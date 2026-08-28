"""Manual checks for _guess_job_title_company()'s fallback-path fix
(backend/app/job_analyzer.py).

Bug reported by the user: on "Send søknad", the green "Tilpasset: ..." box
showed "Customer Service Associate [Customer Service Associate] 0 CV
Budget: $110" for a VietnamWorks posting -- the real title duplicated in
brackets plus an unrelated applicant-count/budget tail glued on with no
separator.

Root cause: fetch_job_text() collapses ALL whitespace (including newlines
between separate page elements) into single spaces, so when none of
_guess_job_title_company()'s known separator patterns (" - ", " | ", " – ",
" — ", "... hos Company") match, the naive `t[:120]` fallback can splice
together the real title with adjacent page noise (badges, salary widgets,
duplicate/bracketed a11y text) with zero boundary between them. Fixed by
validating the fallback with the same _is_probably_job_title() heuristic
pdfgen.py already uses for the PDF subtitle, falling back to "Ukjent
stilling" instead of showing the noise verbatim.

This is a pure unit test of the function -- no network call, no API key
needed.

Run manually:
  cd backend && venv/bin/python -m app.tools.job_title_guess_test
"""

from __future__ import annotations

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used-by-this-test")

from app.job_analyzer import _guess_job_title_company  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    # 1) THE PRODUCTION BUG: exact garbled text reported by the user.
    title, company = _guess_job_title_company(
        "Customer Service Associate [Customer Service Associate] 0 CV Budget: $110"
    )
    _assert(title == "Ukjent stilling", f"expected clean fallback, got {title!r}")
    print(f"[OK] VietnamWorks-style garbled fallback text -> {title!r} (not shown verbatim)")

    # 2) A different noise pattern (duplicate + trailing badge, no brackets)
    #    must be caught too, not just the exact reported string.
    title, company = _guess_job_title_company(
        "Warehouse Associate Warehouse Associate 12 CV Budget: $250 Apply now"
    )
    _assert(title == "Ukjent stilling", f"expected clean fallback, got {title!r}")
    print(f"[OK] Similar noise pattern (no brackets) -> {title!r}")

    # 3) Separator-based extraction (Norwegian, already working) must be
    #    completely unaffected -- this fix must not touch that path at all.
    title, company = _guess_job_title_company("Butikkmedarbeider - Rema 1000 Kristiansand")
    _assert(title == "Butikkmedarbeider", f"NO separator path regressed, got {title!r}")
    _assert(company == "Rema 1000 Kristiansand", f"NO separator path regressed (company), got {company!r}")
    print(f"[OK] Norwegian ' - ' separator still works: title={title!r}, company={company!r}")

    # 4) Separator-based extraction (English " | ") must be unaffected too.
    title, company = _guess_job_title_company("Sales Associate | Test Company AS")
    _assert(title == "Sales Associate", f"EN separator path regressed, got {title!r}")
    _assert(company == "Test Company AS", f"EN separator path regressed (company), got {company!r}")
    print(f"[OK] English ' | ' separator still works: title={title!r}, company={company!r}")

    # 5) "... hos Company" pattern must be unaffected.
    title, company = _guess_job_title_company("Vi soker en dyktig selger hos Elkjop Norge")
    _assert("hos" not in title.lower(), f"'hos' pattern regressed, got {title!r}")
    print(f"[OK] '... hos Company' pattern still works: title={title!r}, company={company!r}")

    # 6) A genuinely clean fallback (no separator, but the raw text IS a
    #    plausible short title) must still be accepted, not over-rejected.
    title, company = _guess_job_title_company("Regnskapsforer")
    _assert(title == "Regnskapsforer", f"clean fallback should be accepted as-is, got {title!r}")
    print(f"[OK] Clean, short fallback text still accepted: title={title!r}")

    # 7) Empty input must still hit the safe fallback (pre-existing behavior).
    title, company = _guess_job_title_company("")
    _assert(title == "Ukjent stilling", f"expected 'Ukjent stilling' for empty input, got {title!r}")
    print(f"[OK] Empty input -> {title!r} (unchanged pre-existing behavior)")

    print("\nAlle sjekker OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
