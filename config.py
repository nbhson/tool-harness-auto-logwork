"""Ứng dụng configuration — đọc từ .env hoặc environment variables."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


class Config:
    # ─── App ────────────────────────────────────────
    APP_NAME: str = "Work Log Tracker"
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"

    # ─── Server ─────────────────────────────────────
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8765"))

    # ─── Database ───────────────────────────────────
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", "sqlite:///./worklog.db"
    )

    # ─── Jira ───────────────────────────────────────
    JIRA_URL: str = os.getenv("JIRA_URL", "")
    JIRA_EMAIL: str = os.getenv("JIRA_EMAIL", "")
    JIRA_API_TOKEN: str = os.getenv("JIRA_API_TOKEN", "")
    JIRA_PROJECT: str = os.getenv("JIRA_PROJECT", "")
    JIRA_POLL_INTERVAL: int = int(
        os.getenv("JIRA_POLL_INTERVAL_MINUTES", "10")
    )

    # ─── Bitbucket ──────────────────────────────────
    BITBUCKET_USERNAME: str = os.getenv("BITBUCKET_USERNAME", "")
    BITBUCKET_APP_PASSWORD: str = os.getenv(
        "BITBUCKET_APP_PASSWORD", ""
    )
    BITBUCKET_WORKSPACE: str = os.getenv("BITBUCKET_WORKSPACE", "")
    BITBUCKET_POLL_INTERVAL: int = int(
        os.getenv("BITBUCKET_POLL_INTERVAL_MINUTES", "10")
    )

    # ─── GitHub Models ──────────────────────────────
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
    GITHUB_BASE_URL: str = os.getenv(
        "GITHUB_BASE_URL", "https://models.inference.ai.azure.com"
    )

    # ─── GitHub Poller ──────────────────────────────
    GITHUB_POLL_INTERVAL: int = int(
        os.getenv("GITHUB_POLL_INTERVAL_MINUTES", "10")
    )

    # ─── Git hooks ──────────────────────────────────
    GIT_HOOK_LOG: str = os.getenv(
        "GIT_HOOK_LOG",
        str(Path.home() / ".worklog_git_hooks.jsonl"),
    )


config = Config()
