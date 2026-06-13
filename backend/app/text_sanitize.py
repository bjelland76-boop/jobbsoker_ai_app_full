from __future__ import annotations

import re
from typing import Any

# Headings/labels that must NEVER be sent to an employer in PDF/email.
# NOTE: We intentionally do NOT remove "Profesjonell oppsummering" (valid CV section).
_REMOVE_PREFIXES = [
    "profesjonell vurdering",
    "ærlig vurdering",
    "matchscore",
    "match score",
    "styrker",
    "svakheter",
    "manglende krav",
    "risiko",
    "risikoer",
    "ai-analyse",
    "ai analyse",
    "intern analyse",
    "anbefalte cv-endringer",
    "anbefalte cv endringer",
]

# Section headings we consider as "safe boundaries" when removing a section.
# If we enter a removed section, we keep skipping until we hit one of these.
_SAFE_SECTION_HEADINGS = {
    # CV structure used by prompts
    "profesjonell oppsummering",
    "kjerneferdigheter",
    "arbeidserfaring",
    "utdanning",
    "sertifiseringer",
    "språk",
    "referanser",
    # Other headings used by PDF fallback renderer
    "cv",
    "erfaring",
    "ferdigheter",
    "hull i cv",
    # Misc (cover letter)
    "søknad",
    "søknadstekst",
}


def _extract_textish(value: Any, *, _depth: int = 0) -> str:
    """Best-effort: coerce LLM output into plain text WITHOUT pretty-printing JSON.

    Goal:
    - If the model returns dict/list/object, extract the human text fields.
    - Avoid dumping JSON into PDF/email (that can leak internal keys/analysis).
    """

    if value is None:
        return ""

    if isinstance(value, str):
        return value

    # Guard against weird/recursive shapes.
    if _depth >= 4:
        return str(value)

    if isinstance(value, dict):
        # Common keys from our own code + LLM outputs.
        for k in (
            "cover_letter",
            "coverLetter",
            "tailored_cv",
            "tailoredCv",
            "email_text",
            "emailText",
            "cv",
            "body",
            "text",
            "content",
            "value",
            "message",
        ):
            if k in value:
                v = value.get(k)
                if isinstance(v, str) and v.strip():
                    return v
                extracted = _extract_textish(v, _depth=_depth + 1)
                if extracted.strip():
                    return extracted

        # Fallback: try any string-like values.
        for v in value.values():
            if isinstance(v, str) and v.strip():
                return v

        return ""

    if isinstance(value, (list, tuple)):
        parts: list[str] = []
        for it in value:
            s = _extract_textish(it, _depth=_depth + 1).strip()
            if s:
                parts.append(s)
        return "\n".join(parts)

    # Last resort: string conversion (but no JSON dumps/indentation here).
    return str(value)


def _normalize_heading(line: str) -> str:
    s = (line or "").strip()
    # Remove leading bullets/dashes.
    s = re.sub(r"^[\s•\-–—]+", "", s).strip()
    # Normalize trailing ':' (common heading format).
    s = s[:-1].strip() if s.endswith(":") else s
    # Collapse whitespace.
    s = " ".join(s.split())
    return s.casefold()


def _is_removed_heading(line: str) -> bool:
    h = _normalize_heading(line)

    # Explicit allow-list exception.
    if h.startswith("profesjonell oppsummering"):
        return False

    return any(h.startswith(prefix) for prefix in _REMOVE_PREFIXES)


def _is_safe_section_boundary(line: str) -> bool:
    h = _normalize_heading(line)
    if not h:
        return False

    # Only treat as a section heading if it looks like one (short-ish),
    # otherwise random sentences could stop the skip.
    if len(h) > 60:
        return False

    return h in _SAFE_SECTION_HEADINGS


def sanitize_employer_text(value: Any) -> str:
    """Remove internal AI analysis content from text used in employer-facing outputs.

    Used only for:
    - PDFs
    - email body (to employer)

    Does NOT change what the API returns to the app.
    """

    text = _extract_textish(value)
    if not text or not isinstance(text, str):
        return ""

    # Normalize newlines.
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    lines_in = text.split("\n")
    lines_out: list[str] = []

    skipping_section = False

    for ln in lines_in:
        if not skipping_section:
            if _is_removed_heading(ln):
                skipping_section = True
                continue
            lines_out.append(ln)
            continue

        # skipping_section == True
        if _is_safe_section_boundary(ln) and not _is_removed_heading(ln):
            skipping_section = False
            lines_out.append(ln)
            continue

        # Otherwise: keep skipping.
        continue

    # Post-process: collapse excessive blank lines.
    cleaned: list[str] = []
    blank_run = 0
    for ln in lines_out:
        if not ln.strip():
            blank_run += 1
            if blank_run <= 2:
                cleaned.append("")
            continue
        blank_run = 0
        cleaned.append(ln.rstrip())

    return "\n".join(cleaned).strip()
