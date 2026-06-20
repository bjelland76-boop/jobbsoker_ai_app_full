"""CV import: extract text from PDF/docx/image, then parse with Claude."""
from __future__ import annotations

import base64
import io
import json
import os
import re
import tempfile
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv(".env")

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"

_SYSTEM_PROMPT = (
    "Du er en CV-parser. Analyser innholdet og returner KUN et JSON-objekt "
    "(ingen markdown, ingen forklaring) med feltene:\n"
    '{"name": "fullt navn", "email": "e-post eller tom streng", '
    '"phone": "telefon eller tom streng", "address": "adresse eller tom streng", '
    '"cv_text": "fullstendig CV-tekst som sammenhengende tekst", '
    '"experience": "arbeidserfaring som tekst", '
    '"education": "utdanning som tekst", '
    '"skills": "ferdigheter som kommaseparert tekst"}\n'
    "Bruk tom streng for felt som mangler. Svar kun med JSON."
)


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY mangler i backend/.env")
    return anthropic.Anthropic(api_key=api_key)


def _strip_md(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return json.loads(raw)


def _ask_claude_text(text: str) -> dict:
    client = _get_client()
    res = client.messages.create(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"CV-tekst:\n\n{text}"}],
        max_tokens=2048,
        temperature=0,
    )
    return _strip_md(res.content[0].text)


def _ask_claude_image(image_bytes: bytes, media_type: str) -> dict:
    client = _get_client()
    b64 = base64.standard_b64encode(image_bytes).decode()
    res = client.messages.create(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system=_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64},
                    },
                    {"type": "text", "text": "Les og ekstraher CV-informasjon fra dette bildet."},
                ],
            }
        ],
        max_tokens=2048,
        temperature=0,
    )
    return _strip_md(res.content[0].text)


def _extract_pdf(data: bytes) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        raise RuntimeError("PyMuPDF er ikke installert (pip install PyMuPDF)") from exc

    doc = fitz.open(stream=data, filetype="pdf")
    pages = [page.get_text() for page in doc]
    doc.close()
    return "\n".join(pages)


def _extract_docx(data: bytes) -> str:
    try:
        import docx
    except ImportError as exc:
        raise RuntimeError("python-docx er ikke installert (pip install python-docx)") from exc

    doc = docx.Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_and_parse(filename: str, content_type: str, data: bytes) -> dict:
    """Main entry point: extract text and parse with Claude. Returns profile dict."""
    ext = Path(filename).suffix.lower() if filename else ""
    ct = (content_type or "").lower()

    if ext == ".pdf" or "pdf" in ct:
        text = _extract_pdf(data)
        parsed = _ask_claude_text(text)
    elif ext in (".docx", ".doc") or "word" in ct or "officedocument" in ct:
        text = _extract_docx(data)
        parsed = _ask_claude_text(text)
    elif ct.startswith("image/") or ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        media_type = ct if ct.startswith("image/") else f"image/{ext.lstrip('.')}"
        if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            media_type = "image/jpeg"
        parsed = _ask_claude_image(data, media_type)
    else:
        # Fallback: try to decode as text
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            text = ""
        if not text.strip():
            raise ValueError(f"Filtypen støttes ikke: {filename or content_type}")
        parsed = _ask_claude_text(text)

    return {
        "name": parsed.get("name", ""),
        "email": parsed.get("email", ""),
        "phone": parsed.get("phone", ""),
        "address": parsed.get("address", ""),
        "cv_text": parsed.get("cv_text", ""),
        "experience": parsed.get("experience", ""),
        "education": parsed.get("education", ""),
        "skills": parsed.get("skills", ""),
    }
