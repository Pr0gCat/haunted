"""Main CLI interface for Haunted."""

import asyncio

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from haunted import __version__
from haunted.utils.config import get_config_manager, load_config
from haunted.utils.logger import setup_logging, get_logger
from haunted.core.database import DatabaseManager
from haunted.core.git_manager import GitManager
from haunted.models import Issue, WorkflowStage, PhaseStatus, IssueStatus, Priority
from haunted.core.claude_wrapper import ClaudeCodeWrapper
from datetime import datetime

console = Console()
logger = get_logger(__name__)


@click.group()
@click.option("--verbose", "-v", is_flag=True, help="Enable verbose logging")
@click.option("--log-file", help="Log file path")
@click.version_option(version=__version__, prog_name="Haunted")
@click.pass_context
def cli(ctx, verbose, log_file):
    """Haunted - AI-powered development with automated workflow management."""
    # Setup logging
    log_level = "DEBUG" if verbose else "INFO"
    setup_logging(log_level, log_file)

    # Store context
    ctx.ensure_object(dict)
    ctx.obj["verbose"] = verbose


@cli.command()
def init():
    """Initialize Haunted in the current project."""
    # Check if already initialized
    config_manager = get_config_manager()
    if config_manager.is_initialized():
        console.print(
            "[yellow]Haunted is already initialized in this project.[/yellow]"
        )
        return

    # Check if git repository exists, initialize if not
    try:
        git_manager = GitManager()
        console.print(
            f"[green]✓[/green] Git repository detected: {git_manager.get_current_branch()}"
        )
    except Exception:
        console.print(
            "[yellow]⚠[/yellow] Not a Git repository. Initializing git..."
        )
        try:
            # Initialize git repository using GitPython
            from git import Repo

            repo = Repo.init(".")
            console.print("[green]✓[/green] Git repository initialized")

            # Create initial commit if repository is empty
            if not repo.heads:
                # Create an initial commit to establish main branch
                repo.index.commit("Initial commit")
                console.print("[green]✓[/green] Created initial commit")

            # Try to create GitManager again
            git_manager = GitManager()
            console.print(
                f"[green]✓[/green] Now on branch: {git_manager.get_current_branch()}"
            )
        except Exception as init_error:
            console.print(f"[red]✗[/red] Failed to initialize git: {init_error}")
            return

    # Check Claude Code CLI availability
    console.print("[cyan]Checking Claude Code CLI...[/cyan]")

    wrapper = ClaudeCodeWrapper()

    try:
        is_available = asyncio.run(wrapper.check_claude_availability())
        if is_available:
            console.print("[green]✓[/green] Claude Code CLI is available")
        else:
            console.print("[yellow]⚠[/yellow] Claude Code CLI not found")
            console.print("Please install Claude Code: https://claude.ai/download")
            console.print("Or continue anyway - you can install it later")
    except Exception as e:
        console.print(f"[yellow]⚠[/yellow] Could not verify Claude Code: {e}")
        console.print("Continuing with initialization...")

    # Create configuration (no API key needed)
    config = config_manager.create_default_config()
    config_manager.save_config(config)

    # Initialize database
    db_manager = DatabaseManager(config.database.url)
    asyncio.run(db_manager.create_tables())

    console.print(
        Panel.fit(
            "[green]✓ Haunted initialized successfully![/green]\n\n"
            "Next steps:\n"
            "1. Create a phase: [cyan]haunted phase create 'Phase 1'[/cyan]\n"
            "2. Create an issue: [cyan]haunted issue create 'Implement feature'[/cyan]\n"
            "3. Start the daemon: [cyan]haunted start[/cyan]\n\n"
            "[dim]Note: Haunted uses Claude Code CLI - no API key required![/dim]",
            title="Initialization Complete",
        )
    )


@cli.command()
@click.option("--background", "-b", is_flag=True, help="Run daemon in background")
@click.option("--auto-exit", is_flag=True, help="Exit automatically when no more issues to process")
def start(background, auto_exit):
    """Start the Haunted daemon."""
    # Check if initialized
    config_manager = get_config_manager()
    if not config_manager.is_initialized():
        console.print(
            "[red]✗[/red] Project not initialized. Run 'haunted init' first."
        )
        return

    # Load configuration
    config = load_config()

    console.print("[cyan]Starting Haunted daemon...[/cyan]")

    if background:
        console.print("[yellow]Background mode not implemented yet.[/yellow]")
        return

    # Start updated daemon with Claude Code integration
    from haunted.daemon.service import HauntedDaemon

    daemon = HauntedDaemon(config)
    asyncio.run(daemon.start())


