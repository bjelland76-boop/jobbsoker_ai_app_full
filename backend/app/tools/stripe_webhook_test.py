"""Manual checks for POST /stripe-webhook after refactoring it onto the
shared _grant_credits() / _set_subscription_status() helpers (Play Billing
prep, phase 0). Confirms one-time credit purchases and the 79kr subscription
still behave exactly as before the refactor.

Uses an isolated on-disk sqlite DB and mocks stripe.Webhook.construct_event
(no real network call to Stripe, no real signature needed).

Run manually:
  cd backend && venv/bin/python -m app.tools.stripe_webhook_test
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-stripe-webhook-test"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Profile, StripePayment, User  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _make_user(db, email: str) -> tuple[int, int]:
    user = User(email=email, password_hash="")
    db.add(user)
    db.commit()
    db.refresh(user)
    profile = Profile(
        user_id=user.id, name="Test", email=email, phone="", address="",
        include_photo_default=True, consent_analytics=False, target_role="",
        cv_text="", experience="", education="", skills="", languages="[]",
        references_json="[]", cv_gaps="", tone="normal",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return user.id, profile.id


def _webhook_event(event_type: str, obj: dict) -> dict:
    return {"type": event_type, "data": {"object": obj}}


def main() -> int:
    with TestClient(app) as client:
        db = SessionLocal()
        user_id, profile_id = _make_user(db, "buyer@example.com")

        # 1) One-time credit purchase (checkout.session.completed, mode=payment)
        #    -> job_credits granted via _grant_credits(), StripePayment recorded.
        event = _webhook_event("checkout.session.completed", {
            "id": "cs_test_pkg_1",
            "mode": "payment",
            "metadata": {"user_id": str(user_id), "credits": "15"},
        })
        with patch("app.main.stripe.Webhook.construct_event", return_value=event):
            r = client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        _assert(r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}")

        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.job_credits == 15, f"expected 15 credits, got {profile.job_credits}")
        payment = db.scalars(
            __import__("sqlalchemy").select(StripePayment).where(StripePayment.session_id == "cs_test_pkg_1")
        ).first()
        _assert(payment is not None and payment.credits == 15, "StripePayment row not recorded correctly")

        # 2) Idempotency: replaying the SAME session id must not grant credits twice.
        with patch("app.main.stripe.Webhook.construct_event", return_value=event):
            r2 = client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        _assert(r2.status_code == 200, "replayed webhook should still return 200")
        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.job_credits == 15, f"replay must not double-grant credits, got {profile.job_credits}")

        # 3) A second, different purchase adds on top of the existing balance.
        event2 = _webhook_event("checkout.session.completed", {
            "id": "cs_test_pkg_2",
            "mode": "payment",
            "metadata": {"user_id": str(user_id), "credits": "3"},
        })
        with patch("app.main.stripe.Webhook.construct_event", return_value=event2):
            client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.job_credits == 18, f"expected 15+3=18 credits, got {profile.job_credits}")

        # 4) Subscription checkout completion (mode=subscription) must NOT grant credits
        #    (that's handled by the subscription.* events below, not this one).
        sub_checkout_event = _webhook_event("checkout.session.completed", {
            "id": "cs_test_sub", "mode": "subscription", "metadata": {"user_id": str(user_id)},
        })
        with patch("app.main.stripe.Webhook.construct_event", return_value=sub_checkout_event):
            client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.job_credits == 18, "subscription-mode checkout.session.completed must not touch credits")

        # 5) customer.subscription.created (active) -> subscription_status="active",
        #    subscription_end set via _set_subscription_status(), stripe_customer_id backfilled.
        period_end_ts = int((datetime.utcnow() + timedelta(days=30)).timestamp())
        sub_created = _webhook_event("customer.subscription.created", {
            "customer": "cus_test_123",
            "status": "active",
            "current_period_end": period_end_ts,
            "metadata": {"user_id": str(user_id)},
        })
        with patch("app.main.stripe.Webhook.construct_event", return_value=sub_created):
            r5 = client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        _assert(r5.status_code == 200, f"expected 200, got {r5.status_code}")
        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.subscription_status == "active", f"expected active, got {profile.subscription_status}")
        _assert(profile.stripe_customer_id == "cus_test_123", "stripe_customer_id must be backfilled")
        _assert(profile.subscription_end is not None, "subscription_end must be set")

        # 6) customer.subscription.deleted -> forced to "cancelled" regardless of reported status.
        sub_deleted = _webhook_event("customer.subscription.deleted", {
            "customer": "cus_test_123", "status": "active",  # Stripe sometimes still reports "active" on delete
            "current_period_end": period_end_ts, "metadata": {"user_id": str(user_id)},
        })
        with patch("app.main.stripe.Webhook.construct_event", return_value=sub_deleted):
            client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.subscription_status == "cancelled", f"expected cancelled, got {profile.subscription_status}")

        # 7) invoice.payment_failed -> subscription_status="past_due", subscription_end UNCHANGED.
        # Re-activate first so we can observe past_due doesn't clobber subscription_end.
        with patch("app.main.stripe.Webhook.construct_event", return_value=sub_created):
            client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        db.expire_all()
        end_before = db.get(Profile, profile_id).subscription_end

        failed_event = _webhook_event("invoice.payment_failed", {"customer": "cus_test_123"})
        with patch("app.main.stripe.Webhook.construct_event", return_value=failed_event):
            client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "x"})
        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.subscription_status == "past_due", f"expected past_due, got {profile.subscription_status}")
        _assert(profile.subscription_end == end_before, "invoice.payment_failed must not change subscription_end")

        # 8) Invalid signature -> 400, no state change.
        with patch("app.main.stripe.Webhook.construct_event", side_effect=Exception("bad sig")):
            r8 = client.post("/stripe-webhook", data=b"{}", headers={"stripe-signature": "bad"})
        _assert(r8.status_code == 400, f"expected 400 for bad signature, got {r8.status_code}")

        db.close()

    os.remove(_db_path)
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
