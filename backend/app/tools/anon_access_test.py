"""Manual checks for the temporary anonymous-access mode (profil, dokumenter,
CV-analyse, CV-generering, jobbanalyse -- no token required, no device-id,
no payment/limit logic for anonymous callers).

Uses an isolated on-disk sqlite DB and mocks all LLM calls (no real network
calls to Claude/OpenAI). Also confirms:
  - a logged-in user still works exactly as before (including the existing
    3-free-limit, which anonymous callers bypass but logged-in users do not)
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
        # 5) CV-analyse: unlimited for anonymous (run past the old FREE_LIMIT=3)
        # ------------------------------------------------------------------
        for i in range(5):
            r = client.post("/analyze-cv", json={"profile_id": anon_pid, "language": "no"})
            _assert(r.status_code == 200, f"anon analyze-cv call {i+1} failed: {r.status_code} {r.text}")

        r = client.get(f"/profiles/{anon_pid}")
        _assert(r.json()["cv_analysis_count"] == 0, "anonymous cv_analysis_count should stay 0 (no limit logic applied)")

        print("[OK] anonym CV-analyse: 5 kall uten grense, telleren rørt ikke")

        # ------------------------------------------------------------------
        # 6) Jobbanalyse: unlimited for anonymous, and the created Job is anonymous too
        # ------------------------------------------------------------------
        job_ids = []
        for i in range(5):
            r = client.post(
                "/analyze-url",
                json={"profile_id": anon_pid, "url": f"https://example.com/job-{i}", "language": "no"},
            )
            _assert(r.status_code == 200, f"anon analyze-url call {i+1} failed: {r.status_code} {r.text}")
            job_ids.append(r.json()["job_id"])

        r = client.get(f"/profiles/{anon_pid}")
        _assert(r.json()["analysis_count"] == 0, "anonymous analysis_count should stay 0 (no limit logic applied)")

        r = client.get("/job-analyses", params={"profile_id": anon_pid})
        _assert(r.status_code == 200 and len(r.json()) == 5, f"anon job-analyses list failed: {r.text}")

        job_id = job_ids[-1]
        r = client.get(f"/job-analyses/{job_id}", params={"profile_id": anon_pid})
        _assert(r.status_code == 200, f"anon get single job-analysis failed: {r.text}")

        r = client.post(f"/job-analyses/{job_id}/hide/{anon_pid}")
        _assert(r.status_code == 200, f"anon hide job-analysis failed: {r.text}")

        r = client.patch(f"/job-analyses/{job_ids[0]}/favorite/{anon_pid}")
        _assert(r.status_code == 200, f"anon favorite job-analysis failed: {r.text}")

        # Cross-check: logged-in user cannot reach the anonymous Job either.
        r = client.get(f"/job-analyses/{job_ids[0]}", params={"profile_id": real_pid}, headers=headers)
        _assert(r.status_code == 404, f"logged-in user should not reach anonymous job, got {r.status_code}")

        print("[OK] anonym jobbanalyse: 5 kall uten grense + historikk (liste/hent/skjul/favoritt)")

        # ------------------------------------------------------------------
        # 7) CV-generering (tailored CV for a job): unlimited for anonymous
        # ------------------------------------------------------------------
        gen_job_id = job_ids[1]
        for i in range(5):
            r = client.post(
                f"/job-analyses/{gen_job_id}/generate-tailored-cv",
                params={"profile_id": anon_pid, "language": "no"},
            )
            _assert(r.status_code == 200, f"anon generate-tailored-cv call {i+1} failed: {r.status_code} {r.text}")
            _assert(r.json()["cv"] == _FAKE_GENERATED_TEXTS["tailored_cv"], "unexpected generated cv text")

        r = client.get(f"/profiles/{anon_pid}")
        _assert(r.json()["cv_generation_count"] == 0, "anonymous cv_generation_count should stay 0 (no limit logic applied)")

        print("[OK] anonym CV-generering: 5 kall uten grense, telleren rørt ikke")

        # ------------------------------------------------------------------
        # 8) stream-documents: anonymous SSE path also works and stays unlimited
        # ------------------------------------------------------------------
        def _fake_stream(*args, **kwargs):
            yield "chunk", "Kjaere "
            yield "chunk", "Test AS"
            yield "done", dict(_FAKE_GENERATED_TEXTS)

        with patch("app.job_analyzer.stream_application_texts", side_effect=_fake_stream):
            r = client.post(
                f"/job-analyses/{gen_job_id}/stream-documents",
                params={"profile_id": anon_pid, "language": "no"},
            )
        _assert(r.status_code == 200, f"anon stream-documents failed: {r.status_code} {r.text}")

        r = client.get(f"/profiles/{anon_pid}")
        _assert(r.json()["cv_generation_count"] == 0, "anonymous cv_generation_count should stay 0 after streaming too")

        print("[OK] anonym CV-generering (streaming): uten grense")

        # ------------------------------------------------------------------
        # 9) Regression: logged-in user is still subject to the existing
        #    3-free-limit for cv_analyse (unaffected by the anonymous changes)
        # ------------------------------------------------------------------
        for i in range(3):
            r = client.post("/analyze-cv", json={"profile_id": real_pid, "language": "no"}, headers=headers)
            _assert(r.status_code == 200, f"logged-in analyze-cv call {i+1} failed: {r.status_code} {r.text}")

        r = client.post("/analyze-cv", json={"profile_id": real_pid, "language": "no"}, headers=headers)
        _assert(r.status_code == 403, f"logged-in 4th analyze-cv call should hit the existing free limit, got {r.status_code}: {r.text}")
        _assert(r.json().get("error") == "free_limit_reached", "expected free_limit_reached error body")

        print("[OK] innlogget bruker: eksisterende 3-gratis-grense fortsatt håndhevet uendret")

        # ------------------------------------------------------------------
        # 10) usage_events: logged independently of the free-limit system,
        #     for both anonymous (user_id=NULL) and logged-in callers.
        # ------------------------------------------------------------------
        real_user_id = client.get("/auth/me", headers=headers).json()["id"]

        _assert(
            _usage_count("cv_analysis_completed", None) == 5,
            f"expected 5 anonymous cv_analysis_completed rows, got {_usage_count('cv_analysis_completed', None)}",
        )
        _assert(
            _usage_count("job_analysis_completed", None) == 5,
            f"expected 5 anonymous job_analysis_completed rows, got {_usage_count('job_analysis_completed', None)}",
        )
        _assert(
            _usage_count("cv_generation_completed", None) == 6,
            f"expected 6 anonymous cv_generation_completed rows (5 generate-tailored-cv + 1 stream), got {_usage_count('cv_generation_completed', None)}",
        )
        _assert(
            _usage_count("cv_analysis_completed", real_user_id) == 3,
            f"expected 3 logged-in cv_analysis_completed rows (the 4th call was blocked and should not log), got {_usage_count('cv_analysis_completed', real_user_id)}",
        )

        print("[OK] usage_events logges uavhengig av grense-sjekken, for anonym (user_id=NULL) og innlogget")

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
