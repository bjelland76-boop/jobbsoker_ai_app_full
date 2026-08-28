"""Manual checks for the anonymous-access mode (profil, dokumenter,
CV-analyse, CV-generering, jobbanalyse -- no token required).

Anonymous callers share ONE pool of ANON_SHARED_LIMIT=6 credits across
jobbanalyse + CV-analyse + CV-generering combined (not three separate
3-limits like logged-in users get). Once exhausted, all three require
login + payment.

Uses an isolated on-disk sqlite DB and mocks all LLM calls (no real network
calls to Claude/OpenAI). Also confirms:
  - a logged-in user still works exactly as before -- three SEPARATE
    3-free-limits (analyse/cv_analyse/cv), not the anonymous shared pool
  - /analyze-url-and-send and /interview/* still require a token, untouched

Run manually:
  cd backend && venv/bin/python -m app.tools.anon_access_test
"""

from __future__ import annotations

import io
import os
import tempfile
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-anon-access-test"
os.environ["GOOGLE_CLIENT_ID_WEB"] = "test-client-id.apps.googleusercontent.com"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-client-secret"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import UsageEvent  # noqa: E402


def _usage_count(action: str, user_id) -> int:
    with SessionLocal() as db:
        rows = db.scalars(
            select(UsageEvent).where(UsageEvent.action == action, UsageEvent.user_id == user_id)
        ).all()
        return len(rows)


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


_FAKE_CV_ANALYSIS = {"summary": "Solid CV", "strengths": ["a"], "gaps": []}
_FAKE_JOB_ANALYSIS = {
    "job_title": "Butikkmedarbeider",
    "company": "Test AS",
    "match_score": 82,
    "__job_text": "Vi soker en dyktig butikkmedarbeider.",
}
_FAKE_GENERATED_TEXTS = {
    "cover_letter": "Kjaere Test AS ...",
    "tailored_cv": "Skreddersydd CV-tekst",
    "email_text": "Hei, vedlagt finner du ...",
}


