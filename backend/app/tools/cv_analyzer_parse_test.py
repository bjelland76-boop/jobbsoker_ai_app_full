"""Manual checks for cv_analyzer._parse_json()'s robustness against the
"Extra data" class of JSON-decode failure seen in production on /analyze-cv
(HTTP 500, detail: "Extra data: line 13 column 1 (char 863)").

That error means json.loads() found a COMPLETE, valid JSON object but then
hit more content after it -- e.g. Claude appending a trailing remark after
the JSON block, or repeating it. This is a pure parsing-logic test: no
Anthropic API key or network call needed, since it feeds _parse_json()
synthetic raw text shaped like the various ways Claude has been observed
(here) or could plausibly misbehave.

Run manually:
  cd backend && venv/bin/python -m app.tools.cv_analyzer_parse_test
"""

from __future__ import annotations

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used-by-this-test")

from app.cv_analyzer import CvAnalysisParseError, _parse_json  # noqa: E402


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


_VALID_FIELDS = {
    "summary": "Erfaren selger med god kundeservicebakgrunn.",
    "suggested_roles": ["Butikkmedarbeider", "Kundeservicemedarbeider"],
    "education_fit": "Kvalifisert for salgs- og servicestillinger.",
    "strengths": ["Kommunikasjon", "Pålitelighet"],
    "gaps": ["Mangler ledererfaring"],
    "improvement_tips": ["Ta kurs i konflikthåndtering"],
    "search_keywords": ["butikk", "kundeservice", "salg"],
}
_VALID_JSON = (
    '{"summary": "Erfaren selger med god kundeservicebakgrunn.", '
    '"suggested_roles": ["Butikkmedarbeider", "Kundeservicemedarbeider"], '
    '"education_fit": "Kvalifisert for salgs- og servicestillinger.", '
    '"strengths": ["Kommunikasjon", "Pålitelighet"], '
    '"gaps": ["Mangler ledererfaring"], '
    '"improvement_tips": ["Ta kurs i konflikthåndtering"], '
    '"search_keywords": ["butikk", "kundeservice", "salg"]}'
)


def _check(label: str, raw: str) -> None:
    result = _parse_json(raw)
    _assert(result == _VALID_FIELDS, f"{label}: parsed data does not match expected fields, got {result}")
    print(f"[OK] {label}")


def main() -> int:
    # 1) Plain, well-formed JSON -- baseline, must still work.
    _check("ren gyldig JSON", _VALID_JSON)

    # 2) Wrapped in a ```json ... ``` code fence.
    _check("kodeblokk med json-tag", f"```json\n{_VALID_JSON}\n```")

    # 3) Wrapped in a bare ``` ... ``` fence (no "json" tag).
    _check("kodeblokk uten tag", f"```\n{_VALID_JSON}\n```")

    # 4) THE PRODUCTION BUG: valid JSON followed by trailing prose.
    #    Plain json.loads() raises "Extra data: line N column 1 (char M)"
    #    here -- exactly the error seen in production.
    _check(
        "gyldig JSON + etterfølgende forklarende tekst",
        _VALID_JSON + "\n\nHåper dette hjelper! La meg vite om du trenger mer.",
    )

    # 5) Valid JSON followed by a second, duplicate JSON object (model
    #    repeats itself) -- also an "Extra data" case.
    _check("gyldig JSON etterfulgt av et duplikat JSON-objekt", _VALID_JSON + "\n" + _VALID_JSON)

    # 6) Leading prose before the JSON object (no fence).
    _check("forklarende tekst før JSON-objektet", "Her er analysen:\n" + _VALID_JSON)

    # 7) Leading prose AND trailing prose at once.
    _check(
        "tekst både før og etter JSON-objektet",
        "Her er analysen:\n" + _VALID_JSON + "\n\nSi fra om du vil ha mer detaljer.",
    )

    # 8) Trailing whitespace/newlines only -- must not be treated as an error.
    _check("etterfølgende whitespace", _VALID_JSON + "\n\n   \n")

    # 9) Fenced JSON with trailing prose AFTER the closing fence.
    _check(
        "kodeblokk med tekst etter avsluttende fence",
        f"```json\n{_VALID_JSON}\n```\nLykke til med søket!",
    )

    # 10) Genuinely unparseable garbage -- must raise the NAMED, clear
    #     exception (not a raw JSONDecodeError leaking to the caller).
    try:
        _parse_json("Beklager, jeg kan ikke analysere denne CV-en uten mer informasjon.")
        raise AssertionError("expected CvAnalysisParseError for non-JSON garbage input")
    except CvAnalysisParseError as e:
        _assert("JSON" in str(e), f"expected a clear JSON-related message, got: {e}")
        print(f"[OK] uparserbar søppel-tekst gir CvAnalysisParseError med tydelig melding: {e}")

    # 11) Empty string -- also must raise the named exception, not crash
    #     some other way (e.g. IndexError from raw.find()).
    try:
        _parse_json("")
        raise AssertionError("expected CvAnalysisParseError for empty input")
    except CvAnalysisParseError as e:
        print(f"[OK] tom streng gir CvAnalysisParseError: {e}")

    print("\nAlle 11 sjekker OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
