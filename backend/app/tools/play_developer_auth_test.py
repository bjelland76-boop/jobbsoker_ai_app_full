"""Manual checks for _get_play_developer_access_token() (Play Billing prep,
phase 1 step 6).

Confirms the service-account credential flow is wired up correctly using a
fake key + a mocked token refresh (no real network call to Google needed).

If a REAL GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is present in the environment
when this is run, it ALSO makes one real read-only call to the Play
Developer API (listing the app's in-app products) to confirm the real
credential actually works end to end. That part is skipped otherwise --
the real key can only be supplied once Frank has done the Google
Cloud/Play Console service-account setup (plan step 0) and pasted the key
into Render's GOOGLE_PLAY_SERVICE_ACCOUNT_JSON env var.

Run manually:
  cd backend && venv/bin/python -m app.tools.play_developer_auth_test
"""

from __future__ import annotations

import json
import os
import tempfile
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-play-developer-auth-test"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

_real_service_account_json = os.getenv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")

_FAKE_KEY = {
    "type": "service_account",
    "project_id": "aerlig-test",
    "private_key_id": "fake",
    # A syntactically valid RSA key is required for google-auth to construct
    # Credentials at all (it parses the PEM eagerly) -- generated fresh and
    # locally for this test fixture only, not a real secret, never used to
    # sign a real request since credentials.refresh() is mocked below.
    "private_key": (
        "-----BEGIN PRIVATE KEY-----\n"
        "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDO5LSvGDbic9Wr\n"
        "BZoD1A8xQPj2Gt2bI8+0zWaxxTKGwTf8212ag4mM6W2tQyqXPzFlmdNEaPvBhBUl\n"
        "LNL7bkRFdnxRngOVkQSyoP2BBdUCyjHUsGjfuZxppQ+LSTndM3KxQLFV9DS2/ECk\n"
        "m5rRm7J/wLiPCNLy7LfONntEJVgDOIXUEK81aQW0lO9EHeHq93yRnKNIY1XGsvQ/\n"
        "4rO51Y4/GQnCNOEP32T1qnLzKjfdAIJFx9VNKXnVgQFg7Z1/Kuqs6zHIKVgrhZcE\n"
        "Li/7GKQc6AAAFPX7NUNcw3P4/wo0OmNA6weX29oN2Hg7oIJi/RUfx4qb1u1cInsM\n"
        "jijeBgcXAgMBAAECggEAAJnlQz9HJ1NniqmUokxmIJsME3nzzdDDgg29xXHCe1yI\n"
        "jLlomWwYYolggb5IMzILwU8iuaB6BU+TEY/TK2knXtomvxnj+Y2rVlM9Y/8CUtQH\n"
        "iZfDoTWaboD3l3c4Wv0hMDP1KNe4yqzgtCuEii5znZpW4ehnHnAP+oNufoT0l5r7\n"
        "yXECGQCg/nhjubEcTCWVd8uWiRJE97cllz81u1q56U4AHZ37V28QC3ljOC0Pq+ya\n"
        "SOL/7PtiPzSBoTAEaWnansIbnqp0nQbslaos6BMEva2LrQ9rje6hpwXRf891AKNl\n"
        "kVxpvgXyD663L0rgU0RfV7Ws+asIvZrdp5uoRuCanQKBgQDm6JqHuCivL/TNIq++\n"
        "bLJ2PQzC4Uk+/MrUo+OIokrhSIgCAHu4IH8V5fQHDqI8D9RzGt0IBbF5T2yFDMvX\n"
        "Q0vzy5A7/JP/UBfC45uSbk7aJJz9mf4FkBVhOJE1GUNE0sfBeSHismTF5vxpPfnM\n"
        "WH7xklnMALZ2J+xZcJ76vBG1AwKBgQDlYAxyAw7/+P55GwD2KUMHNvxTIXuTtamF\n"
        "35T+Kzc3o5vkZYEAZOl2MoH69MJYIiUhmsN4YqlpHVP3mWSPTtuCKzy6DTTGkel7\n"
        "zZhYWnnGPs9gL+MtPMsM51dcLVdx5ww71eb6vAK6bkLUzJ/uPIpqC6yBn3iLQckj\n"
        "b8xhuBwXXQKBgQCfnS4knuJQpv+7RTzijtSV8wF9PKmbBrdWYauI6VaFf9O0Po1G\n"
        "6/+tLXWP40e16ONcZbdgMj9JseM73WqSdIxuC8q6DJBpLf4e06LYh7OuCx0SGH6F\n"
        "beG5gJavc7USP/mg/ZC02cfbHR5hyVuBK7MkXZwA7oUyC8rO0JC0lYhP7QKBgGnw\n"
        "g68A5KOrH/VVWItZIWEqrz3CAC6Hv+VaD5mY4ibrhOvnSb6h3QY/a7M56q0EEDxG\n"
        "G7P1daNb7VU1XrGlzVKAn8qaoN55s+n/WjasiwPaLLOTSoyxQGMUUk/7jSDJguf7\n"
        "8nOp9GSg2nMok1FYWuGBxMoVmnpPBxQ75ZzYiPjtAoGBAMll4mB91xC2i2CNEM7F\n"
        "9mdYTbjh6YYLCtSwda2IBtURhaz6olZdevtdXm+zNiv+DheXH9TvQJDZU0biUS8F\n"
        "2bge9ViFEFqnjNVztQBWkxziR5N/+dAQyDikLB5cpBVh0KRJ+1MHdFecMrPmZst1\n"
        "oI6rTXBdWwKYGoYZfFcvMCzW\n"
        "-----END PRIVATE KEY-----\n"
    ),
    "client_email": "play-billing-test@aerlig-test.iam.gserviceaccount.com",
    "token_uri": "https://oauth2.googleapis.com/token",
}


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    # Isolate this test's env var from any real key an earlier run may have left set.
    os.environ.pop("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", None)

    from app.main import _get_play_developer_access_token  # noqa: E402

    # 1) Not configured -> None, no crash.
    token = _get_play_developer_access_token()
    _assert(token is None, f"expected None when unset, got {token!r}")

    # 2) Configured with a fake key -> builds Credentials and returns the
    #    (mocked) refreshed token. Mocking Credentials.refresh means this
    #    never makes a real network call to Google.
    os.environ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"] = json.dumps(_FAKE_KEY)

    def _fake_refresh(self, request):
        self.token = "fake-access-token-abc"

    with patch("app.main.google_service_account.Credentials.refresh", _fake_refresh):
        token = _get_play_developer_access_token()
    _assert(token == "fake-access-token-abc", f"expected mocked token, got {token!r}")

    print("[OK] _get_play_developer_access_token(): unset -> None, configured -> refreshed token (mocked)")

    # 3) Malformed JSON in the env var must raise cleanly (caller's problem to
    #    handle/log), not silently return a bad token.
    os.environ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"] = "not-json"
    try:
        _get_play_developer_access_token()
        raised = False
    except json.JSONDecodeError:
        raised = True
    _assert(raised, "malformed service-account JSON must raise, not fail silently")

    os.environ.pop("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", None)
    print("[OK] Malformed service-account JSON raises instead of returning a bad token")

    if os.path.exists(_db_path):
        os.remove(_db_path)

    # 4) OPTIONAL live check: only runs if a real key was already present in
    #    this shell's environment before the test started (never committed,
    #    never required for the test to pass).
    if _real_service_account_json:
        import requests as _requests
        os.environ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"] = _real_service_account_json
        from app.main import PLAY_PACKAGE_NAME
        real_token = _get_play_developer_access_token()
        _assert(real_token, "real service-account key present but no token returned")
        resp = _requests.get(
            f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PLAY_PACKAGE_NAME}/inappproducts",
            headers={"Authorization": f"Bearer {real_token}"},
            timeout=10,
        )
        _assert(resp.status_code == 200, f"real Play Developer API call failed: {resp.status_code} {resp.text}")
        print(f"[OK] Live Play Developer API call succeeded, {len(resp.json().get('inappproduct', []))} in-app product(s) found")
    else:
        print("[SKIP] No real GOOGLE_PLAY_SERVICE_ACCOUNT_JSON in environment -- live API check skipped")

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
