"""Configuration management for Haunted."""

import os
from pathlib import Path
from typing import Optional, Dict, Any
import yaml
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from .logger import get_logger

logger = get_logger(__name__)


class DatabaseConfig(BaseModel):
    """Database configuration."""
    url: str = Field(default="sqlite:////.haunted/haunted.db")
    echo: bool = Field(default=False)


class AIConfig(BaseModel):
    """AI configuration for Claude Code CLI integration."""
    model: str = Field(default="claude-3-sonnet-20240229", description="Model reference")
    max_tokens: int = Field(default=4000, description="Maximum tokens for responses")
    max_concurrent_issues: int = Field(default=3, description="Max concurrent issues to process")
    rate_limit_retry: bool = Field(default=True, description="Retry on rate limit")


class DaemonConfig(BaseModel):
    """Daemon configuration."""
    scan_interval: int = Field(default=30)  # seconds
    max_iterations: int = Field(default=3)


class GitConfig(BaseModel):
    """Git configuration."""
    auto_merge: bool = Field(default=True)
    auto_commit: bool = Field(default=True)
    commit_message_template: str = Field(default="Issue #{issue_id}: {stage} - {description}")


class HauntedConfig(BaseModel):
    """Main Haunted configuration."""
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    ai: AIConfig = Field(default_factory=AIConfig)
    daemon: DaemonConfig = Field(default_factory=DaemonConfig)
    git: GitConfig = Field(default_factory=GitConfig)
    project_root: str = Field(default=".")


class ConfigManager:
    """Manages Haunted configuration."""
    
    def __init__(self, project_root: str = "."):
        """
        Initialize config manager.
        
        Args:
            project_root: Project root directory
        """
        self.project_root = Path(project_root)
        self.haunted_dir = self.project_root / ".haunted"
        self.config_file = self.haunted_dir / "config.yaml"
        self.env_file = self.project_root / ".env"
        
        # Load environment variables
        if self.env_file.exists():
            load_dotenv(self.env_file)
    
    def ensure_haunted_directory(self):
        """Create .haunted directory if it doesn't exist."""
        self.haunted_dir.mkdir(exist_ok=True)
        logger.info(f"Haunted directory: {self.haunted_dir}")
    
    def create_default_config(self) -> HauntedConfig:
        """
        Create default configuration.
        
        Returns:
            Default configuration
        """
        config = HauntedConfig(
            project_root=str(self.project_root)
        )
        
        # Update database URL to use project-specific path
        config.database.url = f"sqlite:///{self.haunted_dir}/haunted.db"
        
        return config
    
    def save_config(self, config: HauntedConfig):
        """
        Save configuration to file.
        
        Args:
            config: Configuration to save
        """
        self.ensure_haunted_directory()
        
        # Convert to dict
        config_dict = config.model_dump()
        
        with open(self.config_file, "w") as f:
            yaml.dump(config_dict, f, default_flow_style=False)
        
        logger.info(f"Configuration saved to {self.config_file}")
    
    def load_config(self) -> HauntedConfig:
        """
        Load configuration from file and environment.
        
        Returns:
            Loaded configuration
        """
        if not self.config_file.exists():
            logger.info("No config file found, creating default configuration")
            config = self.create_default_config()
            self.save_config(config)
            return config
        
        try:
            with open(self.config_file, "r") as f:
                config_dict = yaml.safe_load(f)
            
            config_dict["project_root"] = str(self.project_root)
            
            # Update database path
            config_dict["database"]["url"] = f"sqlite:///{self.haunted_dir}/haunted.db"
            
            config = HauntedConfig(**config_dict)
            logger.info(f"Configuration loaded from {self.config_file}")
            return config
            
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            logger.info("Creating default configuration")
            config = self.create_default_config()
            self.save_config(config)
            return config
    
    def update_config(self, updates: Dict[str, Any]) -> HauntedConfig:
        """
        Update configuration with new values.
        
        Args:
            updates: Dictionary of updates to apply
            
        Returns:
            Updated configuration
        """
        config = self.load_config()
        
        # Apply updates recursively
        def update_dict(d: Dict[str, Any], updates: Dict[str, Any]):
            for key, value in updates.items():
                if isinstance(value, dict) and key in d and isinstance(d[key], dict):
                    update_dict(d[key], value)
                else:
                    d[key] = value
        
        config_dict = config.model_dump()
        update_dict(config_dict, updates)
        
        # Recreate config object
        
        updated_config = HauntedConfig(**config_dict)
        self.save_config(updated_config)
        
        logger.info("Configuration updated")
        return updated_config
    
    def is_initialized(self) -> bool:
        """
        Check if project is initialized with Haunted.
        
        Returns:
            True if initialized
        """
        return self.haunted_dir.exists() and self.config_file.exists()


def get_config_manager(project_root: str = ".") -> ConfigManager:
    """
    Get configuration manager instance.
    
    Args:
        project_root: Project root directory
        
    Returns:
        Configuration manager
    """
    return ConfigManager(project_root)


def load_config(project_root: str = ".") -> HauntedConfig:
    """
    Load Haunted configuration.
    
    Args:
        project_root: Project root directory
        
    Returns:
        Loaded configuration
    """
    manager = get_config_manager(project_root)
    return manager.load_config()