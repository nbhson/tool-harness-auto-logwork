"""Database engine & session factory."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from config import config

# SQLite cần check_same_thread=False vì FastAPI + scheduler
# có thể truy cập DB từ nhiều thread khác nhau.
connect_args = (
    {"check_same_thread": False}
    if "sqlite" in config.DATABASE_URL
    else {}
)

engine = create_engine(
    config.DATABASE_URL,
    connect_args=connect_args,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def init_db() -> None:
    """Tạo tất cả bảng nếu chưa tồn tại."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Generator: yield một session và tự động đóng sau khi dùng."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
