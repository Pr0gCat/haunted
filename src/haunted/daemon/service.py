"""Haunted daemon service for autonomous issue processing."""

import asyncio
import signal
from typing import List, Dict, Optional
from datetime import datetime

from ..core.workflow import WorkflowEngine
from ..core.claude_wrapper import ClaudeCodeWrapper
from ..core.database import DatabaseManager
from ..core.git_manager import GitManager
from ..models import Issue, IssueStatus, WorkflowStage
from ..utils.config import HauntedConfig
from ..utils.logger import get_logger

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
        self.workflow_engine = WorkflowEngine(self.agent, self.db_manager)
        
        # Track active issues to prevent duplicates
        self.active_issues: Dict[str, asyncio.Task] = {}
        
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
            for i in range(self.config.api.max_concurrent_issues):
                worker = asyncio.create_task(self._worker(f"worker-{i}"))
                self.workers.append(worker)
            
            logger.info(f"Daemon started with {len(self.workers)} workers")
            
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
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    
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
    
    async def _scan_issues(self):
        """Scan for new issues and add them to processing queue."""
        logger.info("Issue scanner started")
        
        while self.running:
            try:
                # Get open issues ordered by priority
                issues = await self.db_manager.get_open_issues_by_priority()
                
                # Filter out already active issues
                new_issues = [
                    issue for issue in issues 
                    if issue.id not in self.active_issues
                ]
                
                # Add new issues to queue
                for issue in new_issues:
                    await self.issue_queue.put(issue)
                    logger.info(f"Queued issue {issue.id}: {issue.title}")
                
                if new_issues:
                    logger.info(f"Queued {len(new_issues)} new issues")
                
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
                    issue = await asyncio.wait_for(
                        self.issue_queue.get(), 
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    continue
                
                # Process the issue
                await self._process_issue(issue, worker_id)
                
            except Exception as e:
                logger.error(f"Worker {worker_id} error: {e}")
                await asyncio.sleep(5)  # Brief pause before continuing
        
        logger.info(f"Worker {worker_id} stopped")
    
    async def _process_issue(self, issue: Issue, worker_id: str):
        """
        Process a single issue through the workflow.
        
        Args:
            issue: Issue to process
            worker_id: ID of worker processing the issue
        """
        logger.info(f"Worker {worker_id} processing issue {issue.id}: {issue.title}")
        
        try:
            # Mark issue as active
            self.active_issues[issue.id] = asyncio.current_task()
            
            # Update issue status to in_progress
            issue.status = IssueStatus.IN_PROGRESS
            await self.db_manager.update_issue(issue)
            
            # Create or checkout issue branch
            try:
                self.git_manager.create_issue_branch(issue)
                self.git_manager.checkout_branch(issue.branch_name)
            except Exception as e:
                logger.warning(f"Git branch setup failed for issue {issue.id}: {e}")
            
            # Process through workflow engine
            processed_issue = await self.workflow_engine.process_issue(issue)
            
            # Handle completion
            if processed_issue.workflow_stage == WorkflowStage.DONE:
                if processed_issue.status == IssueStatus.CLOSED:
                    # Successfully completed - merge branch
                    try:
                        success = self.git_manager.merge_issue_to_phase(processed_issue)
                        if success:
                            logger.info(f"Successfully merged issue {issue.id}")
                        else:
                            logger.warning(f"Failed to merge issue {issue.id}")
                    except Exception as e:
                        logger.error(f"Merge failed for issue {issue.id}: {e}")
                
                elif processed_issue.status == IssueStatus.BLOCKED:
                    logger.warning(f"Issue {issue.id} blocked after processing")
                
                # Add completion comment
                await self.db_manager.add_comment(
                    issue.id,
                    "ai",
                    f"Issue processing completed by worker {worker_id}. "
                    f"Final status: {processed_issue.status}, "
                    f"Stage: {processed_issue.workflow_stage}"
                )
            
            logger.info(f"Worker {worker_id} completed issue {issue.id}")
            
        except Exception as e:
            logger.error(f"Worker {worker_id} failed to process issue {issue.id}: {e}")
            
            # Mark issue as blocked
            try:
                issue.status = IssueStatus.BLOCKED
                await self.db_manager.update_issue(issue)
                
                # Add error comment
                await self.db_manager.add_comment(
                    issue.id,
                    "ai",
                    f"Issue processing failed: {str(e)}"
                )
            except Exception as update_error:
                logger.error(f"Failed to update blocked issue {issue.id}: {update_error}")
        
        finally:
            # Remove from active issues
            if issue.id in self.active_issues:
                del self.active_issues[issue.id]
    
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
                "max_concurrent_issues": self.config.api.max_concurrent_issues,
                "scan_interval": self.config.daemon.scan_interval,
                "max_iterations": self.config.daemon.max_iterations
            }
        }