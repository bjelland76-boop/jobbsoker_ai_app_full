"""Manual check for the PlayBillingPurchase table (Play Billing prep, phase 1
step 7): confirms it's auto-created on a fresh DB by Base.metadata.create_all()
(same mechanism that created StripePayment -- no ensure_col migration needed
since this is a brand-new table, not a new column on an existing one), and
that its purchase_token uniqueness is enforced.

Run manually:
  cd backend && venv/bin/python -m app.tools.play_billing_purchase_test
"""

from __future__ import annotations

import os
import tempfile

os.environ["JWT_SECRET"] = "test-secret-for-play-billing-purchase-test"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import inspect  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.main import app  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.models import PlayBillingPurchase, User  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    # Starting the app (lifespan) runs Base.metadata.create_all() + ensure_profile_columns() --
    # this is what must create play_billing_purchases on a fresh DB with no extra migration step.
    with TestClient(app):
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        _assert("play_billing_purchases" in tables, "play_billing_purchases table was not auto-created by create_all()")

        cols = {c["name"] for c in inspector.get_columns("play_billing_purchases")}
        expected_cols = {"id", "purchase_token", "user_id", "product_id", "status", "verified_at"}
        _assert(expected_cols.issubset(cols), f"missing columns: {expected_cols - cols}")

        db = SessionLocal()
        user = User(email="buyer@example.com", password_hash="")
        db.add(user)
        db.commit()
        db.refresh(user)

        db.add(PlayBillingPurchase(
            purchase_token="tok_abc123",
            user_id=user.id,
            product_id="1_maanedsabonnement",
            status="verified",
        ))
        db.commit()

        # 1) purchase_token must be unique -- a second row with the same token must fail.
        db.add(PlayBillingPurchase(
            purchase_token="tok_abc123",
            user_id=user.id,
            product_id="1_maanedsabonnement",
            status="verified",
        ))
        try:
            db.commit()
            raised = False
        except IntegrityError:
            db.rollback()
            raised = True
        _assert(raised, "duplicate purchase_token must violate the unique constraint")

        # 2) A different token for the same user is fine (e.g. a renewal or the 7-day pass).
        db.add(PlayBillingPurchase(
            purchase_token="tok_def456",
            user_id=user.id,
            product_id="7dager",
            status="verified",
        ))
        db.commit()

        count = db.query(PlayBillingPurchase).filter(PlayBillingPurchase.user_id == user.id).count()
        _assert(count == 2, f"expected 2 purchase rows for user, got {count}")

        db.close()

    os.remove(_db_path)
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