def main() -> int:
    with TestClient(app) as client, \
         patch("app.cv_analyzer.analyze_profile_cv", return_value=dict(_FAKE_CV_ANALYSIS)), \
         patch("app.job_analyzer.analyze_job_url") as mock_analyze_url, \
         patch("app.job_analyzer.generate_application_texts", return_value=dict(_FAKE_GENERATED_TEXTS)):

        def _fake_analyze(profile, url, **kwargs):
            # Vary match_score slightly per call so repeated calls with
            # different urls create distinct Job rows.
            return dict(_FAKE_JOB_ANALYSIS)

        mock_analyze_url.side_effect = _fake_analyze

        # ------------------------------------------------------------------
        # 1) Anonymous profile CRUD
        # ------------------------------------------------------------------
        r = client.post("/profiles", json={"name": "Anonym Bruker", "email": "anon@example.com"})
        _assert(r.status_code == 200, f"anon create profile: expected 200, got {r.status_code}: {r.text}")
        anon_profile = r.json()
        _assert(anon_profile["user_id"] is None, "anon profile should have user_id=None")
        anon_pid = anon_profile["id"]

        r = client.get("/profiles")
        _assert(r.status_code == 200 and r.json() == [], f"anon GET /profiles should be [], got {r.text}")

        r = client.get(f"/profiles/{anon_pid}")
        _assert(r.status_code == 200 and r.json()["name"] == "Anonym Bruker", f"anon GET /profiles/{{id}} failed: {r.text}")

        r = client.put(f"/profiles/{anon_pid}", json={"name": "Anonym Bruker 2", "email": "anon@example.com"})
        _assert(r.status_code == 200 and r.json()["name"] == "Anonym Bruker 2", f"anon PUT /profiles/{{id}} failed: {r.text}")

        r = client.patch(f"/profiles/{anon_pid}/onboarding")
        _assert(r.status_code == 200 and r.json()["has_seen_onboarding"] is True, f"anon onboarding-patch failed: {r.text}")

        print("[OK] anonym profil-CRUD")

        # ------------------------------------------------------------------
        # 2) Logged-in user (Google Sign-In), for isolation + regression checks
        # ------------------------------------------------------------------
        with patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "logged.in@example.com",
                "email_verified": True,
                "name": "Innlogget Bruker",
            }
            r = client.post("/auth/google", json={"id_token": "fake-token"})
        _assert(r.status_code == 200, f"google sign-in failed: {r.text}")
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        r = client.get("/profiles", headers=headers)
        _assert(r.status_code == 200 and len(r.json()) == 1, f"logged-in GET /profiles failed: {r.text}")
        real_profile = r.json()[0]
        real_pid = real_profile["id"]
        _assert(real_profile["user_id"] is not None, "logged-in profile should have a user_id")

        print("[OK] innlogget bruker opprettet via Google Sign-In (uendret flyt)")

        # ------------------------------------------------------------------
        # 3) Isolation: anonymous <-> logged-in profiles must not cross over
        # ------------------------------------------------------------------
        r = client.get(f"/profiles/{real_pid}")  # no auth
        _assert(r.status_code == 404, f"anonymous should NOT reach a real user's profile, got {r.status_code}")

        r = client.get(f"/profiles/{anon_pid}", headers=headers)  # logged-in token
        _assert(r.status_code == 404, f"logged-in user should NOT reach an anonymous profile by id, got {r.status_code}")

        print("[OK] anonym/innlogget profil-isolasjon")

        # ------------------------------------------------------------------
        # 4) Documents: anonymous extracts-but-does-not-persist
        # ------------------------------------------------------------------
        with patch("app.cv_importer.extract_document_text", return_value="Uttrukket tekst fra dokument"):
            files = {"file": ("attest.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")}
            r = client.post("/profile/documents", files=files, data={"document_type": "Attest"})
        _assert(r.status_code == 200, f"anon document upload failed: {r.text}")
        body = r.json()
        _assert(body["id"] is None, "anon document upload should not get a persisted id")
        _assert(body.get("extracted_text") == "Uttrukket tekst fra dokument", "anon upload should return extracted text directly")

        r = client.get("/profile/documents")
        _assert(r.status_code == 200 and r.json() == [], f"anon GET documents should be [], got {r.text}")

        r = client.delete("/profile/documents/999999")
        _assert(r.status_code == 404, f"anon delete document should 404, got {r.status_code}")

        print("[OK] anonym dokument-opplasting (uttrekk uten lagring)")

        # ------------------------------------------------------------------
        # 5) Anonymous shared 6-credit pool across analyse + cv_analyse + cv,
        #    consumed in a mixed order: 2 cv_analyse, 2 analyse, 1 cv
        #    (generate-tailored-cv), 1 cv (stream-documents) = 6 total.
        # ------------------------------------------------------------------
        for i in range(2):
            r = client.post("/analyze-cv", json={"profile_id": anon_pid, "language": "no"})
            _assert(r.status_code == 200, f"anon analyze-cv call {i+1} failed: {r.status_code} {r.text}")

        job_ids = []
        for i in range(2):
            r = client.post(
                "/analyze-url",
                json={"profile_id": anon_pid, "url": f"https://example.com/job-{i}", "language": "no"},
            )
            _assert(r.status_code == 200, f"anon analyze-url call {i+1} failed: {r.status_code} {r.text}")
            job_ids.append(r.json()["job_id"])

        r = client.get("/job-analyses", params={"profile_id": anon_pid})
        _assert(r.status_code == 200 and len(r.json()) == 2, f"anon job-analyses list failed: {r.text}")
        r = client.patch(f"/job-analyses/{job_ids[1]}/favorite/{anon_pid}")
        _assert(r.status_code == 200, f"anon favorite job-analysis failed: {r.text}")
        # Cross-check: logged-in user cannot reach the anonymous Job either.
        r = client.get(f"/job-analyses/{job_ids[0]}", params={"profile_id": real_pid}, headers=headers)
        _assert(r.status_code == 404, f"logged-in user should not reach anonymous job, got {r.status_code}")

        r = client.post(
            f"/job-analyses/{job_ids[0]}/generate-tailored-cv",
            params={"profile_id": anon_pid, "language": "no"},
        )
        _assert(r.status_code == 200, f"anon generate-tailored-cv failed: {r.status_code} {r.text}")
        _assert(r.json()["cv"] == _FAKE_GENERATED_TEXTS["tailored_cv"], "unexpected generated cv text")

        def _fake_stream(*args, **kwargs):
            yield "chunk", "Kjaere "
            yield "chunk", "Test AS"
            yield "done", dict(_FAKE_GENERATED_TEXTS)

        with patch("app.job_analyzer.stream_application_texts", side_effect=_fake_stream):
            r = client.post(
                f"/job-analyses/{job_ids[1]}/stream-documents",
                params={"profile_id": anon_pid, "language": "no"},
            )
        _assert(r.status_code == 200, f"anon stream-documents failed: {r.status_code} {r.text}")

        # 6 credits used (2+2+1+1), spread across the three per-type columns.
        r = client.get(f"/profiles/{anon_pid}")
        prof = r.json()
        _assert(prof["cv_analysis_count"] == 2, f"expected cv_analysis_count=2, got {prof['cv_analysis_count']}")
        _assert(prof["analysis_count"] == 2, f"expected analysis_count=2, got {prof['analysis_count']}")
        _assert(prof["cv_generation_count"] == 2, f"expected cv_generation_count=2, got {prof['cv_generation_count']}")
        _assert(prof["job_credits"] == 0, "anon shared pool must not touch paid job_credits")

        print("[OK] anonym delt 6-kreditt-pott: 2 cv_analyse + 2 analyse + 1 cv (generate) + 1 cv (stream) = 6")

        r = client.post(f"/job-analyses/{job_ids[0]}/hide/{anon_pid}")
        _assert(r.status_code == 200, f"anon hide job-analysis failed: {r.text}")

        print("[OK] anonym jobbanalyse-historikk: liste/hent/skjul/favoritt fungerer")

        # ------------------------------------------------------------------
        # 6) Pool exhausted: further use of all three action types is
        #    blocked for anonymous, with limit_type="anon_shared".
        # ------------------------------------------------------------------
        r = client.post("/analyze-cv", json={"profile_id": anon_pid, "language": "no"})
        _assert(r.status_code == 403, f"7th anon analyze-cv should be blocked, got {r.status_code}: {r.text}")
        _assert(r.json().get("limit_type") == "anon_shared", f"expected limit_type=anon_shared, got {r.json()}")

        r = client.post(
            "/analyze-url",
            json={"profile_id": anon_pid, "url": "https://example.com/job-overflow", "language": "no"},
        )
        _assert(r.status_code == 403, f"7th anon analyze-url should be blocked, got {r.status_code}: {r.text}")
        _assert(r.json().get("limit_type") == "anon_shared", f"expected limit_type=anon_shared, got {r.json()}")

        # job_ids[1] (not hidden, unlike job_ids[0]); omit `template` so
        # skip_claude stays False and the request actually reaches the
        # limit check instead of short-circuiting on cached text.
        r = client.post(
            f"/job-analyses/{job_ids[1]}/generate-tailored-cv",
            params={"profile_id": anon_pid, "language": "no"},
        )
        _assert(r.status_code == 403, f"7th anon generate-tailored-cv should be blocked, got {r.status_code}: {r.text}")
        _assert(r.json().get("limit_type") == "anon_shared", f"expected limit_type=anon_shared, got {r.json()}")

        # Counters must not have moved past 6 despite the blocked attempts.
        r = client.get(f"/profiles/{anon_pid}")
        prof = r.json()
        _assert(
            prof["cv_analysis_count"] + prof["analysis_count"] + prof["cv_generation_count"] == 6,
            f"blocked calls must not consume credits, got {prof}",
        )

        print("[OK] anonym pott tom etter 6: alle tre handlingstyper blokkeres (403, anon_shared)")

        # ------------------------------------------------------------------
        # 7) "Close and reopen the app": re-fetching the same cached
        #    profile id later still shows the same profile + remaining
        #    (zero) credits -- this is exactly what the mobile app does on
        #    launch with the AsyncStorage-cached id (mobile/hooks/useProfile.js).
        # ------------------------------------------------------------------
        r = client.get(f"/profiles/{anon_pid}")
        _assert(r.status_code == 200, f"re-fetching the cached anon profile failed: {r.status_code}")
        prof = r.json()
        _assert(prof["id"] == anon_pid, "re-fetched profile id must match the cached id")
        _assert(prof["name"] == "Anonym Bruker 2", "profile data must survive across the simulated relaunch")
        _assert(
            prof["cv_analysis_count"] == 2 and prof["analysis_count"] == 2 and prof["cv_generation_count"] == 2,
            "credit counters must survive across the simulated relaunch",
        )

        print("[OK] samme anonym profil + gjenstående kreditter gjenfinnes etter simulert omstart")

        # ------------------------------------------------------------------
        # 8) Regression: logged-in users get three SEPARATE 3-free-limits
        #    (analyse/cv_analyse/cv), NOT the anonymous shared pool of 6.
        # ------------------------------------------------------------------
        for i in range(3):
            r = client.post("/analyze-cv", json={"profile_id": real_pid, "language": "no"}, headers=headers)
            _assert(r.status_code == 200, f"logged-in analyze-cv call {i+1} failed: {r.status_code} {r.text}")

        r = client.post("/analyze-cv", json={"profile_id": real_pid, "language": "no"}, headers=headers)
        _assert(r.status_code == 403, f"logged-in 4th analyze-cv call should hit the existing free limit, got {r.status_code}: {r.text}")
        _assert(r.json().get("error") == "free_limit_reached", "expected free_limit_reached error body")
        _assert(r.json().get("limit_type") == "cv_analyse", f"logged-in limit_type should be per-type, got {r.json()}")

        # cv_analyse is now exhausted for this user, but analyse is a wholly
        # separate counter -- proves logged-in users are NOT on the shared pool.
        for i in range(3):
            r = client.post(
                "/analyze-url",
                json={"profile_id": real_pid, "url": f"https://example.com/real-job-{i}", "language": "no"},
                headers=headers,
            )
            _assert(r.status_code == 200, f"logged-in analyze-url call {i+1} failed: {r.status_code} {r.text}")

        print("[OK] innlogget bruker: tre separate 3-gratis-grenser (ikke delt pott) -- upåvirket av anonym-endringene")

        # ------------------------------------------------------------------
        # 9) usage_events: logged independently of the free-limit system,
        #    for both anonymous (user_id=NULL) and logged-in callers. Blocked
        #    (403) attempts must never log, anonymous or logged-in.
        # ------------------------------------------------------------------
        real_user_id = client.get("/auth/me", headers=headers).json()["id"]

        _assert(
            _usage_count("cv_analysis_completed", None) == 2,
            f"expected 2 anonymous cv_analysis_completed rows, got {_usage_count('cv_analysis_completed', None)}",
        )
        _assert(
            _usage_count("job_analysis_completed", None) == 2,
            f"expected 2 anonymous job_analysis_completed rows, got {_usage_count('job_analysis_completed', None)}",
        )
        _assert(
            _usage_count("cv_generation_completed", None) == 2,
            f"expected 2 anonymous cv_generation_completed rows (1 generate-tailored-cv + 1 stream), got {_usage_count('cv_generation_completed', None)}",
        )
        _assert(
            _usage_count("cv_analysis_completed", real_user_id) == 3,
            f"expected 3 logged-in cv_analysis_completed rows (the 4th call was blocked and should not log), got {_usage_count('cv_analysis_completed', real_user_id)}",
        )
        _assert(
            _usage_count("job_analysis_completed", real_user_id) == 3,
            f"expected 3 logged-in job_analysis_completed rows, got {_usage_count('job_analysis_completed', real_user_id)}",
        )

        print("[OK] usage_events logges uavhengig av grense-sjekken, for anonym (user_id=NULL) og innlogget")

        # ------------------------------------------------------------------
        # 10) /events/log is now anonymous-capable (this is the actual fix):
        #     a 401 here used to trip apiFetch()'s global UNAUTHORIZED_HANDLER
        #     client-side, which unconditionally reset activeTab to 'home' --
        #     silently bouncing anonymous users away from jobbanalyse/CV-
        #     analyse/CV-generering results right after they completed.
        # ------------------------------------------------------------------
        r = client.post(
            "/events/log",
            json={"action": "anon_ux_event", "metadata": {"foo": "bar"}},
        )
        _assert(r.status_code == 204, f"anon /events/log should succeed (204), got {r.status_code}: {r.text}")
        _assert(
            _usage_count("anon_ux_event", None) == 1,
            f"expected 1 anonymous anon_ux_event row (user_id=NULL), got {_usage_count('anon_ux_event', None)}",
        )

        r = client.post(
            "/events/log",
            json={"action": "logged_in_ux_event"},
            headers=headers,
        )
        _assert(r.status_code == 204, f"logged-in /events/log should still succeed (204), got {r.status_code}: {r.text}")
        _assert(
            _usage_count("logged_in_ux_event", real_user_id) == 1,
            f"expected 1 logged_in_ux_event row for the real user_id, got {_usage_count('logged_in_ux_event', real_user_id)}",
        )

        print("[OK] /events/log er anonym-kapabelt (204, ikke 401) -- innlogget logging uendret")

        # ------------------------------------------------------------------
        # 11) Untouched endpoints: still require a token
        # ------------------------------------------------------------------
        r = client.post("/analyze-url-and-send", json={"profile_id": anon_pid, "url": "https://example.com/job-x"})
        _assert(r.status_code == 401, f"/analyze-url-and-send must still require auth, got {r.status_code}")

        r = client.post("/interview/chat", json={"profile_id": anon_pid, "messages": []})
        _assert(r.status_code == 401, f"/interview/chat must still require auth, got {r.status_code}")

        print("[OK] e-post-sending og intervjutrening krever fortsatt innlogging (uendret)")

    print("\nAlle sjekker OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
