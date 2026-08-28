"""Manual checks for step 3 of the Vietnamese-market CV plan: the third
(_vi) storage-key set for generated CV/cover-letter/email text, parallel to
the existing (no-suffix) Norwegian and _en English keys.

This is PURELY an infrastructure test -- job_analyzer.py does not have a real
Vietnamese prompt branch yet (that's step 4), so language="vi" currently
still produces Norwegian TEXT via the real code path. What this test verifies
is that the STORAGE routing (which JSON key the text lands in, which
has_tailored_cv_* flag flips, and what re-analysis preserves) correctly
treats "vi" as a third, independent slot -- using a mocked
generate_application_texts/stream_application_texts that returns
language-tagged dummy text, so a collision with the no/en keys would show up
as a wrong dummy value, not just a wrong language of real content.

Uses an isolated on-disk sqlite DB and mocks all LLM calls.

Run manually:
  cd backend && venv/bin/python -m app.tools.vi_storage_keys_test
"""

from __future__ import annotations

import os
import tempfile
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-vi-storage-keys-test"
os.environ["GOOGLE_CLIENT_ID_WEB"] = "test-client-id.apps.googleusercontent.com"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-client-secret"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

import json  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import JobAnalysisHistory  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _stored_analysis(profile_id: int, job_id: int) -> dict:
    """Read the raw analysis_json blob directly from the DB -- the actual
    storage layer this task changes. JobAnalysisOut only ever exposes the
    base (Norwegian-slot) tailored_cv/cover_letter/email_text fields plus the
    has_tailored_cv_* booleans over the API, never the raw _en/_vi text, so
    this is the only way to see the _en/_vi keys' actual stored values."""
    with SessionLocal() as db:
        row = db.query(JobAnalysisHistory).filter_by(profile_id=profile_id, job_id=job_id).first()
        return json.loads(row.analysis_json) if row and row.analysis_json else {}


_FAKE_JOB_ANALYSIS = {
    "job_title": "Butikkmedarbeider",
    "company": "Test AS",
    "match_score": 82,
    "__job_text": "Vi soker en dyktig butikkmedarbeider.",
}


def _fake_texts_for(language: str) -> dict:
    """Language-tagged dummy text -- if the wrong storage key is used, the
    wrong tag shows up in the assertion, making a collision impossible to miss."""
    return {
        "cover_letter": f"LETTER-{language.upper()}",
        "tailored_cv": f"CV-{language.upper()}",
        "email_text": f"EMAIL-{language.upper()}",
    }