@cli.command()
def stop():
    """Stop the Haunted daemon."""
    console.print("[yellow]Daemon stop not implemented yet.[/yellow]")


@cli.command()
def status():
    """Show Haunted status."""
    # Check if initialized
    config_manager = get_config_manager()
    if not config_manager.is_initialized():
        console.print("[red]✗[/red] Project not initialized.")
        return

    # Load configuration and database
    config = load_config()
    db_manager = DatabaseManager(config.database.url)

    async def show_status():
        # Get statistics
        stats = await db_manager.get_issue_stats()

        # Create status table
        table = Table(title="Haunted Status")
        table.add_column("Metric", style="cyan")
        table.add_column("Count", justify="right", style="magenta")

        # Issue status counts
        for status, count in stats.items():
            if status != "workflow_stages":
                table.add_row(f"Issues ({status})", str(count))

        table.add_row("", "")  # Empty row

        # Workflow stage counts
        workflow_stats = stats.get("workflow_stages", {})
        for stage, count in workflow_stats.items():
            if count > 0:
                table.add_row(f"Stage ({stage})", str(count))

        console.print(table)

        # Git status
        try:
            git_manager = GitManager()
            git_status = git_manager.get_repository_status()

            git_table = Table(title="Git Status")
            git_table.add_column("Property", style="cyan")
            git_table.add_column("Value", style="green")

            git_table.add_row("Current Branch", git_status["current_branch"])
            git_table.add_row("Is Dirty", "Yes" if git_status["is_dirty"] else "No")
            git_table.add_row(
                "Untracked Files", str(len(git_status["untracked_files"]))
            )
            git_table.add_row(
                "Modified Files", str(len(git_status["modified_files"]))
            )
            git_table.add_row(
                "Has Conflicts", "Yes" if git_status["has_conflicts"] else "No"
            )

            console.print(git_table)

        except Exception as e:
            console.print(f"[yellow]Git status unavailable: {e}[/yellow]")

    asyncio.run(show_status())


# Phase commands
@cli.group()
def phase():
    """Manage project phases."""
    pass


@phase.command("create")
@click.argument("name")
@click.option("--description", "-d", help="Phase description")
def create_phase(name, description):
    """Create a new phase."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)
    git_manager = GitManager()

    async def create():
        # Create phase in database
        phase = await db_manager.create_phase(name, description)

        # Phase is now returned as dictionary
        phase_id = phase["id"]
        phase_name = phase["name"]
        phase_branch = phase["branch_name"]

        # Create Git branch using stored properties
        try:
            git_manager.create_branch(phase_branch, "main")
            logger.info(f"Created Git branch: {phase_branch}")
        except Exception as git_error:
            logger.warning(f"Git branch creation failed: {git_error}")

        console.print(f"[green]✓[/green] Created phase: {phase_name}")
        console.print(f"  ID: {phase_id}")
        console.print(f"  Branch: {phase_branch}")

    asyncio.run(create())


@phase.command("list")
def list_phases():
    """List all phases."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)

    async def list_all():
        phases = await db_manager.list_phases()

        if not phases:
            console.print("[yellow]No phases found.[/yellow]")
            return

        table = Table(title="Phases")
        table.add_column("ID", style="cyan")
        table.add_column("Name", style="green")
        table.add_column("Status", style="yellow")
        table.add_column("Branch", style="blue")
        table.add_column("Created", style="dim")

        for phase in phases:
            # Handle datetime formatting
            created_at_str = str(phase["created_at"])[:10]  # Get YYYY-MM-DD part
            table.add_row(
                str(phase["id"]),
                phase["name"],
                phase["status"],
                phase["branch_name"],
                created_at_str,
            )

        console.print(table)

    asyncio.run(list_all())


