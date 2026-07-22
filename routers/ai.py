"""AI Harness Endpoints — classify, summarize, analyze work logs.

Mỗi endpoint dùng LLM để xử lý thông minh dữ liệu work log.
Settings (provider, key, model) được lấy từ AppSetting trong DB.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import WorkLog, AppSetting
from services.ai_service import AIService

router = APIRouter(prefix="/api/ai", tags=["ai"])


# ─── Helpers ───────────────────────────────────────────


def _get_setting(db: Session, key: str) -> str:
    s = db.query(AppSetting).filter(AppSetting.key == key).first()
    return s.value if s else ""


def _resolve_service(db: Session) -> AIService:
    enabled = _get_setting(db, "ai_enabled")
    if enabled != "true":
        raise HTTPException(
            status_code=400,
            detail="AI is disabled. Go to ⚙️ Settings and configure your LLM provider.",
        )
    api_key = _get_setting(db, "ai_api_key")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="API key not configured. Go to ⚙️ Settings to set it up.",
        )
    return AIService(
        provider=_get_setting(db, "ai_provider") or "openai",
        api_key=api_key,
        base_url=_get_setting(db, "ai_base_url"),
        model=_get_setting(db, "ai_model"),
    )


# ─── Schemas ───────────────────────────────────────────


class ClassifyOut(BaseModel):
    log_id: int
    category: str
    suggested_time_minutes: int
    tags: list[str]
    confidence: float
    reasoning: str


class BatchClassifyIn(BaseModel):
    log_ids: Optional[list[int]] = None


class BatchClassifyOut(BaseModel):
    results: list[ClassifyOut]


class SummaryIn(BaseModel):
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    period: str = "daily"


class SummaryOut(BaseModel):
    summary: str
    log_count: int


class AnalyzeIn(BaseModel):
    query: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class AnalyzeOut(BaseModel):
    answer: str
    log_count: int


# ─── Endpoints ─────────────────────────────────────────


@router.post("/classify/{log_id}", response_model=ClassifyOut)
async def classify_single(log_id: int, db: Session = Depends(get_db)):
    """✨ Phân loại một work log entry bằng AI."""
    log = db.query(WorkLog).filter(WorkLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")

    svc = _resolve_service(db)
    result = await svc.classify_log(log.title, log.description or "")

    # Tự động áp dụng nếu confidence đủ cao
    conf = result.get("confidence", 0)
    if conf > 0.5:
        if result.get("category") and result["category"] != "other":
            log.activity_type = result["category"]
        suggested = result.get("suggested_time_minutes", 0)
        if suggested > 0 and log.time_spent_minutes == 0:
            log.time_spent_minutes = suggested
        db.commit()

    return ClassifyOut(
        log_id=log_id,
        category=result.get("category", "other"),
        suggested_time_minutes=result.get("suggested_time_minutes", 0),
        tags=result.get("tags", []),
        confidence=conf,
        reasoning=result.get("reasoning", ""),
    )


@router.post("/classify", response_model=BatchClassifyOut)
async def classify_batch(
    req: BatchClassifyIn, db: Session = Depends(get_db)
):
    """✨ Phân loại hàng loạt work logs (mặc định: tất cả manual entries chưa phân loại)."""
    q = db.query(WorkLog)
    if req.log_ids:
        q = q.filter(WorkLog.id.in_(req.log_ids))
    else:
        q = q.filter(
            WorkLog.source == "manual",
            WorkLog.activity_type.in_(["other", "meeting", "code_review", "research"]),
        )
    logs = q.order_by(WorkLog.activity_timestamp.desc()).limit(50).all()

    if not logs:
        raise HTTPException(status_code=404, detail="No matching logs found to classify")

    svc = _resolve_service(db)
    results: list[ClassifyOut] = []

    for log in logs:
        result = await svc.classify_log(log.title, log.description or "")
        conf = result.get("confidence", 0)
        if conf > 0.5:
            if result.get("category") and result["category"] != "other":
                log.activity_type = result["category"]
            suggested = result.get("suggested_time_minutes", 0)
            if suggested > 0 and log.time_spent_minutes == 0:
                log.time_spent_minutes = suggested
        results.append(
            ClassifyOut(
                log_id=log.id,
                category=result.get("category", "other"),
                suggested_time_minutes=result.get("suggested_time_minutes", 0),
                tags=result.get("tags", []),
                confidence=conf,
                reasoning=result.get("reasoning", ""),
            )
        )

    db.commit()
    return BatchClassifyOut(results=results)


@router.post("/summarize", response_model=SummaryOut)
async def summarize(req: SummaryIn, db: Session = Depends(get_db)):
    """🤖 Tạo báo cáo tóm tắt work logs bằng AI."""
    q = db.query(WorkLog)
    if req.date_from:
        try:
            q = q.filter(
                WorkLog.activity_timestamp
                >= datetime.fromisoformat(req.date_from)
            )
        except ValueError:
            pass
    if req.date_to:
        try:
            q = q.filter(
                WorkLog.activity_timestamp
                <= datetime.fromisoformat(req.date_to)
            )
        except ValueError:
            pass

    logs = (
        q.order_by(WorkLog.activity_timestamp.asc()).limit(150).all()
    )

    logs_data = [
        {
            "source": l.source,
            "title": l.title,
            "activity_type": l.activity_type,
            "project": l.project,
            "time_spent_minutes": l.time_spent_minutes,
            "activity_timestamp": (
                l.activity_timestamp.isoformat() if l.activity_timestamp else ""
            ),
        }
        for l in logs
    ]

    svc = _resolve_service(db)
    summary = await svc.generate_summary(logs_data, req.period)

    return SummaryOut(summary=summary, log_count=len(logs_data))


@router.post("/analyze", response_model=AnalyzeOut)
async def analyze(req: AnalyzeIn, db: Session = Depends(get_db)):
    """💬 Trả lời câu hỏi natural language về work logs."""
    q = db.query(WorkLog)
    if req.date_from:
        try:
            q = q.filter(
                WorkLog.activity_timestamp
                >= datetime.fromisoformat(req.date_from)
            )
        except ValueError:
            pass
    if req.date_to:
        try:
            q = q.filter(
                WorkLog.activity_timestamp
                <= datetime.fromisoformat(req.date_to)
            )
        except ValueError:
            pass

    logs = (
        q.order_by(WorkLog.activity_timestamp.desc()).limit(200).all()
    )

    logs_data = [
        {
            "source": l.source,
            "title": l.title,
            "description": l.description,
            "activity_type": l.activity_type,
            "project": l.project,
            "time_spent_minutes": l.time_spent_minutes,
            "activity_timestamp": (
                l.activity_timestamp.isoformat() if l.activity_timestamp else ""
            ),
        }
        for l in logs
    ]

    svc = _resolve_service(db)
    answer = await svc.analyze_query(logs_data, req.query)

    return AnalyzeOut(answer=answer, log_count=len(logs_data))
