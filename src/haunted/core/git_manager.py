"""Git management for Haunted."""

from typing import Optional, List, Dict
from pathlib import Path
import os
from contextlib import contextmanager
import threading
from git import Repo, InvalidGitRepositoryError
from git.exc import GitCommandError

from haunted.models import Issue, Phase, Task
from haunted.utils.logger import get_logger

logger = get_logger(__name__)


class GitManager:
    """Manages Git operations for Haunted workflow."""

    def __init__(self, repo_path: str = "."):
        """
        Initialize Git manager.

        Args:
            repo_path: Path to Git repository

        Raises:
            InvalidGitRepositoryError: If path is not a Git repository
        """
        self.repo_path = Path(repo_path)

        try:
            self.repo = Repo(repo_path)
            logger.info(f"Git repository initialized at {repo_path}")
        except InvalidGitRepositoryError:
            raise InvalidGitRepositoryError(
                f"Path {repo_path} is not a Git repository. "
                "Run 'git init' to initialize."
            )

        # Initialize in-process reentrant lock for git operations
        self._thread_lock = threading.RLock()

        # Worktree root under project .haunted directory
        self._worktree_root = self.repo_path / ".haunted" / "worktrees"
        try:
            self._worktree_root.mkdir(parents=True, exist_ok=True)
        except Exception:
            # Best-effort; non-fatal if creation fails now
            pass

    @contextmanager
    def _git_lock(self):
        """
        In-process exclusive lock for serializing git state mutations.

        Ensures concurrent async workers within the same daemon don't
        interleave git operations like checkout, merge, and commit.
        """
        with self._thread_lock:
            yield

    def get_current_branch(self) -> str:
        """Get current branch name."""
        return self.repo.active_branch.name

    def branch_exists(self, branch_name: str) -> bool:
        """Check if branch exists."""
        try:
            self.repo.heads[branch_name]
            return True
        except IndexError:
            return False

    def create_branch(self, branch_name: str, base_branch: str = "main") -> str:
        """
        Create new branch from base branch.

        Args:
            branch_name: Name of new branch
            base_branch: Base branch to create from

        Returns:
            Created branch name

        Raises:
            GitCommandError: If branch creation fails
        """
        try:
            with self._git_lock():
                # Check if base branch exists
                if not self.branch_exists(base_branch):
                    logger.warning(
                        f"Base branch {base_branch} not found, using current branch"
                    )
                    base_branch = self.get_current_branch()

                # Create new branch
                if not self.branch_exists(branch_name):
                    new_branch = self.repo.create_head(branch_name, base_branch)
                    logger.info(f"Created branch: {branch_name} from {base_branch}")
                    return new_branch.name
                else:
                    logger.info(f"Branch {branch_name} already exists")
                    return branch_name

        except GitCommandError as e:
            logger.error(f"Failed to create branch {branch_name}: {e}")
            raise

    def checkout_branch(self, branch_name: str, apply_stash: bool = True):
        """
        Checkout to specified branch with optional auto-stash/restore.

        Args:
            branch_name: Branch to checkout
            apply_stash: Whether to re-apply auto-stashed changes after checkout
        """
        try:
            with self._git_lock():
                # Short-circuit if already on target branch
                try:
                    current = self.get_current_branch()
                except Exception:
                    current = None

                # Prepare stash if working tree has changes
                stash_ref_to_apply = None
                if current and current != branch_name:
                    try:
                        has_changes = self.repo.is_dirty(untracked_files=True) or bool(self.repo.untracked_files)
                    except Exception:
                        has_changes = False

                    if has_changes:
                        message = f"haunted-auto-stash:{current}->{branch_name}"
                        try:
                            self.repo.git.stash("push", "-u", "-m", message)
                            # Find the just-created stash ref by message
                            stash_list = self.repo.git.stash("list")
                            for line in stash_list.splitlines():
                                if message in line:
                                    stash_ref_to_apply = line.split(":", 1)[0].strip()
                                    break
                            logger.info(f"Auto-stashed changes before checkout: {message}")
                        except GitCommandError as e:
                            logger.warning(f"Failed to auto-stash before checkout: {e}")

                # Perform checkout
                self.repo.heads[branch_name].checkout()
                logger.info(f"Checked out to branch: {branch_name}")

                # Optionally restore stash onto the target branch
                if apply_stash and stash_ref_to_apply:
                    try:
                        self.repo.git.stash("apply", stash_ref_to_apply)
                        # Drop the applied stash entry
                        try:
                            self.repo.git.stash("drop", stash_ref_to_apply)
                        except GitCommandError:
                            pass
                        logger.info("Re-applied auto-stashed changes after checkout")
                    except GitCommandError as e:
                        logger.warning(f"Failed to re-apply auto-stashed changes: {e}")
        except GitCommandError as e:
            logger.error(f"Failed to checkout branch {branch_name}: {e}")
            raise

    # ----------------------------
    # Worktree management helpers
    # ----------------------------
    def worktree_root(self) -> Path:
        """Return the base directory where per-issue worktrees are stored."""
        return self._worktree_root

    def get_worktree_path(self, branch_name: str) -> Path:
        """Get the filesystem path for a branch's worktree."""
        safe_name = branch_name.replace("/", "-")
        return self._worktree_root / safe_name

    def list_worktrees(self) -> List[Dict[str, str]]:
        """List existing git worktrees (parsed from porcelain output)."""
        try:
            with self._git_lock():
                out = self.repo.git.worktree("list", "--porcelain")
        except GitCommandError:
            return []

        entries: List[Dict[str, str]] = []
        current: Dict[str, str] = {}
        for line in out.splitlines():
            if line.startswith("worktree "):
                if current:
                    entries.append(current)
                    current = {}
                current["worktree"] = line.split(" ", 1)[1].strip()
            elif line.startswith("branch "):
                current["branch"] = line.split(" ", 1)[1].strip()
            elif line.startswith("bare"):
                current["bare"] = "true"
            elif line.startswith("detached"):
                current["detached"] = "true"
        if current:
            entries.append(current)
        return entries

    def _worktree_exists(self, path: Path) -> bool:
        """Check if a path is already registered as a worktree."""
        for wt in self.list_worktrees():
            if os.path.abspath(wt.get("worktree", "")) == os.path.abspath(str(path)):
                return True
        return False

    def ensure_worktree_for_branch(
        self, branch_name: str, base_branch: Optional[str] = None
    ) -> Path:
        """
        Ensure a dedicated worktree exists for a branch.

        - If branch exists: add worktree checked out to that branch
        - If branch does not exist: create from base_branch (or fallback)

        Returns:
            Path to the worktree directory
        """
        path = self.get_worktree_path(branch_name)
        path.parent.mkdir(parents=True, exist_ok=True)

        with self._git_lock():
            # Create branch if needed
            if not self.branch_exists(branch_name):
                base = base_branch or "main"
                try:
                    # If base missing, fallback to current branch
                    if not self.branch_exists(base):
                        base = self.get_current_branch()
                except Exception:
                    pass
                # Create branch in main repo first
                self.create_branch(branch_name, base)

            # Add worktree if not present
            if not self._worktree_exists(path):
                try:
                    # Prefer checkout of existing branch into new worktree
                    self.repo.git.worktree(
                        "add", "--checkout", str(path), branch_name
                    )
                    logger.info(
                        f"Added worktree for branch {branch_name} at {path}"
                    )
                except GitCommandError as e:
                    logger.error(
                        f"Failed to add worktree for {branch_name} at {path}: {e}"
                    )
                    raise

        return path

    def remove_worktree(self, branch_name: Optional[str] = None, path: Optional[str] = None, force: bool = False) -> bool:
        """
        Remove a worktree by branch name or path (leaves branch intact).

        Args:
            branch_name: Branch whose worktree to remove
            path: Explicit worktree path
            force: Use --force to remove even if not clean

        Returns:
            True if removed or not present
        """
        wt_path = Path(path) if path else (self.get_worktree_path(branch_name) if branch_name else None)
        if not wt_path:
            return False

        args = ["prune"]  # Prune stale first
        try:
            with self._git_lock():
                try:
                    self.repo.git.worktree(*args)
                except GitCommandError:
                    pass

                if self._worktree_exists(wt_path):
                    cmd = ["remove"]
                    if force:
                        cmd.append("--force")
                    cmd.append(str(wt_path))
                    self.repo.git.worktree(*cmd)
                    logger.info(f"Removed worktree at {wt_path}")
        except GitCommandError as e:
            logger.error(f"Failed to remove worktree at {wt_path}: {e}")
            return False
        return True

    def create_phase_branch(self, phase: Phase) -> str:
        """
        Create branch for a phase.

        Args:
            phase: Phase object

        Returns:
            Created branch name
        """
        return self.create_branch(phase.branch_name, "main")

    def create_issue_branch(
        self, issue: Issue, base_branch: Optional[str] = None
    ) -> str:
        """
        Create branch for an issue.

        Args:
            issue: Issue object
            base_branch: Base branch (defaults to phase branch or main)

        Returns:
            Created branch name
        """
        # Determine base branch
        if not base_branch:
            if issue.phase_id:
                # Use phase branch as base
                base_branch = f"phase/{issue.phase_id}"
                if not self.branch_exists(base_branch):
                    base_branch = "main"
            else:
                base_branch = "main"

        return self.create_branch(issue.branch_name, base_branch)

    def commit_changes(self, message: str, add_all: bool = True) -> Optional[str]:
        """
        Commit changes to current branch.

        Args:
            message: Commit message
            add_all: Add all changes before commit

        Returns:
            Commit hash if successful
        """
        try:
            with self._git_lock():
                # Check if there are changes to commit
                if not self.repo.is_dirty() and not self.repo.untracked_files:
                    logger.info("No changes to commit")
                    return None

                # Add files
                if add_all:
                    self.repo.git.add(".")

                # Commit
                commit = self.repo.index.commit(message)
                logger.info(f"Committed changes: {commit.hexsha[:8]} - {message}")
                return commit.hexsha

        except GitCommandError as e:
            logger.error(f"Failed to commit changes: {e}")
            raise

    def commit_task_completion(self, task: Task, issue: Issue) -> str:
        """
        Commit task completion.

        Args:
            task: Completed task
            issue: Associated issue

        Returns:
            Commit hash
        """
        message = (
            f"Task #{task.id}: {task.description}\n\nIssue: #{issue.id} - {issue.title}"
        )
        return self.commit_changes(message)

    def commit_workflow_stage(
        self, issue: Issue, stage: str, description: str = ""
    ) -> str:
        """
        Commit workflow stage completion.

        Args:
            issue: Issue object
            stage: Workflow stage name
            description: Optional description

        Returns:
            Commit hash
        """
        message = f"Issue #{issue.id}: Complete {stage} stage"
        if description:
            message += f"\n\n{description}"

        message += f"\n\nIssue: {issue.title}"
        return self.commit_changes(message)

    def merge_branch(
        self, source_branch: str, target_branch: str, delete_source: bool = True
    ) -> bool:
        """
        Merge source branch into target branch.

        Args:
            source_branch: Source branch to merge
            target_branch: Target branch
            delete_source: Delete source branch after merge

        Returns:
            True if successful
        """
        try:
            with self._git_lock():
                # Checkout target branch (do not bring along working changes)
                self.checkout_branch(target_branch, apply_stash=False)

                # Merge source branch
                try:
                    self.repo.git.merge(source_branch, "--no-ff")
                    logger.info(f"Merged {source_branch} into {target_branch}")
                except GitCommandError as e:
                    # If merge produced conflicts, leave repo in merge state and bubble up
                    logger.warning(
                        f"Merge reported error/possibly conflicts {source_branch} -> {target_branch}: {e}"
                    )
                    raise

                # Delete source branch if requested
                if delete_source and self.branch_exists(source_branch):
                    self.repo.delete_head(source_branch)
                    logger.info(f"Deleted branch: {source_branch}")

                return True

        except GitCommandError as e:
            logger.error(f"Failed to merge {source_branch} into {target_branch}: {e}")
            return False

    def merge_issue_to_phase(self, issue: Issue, phase: Optional[Phase] = None) -> bool:
        """
        Merge completed issue branch to phase branch.

        Args:
            issue: Completed issue
            phase: Target phase (optional)

        Returns:
            True if successful
        """
        target_branch = phase.branch_name if phase else "main"
        return self.merge_branch(issue.branch_name, target_branch)

    def has_conflicts(self) -> bool:
        """Check if repository has merge conflicts."""
        try:
            # Check for unmerged paths
            return len(self.repo.index.unmerged_blobs()) > 0
        except Exception:
            return False

    def get_conflicted_files(self) -> List[str]:
        """Get list of files with merge conflicts."""
        try:
            unmerged = self.repo.index.unmerged_blobs()
            return list(unmerged.keys())
        except Exception:
            return []

    def auto_resolve_conflicts(self) -> bool:
        """
        Attempt to automatically resolve merge conflicts.

        This is a simple implementation that takes the incoming changes.
        In practice, this would need more sophisticated conflict resolution.

        Returns:
            True if conflicts resolved successfully
        """
        try:
            with self._git_lock():
                conflicted_files = self.get_conflicted_files()

                if not conflicted_files:
                    return True

                logger.warning(f"Found {len(conflicted_files)} conflicted files")

                # For now, use simple strategy: accept incoming changes
                for file_path in conflicted_files:
                    self.repo.git.checkout("--theirs", file_path)
                    logger.info(f"Resolved conflict in {file_path} (accepted incoming)")

                # Add resolved files
                self.repo.index.add(conflicted_files)

                # Complete merge
                self.repo.index.commit("Resolve merge conflicts automatically")

                logger.info("Merge conflicts resolved automatically")
                return True

        except GitCommandError as e:
            logger.error(f"Failed to auto-resolve conflicts: {e}")
            return False

    def get_branch_info(self, branch_name: str) -> dict:
        """
        Get information about a branch.

        Args:
            branch_name: Branch name

        Returns:
            Branch information dictionary
        """
        try:
            branch = self.repo.heads[branch_name]
            return {
                "name": branch.name,
                "commit": branch.commit.hexsha,
                "author": str(branch.commit.author),
                "message": branch.commit.message.strip(),
                "date": branch.commit.committed_datetime.isoformat(),
            }
        except IndexError:
            return {}

    def get_repository_status(self) -> dict:
        """
        Get repository status information.

        Returns:
            Repository status dictionary
        """
        return {
            "current_branch": self.get_current_branch(),
            "is_dirty": self.repo.is_dirty(),
            "untracked_files": self.repo.untracked_files,
            "modified_files": [item.a_path for item in self.repo.index.diff(None)],
            "staged_files": [item.a_path for item in self.repo.index.diff("HEAD")],
            "has_conflicts": self.has_conflicts(),
            "conflicted_files": self.get_conflicted_files(),
        }

    def cleanup_merged_branches(self):
        """Clean up merged feature branches."""
        try:
            with self._git_lock():
                # Get merged branches (excluding main and current)
                current_branch = self.get_current_branch()
                main_branches = ["main", "master", "develop"]

                merged_branches = []
                for branch in self.repo.heads:
                    if branch.name not in main_branches and branch.name != current_branch:
                        # Check if branch is merged into main
                        try:
                            merge_base = self.repo.merge_base(branch, self.repo.heads.main)[
                                0
                            ]
                            if merge_base == branch.commit:
                                merged_branches.append(branch.name)
                        except (IndexError, AttributeError):
                            continue

                # Delete merged branches
                for branch_name in merged_branches:
                    self.repo.delete_head(branch_name)
                    logger.info(f"Cleaned up merged branch: {branch_name}")

                logger.info(f"Cleaned up {len(merged_branches)} merged branches")

        except Exception as e:
            logger.error(f"Failed to cleanup branches: {e}")
