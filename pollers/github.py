"""GitHub REST API poller — lấy commits, PRs, issues gần đây.

Sử dụng GitHub REST API v3 (Events API + Search API) để lấy hoạt động
của user hiện tại từ tất cả repositories.
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
        ts = data.get("github_last_run")
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
    data["github_last_run"] = dt.isoformat()
    STATE_FILE.write_text(json.dumps(data, indent=2))


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {config.GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "WorkLogHarness/1.0",
    }


def _get_username() -> Optional[str]:
    """Lấy GitHub username từ token."""
    try:
        resp = httpx.get(
            "https://api.github.com/user",
            headers=_headers(),
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("login")
    except httpx.HTTPError as e:
        print(f"[GitHub Poller] Failed to get user: {e}")
        return None


def poll_github() -> None:
    """Hàm chính được scheduler gọi định kỳ."""
    if not config.GITHUB_TOKEN:
        return

    username = _get_username()
    if not username:
        return

    base_api = "https://api.github.com"

    last_run = _get_last_run()
    now = datetime.utcnow()

    if last_run is None:
        since = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        since = (last_run - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")

    db = SessionLocal()
    try:
        new_count = 0

        # ─── 1. Events (PRs, Issues, Comments) ─────────
        events = _get_user_events(username, base_api)

        # ─── 2. Commits từ Repo API (PushEvent.commits thường rỗng) ──
        repo_names = set()
        for event in events:
            if event.get("type") == "PushEvent":
                repo = event.get("repo", {}).get("name", "")
                if repo:
                    repo_names.add(repo)

        for repo_full in repo_names:
            owner, repo = repo_full.split("/", 1)
            _, commits = _get_repo_commits(owner, repo, username, since, base_api)
            for commit in commits:
                sha = commit.get("sha", "")
                if not sha:
                    continue

                msg = (commit.get("commit", {}) or {}).get("message", "")
                author_name = (commit.get("commit", {}) or {}).get("author", {}) or {}
                author_name = author_name.get("name", "")
                committer_date = (commit.get("commit", {}) or {}).get("committer", {}) or {}
                date_str = committer_date.get("date", "")

                try:
                    ts = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    ts = ts.replace(tzinfo=None)
                except (ValueError, TypeError):
                    ts = now

                external_id = f"github_commit_{sha}"
                exists = (
                    db.query(WorkLog)
                    .filter(WorkLog.external_id == external_id)
                    .first()
                )
                if exists:
                    continue

                repo_short = repo_full.split("/")[-1]
                log = WorkLog(
                    source="github",
                    activity_type="commit",
                    title=f"[{repo_short}] {msg[:100]}",
                    description=(
                        f"Commit by {author_name} | "
                        f"Repo: {repo_full} | SHA: {sha[:12]}"
                    ),
                    project=repo_full,
                    url=f"https://github.com/{repo_full}/commit/{sha}",
                    activity_timestamp=ts,
                    external_id=external_id,
                    created_at=now,
                )
                db.add(log)
                new_count += 1

        # ─── 2a. Commits từ Search API (fallback) ────────────
        # Bắt các repo không có PushEvent trong 100 events gần nhất
        search_commits = _search_commits(username, since, base_api)
        for commit in search_commits:
            sha = commit.get("sha", "")
            if not sha:
                continue

            repo_full = (
                (commit.get("repository", {}) or {}).get("full_name", "")
                or _issue_repo(commit.get("html_url", ""))
            )
            if not repo_full or repo_full == "unknown":
                continue

            msg = (commit.get("commit", {}) or {}).get("message", "")
            author_name = (commit.get("commit", {}) or {}).get("author", {}) or {}
            author_name = author_name.get("name", "")
            committer_date = (commit.get("commit", {}) or {}).get("committer", {}) or {}
            date_str = committer_date.get("date", "")

            try:
                ts = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                ts = ts.replace(tzinfo=None)
            except (ValueError, TypeError):
                ts = now

            external_id = f"github_commit_{sha}"
            exists = (
                db.query(WorkLog)
                .filter(WorkLog.external_id == external_id)
                .first()
            )
            if exists:
                continue

            repo_short = repo_full.split("/")[-1]
            log = WorkLog(
                source="github",
                activity_type="commit",
                title=f"[{repo_short}] {msg[:100]}",
                description=(
                    f"Commit by {author_name} | "
                    f"Repo: {repo_full} | SHA: {sha[:12]}"
                ),
                project=repo_full,
                url=f"https://github.com/{repo_full}/commit/{sha}",
                activity_timestamp=ts,
                external_id=external_id,
                created_at=now,
            )
            db.add(log)
            new_count += 1

        # ─── 3. Pull Requests ─────────────────────────
        prs = _search_issues(username, "pr", since, base_api)
        for pr in prs:
            pr_id = pr.get("number", "")
            title = pr.get("title", "")
            state = pr.get("state", "")  # open / closed
            merged = pr.get("pull_request", {}).get("merged_at") is not None
            html_url = pr.get("html_url", "")
            repo_full = _issue_repo(html_url)
            repo_name = repo_full.split("/")[-1] if "/" in repo_full else repo_full

            updated = pr.get("updated_at", "")
            try:
                ts = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                ts = ts.replace(tzinfo=None)
            except (ValueError, TypeError):
                ts = now

            external_id = f"github_pr_{pr_id}"
            exists = (
                db.query(WorkLog)
                .filter(WorkLog.external_id == external_id)
                .first()
            )
            if exists:
                continue

            if merged:
                act_type = "pr_merge"
                desc = f"Pull Request #{pr_id} merged — {title}"
            elif state == "closed":
                act_type = "pr_merge" if "merged" in state else "pr_close"
                desc = f"Pull Request #{pr_id} closed — {title}"
            else:
                act_type = "pr_create"
                desc = f"Pull Request #{pr_id} opened — {title}"

            log = WorkLog(
                source="github",
                activity_type=act_type,
                title=f"[{repo_name}] PR #{pr_id}: {title}",
                description=desc,
                project=repo_full,
                url=html_url,
                activity_timestamp=ts,
                external_id=external_id,
                created_at=now,
            )
            db.add(log)
            new_count += 1

        # ─── 4. Issues ────────────────────────────────
        issues = _search_issues(username, "issue", since, base_api)
        for issue in issues:
            issue_id = issue.get("number", "")
            title = issue.get("title", "")
            state = issue.get("state", "")
            html_url = issue.get("html_url", "")
            repo_full = _issue_repo(html_url)
            repo_name = repo_full.split("/")[-1] if "/" in repo_full else repo_full

            updated = issue.get("updated_at", "")
            try:
                ts = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                ts = ts.replace(tzinfo=None)
            except (ValueError, TypeError):
                ts = now

            external_id = f"github_issue_{issue_id}"
            exists = (
                db.query(WorkLog)
                .filter(WorkLog.external_id == external_id)
                .first()
            )
            if exists:
                continue

            act_type = "issue_create" if state == "open" else "issue_close"
            log = WorkLog(
                source="github",
                activity_type=act_type,
                title=f"[{repo_name}] #{issue_id}: {title}",
                description=f"Issue #{issue_id} ({state}) — {title}",
                project=repo_full,
                url=html_url,
                activity_timestamp=ts,
                external_id=external_id,
                created_at=now,
            )
            db.add(log)
            new_count += 1

        # ─── 5. Comments ──────────────────────────────
        for event in events:
            if event.get("type") not in (
                "IssueCommentEvent",
                "PullRequestReviewEvent",
            ):
                continue

            repo_full = event.get("repo", {}).get("name", "")
            repo_name = repo_full.split("/")[-1] if "/" in repo_full else repo_full
            payload = event.get("payload", {})
            action = payload.get("action", "")

            # Determine issue/PR number
            if event["type"] == "IssueCommentEvent":
                issue = payload.get("issue", {})
                number = issue.get("number", "")
                comment_id = payload.get("comment", {}).get("id", "")
                item_type = "issue" if "pull_request" not in issue else "PR"
                item_title = issue.get("title", "")
            else:
                number = payload.get("pull_request", {}).get("number", "")
                comment_id = payload.get("review", {}).get("id", "")
                item_type = "PR"
                item_title = payload.get("pull_request", {}).get("title", "")

            if not comment_id:
                continue

            created = event.get("created_at", "")
            try:
                ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
                ts = ts.replace(tzinfo=None)
            except (ValueError, TypeError):
                ts = now

            external_id = f"github_comment_{comment_id}"
            exists = (
                db.query(WorkLog)
                .filter(WorkLog.external_id == external_id)
                .first()
            )
            if exists:
                continue

            log = WorkLog(
                source="github",
                activity_type="comment",
                title=f"[{repo_name}] Comment on {item_type} #{number}",
                description=(
                    f"Comment on {item_type} #{number} '{item_title[:100]}'"
                ),
                project=repo_full,
                url=f"https://github.com/{repo_full}/{item_type.lower()}/{number}",
                activity_timestamp=ts,
                external_id=external_id,
                created_at=now,
            )
            db.add(log)
            new_count += 1

        if new_count > 0:
            db.commit()

        _save_last_run(now)

    except Exception as e:
        db.rollback()
        print(f"[GitHub Poller] Error: {e}")
    finally:
        db.close()


# ─── Helpers ─────────────────────────────────────


def _get_repo_commits(
    owner: str, repo: str, username: str, since: str, base_api: str
) -> tuple[str, list]:
    """Lấy commits của user trong 1 repository."""
    try:
        resp = httpx.get(
            f"{base_api}/repos/{owner}/{repo}/commits",
            headers=_headers(),
            params={"author": username, "since": since, "per_page": 20},
            timeout=15,
        )
        if resp.status_code == 409:
            return repo, []
        resp.raise_for_status()
        return repo, resp.json()
    except httpx.HTTPError as e:
        print(f"[GitHub Poller] Commits error for {owner}/{repo}: {e}")
        return repo, []


def _get_user_events(username: str, base_api: str) -> list:
    """Lấy events gần đây của user."""
    try:
        resp = httpx.get(
            f"{base_api}/users/{username}/events",
            headers=_headers(),
            params={"per_page": 100},
            timeout=15,
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        print(f"[GitHub Poller] Events error: {e}")
        return []


def _search_issues(username: str, issue_type: str, since: str, base_api: str) -> list:
    """Search issues (is:pr hoặc is:issue) của user."""
    q = f"author:{username} is:{issue_type} updated:>{since}"
    try:
        resp = httpx.get(
            f"{base_api}/search/issues",
            headers=_headers(),
            params={"q": q, "sort": "updated", "order": "desc", "per_page": 20},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("items", [])
    except httpx.HTTPError as e:
        print(f"[GitHub Poller] Search {issue_type} error: {e}")
        return []


def _search_commits(username: str, since: str, base_api: str) -> list:
    """Search commits by user via Search API.

    Cần Accept header preview 'claw-graw-preview' để search commits.
    Fallback khi Events API không có PushEvent cho repo của user.
    """
    q = f"author:{username} committer-date:>{since}"
    headers = _headers()
    headers["Accept"] = "application/vnd.github.claw-graw-preview+json"
    try:
        resp = httpx.get(
            f"{base_api}/search/commits",
            headers=headers,
            params={
                "q": q,
                "sort": "committer-date",
                "order": "desc",
                "per_page": 50,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("items", [])
    except httpx.HTTPError as e:
        print(f"[GitHub Poller] Search commits error: {e}")
        return []


def _issue_repo(html_url: str) -> str:
    """Trích xuất owner/repo từ issue/PR url."""
    # https://github.com/owner/repo/issues/123
    parts = html_url.replace("https://github.com/", "").split("/")
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return "unknown"
