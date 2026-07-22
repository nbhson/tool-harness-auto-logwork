"""SQLAlchemy models cho Work Log Tracker."""

from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime

from database.db import Base


class WorkLog(Base):
    """Bảng chính lưu tất cả work logs từ mọi nguồn."""

    __tablename__ = "work_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    # Nguồn dữ liệu: 'jira' | 'bitbucket' | 'github' | 'git' | 'manual'
    source = Column(String(20), nullable=False, index=True)

    # Loại hoạt động:
    #   Jira:     ticket_update | comment | estimation_change | status_change | worklog
    #   Bitbucket: commit | push | pr_create | pr_merge | pr_comment
    #   GitHub:   commit | pr_create | pr_merge | issue_create | issue_close | comment
    #   Git:      local_commit
    #   Manual:   meeting | code_review | research | other
    activity_type = Column(String(50), nullable=False)

    # Tiêu đề ngắn gọn (vd: "PROJ-123 Fix login bug")
    title = Column(String(500), nullable=False)

    # Mô tả chi tiết
    description = Column(Text, nullable=True)

    # Dự án / Repository name
    project = Column(String(100), nullable=True, index=True)

    # Link đến Jira ticket / Bitbucket PR / commit
    url = Column(String(1000), nullable=True)

    # Thời gian hoạt động xảy ra (server timestamp)
    activity_timestamp = Column(DateTime, nullable=False, index=True)

    # Thời gian ước lượng / nhập tay (phút)
    time_spent_minutes = Column(Integer, default=0, nullable=False)

    # ID bên ngoài: issue key, commit hash, PR number, v.v.
    external_id = Column(String(200), nullable=True)

    # Metadata bổ sung dạng JSON string (vd: changed fields, files list)
    metadata_json = Column(Text, nullable=True)

    # Thời điểm log được tạo trong hệ thống
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AppSetting(Base):
    """Key-value settings table — lưu runtime config (AI key, model, ...)."""

    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
