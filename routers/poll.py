"""Poll Now endpoint — trigger background pollers thủ công."""

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["poll"])


@router.post("/poll")
def trigger_poll():
    """🔄 Trigger tất cả pollers ngay lập tức.

    Chạy đồng bộ, trả về kết quả mỗi poller sau khi hoàn thành.
    """
    from pollers.github import poll_github

    results = {}

    # GitHub
    try:
        poll_github()
        results["github"] = "ok"
    except Exception as e:
        results["github"] = f"error: {e}"

    return {
        "status": "ok",
        "results": results,
        "message": ", ".join(
            f"{k}: {v}" for k, v in results.items()
        ),
    }
