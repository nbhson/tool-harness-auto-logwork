"""Đọc các dòng JSON từ git hook log file và import vào database.

Mỗi lần commit local, post-commit hook sẽ ghi một dòng JSON vào
~/.worklog_git_hooks.jsonl. Module này đọc các dòng mới và thêm
vào bảng work_logs.
"""

import json
import os
from datetime import datetime
from pathlib import Path

from database.db import SessionLocal
from database.models import WorkLog
from config import config


def _get_processed_count() -> int:
    """Đọc số dòng đã xử lý từ file state."""
    state_file = Path(__file__).resolve().parent.parent / "poller_state.json"
    if state_file.exists():
        try:
            data = json.loads(state_file.read_text())
            return data.get("git_hook_processed", 0)
        except (json.JSONDecodeError, KeyError):
            return 0
    return 0


def _save_processed_count(count: int) -> None:
    """Ghi số dòng đã xử lý."""
    state_file = Path(__file__).resolve().parent.parent / "poller_state.json"
    data = {}
    if state_file.exists():
        try:
            data = json.loads(state_file.read_text())
        except json.JSONDecodeError:
            pass
    data["git_hook_processed"] = count
    state_file.write_text(json.dumps(data, indent=2))


def read_git_hooks() -> None:
    """Đọc các commit mới từ git hook log và thêm vào database."""
    log_path = Path(config.GIT_HOOK_LOG).expanduser()
    if not log_path.exists():
        return

    lines = log_path.read_text().splitlines()
    processed = _get_processed_count()

    # Nếu file bị reset (ngắn hơn processed), bắt đầu lại
    if processed > len(lines):
        processed = 0

    new_lines = lines[processed:]
    if not new_lines:
        return

    db = SessionLocal()
    try:
        count = 0
        for line in new_lines:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Parse timestamp
            ts = entry.get("activity_timestamp", "")
            try:
                activity_ts = datetime.fromisoformat(ts)
            except (ValueError, TypeError):
                activity_ts = datetime.utcnow()

            time_minutes = entry.get("time_spent_minutes", 0)
            try:
                time_minutes = int(time_minutes)
            except (ValueError, TypeError):
                time_minutes = 0

            # Kiểm tra trùng lặp theo external_id
            external_id = entry.get("external_id", "")
            if external_id:
                exists = (
                    db.query(WorkLog)
                    .filter(WorkLog.source == "git")
                    .filter(WorkLog.external_id == external_id)
                    .first()
                )
                if exists:
                    continue

            log_entry = WorkLog(
                source="git",
                activity_type=entry.get("activity_type", "local_commit"),
                title=entry.get("title", ""),
                description=entry.get("description", ""),
                project=entry.get("project", ""),
                url=entry.get("url", ""),
                activity_timestamp=activity_ts,
                time_spent_minutes=time_minutes,
                external_id=external_id,
            )
            db.add(log_entry)
            count += 1

        if count > 0:
            db.commit()
            _save_processed_count(len(lines))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
