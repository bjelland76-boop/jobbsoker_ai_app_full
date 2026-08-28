"""LIVE checks for step 4 of the Vietnamese-market CV plan: the new
elif language == "vi": branches in generate_application_texts() and
stream_application_texts() (backend/app/job_analyzer.py).

Makes REAL Claude API calls (costs tokens) -- this is the only way to
actually verify the model produces genuine Vietnamese output, as opposed to
step 3's mocked storage-routing test. Requires a working ANTHROPIC_API_KEY
in backend/.env.

Verifies the core requirement: output is ALWAYS Vietnamese, regardless of
what language the job ad or the candidate's own profile data is written in.
Tests both an ENGLISH job ad and a NORWEGIAN job ad, both with a Norwegian
candidate profile (the profile itself is never translated by us -- it's the
AI's job to translate everything into the output language).

Run manually:
  cd backend && venv/bin/python -m app.tools.vi_prompt_language_test
"""

from __future__ import annotations

import re
from types import SimpleNamespace

from app.job_analyzer import generate_application_texts, stream_application_texts

# Vietnamese-only diacritic characters (never appear in English or Norwegian
# text) -- a reliable, simple signal that a block of text is actually
# Vietnamese rather than English/Norwegian.
_VI_ONLY_CHARS = set("đơưăâêôĐƠƯĂÂÊÔ") | set("ạảãấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏõốồổỗộớờởỡợụủũứừửữựỳỵỷỹ")


def _vi_char_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    vi_hits = sum(1 for c in letters if c in _VI_ONLY_CHARS)
    return vi_hits / len(letters)


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


_PROFILE = SimpleNamespace(
    name="Kari Nordmann",
    email="kari@example.com",
    phone="99887766",
    address="Storgata 1, 0155 Oslo",
    experience='[{"title": "Butikkmedarbeider", "company": "Rema 1000", "from": "2021", "to": "2024", "current": false}]',
    education='[{"school": "Universitetet i Agder", "degree": "Bachelor i markedsføring", "from": "2018", "to": "2021"}]',
    skills="Kundeservice, kassaarbeid, varepåfylling, lagerstyring",
    languages='["Norsk (Morsmål)", "Engelsk (Flytende)"]',
    target_role="",
    cv_gaps="",
    cv_text="",
    references_json="",
)

_JOB_EN = (
    "We are looking for a Sales Associate to join our team in Ho Chi Minh City. "
    "Responsibilities include customer service, inventory management, and cash handling. "
    "Requirements: retail experience preferred, good communication skills."
)

_JOB_NO = (
    "Vi soker en engasjert butikkmedarbeider til vår avdeling. "
    "Arbeidsoppgaver: kundeservice, varepafylling, kassaarbeid. "
    "Krav: erfaring fra butikk er en fordel, gode kommunikasjonsevner."
)


def _check_generate(job_label: str, job_text: str) -> None:
    result = generate_application_texts(
        _PROFILE,
        job_title="Sales Associate" if job_label == "EN" else "Butikkmedarbeider",
        company="Test Company",
        job_text=job_text,
        application_style="vanlig",
        match_context=None,
        language="vi",
    )
    cv = result.get("tailored_cv", "")
    letter = result.get("cover_letter", "")
    _assert(bool(cv.strip()), f"[{job_label}] tailored_cv is empty")
    _assert(bool(letter.strip()), f"[{job_label}] cover_letter is empty")

    cv_ratio = _vi_char_ratio(cv)
    letter_ratio = _vi_char_ratio(letter)
    _assert(cv_ratio > 0.01, f"[{job_label}] tailored_cv does not look Vietnamese (vi-char ratio={cv_ratio:.4f}). First 300 chars: {cv[:300]!r}")
    _assert(letter_ratio > 0.01, f"[{job_label}] cover_letter does not look Vietnamese (vi-char ratio={letter_ratio:.4f}). First 300 chars: {letter[:300]!r}")

    print(f"[OK] generate_application_texts (job ad in {job_label}) -> Vietnamese output confirmed (vi-char ratio: cv={cv_ratio:.3f}, letter={letter_ratio:.3f})")
    print(f"     --- tailored_cv excerpt ---\n{cv[:400]}\n")
    print(f"     --- cover_letter excerpt ---\n{letter[:300]}\n")


def _check_stream(job_label: str, job_text: str) -> None:
    full_chunks = []
    done_data = None
    for event_type, data in stream_application_texts(
        _PROFILE,
        job_title="Sales Associate" if job_label == "EN" else "Butikkmedarbeider",
        company="Test Company",
        job_text=job_text,
        application_style="vanlig",
        match_context=None,
        language="vi",
    ):
        if event_type == "chunk":
            full_chunks.append(data)
        else:
            done_data = data

    _assert(done_data is not None, f"[{job_label}] stream never yielded a 'done' event")
    cv = done_data.get("tailored_cv", "")
    letter = done_data.get("cover_letter", "")
    _assert(bool(cv.strip()), f"[{job_label}] streamed tailored_cv is empty -- marker parsing (_MARKERS_VI) likely broken. Raw: {''.join(full_chunks)[:400]!r}")
    _assert(bool(letter.strip()), f"[{job_label}] streamed cover_letter is empty -- marker parsing (_MARKERS_VI) likely broken. Raw: {''.join(full_chunks)[:400]!r}")

    cv_ratio = _vi_char_ratio(cv)
    letter_ratio = _vi_char_ratio(letter)
    _assert(cv_ratio > 0.01, f"[{job_label}] streamed tailored_cv does not look Vietnamese (ratio={cv_ratio:.4f})")
    _assert(letter_ratio > 0.01, f"[{job_label}] streamed cover_letter does not look Vietnamese (ratio={letter_ratio:.4f})")

    print(f"[OK] stream_application_texts (job ad in {job_label}) -> Vietnamese output confirmed, marker parsing works (vi-char ratio: cv={cv_ratio:.3f}, letter={letter_ratio:.3f})")


def main() -> int:
    _check_generate("EN", _JOB_EN)
    _check_generate("NO", _JOB_NO)
    _check_stream("EN", _JOB_EN)
    _check_stream("NO", _JOB_NO)
    print("\nAlle sjekker OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
