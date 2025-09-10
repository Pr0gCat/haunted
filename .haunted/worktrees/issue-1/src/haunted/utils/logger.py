"""Logging utilities for Haunted."""

import logging
import sys
from pathlib import Path
from typing import Optional
from rich.console import Console
from rich.logging import RichHandler
from rich.traceback import install


def setup_logging(level: str = "INFO", log_file: Optional[str] = None):
    """
    Setup logging with Rich formatting.
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR)
        log_file: Optional log file path
    """
    # Install rich traceback handler
    install(show_locals=True)
    
    # Create console for rich logging
    console = Console()
    
    # Configure root logger
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(message)s",
        datefmt="[%X]",
        handlers=[
            RichHandler(
                console=console,
                rich_tracebacks=True,
                tracebacks_show_locals=True
            )
        ]
    )
    
    # Add file handler if specified
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        file_handler = logging.FileHandler(log_path)
        file_handler.setLevel(getattr(logging, level.upper()))
        file_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        file_handler.setFormatter(file_formatter)
        
        # Add to root logger
        logging.getLogger().addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    """
    Get logger with Rich formatting.
    
    Args:
        name: Logger name (usually __name__)
        
    Returns:
        Configured logger
    """
    return logging.getLogger(name)


# Initialize default logging
setup_logging()