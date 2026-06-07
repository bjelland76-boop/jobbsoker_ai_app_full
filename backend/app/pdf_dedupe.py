from __future__ import annotations

import base64
import hashlib
import json
import re
from typing import Any


def normalize_for_hash(text: Any) -> str:
    """Normalize text so harmless formatting differences don't change hashes.

    Rules:
    - normalize line endings (CRLF/CR -> LF)
    - trim leading/trailing whitespace
    - collapse repeated whitespace (spaces/tabs)
    - collapse repeated blank lines (3+ newlines -> 2)

    Example:
      "Hello\n\n\nWorld" -> "Hello\n\nWorld"
    """

    s = "" if text is None else str(text)

    # Normalize line endings.
    s = s.replace("\r\n", "\n").replace("\r", "\n")

    # Trim overall.
    s = s.strip()

    # Collapse whitespace runs (but keep newlines significant).
    s = re.sub(r"[\t\f\v ]+", " ", s)

    # Trim spaces around line breaks.
    s = re.sub(r" *\n *", "\n", s)

    # Collapse repeated blank lines.
    s = re.sub(r"\n{3,}", "\n\n", s)

    return s


def _parse_json_field(value: Any) -> list[Any]:
    if value is None or value == "":
        return []

    if isinstance(value, list):
        return value

    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return parsed
            return [parsed]
        except Exception:
            return [s]

    return [value]


def _photo_bytes_from_data_uri(data_uri: Any) -> bytes | None:
    """Best-effort decode for profile photo data URIs."""

    if not data_uri or not isinstance(data_uri, str):
        return None

    s = data_uri.strip()
    if not s:
        return None

    if s.startswith("data:"):
        try:
            b64 = s.split(",", 1)[1]
        except Exception:
            return None
    else:
        b64 = s

    try:
        return base64.b64decode(b64, validate=False)
    except Exception:
        return None


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_pdf_content_hash(
    *,
    template_id: str,
    include_photo: bool,
    cover_letter: str,
    rendered_cv_text: str,
    profile: Any,
    job: Any,
) -> str:
    """Compute a stable content hash for the rendered PDF.

    Includes all inputs that can affect the final PDF output.
    """

    # ---- Profile fields used by PDF sidebar/header/CV injection ----
    name = normalize_for_hash(getattr(profile, "name", "") or "")
    email = normalize_for_hash(getattr(profile, "email", "") or "")
    phone = normalize_for_hash(getattr(profile, "phone", "") or "")
    address = normalize_for_hash(getattr(profile, "address", "") or "")
    postal_code = normalize_for_hash(getattr(profile, "postal_code", "") or "")
    postal_place = normalize_for_hash(getattr(profile, "postal_place", "") or "")

    languages_raw = _parse_json_field(getattr(profile, "languages", ""))
    languages = [normalize_for_hash(x) for x in languages_raw]

    references_raw = _parse_json_field(getattr(profile, "references_json", ""))
    references: list[Any] = []
    for it in references_raw:
        if isinstance(it, dict):
            references.append(
                {
                    "name": normalize_for_hash(it.get("name") or ""),
                    "relation": normalize_for_hash(it.get("relation") or ""),
                    "contact": normalize_for_hash(it.get("contact") or ""),
                }
            )
        else:
            references.append(normalize_for_hash(it))

    photo_hash = ""
    if bool(include_photo):
        b = _photo_bytes_from_data_uri(getattr(profile, "photo_data", "") or "")
        photo_hash = _sha256_hex(b) if b else ""

    # ---- Job header fields used in PDF title/subtitle ----
    job_title = normalize_for_hash(getattr(job, "title", "") or "")
    company = normalize_for_hash(getattr(job, "company", "") or "")

    payload = {
        "template_id": (template_id or "").strip(),
        "include_photo": bool(include_photo),
        "job_title": job_title,
        "company": company,
        "cover_letter": normalize_for_hash(cover_letter),
        "rendered_cv_text": normalize_for_hash(rendered_cv_text),
        "profile": {
            "name": name,
            "email": email,
            "phone": phone,
            "address": address,
            "postal_code": postal_code,
            "postal_place": postal_place,
            "languages": languages,
            "references": references,
            "photo_hash": photo_hash,
        },
    }

    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return _sha256_hex(raw)
