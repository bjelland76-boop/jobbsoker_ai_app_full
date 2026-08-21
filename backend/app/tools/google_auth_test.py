"""Manual checks for POST /auth/google (Google Sign-In).

Uses an isolated on-disk sqlite DB and mocks Google's token verification
(no real network call to Google). Also exercises /auth/request-code to
confirm the existing passwordless-code flow still works unmodified.

Run manually:
  cd backend && venv/bin/python -m app.tools.google_auth_test
"""

from __future__ import annotations

import os
import tempfile
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-google-auth-test"
os.environ["GOOGLE_CLIENT_ID_WEB"] = "test-client-id.apps.googleusercontent.com"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-client-secret"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    with TestClient(app) as client:
        # 1) New user signs in with Google -> account auto-created, is_tester False.
        with patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "New.User@Example.com",
                "email_verified": True,
                "name": "Ny Bruker",
            }
            r = client.post("/auth/google", json={"id_token": "fake-token"})
        _assert(r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}")
        body = r.json()
        _assert("access_token" in body, "missing access_token")
        token1 = body["access_token"]
        user_id_1 = body["user_id"]

        me = client.get("/auth/me", headers={"Authorization": f"Bearer {token1}"})
        _assert(me.status_code == 200, "auth/me should work with google-issued token")
        _assert(me.json()["email"] == "new.user@example.com", "email must be stored lowercase")

        # 2) Same person signs in again later with a different-cased email ->
        #    must match the SAME existing account (case-insensitive lookup),
        #    not create a second one.
        with patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "NEW.USER@EXAMPLE.COM",
                "email_verified": True,
                "name": "Ny Bruker",
            }
            r2 = client.post("/auth/google", json={"id_token": "fake-token-2"})
        _assert(r2.status_code == 200, f"expected 200, got {r2.status_code}: {r2.text}")
        _assert(r2.json()["user_id"] == user_id_1, "case-insensitive email must match same user, not create a new one")

        # 3) email_verified == False must be rejected.
        with patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "unverified@example.com",
                "email_verified": False,
                "name": "Uverifisert",
            }
            r3 = client.post("/auth/google", json={"id_token": "fake-token-3"})
        _assert(r3.status_code == 401, f"unverified email must be rejected, got {r3.status_code}")

        # 4) Invalid/garbage token must be rejected cleanly (no 500).
        with patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.side_effect = ValueError("bad token")
            r4 = client.post("/auth/google", json={"id_token": "garbage"})
        _assert(r4.status_code == 401, f"invalid token must be rejected, got {r4.status_code}")

        # 6) /auth/google/callback (Android Custom Tab flow): successful code
        #    exchange -> HTML page whose deep link carries our own JWT.
        class _FakeTokenResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"id_token": "fake-id-token-from-google"}

        with patch("app.main.requests.post", return_value=_FakeTokenResp()) as mock_post, \
                patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "callback.user@example.com",
                "email_verified": True,
                "name": "Callback Bruker",
            }
            r6 = client.get("/auth/google/callback", params={"code": "fake-auth-code", "state": "xyz"}, follow_redirects=False)
        _assert(r6.status_code == 200, f"callback should render an HTML page, got {r6.status_code}")
        _assert(mock_post.called, "callback must exchange the code with Google's token endpoint")
        _assert("com.aerlig.app://auth-callback?token=" in r6.text, "success page must deep-link back with a token")
        _assert("state=xyz" in r6.text, "state must be echoed back to the app for CSRF verification")

        # 7) Missing `code` (e.g. user cancelled) -> error deep link, not a crash.
        r7 = client.get("/auth/google/callback", params={"error": "access_denied", "state": "xyz"})
        _assert(r7.status_code == 200, f"cancelled callback should still render OK, got {r7.status_code}")
        _assert("error=access_denied" in r7.text, "cancellation reason must be forwarded to the app")

        # 8) email_verified == False on the callback path too.
        with patch("app.main.requests.post", return_value=_FakeTokenResp()), \
                patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {"email": "unverified2@example.com", "email_verified": False}
            r8 = client.get("/auth/google/callback", params={"code": "fake-auth-code"})
        _assert("error=email_not_verified" in r8.text, "unverified email must surface as an error deep link")

        # 9) Token-exchange failure (e.g. Google 400s the code) must not crash the server.
        with patch("app.main.requests.post", side_effect=Exception("boom")):
            r9 = client.get("/auth/google/callback", params={"code": "bad-code"})
        _assert(r9.status_code == 200, f"exchange failure should still render OK, got {r9.status_code}")
        _assert("error=exchange_failed" in r9.text, "exchange failure must surface as an error deep link")

        # 10) Same case-insensitive email match as /auth/google: a callback login
        #     for the user created in step 1 must not create a second account.
        with patch("app.main.requests.post", return_value=_FakeTokenResp()), \
                patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {"email": "NEW.USER@example.com", "email_verified": True, "name": "Ny Bruker"}
            r10 = client.get("/auth/google/callback", params={"code": "fake-auth-code"})
        me_token = r10.text.split("token=")[1].split("&")[0].split('"')[0]
        from urllib.parse import unquote
        me_resp = client.get("/auth/me", headers={"Authorization": f"Bearer {unquote(me_token)}"})
        _assert(me_resp.status_code == 200, "token minted by the callback must be a valid JWT")
        _assert(me_resp.json()["id"] == user_id_1, "callback login must match the same existing user, not create a new one")

        # 5) Existing /auth/request-code flow must still work unmodified.
        with patch("app.main.send_email") as mock_send:
            mock_send.return_value = {"sent": True}
            r5 = client.post("/auth/request-code", json={"email": "coder@example.com"})
        _assert(r5.status_code == 200, f"request-code should still work, got {r5.status_code}: {r5.text}")
        _assert(r5.json() == {"sent": True}, "request-code response shape changed")
        _assert(mock_send.called, "request-code should still attempt to send an email")

    os.remove(_db_path)
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