@phase.command("switch")
@click.argument("identifier")
@click.option("--deactivate-others/--no-deactivate-others", default=True, help="Set other phases to planning")
def switch_phase(identifier, deactivate_others):
    """Switch to a phase by ID or name: checks out its branch and marks it active."""
    # Load configuration and managers
    config = load_config()
    db_manager = DatabaseManager(config.database.url)
    git_manager = GitManager()

    async def switch():
        # Resolve phase by id or name
        phase_obj = None
        try:
            # If identifier is an int, try by ID first
            phase_id = int(identifier)
            phase_obj = await db_manager.get_phase(phase_id)
        except ValueError:
            # Not an int, try by name
            phase_obj = await db_manager.get_phase_by_name(identifier)

        if not phase_obj:
            console.print(f"[red]✗[/red] Phase '{identifier}' not found")
            return

        # Ensure branch exists (create if missing)
        branch_name = phase_obj.branch_name
        try:
            if not git_manager.branch_exists(branch_name):
                git_manager.create_branch(branch_name, "main")
        except Exception as e:
            console.print(f"[red]✗[/red] Failed ensuring branch '{branch_name}': {e}")
            return

        # Checkout to phase branch (auto-stash/restore)
        try:
            git_manager.checkout_branch(branch_name, apply_stash=True)
        except Exception as e:
            console.print(f"[red]✗[/red] Failed to checkout branch '{branch_name}': {e}")
            return

        # Activate in DB
        try:
            updated = await db_manager.activate_phase(phase_obj, deactivate_others)
        except Exception as e:
            console.print(f"[yellow]⚠[/yellow] Branch switched but failed to update phase status: {e}")
            updated = {
                "id": phase_obj.id,
                "name": phase_obj.name,
                "status": str(phase_obj.status),
                "branch_name": phase_obj.branch_name,
            }

        console.print(
            f"[green]✓[/green] Switched to phase: {updated['name']}  "
            f"(ID: {updated['id']})\n  Branch: {branch_name}\n  Status: {updated['status']}"
        )

    asyncio.run(switch())


# Issue commands
@cli.group()
def issue():
    """Manage issues."""
    pass


@issue.command("create")
@click.argument("title")
@click.option("--description", "-d", default="", help="Issue description")
@click.option(
    "--priority",
    "-p",
    type=click.Choice(["critical", "high", "medium", "low"]),
    default="medium",
    help="Issue priority",
)
@click.option("--phase", help="Phase ID")
def create_issue(title, description, priority, phase):
    """Create a new issue."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)
    git_manager = GitManager()

    async def create():
        # Create issue in database
        issue = await db_manager.create_issue(title, description, priority, phase)

        # Issue is now returned as dictionary
        issue_id = issue["id"]
        issue_title = issue["title"]
        issue_priority = issue["priority"]
        issue_branch = issue["branch_name"]
        issue_stage = issue["workflow_stage"]

        # Create Git branch (using stored properties)
        try:
            git_manager.create_branch(issue_branch, "main")
            logger.info(f"Created Git branch: {issue_branch}")
        except Exception as git_error:
            logger.warning(f"Git branch creation failed: {git_error}")

        console.print(f"[green]✓[/green] Created issue: {issue_title}")
        console.print(f"  ID: {issue_id}")
        console.print(f"  Priority: {issue_priority}")
        console.print(f"  Branch: {issue_branch}")
        console.print(f"  Workflow Stage: {issue_stage}")

    asyncio.run(create())


@issue.command("list")
@click.option(
    "--status",
    type=click.Choice(["open", "in_progress", "blocked", "closed"]),
    help="Filter by status",
)
@click.option(
    "--stage",
    type=click.Choice([s.value for s in WorkflowStage]),
    help="Filter by workflow stage",
)
def list_issues(status, stage):
    """List issues."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)

    async def list_all():
        issues = await db_manager.list_issues(status=status)

        if not issues:
            console.print("[yellow]No issues found.[/yellow]")
            return

        table = Table(title="Issues")
        table.add_column("ID", style="cyan")
        table.add_column("Title", style="green", max_width=40)
        table.add_column("Priority", style="yellow")
        table.add_column("Status", style="red")
        table.add_column("Stage", style="blue", max_width=15)
        table.add_column("Created", style="dim")

        for issue in issues:
            # Filter by stage if specified
            if stage and issue["workflow_stage"] != stage:
                continue

            # Color priority
            priority_color = {
                "critical": "red",
                "high": "orange1",
                "medium": "yellow",
                "low": "green",
            }.get(issue["priority"], "white")

            # Handle datetime formatting
            created_at_str = str(issue["created_at"])[:10]  # Get YYYY-MM-DD part

            table.add_row(
                str(issue["id"]),
                issue["title"],
                f"[{priority_color}]{issue['priority']}[/{priority_color}]",
                issue["status"],
                issue["workflow_stage"].replace("_", " "),
                created_at_str,
            )

        console.print(table)

    asyncio.run(list_all())


