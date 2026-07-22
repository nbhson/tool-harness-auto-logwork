"""Bitbucket Cloud API poller — lấy commits và PR activities gần đây.

Sử dụng Bitbucket Cloud REST API v2 để lấy commits và pull request
activities của user hiện tại.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx

from config import config
from database.db import SessionLocal
from database.models import WorkLog


STATE_FILE = Path(__file__).resolve().parent.parent / "poller_state.json"


def _get_last_run() -> Optional[datetime]:
    if not STATE_FILE.exists():
        return None
    try:
        data = json.loads(STATE_FILE.read_text())
        ts = data.get("bitbucket_last_run")
        if ts:
            return datetime.fromisoformat(ts)
    except (json.JSONDecodeError, KeyError, ValueError):
        pass
    return None


def _save_last_run(dt: datetime) -> None:
    data = {}
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    data["bitbucket_last_run"] = dt.isoformat()
    STATE_FILE.write_text(json.dumps(data, indent=2))


def _get_auth():
    return (config.BITBUCKET_USERNAME, config.BITBUCKET_APP_PASSWORD)


def poll_bitbucket() -> None:
    """Hàm chính được scheduler gọi định kỳ."""
    if not config.BITBUCKET_USERNAME or not config.BITBUCKET_APP_PASSWORD:
        return

    if not config.BITBUCKET_WORKSPACE:
        print("[Bitbucket Poller] No workspace configured, skipping")
        return

    auth = _get_auth()
    workspace = config.BITBUCKET_WORKSPACE
    base_url = "https://api.bitbucket.org/2.0"

    last_run = _get_last_run()
    since_dt = datetime.now(timezone.utc)
    if last_run is None:
        since = (since_dt - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")
    else:
        since = (last_run.replace(tzinfo=timezone.utc) - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%S")

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        new_count = 0

        # ─── Lấy repositories ───────────────────────
        repos = _get_repos(auth, workspace, base_url)

        for repo in repos:
            repo_name = repo.get("slug", repo.get("name", "unknown"))
            repo_full = f"{workspace}/{repo_name}"

            # ─── Commits ────────────────────────────
            commits = _get_commits(
                auth, workspace, repo_name, base_url, since
            )
            for commit in commits:
                commit_hash = commit.get("hash", "")
                if not commit_hash:
                    continue

                author_info = commit.get("author", {})
                author_raw = author_info.get("raw", "") if isinstance(author_info, dict) else str(author_info)

                # Chỉ lấy commit của user hiện tại
                if config.BITBUCKET_USERNAME and config.BITBUCKET_USERNAME not in author_raw:
                    continue

                date_str = commit.get("date", "")
                try:
                    ts = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    ts = ts.replace(tzinfo=None)
                except (ValueError, TypeError):
                    ts = now

                summary = commit.get("summary", {})
                msg = summary.get("raw", "") if isinstance(summary, dict) else str(summary)

                external_id = f"bb_commit_{commit_hash}"
                exists = (
                    db.query(WorkLog)
                    .filter(WorkLog.external_id == external_id)
                    .first()
                )
                if exists:
                    continue

                log = WorkLog(
                    source="bitbucket",
                    activity_type="commit",
                    title=f"[{repo_name}] {msg[:100]}",
                    description=msg[:500],
                    project=repo_full,
                    url=f"https://bitbucket.org/{workspace}/{repo_name}/commits/{commit_hash}",
                    activity_timestamp=ts,
                    external_id=external_id,
                    created_at=now,
                )
                db.add(log)
                new_count += 1

            # ─── Pull Requests ──────────────────────
            prs = _get_pull_requests(
                auth, workspace, repo_name, base_url, since
            )
            for pr in prs:
                pr_id = pr.get("id", "")
                title = pr.get("title", "")
                state = pr.get("state", "")
                author_info = pr.get("author", {})
                pr_author = author_info.get("nickname", "") if isinstance(author_info, dict) else str(author_info)

                date_str = pr.get("updated_on", "")
                try:
                    ts = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    ts = ts.replace(tzinfo=None)
                except (ValueError, TypeError):
                    ts = now

                external_id = f"bb_pr_{repo_name}_{pr_id}"
                exists = (
                    db.query(WorkLog)
                    .filter(WorkLog.external_id == external_id)
                    .first()
                )
                if exists:
                    continue

                log = WorkLog(
                    source="bitbucket",
                    activity_type="pr_create" if state == "OPEN" else "pr_merge",
                    title=f"[{repo_name}] PR #{pr_id}: {title}",
                    description=f"Pull Request #{pr_id} ({state}) — {title}",
                    project=repo_full,
                    url=f"https://bitbucket.org/{workspace}/{repo_name}/pull-requests/{pr_id}",
                    activity_timestamp=ts,
                    external_id=external_id,
                    created_at=now,
                )
                db.add(log)
                new_count += 1

        if new_count > 0:
            db.commit()

        _save_last_run(datetime.utcnow())

    except Exception as e:
        db.rollback()
        print(f"[Bitbucket Poller] Error: {e}")
    finally:
        db.close()


def _get_repos(auth, workspace: str, base_url: str) -> list:
    """Lấy danh sách repositories trong workspace."""
    repos = []
    url = f"{base_url}/repositories/{workspace}"
    params = {"pagelen": 50, "role": "member"}
    try:
        while url:
            resp = httpx.get(url, auth=auth, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            repos.extend(data.get("values", []))
            url = data.get("next", "")
            params = None  # next URL đã bao gồm params
    except httpx.HTTPError as e:
        print(f"[Bitbucket] Error fetching repos: {e}")
    return repos


def _get_commits(
    auth, workspace: str, repo: str, base_url: str, since: str
) -> list:
    """Lấy commits gần đây của một repository."""
    commits = []
    url = f"{base_url}/repositories/{workspace}/{repo}/commits"
    try:
        resp = httpx.get(
            url,
            auth=auth,
            params={
                "pagelen": 20,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        commits = data.get("values", [])
    except httpx.HTTPError as e:
        print(f"[Bitbucket] Error fetching commits for {repo}: {e}")
    return commits


def _get_pull_requests(
    auth, workspace: str, repo: str, base_url: str, since: str
) -> list:
    """Lấy pull requests gần đây."""
    prs = []
    url = f"{base_url}/repositories/{workspace}/{repo}/pullrequests"
    try:
        resp = httpx.get(
            url,
            auth=auth,
            params={
                "pagelen": 10,
                "state": "ALL",
            },
            timeout=30,
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        data = resp.json()
        prs = data.get("values", [])
    except httpx.HTTPError as e:
        print(f"[Bitbucket] Error fetching PRs for {repo}: {e}")
    return prs
