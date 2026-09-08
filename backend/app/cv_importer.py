"""CV import: extract text from PDF/docx/image, then parse with Claude."""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv(".env")

logger = logging.getLogger(__name__)

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"

_SYSTEM_PROMPT = """Du er en CV-parser. Analyser innholdet og returner KUN et gyldig JSON-objekt (ingen markdown, ingen forklaring) med disse feltene:

{
  "name": "fullt navn eller tom streng",
  "email": "e-post eller tom streng",
  "phone": "telefon eller tom streng",
  "address": "gateadresse eller tom streng",
  "experience": [
    {
      "title": "stillingstittel",
      "company": "arbeidsgiver",
      "from": "årstall som streng, f.eks. 2018",
      "to": "årstall som streng eller tom streng hvis pågående",
      "current": false
    }
  ],
  "education": [
    {
      "degree": "grad eller studieprogram",
      "school": "skole eller universitet",
      "from": "årstall som streng",
      "to": "årstall som streng"
    }
  ],
  "skills": ["ferdighet1", "ferdighet2"],
  "languages": ["språk1", "språk2"]
}

Regler:
- experience og education skal alltid være lister (tom liste [] hvis ingenting finnes)
- skills og languages skal alltid være lister (tom liste [] hvis ingenting finnes)
- from/to skal være årstall som streng (f.eks. "2018"), ikke datoer
- Sett current: true og to: "" hvis stillingen er pågående
- Svar KUN med JSON, ingen tekst rundt"""


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY mangler i backend/.env")
    return anthropic.Anthropic(api_key=api_key)


class CvImportParseError(RuntimeError):
    """Claude's CV-import response could not be parsed as JSON, even after
    stripping code fences and trying to recover the first complete JSON
    value from any trailing content. Caught in main.py's /profile/import-cv
    and surfaced as a clear 500 detail instead of a raw JSONDecodeError
    string. Same failure mode and fix as cv_analyzer.CvAnalysisParseError."""


def _strip_md(raw: str) -> dict:
    """Parse Claude's JSON response robustly.

    Claude is instructed (system prompt) to return ONLY JSON, but in
    practice sometimes still appends trailing content after a complete,
    valid JSON object -- a stray repeated block, a trailing remark. Plain
    json.loads() then raises "Extra data" even though the JSON itself is
    perfectly valid. json.JSONDecoder().raw_decode() parses only the first
    complete JSON value and ignores whatever follows it, which is exactly
    what's needed here. Same fallback already used in cv_analyzer.py's
    _parse_json() and job_analyzer.py's generate_application_texts() for
    the identical failure mode (production bug fixed 2026-08-28, ~5 of 6
    /analyze-cv calls failed with this before the fix -- this file had the
    same unguarded json.loads() but was missed at the time).
    """
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError as first_err:
        # Skip any leading prose Claude might have added before the JSON
        # object itself (rare, but raw_decode needs to start ON the value).
        start = raw.find("{")
        if start == -1:
            logger.error("[cv_importer] no JSON object found in response: %r", raw[:500])
            raise CvImportParseError(
                "Kunne ikke tolke AI-modellens svar: fant ingen JSON-struktur i svaret."
            ) from first_err
        try:
            data, _end = json.JSONDecoder().raw_decode(raw, start)
            return data
        except json.JSONDecodeError as second_err:
            logger.error(
                "[cv_importer] JSON parse failed even with raw_decode fallback (%s): %r",
                second_err, raw[:500],
            )
            raise CvImportParseError(
                "Kunne ikke tolke AI-modellens svar som JSON. Prøv igjen om et øyeblikk."
            ) from second_err


