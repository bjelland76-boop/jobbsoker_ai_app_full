import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()


def _default_data_dir() -> str:
    # Preferred explicit config
    v = (os.getenv("APP_DATA_DIR") or os.getenv("DATA_DIR") or "").strip()
    if v:
        return v

    # Common convention on hosts like Render/Fly when a disk is mounted.
    if os.path.isdir("/data"):
        return "/data"

    return ""


DATA_DIR = _default_data_dir()

if DATA_DIR:
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)

_default_db_path = (Path(DATA_DIR) / "jobbsoker.db") if DATA_DIR else Path("./jobbsoker.db")

# If DATABASE_URL is not set, default to SQLite on disk.
# - Relative path => sqlite:///./jobbsoker.db
# - Absolute path  => sqlite:////data/jobbsoker.db
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip() or f"sqlite:///{_default_db_path}"

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
