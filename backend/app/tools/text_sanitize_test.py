"""Unit-style checks for employer-safe text sanitizing.

Run manually:
  python3 -m backend.app.tools.text_sanitize_test

This is intentionally lightweight (no pytest dependency).
"""

from backend.app.text_sanitize import sanitize_employer_text


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    src = (
        "Profesjonell vurdering:\n"
        "Dette skal bort.\n\n"
        "Profesjonell oppsummering\n"
        "Dette skal være med.\n\n"
        "Matchscore: 72%\n"
        "Mer analyse.\n\n"
        "Arbeidserfaring\n"
        "• Jobb A\n"
    )

    out = sanitize_employer_text(src)

    _assert("Profesjonell vurdering" not in out, "Should remove 'Profesjonell vurdering' section")
    _assert("Matchscore" not in out, "Should remove 'Matchscore' section")

    # Must keep the valid CV section.
    _assert("Profesjonell oppsummering" in out, "Must NOT remove 'Profesjonell oppsummering'")

    # Must keep content after safe boundaries.
    _assert("Arbeidserfaring" in out, "Must keep safe CV sections")

    # Dict extraction should not pretty-print JSON.
    out2 = sanitize_employer_text({"tailored_cv": "Profesjonell oppsummering\nOK"})
    _assert(out2.strip().startswith("Profesjonell oppsummering"), "Should extract text field from dict")

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
