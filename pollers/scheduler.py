"""APScheduler — quản lý các background jobs định kỳ.

Khi app khởi động, các poller được đăng ký chạy theo interval.
Chỉ những poller có đủ cấu hình mới được kích hoạt.
"""

from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from config import config

scheduler: BackgroundScheduler = BackgroundScheduler(daemon=True)


def _now() -> datetime:
    """Trả về thời gian UTC hiện tại (timezone-aware)."""
    return datetime.now(timezone.utc)


def start_scheduler() -> None:
    """Đăng ký và khởi động tất cả poller jobs."""
    from pollers.jira import poll_jira
    from pollers.bitbucket import poll_bitbucket
    from pollers.git_hook_reader import read_git_hooks
    from pollers.github import poll_github

    # ─── Jira poller ────────────────────────────────
    if config.JIRA_URL and config.JIRA_API_TOKEN:
        scheduler.add_job(
            poll_jira,
            "interval",
            minutes=config.JIRA_POLL_INTERVAL,
            id="jira_poller",
            replace_existing=True,
            next_run_time=_now(),
            name="Jira Activity Poller",
        )
        print(
            f"  ✓ Jira poller enabled — every {config.JIRA_POLL_INTERVAL} min"
        )
    else:
        print("  – Jira poller disabled (config missing)")

    # ─── Bitbucket poller ───────────────────────────
    if (
        config.BITBUCKET_USERNAME
        and config.BITBUCKET_APP_PASSWORD
        and config.BITBUCKET_WORKSPACE
    ):
        scheduler.add_job(
            poll_bitbucket,
            "interval",
            minutes=config.BITBUCKET_POLL_INTERVAL,
            id="bitbucket_poller",
            replace_existing=True,
            next_run_time=_now(),
            name="Bitbucket Activity Poller",
        )
        print(
            f"  ✓ Bitbucket poller enabled — every {config.BITBUCKET_POLL_INTERVAL} min"
        )
    else:
        print("  – Bitbucket poller disabled (config missing)")

    # ─── GitHub poller ──────────────────────────────
    if config.GITHUB_TOKEN:
        scheduler.add_job(
            poll_github,
            "interval",
            minutes=config.GITHUB_POLL_INTERVAL,
            id="github_poller",
            replace_existing=True,
            next_run_time=_now(),
            name="GitHub Activity Poller",
        )
        print(
            f"  ✓ GitHub poller enabled — every {config.GITHUB_POLL_INTERVAL} min"
        )
    else:
        print("  – GitHub poller disabled (config missing)")

    # ─── Git hook reader ────────────────────────────
    scheduler.add_job(
        read_git_hooks,
        "interval",
        minutes=2,
        id="git_hook_reader",
        replace_existing=True,
        next_run_time=_now(),
        name="Git Hook Reader",
    )
    print("  ✓ Git hook reader enabled — every 2 min")

    # ─── Khởi động ──────────────────────────────────
    scheduler.start()
    print("  ✓ Scheduler started\n")


def stop_scheduler() -> None:
    """Dừng scheduler khi app shutdown."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print("  ✓ Scheduler stopped")
