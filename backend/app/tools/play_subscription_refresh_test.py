"""Manual checks for Play subscription renewal handling (step A, no RTDN):
state mapping, never shortening access from other sources, refresh on a
replayed verify-purchase, refresh before expiring a stale profile, and the
hourly refresh job. Isolated on-disk sqlite DB, Play Developer API mocked.

Run manually:
  cd backend && venv/bin/python -m app.tools.play_subscription_refresh_test
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-play-subscription-refresh-test"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402

import app.main as M  # noqa: E402
from app.auth import create_access_token  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import PlayBillingPurchase, Profile, User  # noqa: E402

_fails = 0


def check(name: str, cond: bool, extra=None) -> None:
    global _fails
    print(("[OK] " if cond else "[FEIL] ") + name + ("" if cond or extra is None else f"  -> {extra}"))
    if not cond:
        _fails += 1


class _FakeResp:
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _sub(state: str, *expiries: datetime) -> _FakeResp:
    return _FakeResp(200, {"subscriptionState": state, "lineItems": [{"expiryTime": _iso(e)} for e in expiries]})


def _make_user(db, email, *, status=None, end=None, play_token=None, product="1_maanedsabonnement", stripe=None):
    user = User(email=email, password_hash="")
    db.add(user)
    db.commit()
    db.refresh(user)
    profile = Profile(
        user_id=user.id, name="Test", email=email, phone="", address="",
        include_photo_default=True, consent_analytics=False, target_role="",
        cv_text="", experience="", education="", skills="", languages="[]",
        references_json="[]", cv_gaps="", tone="normal",
        subscription_status=status, subscription_end=end, stripe_customer_id=stripe,
    )
    db.add(profile)
    if play_token:
        db.add(PlayBillingPurchase(purchase_token=play_token, user_id=user.id, product_id=product, status="verified"))
    db.commit()
    db.refresh(profile)
    return user.id, profile.id, create_access_token(user_id=user.id)


def _close(a: datetime | None, b: datetime | None, secs: int = 5) -> bool:
    return a is not None and b is not None and abs((a - b).total_seconds()) < secs


def main() -> int:
    now = datetime.utcnow()
    future, past = now + timedelta(days=30), now - timedelta(days=2)

    # ---------- 1. State mapping ----------
    E = M._play_subscription_entitlement
    g, s, e = E({"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE", "lineItems": [{"expiryTime": _iso(future)}]}, now)
    check("ACTIVE -> tilgang til expiryTime", g and s == "active" and _close(e, future), (g, s, e))
    g, s, e = E({"subscriptionState": "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "lineItems": [{"expiryTime": _iso(future)}]}, now)
    check("IN_GRACE_PERIOD -> beholder tilgang (var past_due/blokkert før)", g and s == "active", (g, s))
    g, s, e = E({"subscriptionState": "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "lineItems": [{"expiryTime": _iso(past)}]}, now)
    check("IN_GRACE_PERIOD m/ passert expiry -> kort vindu (~1 døgn)", g and _close(e, now + timedelta(days=1), 60), (g, e))
    g, s, e = E({"subscriptionState": "SUBSCRIPTION_STATE_CANCELED", "lineItems": [{"expiryTime": _iso(future)}]}, now)
    check("CANCELED, betalt periode igjen -> tilgang til expiry (var kuttet før)", g and s == "active" and _close(e, future), (g, s))
    g, s, e = E({"subscriptionState": "SUBSCRIPTION_STATE_CANCELED", "lineItems": [{"expiryTime": _iso(past)}]}, now)
    check("CANCELED, periode utløpt -> expired", not g and s == "expired", (g, s))
    for st, want in [("SUBSCRIPTION_STATE_ON_HOLD", "past_due"), ("SUBSCRIPTION_STATE_PAUSED", "cancelled"),
                     ("SUBSCRIPTION_STATE_EXPIRED", "expired"), ("SUBSCRIPTION_STATE_PENDING", "cancelled"), ("", "cancelled")]:
        g, s, _ = E({"subscriptionState": st, "lineItems": [{"expiryTime": _iso(future)}]}, now)
        check(f"{st or '(tom)'} -> ingen tilgang, status {want}", not g and s == want, (g, s))
    g, s, e = E({"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
                 "lineItems": [{"expiryTime": _iso(now + timedelta(days=3))}, {"expiryTime": _iso(future)}]}, now)
    check("flere lineItems -> seneste expiry", _close(e, future), e)

    # ---------- 2. Never shorten access from other sources ----------
    A = M._apply_play_entitlement
    p = SimpleNamespace(subscription_status="active", subscription_end=now + timedelta(days=60))
    A(p, True, "active", future, now)
    check("Play-tilgang forkorter ikke lengre Stripe/7dager-tilgang", _close(p.subscription_end, now + timedelta(days=60)))
    p = SimpleNamespace(subscription_status="active", subscription_end=now + timedelta(days=5))
    A(p, False, "expired", past, now)
    check("Utløpt Play fjerner ikke aktiv tilgang fra annen kilde", p.subscription_status == "active")
    p = SimpleNamespace(subscription_status="active", subscription_end=past)
    A(p, False, "expired", past, now)
    check("Utløpt Play nedgraderer Play-gitt tilgang", p.subscription_status == "expired")
    p = SimpleNamespace(subscription_status="expired", subscription_end=past)
    A(p, True, "active", future, now)
    check("Fornyet Play gjenoppretter utløpt profil", p.subscription_status == "active" and _close(p.subscription_end, future))

    # The scheduler would also start this job at app startup; keep a handle on
    # the real function and stub the module attribute so only the explicit
    # call below runs it.
    real_job = M.refresh_play_subscriptions
    with TestClient(M.app) as client, \
            patch("app.main._get_play_developer_access_token", return_value="fake-access-token"), \
            patch("app.main.refresh_play_subscriptions"), \
            patch("app.main.send_pending_day7_feedback_emails"), \
            patch("app.main.maybe_send_scheduled_report"):
        db = SessionLocal()

        # ---------- 3. verify-purchase ----------
        _, pid, tok = _make_user(db, "renew@example.com", status="active", end=now + timedelta(days=1), play_token="tok_renew")
        with patch("app.main.requests.get", return_value=_sub("SUBSCRIPTION_STATE_ACTIVE", future)) as mg:
            r = client.post("/play-billing/verify-purchase", json={"purchase_token": "tok_renew", "product_id": "1_maanedsabonnement"},
                            headers={"Authorization": f"Bearer {tok}"})
        db.expire_all(); pr = db.get(Profile, pid)
        check("Gjenopprett kjøp (kjent abonnement-token) henter fornyelse fra Google",
              r.status_code == 200 and mg.called and _close(pr.subscription_end, future), (r.status_code, pr.subscription_end))

        with patch("app.main.requests.get", return_value=_FakeResp(500, {"error": "boom"})):
            r = client.post("/play-billing/verify-purchase", json={"purchase_token": "tok_renew", "product_id": "1_maanedsabonnement"},
                            headers={"Authorization": f"Bearer {tok}"})
        db.expire_all(); pr = db.get(Profile, pid)
        check("Google-feil ved gjenoppretting -> 200, ingen endring", r.status_code == 200 and _close(pr.subscription_end, future))

        _, pid7, tok7 = _make_user(db, "pass7@example.com", status="active", end=now + timedelta(days=2), play_token="tok_7d", product="7dager")
        with patch("app.main.requests.get") as mg:
            r = client.post("/play-billing/verify-purchase", json={"purchase_token": "tok_7d", "product_id": "7dager"},
                            headers={"Authorization": f"Bearer {tok7}"})
        db.expire_all(); pr = db.get(Profile, pid7)
        check("Kjent 7dager-token gir IKKE 7 nye dager og kaller ikke Google",
              r.status_code == 200 and not mg.called and _close(pr.subscription_end, now + timedelta(days=2)))

        _, pidc, tokc = _make_user(db, "canceledpaid@example.com")
        with patch("app.main.requests.get", return_value=_sub("SUBSCRIPTION_STATE_CANCELED", future)):
            r = client.post("/play-billing/verify-purchase", json={"purchase_token": "tok_canc", "product_id": "1_maanedsabonnement"},
                            headers={"Authorization": f"Bearer {tokc}"})
        db.expire_all(); pr = db.get(Profile, pidc)
        check("Nytt token, CANCELED men betalt -> godtas (var 400 før)",
              r.status_code == 200 and pr.subscription_status == "active" and _close(pr.subscription_end, future), (r.status_code, r.text[:120]))

        _, pidx, tokx = _make_user(db, "otheruser@example.com")
        with patch("app.main.requests.get", return_value=_sub("SUBSCRIPTION_STATE_ACTIVE", future)):
            r = client.post("/play-billing/verify-purchase", json={"purchase_token": "tok_renew", "product_id": "1_maanedsabonnement"},
                            headers={"Authorization": f"Bearer {tokx}"})
        db.expire_all(); prx = db.get(Profile, pidx)
        check("Kjent token fra annen konto gir IKKE tilgang til innlogget bruker", r.status_code == 200 and prx.subscription_status is None)

        # ---------- 4. Refresh before expiring (GET /profiles/{id}) ----------
        _, pid4, tok4 = _make_user(db, "lazy@example.com", status="active", end=past, play_token="tok_lazy")
        with patch("app.main.requests.get", return_value=_sub("SUBSCRIPTION_STATE_ACTIVE", future)) as mg:
            r = client.get(f"/profiles/{pid4}", headers={"Authorization": f"Bearer {tok4}"})
        check("Utløpt Play-profil som er fornyet: forblir aktiv ved lesing", mg.called and r.json().get("subscription_status") == "active", r.json().get("subscription_status"))

        _, pid5, tok5 = _make_user(db, "lazyexp@example.com", status="active", end=past, play_token="tok_lazyexp")
        with patch("app.main.requests.get", return_value=_sub("SUBSCRIPTION_STATE_EXPIRED", past)):
            r = client.get(f"/profiles/{pid5}", headers={"Authorization": f"Bearer {tok5}"})
        check("Utløpt Play-profil som IKKE er fornyet: expired", r.json().get("subscription_status") == "expired")

        _, pid6, tok6 = _make_user(db, "lazydown@example.com", status="active", end=past, play_token="tok_lazydown")
        with patch("app.main.requests.get", side_effect=Exception("network down")):
            r = client.get(f"/profiles/{pid6}", headers={"Authorization": f"Bearer {tok6}"})
        check("Google nede: faller tilbake til gammel oppførsel (expired), ingen 500", r.status_code == 200 and r.json().get("subscription_status") == "expired")

        _, pid8, tok8 = _make_user(db, "stripeonly@example.com", status="active", end=past, stripe="cus_1")
        with patch("app.main.requests.get") as mg:
            r = client.get(f"/profiles/{pid8}", headers={"Authorization": f"Bearer {tok8}"})
        check("Profil uten Play-kjøp: ingen Google-kall, utløper som før", not mg.called and r.json().get("subscription_status") == "expired")

        _, pid9, tok9 = _make_user(db, "activeok@example.com", status="active", end=future, play_token="tok_ok")
        with patch("app.main.requests.get") as mg:
            r = client.get(f"/profiles/{pid9}", headers={"Authorization": f"Bearer {tok9}"})
        check("Aktiv profil med end i fremtiden: ingen Google-kall ved lesing", not mg.called and r.json().get("subscription_status") == "active")

        # ---------- 5. Hourly job ----------
        _, j1, _ = _make_user(db, "job_due@example.com", status="active", end=now + timedelta(hours=3), play_token="tok_j1")
        _, j2, _ = _make_user(db, "job_far@example.com", status="active", end=now + timedelta(days=20), play_token="tok_j2")
        _, j3, _ = _make_user(db, "job_hold@example.com", status="past_due", end=past, play_token="tok_j3")
        _, j4, _ = _make_user(db, "job_recentexp@example.com", status="expired", end=now - timedelta(days=1), play_token="tok_j4")
        _, j5, _ = _make_user(db, "job_oldexp@example.com", status="expired", end=now - timedelta(days=10), play_token="tok_j5")
        _, j6, _ = _make_user(db, "job_stripe@example.com", status="active", end=now + timedelta(hours=3), stripe="cus_2")
        called_tokens = []

        def fake_get(url, **kw):
            called_tokens.append(url.rsplit("/", 1)[-1])
            return _sub("SUBSCRIPTION_STATE_ACTIVE", future)

        with patch("app.main.requests.get", side_effect=fake_get):
            real_job()
        db.close()
    db = SessionLocal()
    want = {"tok_j1", "tok_j3", "tok_j4"}
    others = [t for t in called_tokens if t.startswith("tok_j")]
    check("Jobb: sjekker kun aktuelle (snart utløp / on hold / nylig utløpt)", set(others) == want, sorted(others))
    check("Jobb: snart-utløpende fornyes", _close(db.get(Profile, j1).subscription_end, future))
    check("Jobb: on hold -> gjenopprettet når Google sier ACTIVE", db.get(Profile, j3).subscription_status == "active")
    check("Jobb: nylig utløpt -> gjenopprettet ved fornyelse", db.get(Profile, j4).subscription_status == "active")
    check("Jobb: gammel utløpt og langt-frem urørt", db.get(Profile, j5).subscription_status == "expired" and db.get(Profile, j2).subscription_status == "active")
    check("Jobb: Stripe-profil urørt", db.get(Profile, j6).subscription_status == "active")
    db.close()

    os.remove(_db_path)
    print(f"\nFEIL: {_fails}")
    return 1 if _fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
