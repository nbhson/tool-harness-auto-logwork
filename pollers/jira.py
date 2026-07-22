"""Jira API poller — lấy danh sách issue đã update gần đây.

Sử dụng Jira Cloud REST API v3 để query các issue mà current user
được assign, đã update kể từ lần poll trước, và ghi nhận các
thay đổi (changelog, comment, worklog).
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from config import config
from database.db import SessionLocal
from database.models import WorkLog


STATE_FILE = Path(__file__).resolve().parent.parent / "poller_state.json"


def _get_last_run() -> Optional[datetime]:
    """Lấy thời điểm poll thành công gần nhất."""
    if not STATE_FILE.exists():
        return None
    try:
        data = json.loads(STATE_FILE.read_text())
        ts = data.get("jira_last_run")
        if ts:
            return datetime.fromisoformat(ts)
    except (json.JSONDecodeError, KeyError, ValueError):
        pass
    return None


def _save_last_run(dt: datetime) -> None:
    """Ghi thời điểm poll thành công."""
    data = {}
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    data["jira_last_run"] = dt.isoformat()
    STATE_FILE.write_text(json.dumps(data, indent=2))


def _calculate_estimation_change(changelog: list) -> Optional[str]:
    """Trích xuất thông tin thay đổi estimation từ changelog."""
    for history in changelog:
        for item in history.get("items", []):
            if item.get("field") in ("timeestimate", "timetracking", "timeoriginalestimate"):
                return f"Estimation changed: {item.get('fromString', 'none')} → {item.get('toString', 'none')}"
    return None


def poll_jira() -> None:
    """Hàm chính được scheduler gọi định kỳ."""
    if not config.JIRA_URL or not config.JIRA_API_TOKEN:
        return

    auth = (config.JIRA_EMAIL, config.JIRA_API_TOKEN)
    base_url = config.JIRA_URL.rstrip("/")

    last_run = _get_last_run()
    if last_run is None:
        # Lần đầu — lấy dữ liệu 24h gần nhất
        since = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    else:
        # Cộng thêm 2 phút overlap để không miss data
        since = last_run - __import__("datetime").timedelta(minutes=2)

    jql = f"assignee=currentUser() AND updated>='{since.strftime('%Y-%m-%d %H:%M')}'"
    if config.JIRA_PROJECT:
        jql += f" AND project={config.JIRA_PROJECT}"

    try:
        response = httpx.get(
            f"{base_url}/rest/api/3/search",
            auth=auth,
            params={
                "jql": jql,
                "expand": "changelog",
                "maxResults": 50,
                "fields": "summary,updated,status,timeestimate,comment,project",
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        db = SessionLocal()
        try:
            now = datetime.utcnow()
            new_count = 0

            for issue in data.get("issues", []):
                issue_key = issue.get("key", "")
                fields = issue.get("fields", {})
                changelog = issue.get("changelog", {}).get("histories", [])
                summary = fields.get("summary", "")
                project_key = (
                    fields.get("project", {}).get("key", config.JIRA_PROJECT)
                )

                # Nếu có changelog, ghi nhận từng thay đổi
                for history in changelog:
                    author = history.get("author", {}).get("displayName", "")
                    created = history.get("created", "")

                    try:
                        ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        # Chuyển về UTC naive cho SQLite
                        ts = ts.replace(tzinfo=None)
                    except (ValueError, TypeError):
                        ts = now

                    # Kiểm tra trùng lặp
                    external_id = f"{issue_key}_changelog_{history.get('id', '')}"
                    exists = (
                        db.query(WorkLog)
                        .filter(WorkLog.external_id == external_id)
                        .first()
                    )
                    if exists:
                        continue

                    for item in history.get("items", []):
                        field = item.get("field", "")
                        from_str = item.get("fromString", "")
                        to_str = item.get("toString", "")

                        if field in ("status",):
                            log = WorkLog(
                                source="jira",
                                activity_type="status_change",
                                title=f"{issue_key}: {from_str} → {to_str}",
                                description=f"Issue {issue_key} status changed from '{from_str}' to '{to_str}' by {author}",
                                project=project_key,
                                url=f"{base_url}/browse/{issue_key}",
                                activity_timestamp=ts,
                                external_id=external_id,
                                created_at=now,
                            )
                            db.add(log)
                            new_count += 1

                        elif field in (
                            "timeestimate",
                            "timetracking",
                            "timeoriginalestimate",
                        ):
                            log = WorkLog(
                                source="jira",
                                activity_type="estimation_change",
                                title=f"{issue_key}: Estimation {from_str or 'none'} → {to_str or 'none'}",
                                description=f"Estimation changed from '{from_str or 'none'}' to '{to_str or 'none'}' by {author}",
                                project=project_key,
                                url=f"{base_url}/browse/{issue_key}",
                                activity_timestamp=ts,
                                external_id=f"{external_id}_{item.get('field', '')}",
                                created_at=now,
                            )
                            db.add(log)
                            new_count += 1

                        elif field in ("summary", "description", "priority", "assignee"):
                            # Bỏ qua log riêng cho summary/description thay đổi
                            # để tránh spam, nhưng vẫn ghi nếu có estimation thay đổi kèm
                            pass

            # Kiểm tra comments (Jira API không trả comment trong changelog
            # một cách đầy đủ, cần fetch riêng)
            comment_count = _fetch_comments(db, base_url, auth, issue_keys=[i["key"] for i in data.get("issues", [])])
            new_count += comment_count

            if new_count > 0:
                db.commit()

        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        _save_last_run(datetime.utcnow())

    except httpx.HTTPStatusError as e:
        print(f"[Jira Poller] HTTP Error: {e.response.status_code} - {e.response.text[:200]}")
    except httpx.RequestError as e:
        print(f"[Jira Poller] Connection Error: {e}")
    except Exception as e:
        print(f"[Jira Poller] Unexpected Error: {e}")


def _fetch_comments(
    db, base_url: str, auth, issue_keys: list[str]
) -> int:
    """Fetch comments mới cho danh sách issue keys."""
    count = 0
    for key in issue_keys:
        try:
            resp = httpx.get(
                f"{base_url}/rest/api/3/issue/{key}/comment",
                auth=auth,
                params={"orderBy": "-created", "maxResults": 10},
                timeout=15,
            )
            if resp.status_code != 200:
                continue
            comments = resp.json().get("comments", [])
            for comment in comments:
                created = comment.get("created", "")
                try:
                    ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    ts = ts.replace(tzinfo=None)
                except (ValueError, TypeError):
                    continue

                comment_id = comment.get("id", "")
                external_id = f"{key}_comment_{comment_id}"
                exists = (
                    db.query(WorkLog)
                    .filter(WorkLog.external_id == external_id)
                    .first()
                )
                if exists:
                    continue

                body = comment.get("body", "")
                # Jira Cloud trả về ADF (Atlassian Document Format) hoặc plain text
                if isinstance(body, dict):
                    # ADF — lấy plain text đơn giản
                    text = _extract_adf_text(body)
                else:
                    text = str(body)[:500]

                log = WorkLog(
                    source="jira",
                    activity_type="comment",
                    title=f"{key}: New comment",
                    description=text[:500],
                    project=config.JIRA_PROJECT or "",
                    url=f"{base_url}/browse/{key}?focusedCommentId={comment_id}",
                    activity_timestamp=ts,
                    external_id=external_id,
                    created_at=datetime.utcnow(),
                )
                db.add(log)
                count += 1
        except httpx.HTTPError:
            continue
    return count


def _extract_adf_text(adf: dict) -> str:
    """Trích xuất plain text từ Atlassian Document Format."""
    texts = []

    def _walk(node):
        if isinstance(node, dict):
            if node.get("type") == "text" and "text" in node:
                texts.append(node["text"])
            for child in node.get("content", []):
                _walk(child)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(adf)
    return " ".join(texts)[:500]
