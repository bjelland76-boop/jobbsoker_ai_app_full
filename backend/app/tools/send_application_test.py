"""Manual checks for POST /job-analyses/{job_id}/send-application: login is
required, and empty GeneratedApplication rows (left behind by the empty-CV
bug before 38e981c) are never emailed. Isolated on-disk sqlite DB; send_email
is mocked, nothing is actually sent.

Run manually:
  cd backend && venv/bin/python -m app.tools.send_application_test
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-send-application-test"

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import create_access_token  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import GeneratedApplication, Job, JobAnalysisHistory, Profile, User  # noqa: E402

_fails = 0


def check(name: str, cond: bool, extra=None) -> None:
    global _fails
    print(("[OK] " if cond else "[FEIL] ") + name + ("" if cond or extra is None else f"  -> {extra}"))
    if not cond:
        _fails += 1


def _make_user(db, email: str) -> tuple[int, int, int, str]:
    user = User(email=email, password_hash="")
    db.add(user)
    db.commit()
    db.refresh(user)
    profile = Profile(
        user_id=user.id, name="Test", email=email, phone="", address="",
        include_photo_default=False, consent_analytics=False, target_role="",
        cv_text="", experience="", education="", skills="", languages="[]",
        references_json="[]", cv_gaps="", tone="normal",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    job = Job(user_id=user.id, title="Lagermedarbeider", company="Acme", url="https://example.com/j", description="x")
    db.add(job)
    db.commit()
    db.refresh(job)
    db.add(JobAnalysisHistory(profile_id=profile.id, job_id=job.id, analysis_json=json.dumps({"detected_ad_language": "no"})))
    db.commit()
    return profile.id, job.id, user.id, create_access_token(user_id=user.id)


def _add_app(db, profile_id, job_id, *, cv, letter, created_at, pdf="/data/cv.pdf"):
    db.add(GeneratedApplication(
        job_id=job_id, profile_id=profile_id, cover_letter=letter, tailored_cv=cv, email_text="",
        pdf_path="", cv_pdf_path=pdf, template="profesjonell_v1", include_photo=False,
        content_hash="", language="no", created_at=created_at,
    ))
    db.commit()


def main() -> int:
    now = datetime.utcnow()
    with TestClient(app) as client:
        db = SessionLocal()

        def send(job_id, profile_id, token=None):
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            with patch("app.main.send_email") as mock_send:
                r = client.post(
                    f"/job-analyses/{job_id}/send-application?profile_id={profile_id}&language=no&to_email=arbeidsgiver@example.com",
                    headers=headers,
                )
            return r, mock_send

        # 1) Anonymous caller -> 401, nothing sent (also for an anonymous profile/job).
        anon_p = Profile(user_id=None, name="Anon", email="", phone="", address="", include_photo_default=False,
                         consent_analytics=False, target_role="", cv_text="", experience="", education="", skills="",
                         languages="[]", references_json="[]", cv_gaps="", tone="normal")
        db.add(anon_p)
        db.commit()
        anon_j = Job(user_id=None, title="X", company="Y", url="https://example.com/a", description="x")
        db.add(anon_j)
        db.commit()
        db.add(JobAnalysisHistory(profile_id=anon_p.id, job_id=anon_j.id, analysis_json="{}"))
        db.commit()
        _add_app(db, anon_p.id, anon_j.id, cv="CV", letter="Brev", created_at=now)
        r, m = send(anon_j.id, anon_p.id)
        check("Anonym avsender -> 401, ingen e-post", r.status_code == 401 and not m.called, (r.status_code, r.text[:100]))

        # 2) Only an EMPTY row (the empty-CV bug) -> 404, nothing sent.
        pid, jid, _, tok = _make_user(db, "empty@example.com")
        _add_app(db, pid, jid, cv="", letter="", created_at=now)
        r, m = send(jid, pid, tok)
        check("Kun tom rad -> 404 'generer CV først', ingen e-post",
              r.status_code == 404 and not m.called and "generer CV" in r.text, (r.status_code, r.text[:120]))

        # 3) Newer EMPTY row on top of an older good one -> the good one is sent.
        pid2, jid2, _, tok2 = _make_user(db, "mixed@example.com")
        _add_app(db, pid2, jid2, cv="Nøkkelkvalifikasjoner\n• Truck", letter="Hei, jeg søker stillingen.", created_at=now - timedelta(hours=1))
        _add_app(db, pid2, jid2, cv="", letter="", created_at=now)
        r, m = send(jid2, pid2, tok2)
        sent_body = m.call_args.args[2] if m.called else None
        check("Nyere tom rad hoppes over, eldre gyldig søknad sendes",
              r.status_code == 200 and m.called and "jeg søker stillingen" in (sent_body or ""), (r.status_code, sent_body))

        # 4) Row with CV but EMPTY cover letter -> not sendable (empty email body).
        pid3, jid3, _, tok3 = _make_user(db, "nocover@example.com")
        _add_app(db, pid3, jid3, cv="CV-tekst", letter="", created_at=now)
        r, m = send(jid3, pid3, tok3)
        check("CV uten søknadstekst -> 404, ingen tom e-post", r.status_code == 404 and not m.called, r.status_code)

        # 5) Normal valid case -> 200, body + CV-PDF attachment, subject with job title.
        pid4, jid4, _, tok4 = _make_user(db, "ok@example.com")
        _add_app(db, pid4, jid4, cv="CV-tekst", letter="Hei, dette er søknaden.", created_at=now, pdf="/data/cv_ok.pdf")
        r, m = send(jid4, pid4, tok4)
        ok = r.status_code == 200 and m.called
        args = m.call_args if m.called else None
        check("Gyldig søknad sendes: mottaker, tekst, CV-vedlegg",
              ok and args.args[0] == "arbeidsgiver@example.com" and "dette er søknaden" in args.args[2]
              and args.kwargs.get("attachments") == ["/data/cv_ok.pdf"], (r.status_code, args))

        # 6) Logged in, but someone else's profile -> 404, nothing sent.
        r, m = send(jid4, pid4, tok3)
        check("Annens profil -> 404, ingen e-post", r.status_code == 404 and not m.called, r.status_code)

        # 7) Body empties out after sanitizing -> 409, nothing sent.
        with patch("app.main.sanitize_employer_text", return_value="   "):
            r, m = send(jid4, pid4, tok4)
        check("Tom tekst etter sanitering -> 409, ingen e-post", r.status_code == 409 and not m.called, (r.status_code, r.text[:100]))

        db.close()

    os.remove(_db_path)
    print(f"\nFEIL: {_fails}")
    return 1 if _fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
