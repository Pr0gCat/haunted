"""Haunted daemon service for autonomous issue processing."""

import asyncio
import os
import signal
from typing import List, Dict
from rich.live import Live
from rich.table import Table
from rich.panel import Panel
from rich.console import Group

from haunted.core.workflow import WorkflowEngine
from haunted.core.claude_wrapper import ClaudeCodeWrapper
from haunted.core.database import DatabaseManager
from haunted.core.git_manager import GitManager
from haunted.models import Issue, IssueStatus, WorkflowStage
from haunted.utils.config import HauntedConfig
from haunted.utils.logger import get_logger

logger = get_logger(__name__)


class HauntedDaemon:
    """Main daemon service for processing issues autonomously."""

    def __init__(self, config: HauntedConfig):
        """
        Initialize Haunted daemon.

        Args:
            config: Haunted configuration
        """
        self.config = config
        self.running = False
        self.workers: List[asyncio.Task] = []
        self.issue_queue = asyncio.Queue()

        # Initialize components
        self.db_manager = DatabaseManager(config.database.url)
        self.git_manager = GitManager(config.project_root)
        self.agent = ClaudeCodeWrapper()
        self.workflow_engine = WorkflowEngine(self.db_manager, config.project_root)
        # Track per-issue current stage for UI
        self._issue_stages: Dict[int, str] = {}

        def _on_stage_change(issue_id, stage_value):
            if issue_id is None:
                return
            self._issue_stages[int(issue_id)] = stage_value

        self.workflow_engine.on_stage_change = _on_stage_change

        # Track active issues to prevent duplicates
        self.active_issues: Dict[str, asyncio.Task] = {}

        # Track Ctrl+C (SIGINT) count for force-exit on second interrupt
        self._interrupt_count = 0

        logger.info("Daemon initialized")

    async def start(self):
        """Start the daemon service."""
        logger.info("Starting Haunted daemon...")

        try:
            # Initialize database
            await self.db_manager.create_tables()

            # Set running flag
            self.running = True

            # Setup signal handlers
            self._setup_signal_handlers()

            # Start issue scanner
            scanner_task = asyncio.create_task(self._scan_issues())

            # Start worker pool
            for i in range(self.config.ai.max_concurrent_issues):
                worker = asyncio.create_task(self._worker(f"worker-{i}"))
                self.workers.append(worker)

            logger.info(f"Daemon started with {len(self.workers)} workers")

            # Start UI live table
            # ui_task = asyncio.create_task(self._run_live_status())

            # Wait for shutdown
            await self._wait_for_shutdown([scanner_task] + self.workers)

        except Exception as e:
            logger.error(f"Daemon startup failed: {e}")
            raise
        finally:
            await self._cleanup()

    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown."""

        def signal_handler(signum, frame):
            self._interrupt_count += 1
            if self._interrupt_count == 1:
                logger.info(
                    f"Received signal {signum}, initiating graceful shutdown... (press Ctrl+C again to force exit)"
                )
                asyncio.create_task(self.stop())
            else:
                logger.warning("Second interrupt received. Force exiting now.")
                asyncio.create_task(self._force_exit())

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

    async def _force_exit(self):
        """Force exit immediately on second Ctrl+C without waiting for cleanup."""
        try:
            # Best-effort: cancel running tasks quickly
            for task in list(self.active_issues.values()):
                if not task.done():
                    task.cancel()
        finally:
            # Exit with 130 (SIGINT convention)
            os._exit(130)

    async def stop(self):
        """Stop the daemon gracefully."""
        logger.info("Stopping daemon...")
        self.running = False

    async def _wait_for_shutdown(self, tasks: List[asyncio.Task]):
        """Wait for shutdown signal or task completion."""
        try:
            while self.running:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            logger.info("Received keyboard interrupt")
        finally:
            # Cancel all tasks
            for task in tasks:
                task.cancel()

            # Wait for tasks to complete
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _cleanup(self):
        """Cleanup resources."""
        logger.info("Cleaning up resources...")

        # Cancel active issue tasks
        for issue_id, task in self.active_issues.items():
            if not task.done():
                logger.info(f"Cancelling active issue task: {issue_id}")
                task.cancel()

        # Wait for active tasks to complete
        if self.active_issues:
            await asyncio.gather(*self.active_issues.values(), return_exceptions=True)

        # Close database connection
        await self.db_manager.close()

        logger.info("Cleanup completed")

    async def _run_live_status(self):
        """Render a live status table using Rich while daemon is running."""
        def build_tables() -> Group:
            # Summary table
            summary = Table(title="Haunted Daemon Status")
            summary.add_column("Metric", style="cyan")
            summary.add_column("Value", style="green")

            status = {
                "running": str(self.running),
                "workers": str(len(self.workers)),
                "active_issues": str(len(self.active_issues)),
                "queue_size": str(self.issue_queue.qsize()),
            }
            for k, v in status.items():
                summary.add_row(k, v)

            # Active issues table with stages
            issues = Table(title="Active Issues")
            issues.add_column("Issue ID", style="cyan", justify="right")
            issues.add_column("Stage", style="magenta")
            issues.add_column("Worker", style="yellow")

            for issue_id in self.active_issues.keys():
                stage = self._issue_stages.get(int(issue_id), "-")
                # Worker info not strictly tracked per issue; show total workers
                issues.add_row(str(issue_id), stage, str(len(self.workers)))

            return Group(summary, Panel(issues, title="Per-Issue Stage"))

        with Live(build_tables(), refresh_per_second=4) as live:
            while self.running:
                await asyncio.sleep(0.25)
                # Update table
                live.update(build_tables())

    async def _scan_issues(self):
        """Scan for new issues and add them to processing queue."""
        logger.info("Issue scanner started")

        while self.running:
            try:
                # Get open issues ordered by priority
                issues = await self.db_manager.get_open_issues_by_priority()
                try:
                    logger.debug(
                        f"Scanner fetched {len(issues)} open issues: "
                        f"{[i.get('id') if isinstance(i, dict) else getattr(i, 'id', None) for i in issues]}"
                    )
                except Exception:
                    pass

                # Filter out already active issues
                current_active = list(self.active_issues.keys())
                try:
                    logger.debug(f"Active issue IDs: {current_active}")
                except Exception:
                    pass

                new_issues = [
                    issue for issue in issues if issue.get("id") not in self.active_issues
                ]

                # Add new issues to queue
                for issue in new_issues:
                    await self.issue_queue.put(issue)
                    logger.info(f"Queued issue {issue.get('id')}: {issue.get('title')}")

                if new_issues:
                    logger.info(f"Queued {len(new_issues)} new issues")
                else:
                    logger.debug("No new issues to queue this cycle")

                # Wait before next scan
                await asyncio.sleep(self.config.daemon.scan_interval)

            except Exception as e:
                logger.error(f"Issue scanner error: {e}")
                await asyncio.sleep(10)  # Wait before retry

    async def _worker(self, worker_id: str):
        """Worker for processing issues."""
        logger.info(f"Worker {worker_id} started")

        while self.running:
            try:
                # Get issue from queue (with timeout to allow shutdown)
                try:
                    issue = await asyncio.wait_for(self.issue_queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    continue

                # Process the issue
                await self._process_issue(issue, worker_id)

            except Exception as e:
                logger.error(f"Worker {worker_id} error: {e}")
                await asyncio.sleep(5)  # Brief pause before continuing

        logger.info(f"Worker {worker_id} stopped")

    async def _process_issue(self, issue: Dict, worker_id: str):
        """
        Process a single issue through the workflow.

        Args:
            issue: Issue to process
            worker_id: ID of worker processing the issue
        """
        issue_id = issue.get("id")
        logger.info(f"Worker {worker_id} processing issue {issue_id}: {issue.get('title')}")

        # Initialize branch_name for cleanup
        branch_name = None

        try:
            # Mark issue as active
            self.active_issues[issue_id] = asyncio.current_task()

            # Update issue status to in_progress
            issue_model = await self.db_manager.get_issue(int(issue_id))
            if not issue_model:
                raise ValueError(f"Issue not found: {issue_id}")
            
            # Store branch name for cleanup later (before session expires)
            branch_name = issue_model.branch_name
            
            issue_model.status = IssueStatus.IN_PROGRESS
            await self.db_manager.update_issue(issue_model)

            # Create or checkout issue worktree
            worktree_path = None
            try:
                worktree_path = self.git_manager.ensure_worktree_for_branch(
                    issue_model.branch_name
                )
                logger.info(
                    f"Using worktree for issue {issue_id} at {worktree_path}"
                )
            except Exception as e:
                logger.warning(
                    f"Worktree setup failed for issue {issue_id}: {e}; falling back to in-repo checkout"
                )
                try:
                    self.git_manager.create_issue_branch(issue_model)
                    self.git_manager.checkout_branch(issue_model.branch_name)
                except Exception as e2:
                    logger.warning(
                        f"Git branch setup failed for issue {issue_id}: {e2}"
                    )

            # Process through workflow engine
            # If worktree is available, run workflow with project_root pointing to it
            if worktree_path:
                # Temporarily change CWD for the duration of processing to the worktree
                prev_cwd = os.getcwd()
                try:
                    os.chdir(str(worktree_path))
                except Exception:
                    prev_cwd = None
                try:
                    processed_issue = await self.workflow_engine.process_issue(issue)
                finally:
                    if prev_cwd:
                        os.chdir(prev_cwd)
            else:
                processed_issue = await self.workflow_engine.process_issue(issue)

            # Update issue with processed results (if workflow returned results)
            if processed_issue:
                updated_issue = await self.db_manager.get_issue(int(issue_id))
                if updated_issue:
                    if processed_issue.get("status"):
                        updated_issue.status = IssueStatus(processed_issue["status"])
                    if processed_issue.get("workflow_stage"):
                        updated_issue.workflow_stage = WorkflowStage(processed_issue["workflow_stage"])
                    await self.db_manager.update_issue(updated_issue)

            # Handle completion
            if processed_issue and processed_issue.get("workflow_stage") == WorkflowStage.DONE.value:
                if processed_issue.get("status") == IssueStatus.CLOSED.value:
                    # Successfully completed - merge branch
                    try:
                        success = self.git_manager.merge_issue_to_phase(issue_model)
                        if not success and self.git_manager.has_conflicts():
                            # Build conflict summary for Claude
                            conflicted_files = self.git_manager.get_conflicted_files()
                            summary = "Conflicted files:\n" + "\n".join(conflicted_files)

                            # Ask Claude to resolve by editing files in-place
                            agent = ClaudeCodeWrapper(project_root=self.config.project_root)
                            _ = await agent.resolve_merge_conflicts(summary)

                            # Stage all and attempt to conclude merge
                            try:
                                self.git_manager.repo.git.add("-A")
                                self.git_manager.repo.index.commit("Resolve merge conflicts via Claude")
                                logger.info("Committed Claude-based conflict resolution")
                                # Retry delete of source branch if needed will be handled by merge result
                                success = True
                            except Exception as e_commit:
                                logger.error(f"Failed to commit conflict resolution: {e_commit}")
                                success = False

                        if success:
                            logger.info(f"Successfully merged issue {issue_id}")
                        else:
                            logger.warning(f"Failed to merge issue {issue_id}")
                    except Exception as e:
                        logger.error(f"Merge failed for issue {issue_id}: {e}")

                elif processed_issue.get("status") == IssueStatus.BLOCKED.value:
                    logger.warning(f"Issue {issue_id} blocked after processing")

                # Add completion comment
                await self.db_manager.add_comment(
                    int(issue_id),
                    "ai",
                    f"Issue processing completed by worker {worker_id}. "
                    f"Final status: {processed_issue.get('status')}, "
                    f"Stage: {processed_issue.get('workflow_stage')}",
                )

            logger.info(f"Worker {worker_id} completed issue {issue_id}")

        except Exception as e:
            logger.error(f"Worker {worker_id} failed to process issue {issue_id}: {e}")

            # Mark issue as blocked
            try:
                issue_model = await self.db_manager.get_issue(int(issue_id))
                if issue_model:
                    issue_model.status = IssueStatus.BLOCKED
                    await self.db_manager.update_issue(issue_model)

                # Add error comment
                await self.db_manager.add_comment(
                    int(issue_id), "ai", f"Issue processing failed: {str(e)}"
                )
            except Exception as update_error:
                logger.error(
                    f"Failed to update blocked issue {issue_id}: {update_error}"
                )

        finally:
            # Remove from active issues
            if issue_id in self.active_issues:
                del self.active_issues[issue_id]

            # Best-effort: cleanup worktree after processing
            if branch_name:
                try:
                    self.git_manager.remove_worktree(branch_name=branch_name, force=True)
                except Exception as e:
                    logger.warning(f"Failed to cleanup worktree for issue {issue_id}: {e}")

    async def get_status(self) -> Dict:
        """
        Get daemon status information.

        Returns:
            Status dictionary
        """
        return {
            "running": self.running,
            "workers": len(self.workers),
            "active_issues": len(self.active_issues),
            "queue_size": self.issue_queue.qsize(),
            "active_issue_ids": list(self.active_issues.keys()),
            "config": {
                "max_concurrent_issues": self.config.ai.max_concurrent_issues,
                "scan_interval": self.config.daemon.scan_interval,
                "max_iterations": self.config.daemon.max_iterations,
            },
        }