@issue.command("show")
@click.argument("issue_id")
def show_issue(issue_id):
    """Show issue details."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)

    async def show():
        async with db_manager.get_session() as session:
            issue = await session.get(Issue, issue_id)

            if not issue:
                console.print(f"[red]✗[/red] Issue {issue_id} not found")
                return

            # Issue details - access within session
            console.print(f"\n[bold cyan]Issue #{issue.id}[/bold cyan]")
            console.print(f"[green]Title:[/green] {issue.title}")
            console.print(f"[green]Description:[/green] {issue.description}")
            console.print(f"[green]Priority:[/green] {issue.priority}")
            console.print(f"[green]Status:[/green] {issue.status}")
            console.print(f"[green]Workflow Stage:[/green] {issue.workflow_stage}")
            console.print(f"[green]Branch:[/green] {issue.branch_name}")

            # Display plan and diagnosis log if available
            if issue.plan:
                console.print(Panel(issue.plan, title="Implementation Plan"))

            if hasattr(issue, 'diagnosis_log') and issue.diagnosis_log:
                console.print(Panel(issue.diagnosis_log, title="Diagnosis Log"))

            # Comments - get within the same session
            from sqlmodel import select
            from haunted.models import Comment
            
            stmt = (
                select(Comment)
                .where(Comment.issue_id == issue.id)
                .order_by(Comment.created_at)
            )
            result = await session.execute(stmt)
            comments = result.scalars().all()
            
            if comments:
                console.print(f"\n[bold]Comments ({len(comments)}):[/bold]")
                for comment in comments:
                    author_color = "blue" if comment.author == "ai" else "green"
                    console.print(
                        f"[{author_color}]{comment.author}:[/{author_color}] {comment.content}"
                    )
                    console.print(
                        f"[dim]{comment.created_at.strftime('%Y-%m-%d %H:%M')}[/dim]\n"
                    )

    asyncio.run(show())


@issue.command("close")
@click.argument("issue_id")
@click.option("--comment", "-c", help="Closing comment")
def close_issue(issue_id, comment):
    """Close an issue."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)

    async def close():
        async with db_manager.get_session() as session:
            # Get the issue first
            issue = await session.get(Issue, issue_id)
            if not issue:
                console.print(f"[red]✗[/red] Issue {issue_id} not found")
                return
            
            # Update issue status within session
            issue.status = IssueStatus.CLOSED
            issue.workflow_stage = WorkflowStage.DONE
            issue.updated_at = datetime.now()
            session.add(issue)
            
        # Add closing comment if provided (using separate session)
        if comment:
            await db_manager.add_comment(issue_id, "user", comment)
            
        console.print(f"[green]✓[/green] Issue {issue_id} closed")
        if comment:
            console.print(f"  Comment: {comment}")

    asyncio.run(close())


@issue.command("update")
@click.argument("issue_id")
@click.option("--status", type=click.Choice(["open", "in_progress", "blocked", "closed"]), help="Update issue status")
@click.option("--priority", type=click.Choice(["critical", "high", "medium", "low"]), help="Update issue priority")
@click.option("--stage", type=click.Choice([s.value for s in WorkflowStage]), help="Update workflow stage")
def update_issue(issue_id, status, priority, stage):
    """Update issue properties."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)

    async def update():
        async with db_manager.get_session() as session:
            # Get the issue first
            issue = await session.get(Issue, issue_id)
            if not issue:
                console.print(f"[red]✗[/red] Issue {issue_id} not found")
                return
                
            # Update provided fields within session
            updated_fields = []
            if status:
                issue.status = IssueStatus(status)
                updated_fields.append(f"status={status}")
            if priority:
                issue.priority = Priority(priority)
                updated_fields.append(f"priority={priority}")
            if stage:
                issue.workflow_stage = WorkflowStage(stage)
                updated_fields.append(f"stage={stage}")
                
            if not updated_fields:
                console.print("[yellow]No updates specified[/yellow]")
                return
                
            # Save changes within session
            issue.updated_at = datetime.now()
            session.add(issue)
            
        console.print(f"[green]✓[/green] Issue {issue_id} updated: {', '.join(updated_fields)}")

    asyncio.run(update())


@issue.command("comment")
@click.argument("issue_id")
@click.argument("message")
def add_comment(issue_id, message):
    """Add comment to issue."""
    config = load_config()
    db_manager = DatabaseManager(config.database.url)

    async def add():
        await db_manager.add_comment(issue_id, "user", message)
        console.print(f"[green]✓[/green] Comment added to issue {issue_id}")

    asyncio.run(add())


if __name__ == "__main__":
    cli()
