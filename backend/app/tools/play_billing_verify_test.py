"""Manual checks for POST /play-billing/verify-purchase (Play Billing prep,
phase 1 step 8). Mirrors stripe_webhook_test.py's approach: isolated on-disk
sqlite DB, Play Developer API responses mocked (no real network call, no real
purchase token or service-account key needed) -- confirms
_set_subscription_status() gets called correctly for both product types and
that a repeated call is idempotent.

Run manually:
  cd backend && venv/bin/python -m app.tools.play_billing_verify_test
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-play-billing-verify-test"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import create_access_token  # noqa: E402
from app.main import app  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import PlayBillingPurchase, Profile, User  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _make_user(db, email: str) -> tuple[int, int, str]:
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
    token = create_access_token(user_id=user.id)
    return user.id, profile.id, token


class _FakeResp:
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def main() -> int:
    with TestClient(app) as client, \
            patch("app.main._get_play_developer_access_token", return_value="fake-access-token"):
        db = SessionLocal()

        # 1) Subscription product ("1_maanedsabonnement"), Google reports it
        #    active -> subscription_status="active", subscription_end from
        #    Google's expiryTime, PlayBillingPurchase row recorded.
        user_id, profile_id, token = _make_user(db, "sub@example.com")
        expiry_dt = datetime.utcnow() + timedelta(days=30)
        sub_active_resp = _FakeResp(200, {
            "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
            "lineItems": [{"expiryTime": expiry_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")}],
        })
        with patch("app.main.requests.get", return_value=sub_active_resp) as mock_get:
            r = client.post(
                "/play-billing/verify-purchase",
                json={"purchase_token": "tok_sub_1", "product_id": "1_maanedsabonnement"},
                headers={"Authorization": f"Bearer {token}"},
            )
        _assert(r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}")
        _assert(mock_get.called, "must call the Play Developer API")
        _assert("subscriptionsv2" in mock_get.call_args.args[0], "subscription product must hit the subscriptionsv2 endpoint")

        db.expire_all()
        profile = db.get(Profile, profile_id)
        _assert(profile.subscription_status == "active", f"expected active, got {profile.subscription_status}")
        _assert(profile.subscription_end is not None, "subscription_end must be set")
        _assert(abs((profile.subscription_end - expiry_dt).total_seconds()) < 2, "subscription_end must match Google's expiryTime")

        purchase = db.scalars(
            __import__("sqlalchemy").select(PlayBillingPurchase).where(PlayBillingPurchase.purchase_token == "tok_sub_1")
        ).first()
        _assert(purchase is not None and purchase.product_id == "1_maanedsabonnement", "PlayBillingPurchase row not recorded correctly")

        print("[OK] Abonnement (1_maanedsabonnement): aktiv status og expiry hentet korrekt fra Google")

        # 2) Idempotency: replaying the SAME purchase_token must not call
        #    Google again and must not change subscription_end.
        with patch("app.main.requests.get", return_value=sub_active_resp) as mock_get2:
            r2 = client.post(
                "/play-billing/verify-purchase",
                json={"purchase_token": "tok_sub_1", "product_id": "1_maanedsabonnement"},
                headers={"Authorization": f"Bearer {token}"},
            )
        _assert(r2.status_code == 200, "replayed verify-purchase should still return 200")
        _assert(not mock_get2.called, "a known purchase_token must short-circuit before ever calling Google again")

        print("[OK] Idempotent ved gjentatt kall med samme purchase_token (ingen nytt Google-kall)")

        # 3) One-time pass product ("7dager"), Google reports purchaseState=0
        #    (purchased) -> subscription_status="active", subscription_end
        #    ~7 days out (WE compute it, not Google).
        user2_id, profile2_id, token2 = _make_user(db, "pass@example.com")
        pass_purchased_resp = _FakeResp(200, {"purchaseState": 0, "acknowledgementState": 0})
        before = datetime.utcnow()
        with patch("app.main.requests.get", return_value=pass_purchased_resp) as mock_get3:
            r3 = client.post(
                "/play-billing/verify-purchase",
                json={"purchase_token": "tok_pass_1", "product_id": "7dager"},
                headers={"Authorization": f"Bearer {token2}"},
            )
        _assert(r3.status_code == 200, f"expected 200, got {r3.status_code}: {r3.text}")
        _assert("purchases/products/7dager" in mock_get3.call_args.args[0], "one-time pass must hit the products endpoint")

        db.expire_all()
        profile2 = db.get(Profile, profile2_id)
        _assert(profile2.subscription_status == "active", f"expected active, got {profile2.subscription_status}")
        expected_min = before + timedelta(days=6, hours=23)
        expected_max = before + timedelta(days=7, hours=1)
        _assert(
            profile2.subscription_end is not None and expected_min <= profile2.subscription_end <= expected_max,
            f"expected subscription_end ~7 days out, got {profile2.subscription_end}",
        )

        print("[OK] Engangspass (7dager): purchaseState=0 gir 7 dagers tilgang beregnet av oss selv")

        # 4) Pending purchase (purchaseState=2) must be rejected, no state change.
        user3_id, profile3_id, token3 = _make_user(db, "pending@example.com")
        pass_pending_resp = _FakeResp(200, {"purchaseState": 2})
        with patch("app.main.requests.get", return_value=pass_pending_resp):
            r4 = client.post(
                "/play-billing/verify-purchase",
                json={"purchase_token": "tok_pass_pending", "product_id": "7dager"},
                headers={"Authorization": f"Bearer {token3}"},
            )
        _assert(r4.status_code == 400, f"pending purchase must be rejected, got {r4.status_code}")
        db.expire_all()
        profile3 = db.get(Profile, profile3_id)
        _assert(profile3.subscription_status is None, "pending purchase must not grant access")

        print("[OK] Ventende kjøp (purchaseState=2) avvises, ingen tilgang gis")

        # 5) Expired subscription reported by Google must be rejected.
        user4_id, profile4_id, token4 = _make_user(db, "expired@example.com")
        sub_expired_resp = _FakeResp(200, {"subscriptionState": "SUBSCRIPTION_STATE_EXPIRED", "lineItems": []})
        with patch("app.main.requests.get", return_value=sub_expired_resp):
            r5 = client.post(
                "/play-billing/verify-purchase",
                json={"purchase_token": "tok_sub_expired", "product_id": "1_maanedsabonnement"},
                headers={"Authorization": f"Bearer {token4}"},
            )
        _assert(r5.status_code == 400, f"expired subscription must be rejected, got {r5.status_code}")
        db.expire_all()
        profile4 = db.get(Profile, profile4_id)
        _assert(profile4.subscription_status is None, "expired subscription must not grant access")

        print("[OK] Utløpt abonnement rapportert av Google avvises")

        # 6) Unknown product_id -> 400, no Google call.
        with patch("app.main.requests.get") as mock_get_unknown:
            r6 = client.post(
                "/play-billing/verify-purchase",
                json={"purchase_token": "tok_x", "product_id": "not_a_real_product"},
                headers={"Authorization": f"Bearer {token4}"},
            )
        _assert(r6.status_code == 400, f"unknown product_id must be rejected, got {r6.status_code}")
        _assert(not mock_get_unknown.called, "unknown product_id must reject before calling Google")

        print("[OK] Ukjent product_id avvises uten å kalle Google")

        # 7) Google API error (e.g. invalid/expired token) -> 400, no state change.
        google_error_resp = _FakeResp(400, {"error": {"message": "Invalid token"}})
        user5_id, profile5_id, token5 = _make_user(db, "badtoken@example.com")
        with patch("app.main.requests.get", return_value=google_error_resp):
            r7 = client.post(
                "/play-billing/verify-purchase",
                json={"purchase_token": "tok_bad", "product_id": "1_maanedsabonnement"},
                headers={"Authorization": f"Bearer {token5}"},
            )
        _assert(r7.status_code == 400, f"Google API error must surface as 400, got {r7.status_code}")

        print("[OK] Play Developer API-feil (f.eks. ugyldig token) håndteres uten krasj")

        db.close()

    # 8) Not configured (no service-account key) -> 500, checked separately
    #    since it needs _get_play_developer_access_token() to genuinely
    #    return None rather than being mocked.
    os.environ.pop("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", None)
    with TestClient(app) as client2:
        db2 = SessionLocal()
        _, _, token6 = _make_user(db2, "notconfigured@example.com")
        db2.close()
        r8 = client2.post(
            "/play-billing/verify-purchase",
            json={"purchase_token": "tok_noconfig", "product_id": "1_maanedsabonnement"},
            headers={"Authorization": f"Bearer {token6}"},
        )
        _assert(r8.status_code == 500, f"missing service-account config must be a clear 500, got {r8.status_code}")

    print("[OK] Manglende GOOGLE_PLAY_SERVICE_ACCOUNT_JSON gir tydelig 500 istedenfor krasj")

    os.remove(_db_path)
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
