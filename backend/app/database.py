"""Deprecated DB module.

This project originally shipped with both `db.py` and `database.py` containing
separate SQLAlchemy Base/engine/session objects.

That is dangerous because models may bind to one Base while the app creates
tables on another engine/metadata, leading to missing tables or inconsistent
connections.

Keep this module as a compatibility alias so older imports keep working:

    from app.database import Base, engine, get_db

But internally it re-exports the single source of truth from `app.db`.
"""

from .db import Base, engine, SessionLocal, get_db, DATABASE_URL

__all__ = [
    "Base",
    "engine",
    "SessionLocal",
    "get_db",
    "DATABASE_URL",
]
