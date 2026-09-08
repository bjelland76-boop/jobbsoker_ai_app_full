"""Manual checks for cv_importer._strip_md()'s robustness against the "Extra
data" class of JSON-decode failure that was fixed in cv_analyzer.py on
2026-08-28 (HTTP 500, detail: "Extra data: line N column 1 (char M)").

cv_importer.py had the identical unguarded json.loads() call but was missed
at the time -- it backs POST /profile/import-cv, used by the "Last opp CV"
home-screen button and the existing file/camera/gallery CV-import flows.

That error means json.loads() found a COMPLETE, valid JSON object but then
hit more content after it -- e.g. Claude appending a trailing remark after
the JSON block, or repeating it. This is a pure parsing-logic test: no
Anthropic API key or network call needed, since it feeds _strip_md()
synthetic raw text shaped like the various ways Claude has been observed
(in cv_analyzer.py) or could plausibly misbehave here too.

Run manually:
  cd backend && venv/bin/python -m app.tools.cv_importer_parse_test
"""

from __future__ import annotations

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used-by-this-test")

from app.cv_importer import CvImportParseError, _strip_md  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


_VALID_FIELDS = {
    "name": "Kari Nordmann",
    "email": "kari@example.com",
    "phone": "12345678",
    "address": "Osloveien 1",
    "experience": [
        {"title": "Butikkmedarbeider", "company": "Rema 1000", "from": "2020", "to": "", "current": True},
    ],
    "education": [
        {"degree": "Bachelor", "school": "OsloMet", "from": "2016", "to": "2019"},
    ],
    "skills": ["Kundeservice", "Kassaarbeid"],
    "languages": ["Norsk", "Engelsk"],
}
_VALID_JSON = (
    '{"name": "Kari Nordmann", "email": "kari@example.com", "phone": "12345678", '
    '"address": "Osloveien 1", '
    '"experience": [{"title": "Butikkmedarbeider", "company": "Rema 1000", '
    '"from": "2020", "to": "", "current": true}], '
    '"education": [{"degree": "Bachelor", "school": "OsloMet", "from": "2016", "to": "2019"}], '
    '"skills": ["Kundeservice", "Kassaarbeid"], '
    '"languages": ["Norsk", "Engelsk"]}'
)


def _check(label: str, raw: str) -> None:
    result = _strip_md(raw)
    _assert(result == _VALID_FIELDS, f"{label}: parsed data does not match expected fields, got {result}")
    print(f"[OK] {label}")


def main() -> int:
    # 1) Plain, well-formed JSON -- baseline, must still work.
    _check("ren gyldig JSON", _VALID_JSON)

    # 2) Wrapped in a ```json ... ``` code fence.
    _check("kodeblokk med json-tag", f"```json\n{_VALID_JSON}\n```")

    # 3) Wrapped in a bare ``` ... ``` fence (no "json" tag).
    _check("kodeblokk uten tag", f"```\n{_VALID_JSON}\n```")

    # 4) THE PRODUCTION BUG (same class as cv_analyzer.py, 2026-08-28):
    #    valid JSON followed by trailing prose. Plain json.loads() raises
    #    "Extra data: line N column 1 (char M)" here.
    _check(
        "gyldig JSON + etterfølgende forklarende tekst",
        _VALID_JSON + "\n\nHåper dette hjelper! La meg vite om du trenger mer.",
    )

    # 5) Valid JSON followed by a second, duplicate JSON object (model
    #    repeats itself) -- also an "Extra data" case.
    _check("gyldig JSON etterfulgt av et duplikat JSON-objekt", _VALID_JSON + "\n" + _VALID_JSON)

    # 6) Leading prose before the JSON object (no fence).
    _check("forklarende tekst før JSON-objektet", "Her er profilen din:\n" + _VALID_JSON)

    # 7) Leading prose AND trailing prose at once.
    _check(
        "tekst både før og etter JSON-objektet",
        "Her er profilen din:\n" + _VALID_JSON + "\n\nSi fra om du vil ha mer detaljer.",
    )

    # 8) Trailing whitespace/newlines only -- must not be treated as an error.
    _check("etterfølgende whitespace", _VALID_JSON + "\n\n   \n")

    # 9) Fenced JSON with trailing prose AFTER the closing fence.
    _check(
        "kodeblokk med tekst etter avsluttende fence",
        f"```json\n{_VALID_JSON}\n```\nLykke til!",
    )

    # 10) Genuinely unparseable garbage -- must raise the NAMED, clear
    #     exception (not a raw JSONDecodeError leaking to the caller).
    try:
        _strip_md("Beklager, jeg kan ikke lese denne CV-en uten mer informasjon.")
        raise AssertionError("expected CvImportParseError for non-JSON garbage input")
    except CvImportParseError as e:
        _assert("JSON" in str(e), f"expected a clear JSON-related message, got: {e}")
        print(f"[OK] uparserbar søppel-tekst gir CvImportParseError med tydelig melding: {e}")

    # 11) Empty string -- also must raise the named exception, not crash
    #     some other way (e.g. IndexError from raw.find()).
    try:
        _strip_md("")
        raise AssertionError("expected CvImportParseError for empty input")
    except CvImportParseError as e:
        print(f"[OK] tom streng gir CvImportParseError: {e}")

    print("\nAlle 11 sjekker OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
