"""Settings API — lưu runtime config (AI provider, key, model, ...).

Cho phép người dùng cấu hình AI trực tiếp từ UI mà không cần sửa .env.
"""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import AppSetting
from services.ai_service import AIService

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ─── Schemas ───────────────────────────────────────────


class SettingItem(BaseModel):
    key: str
    value: str


class SettingsOut(BaseModel):
    settings: dict[str, str]


class TestConnectionIn(BaseModel):
    provider: str
    api_key: str
    base_url: str = ""
    model: str = ""


class TestConnectionOut(BaseModel):
    status: str  # "success" | "error"
    response: str = ""
    message: str = ""
    models: list[dict[str, str]] = []  # Available models từ provider
    suggested_model: str = ""  # Model được recommend


# ─── Endpoints ─────────────────────────────────────────


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    """Lấy tất cả settings. API key được mask khi trả về."""
    rows = db.query(AppSetting).all()
    result: dict[str, str] = {}
    for s in rows:
        if s.key == "ai_api_key" and s.value:
            v = s.value
            result[s.key] = v[:8] + ("****" if len(v) > 8 else "***")
        else:
            result[s.key] = s.value or ""
    return SettingsOut(settings=result)


@router.put("")
def update_settings(
    items: list[SettingItem], db: Session = Depends(get_db)
):
    """Cập nhật settings. Gửi mảng {key, value}."""
    now = datetime.utcnow()
    for item in items:
        setting = db.query(AppSetting).filter(AppSetting.key == item.key).first()
        if setting:
            setting.value = item.value
            setting.updated_at = now
        else:
            db.add(AppSetting(key=item.key, value=item.value, updated_at=now))

        # Nếu disable AI, clear api_key để tránh leak trong DB
        if item.key == "ai_enabled" and item.value != "true":
            key_setting = (
                db.query(AppSetting)
                .filter(AppSetting.key == "ai_api_key")
                .first()
            )
            if key_setting:
                db.delete(key_setting)

    db.commit()
    return {"status": "ok", "updated": len(items)}


@router.post("/test", response_model=TestConnectionOut)
async def test_connection(data: TestConnectionIn):
    """Test kết nối tới LLM provider với settings hiện tại."""
    if not data.api_key:
        return TestConnectionOut(
            status="error", message="API key is required"
        )

    try:
        svc = AIService(
            provider=data.provider,
            api_key=data.api_key,
            base_url=data.base_url,
            model=data.model,
        )

        # 1. Luôn thử GET /models để verify connectivity + load models
        models = await svc.list_models()

        # 2. Nếu có model name, thử chat test
        response_text = ""
        if data.model:
            result = await svc.chat(
                messages=[{"role": "user", "content": "Reply with exactly: OK"}],
                temperature=0,
                max_tokens=10,
            )
            response_text = result.strip()

        # Xác định suggested model
        suggested = ""
        if models:
            preset_model = AIService.PROVIDER_PRESETS.get(data.provider, {}).get("model", "")
            if preset_model and any(m["id"] == preset_model for m in models):
                suggested = preset_model
            else:
                suggested = models[0]["id"]

        return TestConnectionOut(
            status="success",
            response=response_text,
            models=models[:100],  # Max 100 models
            suggested_model=suggested,
        )
    except httpx.HTTPStatusError as e:
        return TestConnectionOut(
            status="error",
            message=f"HTTP {e.response.status_code}: {e.response.text[:200]}",
        )
    except httpx.RequestError as e:
        return TestConnectionOut(
            status="error", message=f"Connection failed: {e}"
        )
    except Exception as e:
        return TestConnectionOut(
            status="error", message=str(e)[:300]
        )


# Need httpx for error types in test_connection
import httpx