def _normalize(parsed: dict) -> dict:
    """Ensure all fields have the correct types regardless of what Claude returned."""
    def to_list(v):
        if isinstance(v, list):
            return v
        if isinstance(v, str) and v.strip():
            return [v]
        return []

    experience = []
    for e in to_list(parsed.get("experience")):
        if isinstance(e, str):
            experience.append({"title": e, "company": "", "from": "", "to": "", "current": False})
        elif isinstance(e, dict):
            experience.append({
                "title": e.get("title", ""),
                "company": e.get("company", e.get("employer", "")),
                "from": str(e.get("from", "")),
                "to": str(e.get("to", "")),
                "current": bool(e.get("current", False)),
            })

    education = []
    for e in to_list(parsed.get("education")):
        if isinstance(e, str):
            education.append({"school": e, "degree": "", "from": "", "to": ""})
        elif isinstance(e, dict):
            education.append({
                "school": e.get("school", e.get("institution", "")),
                "degree": e.get("degree", ""),
                "from": str(e.get("from", "")),
                "to": str(e.get("to", "")),
            })

    skills_raw = parsed.get("skills", [])
    if isinstance(skills_raw, str):
        skills = [s.strip() for s in re.split(r"[,;]", skills_raw) if s.strip()]
    else:
        skills = [str(s) for s in to_list(skills_raw) if s]

    languages_raw = parsed.get("languages", [])
    if isinstance(languages_raw, str):
        languages = [s.strip() for s in re.split(r"[,;]", languages_raw) if s.strip()]
    else:
        languages = [str(s) for s in to_list(languages_raw) if s]

    return {
        "name": parsed.get("name", ""),
        "email": parsed.get("email", ""),
        "phone": parsed.get("phone", ""),
        "address": parsed.get("address", ""),
        "experience": experience,
        "education": education,
        "skills": skills,
        "languages": languages,
    }


def _ask_claude_text(text: str) -> dict:
    client = _get_client()
    res = client.messages.create(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"CV-tekst:\n\n{text}"}],
        max_tokens=2048,
        temperature=0,
    )
    return _normalize(_strip_md(res.content[0].text))


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
    return _normalize(_strip_md(res.content[0].text))


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


def _ask_claude_image_text(image_bytes: bytes, media_type: str) -> str:
    """Use Claude vision to extract raw text from an image document."""
    client = _get_client()
    b64 = base64.standard_b64encode(image_bytes).decode()
    res = client.messages.create(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64},
                    },
                    {"type": "text", "text": "Transkriber all tekst fra dette dokumentet nøyaktig. Returner kun teksten, ingen kommentarer."},
                ],
            }
        ],
        max_tokens=1024,
        temperature=0,
    )
    return res.content[0].text.strip()


def extract_document_text(filename: str, content_type: str, data: bytes) -> str:
    """Extract raw text from a document (PDF or image) without structured parsing."""
    ext = Path(filename).suffix.lower() if filename else ""
    ct = (content_type or "").lower()

    if ext == ".pdf" or "pdf" in ct:
        return _extract_pdf(data)
    elif ct.startswith("image/") or ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        media_type = ct if ct.startswith("image/") else f"image/{ext.lstrip('.')}"
        if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            media_type = "image/jpeg"
        return _ask_claude_image_text(data, media_type)
    else:
        try:
            return data.decode("utf-8", errors="replace")
        except Exception:
            return ""


def extract_and_parse(filename: str, content_type: str, data: bytes) -> dict:
    """Main entry point: extract text and parse with Claude. Returns profile dict."""
    ext = Path(filename).suffix.lower() if filename else ""
    ct = (content_type or "").lower()

    if ext == ".pdf" or "pdf" in ct:
        text = _extract_pdf(data)
        return _ask_claude_text(text)
    elif ext in (".docx", ".doc") or "word" in ct or "officedocument" in ct:
        text = _extract_docx(data)
        return _ask_claude_text(text)
    elif ct.startswith("image/") or ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        media_type = ct if ct.startswith("image/") else f"image/{ext.lstrip('.')}"
        if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            media_type = "image/jpeg"
        return _ask_claude_image(data, media_type)
    else:
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            text = ""
        if not text.strip():
            raise ValueError(f"Filtypen støttes ikke: {filename or content_type}")
        return _ask_claude_text(text)
