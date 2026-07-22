"""
# 🔄 Work Log Tracker — AI-Powered Work Log Harness

Auto-collect & intelligently process work logs from multiple sources.
  • AI Harness: classify, summarize, analyze work logs with LLM
  • Jira: ticket update, comment, estimation change, status change
  • Bitbucket: commit, pull request
  • Git hooks: local commit tracking
  • Manual: meeting, code review, research (qua web UI)
  • Export: Excel file với summary sheet

## Chạy ứng dụng

    pip install -r requirements.txt
    cp .env.example .env    # điền Jira / Bitbucket credentials
    python app.py

Mở http://localhost:8765
"""

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from database.db import init_db
from pollers.scheduler import start_scheduler, stop_scheduler

# ─── App creation ─────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Khởi tạo DB + scheduler khi app start, dọn dẹp khi stop."""
    print("\n" + "=" * 50)
    print("  🔄 Work Log Harness")
    print("=" * 50)

    # 1. Init database
    print("\n📦 Initializing database...")
    init_db()
    print("  ✓ Database ready")

    # 2. Start background pollers
    print("\n⏱  Starting pollers...")
    start_scheduler()

    yield  # App running...

    # 3. Cleanup
    print("\n⏹  Shutting down...")
    stop_scheduler()
    print("  ✓ Goodbye!\n")


app = FastAPI(
    title="Work Log Harness",
    description="AI-powered work log collector, classifier, and reporter",
    version="1.1.0",
    lifespan=lifespan,
)

# ─── Static files ─────────────────────────────────────
static_dir = Path(__file__).resolve().parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# ─── Routers ──────────────────────────────────────────
from routers import web as web_router
from routers import logs as logs_router
from routers import export as export_router
from routers import settings as settings_router
from routers import ai as ai_router

app.include_router(web_router.router)
app.include_router(logs_router.router)
app.include_router(export_router.router)
app.include_router(settings_router.router)
app.include_router(ai_router.router)


# ─── Entry point ──────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    from config import config

    print(
        f"\n🚀 Starting server at http://{config.HOST}:{config.PORT}\n"
    )
    uvicorn.run(
        "app:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.DEBUG,
        log_level="info" if config.DEBUG else "warning",
    )
