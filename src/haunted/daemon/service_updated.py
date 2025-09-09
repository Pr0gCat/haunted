"""Updated Haunted daemon service using Claude Code CLI integration."""

import asyncio
import signal
from typing import List, Dict, Optional, Any
from datetime import datetime

from ..core.workflow import WorkflowEngine
from ..core.database import DatabaseManager
from ..core.git_manager import GitManager
from ..models import IssueStatus, WorkflowStage
from ..utils.config import HauntedConfig
from ..utils.logger import get_logger

logger = get_logger(__name__)


class HauntedDaemonUpdated:
    """Updated daemon service using Claude Code CLI integration."""
    
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
        
        # Use full workflow engine with Claude Code CLI
        self.workflow_engine = WorkflowEngine(self.db_manager)
        
        # Track active issues to prevent duplicates
        self.active_issues: Dict[str, asyncio.Task] = {}
        
        # Performance metrics
        self.processed_issues = 0
        self.failed_issues = 0
        self.start_time = None
        
        logger.info("Updated daemon initialized with Claude Code CLI integration")
    
    async def start(self):
        """Start the daemon service."""
        logger.info("Starting Haunted daemon (Claude Code version)...")
        
        try:
            self.start_time = datetime.now()
            
            # Initialize database
            await self.db_manager.create_tables()
            
            # Check Claude Code availability
            if not await self.workflow_engine.claude_wrapper.check_claude_availability():
                logger.error("Claude Code CLI not available - daemon cannot start")
                return
            
            # Set running flag
            self.running = True
            
            # Setup signal handlers
            self._setup_signal_handlers()
            
            # Start issue scanner
            scanner_task = asyncio.create_task(self._scan_issues())
            
            # Start worker pool
            max_workers = min(self.config.ai.max_concurrent_issues, 3)  # Limit for stability
            for i in range(max_workers):
                worker = asyncio.create_task(self._worker(f"worker-{i}"))
                self.workers.append(worker)
            
            logger.info(f"Daemon started with {len(self.workers)} workers")
            self._log_status()
            
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
            logger.info(f"Received signal {signum}, initiating graceful shutdown...")
            asyncio.create_task(self.stop())
        
        try:
            signal.signal(signal.SIGINT, signal_handler)
            signal.signal(signal.SIGTERM, signal_handler)
        except Exception as e:
            logger.warning(f"Could not setup signal handlers: {e}")
    
    async def stop(self):
        """Stop the daemon gracefully."""
        logger.info("Stopping daemon...")
        self.running = False
        
        # Cancel all active issue tasks
        for issue_id, task in self.active_issues.items():
            if not task.done():
                logger.info(f"Cancelling active task for issue {issue_id}")
                task.cancel()
        
        self._log_final_stats()
    
    async def _wait_for_shutdown(self, tasks: List[asyncio.Task]):
        """Wait for shutdown signal or task completion."""
        try:
            while self.running:
                # Log periodic status
                if self.processed_issues % 5 == 0 and self.processed_issues > 0:
                    self._log_status()
                
                await asyncio.sleep(self.config.daemon.scan_interval)
                
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received")
            await self.stop()
        finally:
            # Cancel remaining tasks
            for task in tasks:
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
    
    async def _scan_issues(self):
        """Continuously scan for new issues to process."""
        logger.info("Issue scanner started")
        
        while self.running:
            try:
                # Get all issues for now (bypassing status filter)
                issues = await self.db_manager.list_issues()
                logger.info(f"Scanner found {len(issues)} open issues")
                
                for issue_dict in issues:
                    issue_id = issue_dict['id']
                    stage = issue_dict.get('workflow_stage', 'unknown')
                    status = issue_dict.get('status', 'unknown')
                    logger.info(f"Issue {issue_id}: status='{status}', stage='{stage}', active={issue_id in self.active_issues}")
                    
                    # Skip if already being processed
                    if issue_id in self.active_issues:
                        logger.info(f"Skipping {issue_id} - already active")
                        continue
                        
                    # Skip if not open status (accept both lowercase and uppercase)
                    if status.lower() != 'open':
                        logger.info(f"Skipping {issue_id} - not open status '{status}'")
                        continue
                    
                    # Skip if in wrong stage
                    if stage not in ['plan', 'PLAN']:
                        logger.info(f"Skipping {issue_id} - wrong stage '{stage}'")
                        continue
                    
                    # Add to queue
                    await self.issue_queue.put(issue_dict)
                    logger.info(f"✓ Queued issue {issue_id}: {issue_dict['title']}")
                
                # Wait before next scan
                logger.info(f"Scanner sleeping for {self.config.daemon.scan_interval} seconds")
                await asyncio.sleep(self.config.daemon.scan_interval)
                
            except Exception as e:
                logger.error(f"Issue scanning error: {e}")
                await asyncio.sleep(5)  # Short delay before retry
    
    async def _worker(self, worker_id: str):
        """Worker to process issues from the queue."""
        logger.info(f"Worker {worker_id} started")
        
        while self.running:
            try:
                # Get issue from queue with timeout
                try:
                    issue_dict = await asyncio.wait_for(
                        self.issue_queue.get(), 
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    continue
                
                issue_id = issue_dict['id']
                logger.info(f"Worker {worker_id} processing issue {issue_id}")
                
                # Create processing task
                task = asyncio.create_task(self._process_issue(issue_dict, worker_id))
                self.active_issues[issue_id] = task
                
                # Wait for completion
                try:
                    await task
                    self.processed_issues += 1
                    logger.info(f"✅ Worker {worker_id} completed issue {issue_id}")
                    
                except Exception as e:
                    self.failed_issues += 1
                    logger.error(f"❌ Worker {worker_id} failed processing issue {issue_id}: {e}")
                
                finally:
                    # Remove from active issues
                    if issue_id in self.active_issues:
                        del self.active_issues[issue_id]
                    
                    # Mark task as done in queue
                    self.issue_queue.task_done()
                
            except Exception as e:
                logger.error(f"Worker {worker_id} error: {e}")
                await asyncio.sleep(1)
        
        logger.info(f"Worker {worker_id} stopped")
    
    async def _process_issue(self, issue_dict: Dict[str, Any], worker_id: str):
        """
        Process a single issue through the workflow.
        
        Args:
            issue_dict: Issue data dictionary
            worker_id: ID of the processing worker
        """
        issue_id = issue_dict['id']
        logger.info(f"[{worker_id}] Starting workflow for issue {issue_id}")
        
        try:
            # Process through workflow engine
            result = await self.workflow_engine.process_issue(issue_dict.copy())
            
            # Log results
            if result['workflow_stage'] == 'done':
                if result['status'] == 'closed':
                    logger.info(f"[{worker_id}] ✅ Issue {issue_id} completed successfully")
                    
                    # Attempt Git operations if enabled
                    if self.config.git.auto_commit:
                        await self._handle_git_operations(result, worker_id)
                        
                else:
                    logger.warning(f"[{worker_id}] ⚠️ Issue {issue_id} finished but blocked: {result.get('diagnosis_log', 'Unknown issue')}")
            else:
                logger.warning(f"[{worker_id}] ⚠️ Issue {issue_id} did not complete workflow")
            
            return result
            
        except Exception as e:
            logger.error(f"[{worker_id}] Issue {issue_id} processing failed: {e}")
            
            # Try to diagnose the issue
            try:
                diagnosis = await self.workflow_engine.diagnose_issue(issue_dict, str(e))
                logger.info(f"[{worker_id}] Diagnosis for {issue_id}: {diagnosis[:200]}...")
            except:
                logger.warning(f"[{worker_id}] Could not diagnose issue {issue_id}")
            
            raise
    
    async def _handle_git_operations(self, result: Dict[str, Any], worker_id: str):
        """Handle Git operations for completed issues."""
        issue_id = result['id']
        
        try:
            # Switch to issue branch
            branch_name = result.get('branch_name', f"issue/{issue_id[:8]}")
            
            # Create commit message
            commit_msg = self.config.git.commit_message_template.format(
                issue_id=issue_id,
                stage="completed", 
                description=result['title']
            )
            
            logger.info(f"[{worker_id}] Git operations for {issue_id} would commit: {commit_msg}")
            
            # TODO: Implement actual Git operations
            # self.git_manager.commit_changes(commit_msg)
            # if self.config.git.auto_merge:
            #     self.git_manager.merge_to_main(branch_name)
            
        except Exception as e:
            logger.error(f"[{worker_id}] Git operations failed for {issue_id}: {e}")
    
    async def _cleanup(self):
        """Cleanup resources."""
        logger.info("Cleaning up daemon resources...")
        
        # Close database connections
        try:
            await self.db_manager.close()
        except Exception as e:
            logger.error(f"Database cleanup error: {e}")
        
        logger.info("Daemon cleanup completed")
    
    def _log_status(self):
        """Log current daemon status."""
        uptime = datetime.now() - self.start_time if self.start_time else "unknown"
        
        logger.info(
            f"📊 Daemon Status - "
            f"Processed: {self.processed_issues}, "
            f"Failed: {self.failed_issues}, "
            f"Active: {len(self.active_issues)}, "
            f"Queue: {self.issue_queue.qsize()}, "
            f"Uptime: {uptime}"
        )
    
    def _log_final_stats(self):
        """Log final statistics."""
        total_runtime = datetime.now() - self.start_time if self.start_time else None
        success_rate = (self.processed_issues / (self.processed_issues + self.failed_issues) * 100) if (self.processed_issues + self.failed_issues) > 0 else 0
        
        logger.info(
            f"🏁 Final Stats - "
            f"Total Processed: {self.processed_issues}, "
            f"Failed: {self.failed_issues}, "
            f"Success Rate: {success_rate:.1f}%, "
            f"Runtime: {total_runtime}"
        )


# For backward compatibility, create an alias
HauntedDaemon = HauntedDaemonUpdated