def main() -> int:
    with TestClient(app) as client, \
         patch("app.job_analyzer.analyze_job_url") as mock_analyze_url, \
         patch("app.job_analyzer.generate_application_texts") as mock_generate, \
         patch("app.job_analyzer.stream_application_texts") as mock_stream:

        # side_effect (not return_value) so each call gets a FRESH dict --
        # analyze_url()'s endpoint code does result.pop("__job_text", ...),
        # which would otherwise permanently mutate a single shared dict and
        # silently empty job.description on every call after the first.
        mock_analyze_url.side_effect = lambda *a, **kw: dict(_FAKE_JOB_ANALYSIS)
        mock_generate.side_effect = lambda *a, **kw: _fake_texts_for(kw.get("language", "no"))

        # ------------------------------------------------------------------
        # 1) Logged-in user + profile + job to generate tailored CVs against.
        # ------------------------------------------------------------------
        with patch("app.main.google_id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "vi-storage-test@example.com",
                "email_verified": True,
                "name": "VI Storage Test",
            }
            r = client.post("/auth/google", json={"id_token": "fake-token"})
        _assert(r.status_code == 200, f"google sign-in failed: {r.text}")
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        r = client.get("/profiles", headers=headers)
        _assert(r.status_code == 200 and len(r.json()) == 1, f"GET /profiles failed: {r.text}")
        pid = r.json()[0]["id"]

        r = client.post(
            "/analyze-url",
            json={"profile_id": pid, "url": "https://example.com/job-vi-storage"},
            headers=headers,
        )
        _assert(r.status_code == 200, f"analyze-url failed: {r.status_code} {r.text}")
        job_id = r.json()["job_id"]

        # ------------------------------------------------------------------
        # 2) Generate all three language variants for the SAME job, one at a
        #    time, and confirm each lands in its own key without disturbing
        #    the others -- this is the actual bug class being guarded against.
        # ------------------------------------------------------------------
        already_generated: list[str] = []
        for lang in ("no", "en", "vi"):
            r = client.post(
                f"/job-analyses/{job_id}/generate-tailored-cv",
                params={"profile_id": pid, "language": lang},
                headers=headers,
            )
            _assert(r.status_code == 200, f"generate-tailored-cv (lang={lang}) failed: {r.status_code} {r.text}")
            pkg = r.json()
            _assert(pkg["cv"] == f"CV-{lang.upper()}", f"lang={lang}: expected CV-{lang.upper()}, got {pkg['cv']!r}")
            _assert(pkg["coverLetter"] == f"LETTER-{lang.upper()}", f"lang={lang}: expected LETTER-{lang.upper()}, got {pkg['coverLetter']!r}")

            r = client.get(f"/job-analyses/{job_id}", params={"profile_id": pid}, headers=headers)
            _assert(r.status_code == 200, f"get_job_analysis failed after lang={lang}: {r.text}")
            data = r.json()
            # The variant just generated must be flagged true...
            _assert(data[f"has_tailored_cv_{lang}"] is True, f"has_tailored_cv_{lang} should be True after generating it, got {data}")
            # ...and every PREVIOUSLY generated variant must remain untouched (no collision).
            for other in already_generated:
                _assert(data[f"has_tailored_cv_{other}"] is True, f"has_tailored_cv_{other} should still be True after generating lang={lang}, got {data}")
            already_generated.append(lang)

        print("[OK] generate-tailored-cv: no/en/vi lagres i tre uavhengige nøkler (tailored_cv/_en/_vi), ingen kollisjon")

        # Read the raw analysis_json blob directly from the DB and confirm
        # all three raw text keys hold their own distinct dummy value (not
        # just the boolean flags -- the actual JSON storage keys).
        stored = _stored_analysis(pid, job_id)
        _assert(stored.get("tailored_cv") == "CV-NO", f"expected tailored_cv='CV-NO', got {stored.get('tailored_cv')!r}")
        _assert(stored.get("tailored_cv_en") == "CV-EN", f"expected tailored_cv_en='CV-EN', got {stored.get('tailored_cv_en')!r}")
        _assert(stored.get("tailored_cv_vi") == "CV-VI", f"expected tailored_cv_vi='CV-VI', got {stored.get('tailored_cv_vi')!r}")
        _assert(stored.get("cover_letter_vi") == "LETTER-VI", f"expected cover_letter_vi='LETTER-VI', got {stored.get('cover_letter_vi')!r}")
        _assert(stored.get("email_text_vi") == "EMAIL-VI", f"expected email_text_vi='EMAIL-VI', got {stored.get('email_text_vi')!r}")
        print("[OK] Rå lagringsnøkler (tailored_cv/tailored_cv_en/tailored_cv_vi + cover_letter_vi/email_text_vi) inneholder hver sin distinkte verdi")

        # ------------------------------------------------------------------
        # 3) skip_claude cache-read path: requesting the "vi" variant again
        #    with a template change must return the CACHED vi text, not call
        #    Claude again and not silently read the no/en slot instead.
        # ------------------------------------------------------------------
        mock_generate.side_effect = RuntimeError("must not be called -- should hit the vi cache")
        r = client.post(
            f"/job-analyses/{job_id}/generate-tailored-cv",
            params={"profile_id": pid, "language": "vi", "template": "klassisk"},
            headers=headers,
        )
        _assert(r.status_code == 200, f"cached vi re-fetch (template swap) failed: {r.status_code} {r.text}")
        pkg = r.json()
        _assert(pkg["cv"] == "CV-VI", f"expected cached CV-VI on template swap, got {pkg['cv']!r}")
        print("[OK] Cache-lesing (skip_claude) for 'vi' henter fra riktig nøkkel, kaller ikke Claude på nytt")

        # ------------------------------------------------------------------
        # 4) Re-analysis must preserve ALL THREE language variants, not just
        #    no/en -- this is exactly the _CV_PRESERVE_KEYS gap the task
        #    warned about (a previously-similar bug in the anon-access fix
        #    was caused by an overlooked call site).
        # ------------------------------------------------------------------
        mock_generate.side_effect = lambda *a, **kw: _fake_texts_for(kw.get("language", "no"))
        r = client.post(
            "/analyze-url",
            json={"profile_id": pid, "url": "https://example.com/job-vi-storage"},
            headers=headers,
        )
        _assert(r.status_code == 200, f"re-analyze-url failed: {r.status_code} {r.text}")
        stored_after_reanalysis = _stored_analysis(pid, job_id)
        _assert(stored_after_reanalysis.get("tailored_cv_vi") == "CV-VI", f"re-analysis wiped tailored_cv_vi, got {stored_after_reanalysis.get('tailored_cv_vi')!r}")
        _assert(stored_after_reanalysis.get("tailored_cv_en") == "CV-EN", f"re-analysis wiped tailored_cv_en, got {stored_after_reanalysis.get('tailored_cv_en')!r}")
        _assert(stored_after_reanalysis.get("tailored_cv") == "CV-NO", f"re-analysis wiped tailored_cv, got {stored_after_reanalysis.get('tailored_cv')!r}")
        r = client.get(f"/job-analyses/{job_id}", params={"profile_id": pid}, headers=headers)
        data = r.json()
        _assert(data["has_tailored_cv_vi"] is True, f"has_tailored_cv_vi should survive re-analysis, got {data}")
        print("[OK] Re-analyse bevarer alle tre språkvariantene (_CV_PRESERVE_KEYS inkluderer _vi-nøklene)")

        # ------------------------------------------------------------------
        # 5) stream-documents endpoint: same 3-way routing, separate job AND
        #    a separate user (the first user's 3-per-type "cv" free limit is
        #    already fully spent by the generate-tailored-cv no/en/vi calls
        #    above -- a 4th/5th/6th "cv" action would just 403).
        # ------------------------------------------------------------------
        with patch("app.main.google_id_token.verify_oauth2_token") as mock_verify2:
            mock_verify2.return_value = {
                "email": "vi-storage-test-2@example.com",
                "email_verified": True,
                "name": "VI Storage Test 2",
            }
            r = client.post("/auth/google", json={"id_token": "fake-token-2"})
        _assert(r.status_code == 200, f"google sign-in (user2) failed: {r.text}")
        token2 = r.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}
        r = client.get("/profiles", headers=headers2)
        _assert(r.status_code == 200 and len(r.json()) == 1, f"GET /profiles (user2) failed: {r.text}")
        pid2 = r.json()[0]["id"]

        r = client.post(
            "/analyze-url",
            json={"profile_id": pid2, "url": "https://example.com/job-vi-storage-2"},
            headers=headers2,
        )
        _assert(r.status_code == 200, f"analyze-url (job2) failed: {r.status_code} {r.text}")
        job_id_2 = r.json()["job_id"]

        def _fake_stream(*args, **kwargs):
            texts = _fake_texts_for(kwargs.get("language", "no"))
            yield "chunk", texts["tailored_cv"][:2]
            yield "done", texts

        for lang in ("no", "en", "vi"):
            mock_stream.side_effect = _fake_stream
            r = client.post(
                f"/job-analyses/{job_id_2}/stream-documents",
                params={"profile_id": pid2, "language": lang},
                headers=headers2,
            )
            _assert(r.status_code == 200, f"stream-documents (lang={lang}) failed: {r.status_code} {r.text}")

        stored2 = _stored_analysis(pid2, job_id_2)
        _assert(stored2.get("tailored_cv") == "CV-NO", f"stream job2: expected tailored_cv='CV-NO', got {stored2.get('tailored_cv')!r}")
        _assert(stored2.get("tailored_cv_en") == "CV-EN", f"stream job2: expected tailored_cv_en='CV-EN', got {stored2.get('tailored_cv_en')!r}")
        _assert(stored2.get("tailored_cv_vi") == "CV-VI", f"stream job2: expected tailored_cv_vi='CV-VI', got {stored2.get('tailored_cv_vi')!r}")

        r = client.get(f"/job-analyses/{job_id_2}", params={"profile_id": pid2}, headers=headers2)
        data2 = r.json()
        _assert(data2["has_tailored_cv_no"] and data2["has_tailored_cv_en"] and data2["has_tailored_cv_vi"], f"all three flags should be True, got {data2}")
        print("[OK] stream-documents: no/en/vi lagres i tre uavhengige nøkler, ingen kollisjon (samme mønster som generate-tailored-cv)")

        print("\nAlle sjekker OK.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
