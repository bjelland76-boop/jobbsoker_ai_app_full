"""Manual checks for the new Vietnamese-CV `birth_date` field (step 1 of 5 of
the Vietnamese-market CV plan):

1) It can be saved to and read back from a profile via the normal
   POST/PUT/GET /profiles endpoints, alongside the existing Vietnam fields
   (height_cm, civil_status, gender, nationality, military_service).
2) It renders as a "Ngày sinh" row in the Vietnamese PDF template
   (_VietnamesiskPdfDoc._draw_personal_details) when filled in, and is
   correctly omitted -- same as the existing rows -- when left blank.

Uses an isolated on-disk sqlite DB and does not touch pdfgen's real OUT
directory beyond writing throwaway PDFs to it (cleaned up at the end).

Run manually:
  cd backend && venv/bin/python -m app.tools.vietnamese_birthdate_test
"""

from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

os.environ["JWT_SECRET"] = "test-secret-for-vietnamese-birthdate-test"
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


def _test_api_roundtrip() -> None:
    with TestClient(app) as client:
        # 1) Create an anonymous profile without birth_date -- must default to "".
        r = client.post("/profiles", json={"name": "Nguyen Test"})
        _assert(r.status_code == 200, f"create profile failed: {r.status_code} {r.text}")
        profile = r.json()
        pid = profile["id"]
        _assert(profile.get("birth_date") == "", f"expected birth_date='' by default, got {profile.get('birth_date')!r}")

        # 2) PUT the same profile with birth_date set, alongside the sibling
        #    Vietnam fields -- same save path ProfileScreen.js's Vietnamese
        #    accordion card uses.
        r = client.put(
            f"/profiles/{pid}",
            json={
                "name": "Nguyen Test",
                "birth_date": "15/03/1990",
                "height_cm": 170,
                "civil_status": "Gift",
                "gender": "Mann",
                "nationality": "Vietnam",
                "military_service": "Fullført",
            },
        )
        _assert(r.status_code == 200, f"update profile failed: {r.status_code} {r.text}")
        updated = r.json()
        _assert(updated.get("birth_date") == "15/03/1990", f"expected birth_date to round-trip, got {updated.get('birth_date')!r}")

        # 3) GET confirms persistence (fresh read, not just the PUT response echo).
        r = client.get(f"/profiles/{pid}")
        _assert(r.status_code == 200, f"get profile failed: {r.status_code} {r.text}")
        fetched = r.json()
        _assert(fetched.get("birth_date") == "15/03/1990", f"expected persisted birth_date, got {fetched.get('birth_date')!r}")

        print("[OK] birth_date lagres og hentes korrekt via POST/PUT/GET /profiles (samme lagringssti som de andre Vietnam-feltene)")


def _drawn_texts(doc) -> list[str]:
    """Build the doc while intercepting every drawString/drawCentredString
    call, and return the flat list of strings actually drawn onto the PDF
    canvas -- lets us assert on rendered content without a PDF-text-extraction
    library (none is installed in this venv)."""
    drawn: list[str] = []
    orig_draw_string = doc.c.drawString
    orig_draw_centred = doc.c.drawCentredString
    orig_draw_right = doc.c.drawRightString

    def _rec_draw_string(x, y, text, *a, **kw):
        drawn.append(text)
        return orig_draw_string(x, y, text, *a, **kw)

    def _rec_draw_centred(x, y, text, *a, **kw):
        drawn.append(text)
        return orig_draw_centred(x, y, text, *a, **kw)

    def _rec_draw_right(x, y, text, *a, **kw):
        drawn.append(text)
        return orig_draw_right(x, y, text, *a, **kw)

    doc.c.drawString = _rec_draw_string
    doc.c.drawCentredString = _rec_draw_centred
    doc.c.drawRightString = _rec_draw_right

    doc.build()
    return drawn


def _test_pdf_rendering() -> None:
    from app.pdfgen import _VietnamesiskPdfDoc, OUT

    job = SimpleNamespace(title="Nhan vien ban hang", company="Test AS")

    # 1) birth_date filled in -> "Ngày sinh" row + the value must be drawn.
    profile_with = SimpleNamespace(
        name="Nguyen Van A",
        phone="12345678",
        email="a@example.com",
        address="",
        postal_code="",
        postal_place="",
        photo_data="",
        birth_date="15/03/1990",
        height_cm=170,
        civil_status="",
        gender="",
        nationality="",
        military_service="",
    )
    doc = _VietnamesiskPdfDoc("test_vn_birthdate_filled.pdf", profile_with, job, "", "Test CV text", include_photo=False)
    texts = _drawn_texts(doc)
    _assert("Ngày sinh:" in texts, f"expected 'Ngày sinh:' label to be drawn, got: {texts}")
    _assert("15/03/1990" in texts, f"expected birth_date value to be drawn, got: {texts}")
    print("[OK] Fødselsdato vises som 'Ngày sinh'-rad i vietnamesisk PDF når feltet er fylt ut")

    # 2) birth_date blank -> row must be omitted, same pattern as the other
    #    optional personal-detail rows (height/civil_status/gender/etc).
    profile_without = SimpleNamespace(
        name="Nguyen Van B",
        phone="87654321",
        email="b@example.com",
        address="",
        postal_code="",
        postal_place="",
        photo_data="",
        birth_date="",
        height_cm=None,
        civil_status="",
        gender="",
        nationality="",
        military_service="",
    )
    doc2 = _VietnamesiskPdfDoc("test_vn_birthdate_blank.pdf", profile_without, job, "", "Test CV text", include_photo=False)
    texts2 = _drawn_texts(doc2)
    _assert("Ngày sinh:" not in texts2, f"'Ngày sinh:' row should be omitted when birth_date is blank, got: {texts2}")
    # With every optional field blank, the whole "THÔNG TIN CÁ NHÂN" section
    # (rows == []) must be skipped entirely, same as before this change.
    _assert("THÔNG TIN CÁ NHÂN" not in texts2, f"personal-details section header should be omitted when all fields are blank, got: {texts2}")
    print("[OK] 'Ngày sinh'-raden (og hele seksjonen) utelates korrekt når feltene er tomme, uendret oppførsel for de andre radene")

    for name in ("test_vn_birthdate_filled.pdf", "test_vn_birthdate_blank.pdf"):
        p = OUT / name
        if p.exists():
            p.unlink()


def main() -> int:
    _test_api_roundtrip()
    _test_pdf_rendering()
    print("\nAlle sjekker OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
