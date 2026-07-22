"""REST API cho WorkLog CRUD + thống kê."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import WorkLog

router = APIRouter(prefix="/api/logs", tags=["logs"])


# ─── Schemas ───────────────────────────────────────────


class WorkLogCreate(BaseModel):
    """Schema cho manual entry form."""
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    activity_type: str = Field(default="other")
    project: Optional[str] = None
    url: Optional[str] = None
    activity_timestamp: Optional[datetime] = None
    time_spent_minutes: int = Field(default=0, ge=0)


class WorkLogOut(BaseModel):
    """Schema trả về cho client."""
    id: int
    source: str
    activity_type: str
    title: str
    description: Optional[str] = None
    project: Optional[str] = None
    url: Optional[str] = None
    activity_timestamp: datetime
    time_spent_minutes: int
    external_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class WorkLogList(BaseModel):
    """Kết quả phân trang."""
    items: list[WorkLogOut]
    total: int
    page: int
    page_size: int


class StatsOut(BaseModel):
    """Thống kê nhanh."""
    total_logs: int
    total_time_hours: float
    jira_logs: int
    bitbucket_logs: int
    git_logs: int
    manual_logs: int
    today_time_hours: float
    week_time_hours: float


# ─── Endpoints ─────────────────────────────────────────


@router.get("", response_model=WorkLogList)
def list_logs(
    source: Optional[str] = Query(None, description="Filter by source"),
    activity_type: Optional[str] = Query(None, description="Filter by activity type"),
    project: Optional[str] = Query(None, description="Filter by project"),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    search: Optional[str] = Query(None, description="Search in title/description"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query("activity_timestamp", regex="^(activity_timestamp|created_at|source|title)$"),
    sort_order: str = Query("desc", regex="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    """Lấy danh sách work logs với bộ lọc và phân trang."""
    q = db.query(WorkLog)

    if source:
        q = q.filter(WorkLog.source == source)
    if activity_type:
        q = q.filter(WorkLog.activity_type == activity_type)
    if project:
        q = q.filter(WorkLog.project.ilike(f"%{project}%"))
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            q = q.filter(WorkLog.activity_timestamp >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            q = q.filter(WorkLog.activity_timestamp <= dt_to)
        except ValueError:
            pass
    if search:
        search_term = f"%{search}%"
        q = q.filter(
            WorkLog.title.ilike(search_term)
            | WorkLog.description.ilike(search_term)
            | WorkLog.project.ilike(search_term)
        )

    total = q.count()

    # Sorting
    sort_col = getattr(WorkLog, sort_by, WorkLog.activity_timestamp)
    if sort_order == "desc":
        sort_col = sort_col.desc()
    q = q.order_by(sort_col)

    # Pagination
    offset = (page - 1) * page_size
    items = q.offset(offset).limit(page_size).all()

    return WorkLogList(
        items=[WorkLogOut.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=WorkLogOut, status_code=201)
def create_log(entry: WorkLogCreate, db: Session = Depends(get_db)):
    """Tạo manual work log entry."""
    log = WorkLog(
        source="manual",
        activity_type=entry.activity_type,
        title=entry.title,
        description=entry.description,
        project=entry.project,
        url=entry.url,
        activity_timestamp=entry.activity_timestamp or datetime.utcnow(),
        time_spent_minutes=entry.time_spent_minutes,
        created_at=datetime.utcnow(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return WorkLogOut.model_validate(log)


@router.delete("/{log_id}", status_code=204)
def delete_log(log_id: int, db: Session = Depends(get_db)):
    """Xoá một work log entry."""
    log = db.query(WorkLog).filter(WorkLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")
    db.delete(log)
    db.commit()


@router.patch("/{log_id}", response_model=WorkLogOut)
def update_log(
    log_id: int,
    updates: WorkLogCreate,
    db: Session = Depends(get_db),
):
    """Cập nhật một work log (vd: sửa time spent)."""
    log = db.query(WorkLog).filter(WorkLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")

    log.title = updates.title
    log.description = updates.description
    log.activity_type = updates.activity_type
    log.project = updates.project
    log.url = updates.url
    log.activity_timestamp = updates.activity_timestamp or datetime.utcnow()
    log.time_spent_minutes = updates.time_spent_minutes

    db.commit()
    db.refresh(log)
    return WorkLogOut.model_validate(log)


@router.get("/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    """Thống kê nhanh cho dashboard."""
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now.replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    # Lùi về thứ 2 (Monday)
    week_start = week_start.replace(
        day=week_start.day - week_start.weekday()
    )

    total = db.query(func.count(WorkLog.id)).scalar() or 0
    total_time = db.query(
        func.coalesce(func.sum(WorkLog.time_spent_minutes), 0)
    ).scalar() or 0

    def count_by_source(source: str) -> int:
        return (
            db.query(func.count(WorkLog.id))
            .filter(WorkLog.source == source)
            .scalar()
            or 0
        )

    def time_since(start: datetime) -> float:
        result = (
            db.query(
                func.coalesce(
                    func.sum(WorkLog.time_spent_minutes), 0
                )
            )
            .filter(WorkLog.activity_timestamp >= start)
            .scalar()
            or 0
        )
        return round(result / 60, 1)

    return StatsOut(
        total_logs=total,
        total_time_hours=round(total_time / 60, 1),
        jira_logs=count_by_source("jira"),
        bitbucket_logs=count_by_source("bitbucket"),
        git_logs=count_by_source("git"),
        manual_logs=count_by_source("manual"),
        today_time_hours=time_since(today_start),
        week_time_hours=time_since(week_start),
    )
