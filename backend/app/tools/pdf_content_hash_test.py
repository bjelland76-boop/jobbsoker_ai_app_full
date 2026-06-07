"""Lightweight validation for PDF content hashing.

Run (from backend/):
  python3 -m app.tools.pdf_content_hash_test

This is intentionally dependency-free (no pytest) to keep the demo simple.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.pdf_dedupe import compute_pdf_content_hash


@dataclass
class _Obj:
    pass


def _make_profile(*, phone: str = "123", tailored: str | None = None, photo_data: str = ""):
    p = _Obj()
    p.name = "Test Person"
    p.email = "test@example.com"
    p.phone = phone
    p.address = "Street 1"
    p.postal_code = "0001"
    p.postal_place = "Oslo"
    p.languages = '["Norsk", "Engelsk"]'
    p.references_json = '[{"name":"Ref A","relation":"Leder","contact":"90000000"}]'
    p.photo_data = photo_data
    return p


def _make_job():
    j = _Obj()
    j.title = "Butikkmedarbeider"
    j.company = "Test AS"
    return j


def run():
    template_id = "sidebar_v1"
    job = _make_job()

    cover = "Hei\n\nJeg søker stillingen."
    cv = "Erfaring\n- Kundeservice\n\nUtdanning\n- VGS"

    # Valid tiny PNG-ish base64 (content doesn't matter; only bytes/hash).
    photo1 = "data:image/png;base64,aGVsbG8="  # b"hello"
    photo2 = "data:image/png;base64,d29ybGQ="  # b"world"

    # Baseline
    profile = _make_profile(photo_data=photo1)
    h0 = compute_pdf_content_hash(
        template_id=template_id,
        include_photo=True,
        cover_letter=cover,
        rendered_cv_text=cv,
        profile=profile,
        job=job,
    )

    # Case E: no content changes => same hash
    h0b = compute_pdf_content_hash(
        template_id=template_id,
        include_photo=True,
        cover_letter=cover,
        rendered_cv_text=cv,
        profile=profile,
        job=job,
    )
    assert h0 == h0b, "Case E failed: expected same hash when no changes"

    # Case A: change phone => new hash
    profile_a = _make_profile(phone="999", photo_data=photo1)
    ha = compute_pdf_content_hash(
        template_id=template_id,
        include_photo=True,
        cover_letter=cover,
        rendered_cv_text=cv,
        profile=profile_a,
        job=job,
    )
    assert h0 != ha, "Case A failed: phone change should change hash"

    # Case B: change tailored CV => new hash
    hb = compute_pdf_content_hash(
        template_id=template_id,
        include_photo=True,
        cover_letter=cover,
        rendered_cv_text=cv + "\n\nSertifiseringer\n- Truckførerbevis",
        profile=profile,
        job=job,
    )
    assert h0 != hb, "Case B failed: CV change should change hash"

    # Case C: change cover letter => new hash
    hc = compute_pdf_content_hash(
        template_id=template_id,
        include_photo=True,
        cover_letter=cover + "\n\nJeg kan starte raskt.",
        rendered_cv_text=cv,
        profile=profile,
        job=job,
    )
    assert h0 != hc, "Case C failed: cover letter change should change hash"

    # Case D: change photo => new hash (when include_photo=True)
    profile_d = _make_profile(photo_data=photo2)
    hd = compute_pdf_content_hash(
        template_id=template_id,
        include_photo=True,
        cover_letter=cover,
        rendered_cv_text=cv,
        profile=profile_d,
        job=job,
    )
    assert h0 != hd, "Case D failed: photo change should change hash"

    print("OK: pdf content hash validations passed")


if __name__ == "__main__":
    run()
