import json
import logging
import os
import re

import anthropic
from dotenv import load_dotenv

from .prompt_rules import SHARED_ANTI_HALLUCINATION_RULES

load_dotenv(".env")

logger = logging.getLogger(__name__)

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY mangler i backend/.env")
    return anthropic.Anthropic(api_key=api_key)


class CvAnalysisParseError(RuntimeError):
    """Claude's CV-analysis response could not be parsed as JSON, even after
    stripping code fences and trying to recover the first complete JSON
    value from any trailing content. Caught in main.py's /analyze-cv and
    surfaced as a clear 500 detail instead of a raw JSONDecodeError string."""


def _parse_json(raw: str) -> dict:
    """Parse Claude's JSON response robustly.

    Claude is instructed (system + user prompt) to return ONLY JSON, but in
    practice sometimes still appends trailing content after a complete,
    valid JSON object -- a stray repeated block, a trailing remark. Plain
    json.loads() then raises "Extra data" even though the JSON itself is
    perfectly valid. json.JSONDecoder().raw_decode() parses only the first
    complete JSON value and ignores whatever follows it, which is exactly
    what's needed here. Same fallback already used in job_analyzer.py's
    generate_application_texts() for the identical failure mode.
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
            logger.error("[cv_analyzer] no JSON object found in response: %r", raw[:500])
            raise CvAnalysisParseError(
                "Kunne ikke tolke AI-modellens svar: fant ingen JSON-struktur i svaret."
            ) from first_err
        try:
            data, _end = json.JSONDecoder().raw_decode(raw, start)
            return data
        except json.JSONDecodeError as second_err:
            logger.error(
                "[cv_analyzer] JSON parse failed even with raw_decode fallback (%s): %r",
                second_err, raw[:500],
            )
            raise CvAnalysisParseError(
                "Kunne ikke tolke AI-modellens svar som JSON. Prøv igjen om et øyeblikk."
            ) from second_err


_LANG_RULE = {
    "no": "CRITICAL: Write ALL JSON text values in Norwegian (Bokmål). Every string in the output must be Norwegian.",
    "en": "CRITICAL: Write ALL JSON text values in English. Every string in the output must be English.",
    "vi": "CRITICAL: Write ALL JSON text values in Vietnamese (Tiếng Việt). Every string in the output must be Vietnamese.",
    "pl": "CRITICAL: Write ALL JSON text values in Polish (Polski). Every string in the output must be Polish.",
    "lt": "CRITICAL: Write ALL JSON text values in Lithuanian (Lietuvių). Every string in the output must be Lithuanian.",
    "ar": "CRITICAL: Write ALL JSON text values in Arabic (العربية). Every string in the output must be Arabic.",
    "so": (
        "CRITICAL: You MUST write ALL JSON text values in Somali (Af-Soomaali), even though the "
        "candidate's CV/profile data below is written in Norwegian. Do NOT use Norwegian anywhere "
        "in your output. Every string value must be Somali."
    ),
}

_LANG_NAMES = {
    "no": "Norwegian (Bokmål)",
    "en": "English",
    "vi": "Vietnamese (Tiếng Việt)",
    "pl": "Polish (Polski)",
    "lt": "Lithuanian (Lietuvių)",
    "ar": "Arabic (العربية)",
    "so": "Somali (Af-Soomaali)",
}

# Languages where the model tends to code-switch back to Norwegian because the
# CV source text is Norwegian and the target language is under-represented in
# training data. These get a stronger, more explicit reminder.
_LOW_RESOURCE_LANGS = {"so"}


def _reinforced_language_instruction(lang: str) -> str:
    """Extra language directive placed right before the JSON schema in the user
    prompt (in addition to the system prompt). A reminder placed immediately
    before the output instructions is far less likely to be diluted by a long,
    Norwegian-heavy CV block earlier in the prompt."""
    if lang in ("no", "en"):
        return ""
    name = _LANG_NAMES.get(lang, lang)
    if lang in _LOW_RESOURCE_LANGS:
        return (
            f"CRITICAL LANGUAGE REQUIREMENT: You MUST write ALL output text values in {name}, "
            "EVEN THOUGH the candidate data below is written in Norwegian. "
            f"Do NOT use Norwegian in any JSON text values. Every string value in your JSON response must be in {name}.\n\n"
        )
    return (
        f"IMPORTANT: Write all JSON text values in {name}, not in Norwegian, even though the source texts are in Norwegian.\n\n"
    )


def analyze_profile_cv(profile, *, language: str = "no") -> dict:
    """Analyze a profile/CV and suggest suitable job types + concrete advice."""

    lang = language if language in _LANG_RULE else "no"
    lang_rule = _LANG_RULE[lang]

    exp = getattr(profile, "experience", "")
    edu = getattr(profile, "education", "")
    skills = getattr(profile, "skills", "")
    target = getattr(profile, "target_role", "")
    langs = getattr(profile, "languages", "")

    prompt = f"""
{lang_rule}

Analyze the candidate's CV/profile and suggest realistic job types they can apply for.
Be concrete and practical, based on education, experience, and skills.

{_reinforced_language_instruction(lang)}Return ONLY valid JSON with these fields:
- summary (short profile summary)
- suggested_roles (list of 5-12 concrete job types)
- education_fit (what the candidate is qualified to do)
- strengths (list)
- gaps (list)
- improvement_tips (list of concrete actions)
- search_keywords (list of job search keywords)

Candidate:
Target role (if provided): {target}
Experience: {exp}
Education: {edu}
Skills: {skills}
Languages: {langs}

Rules:
- Do not invent education/experience.
- Do not use placeholders like [address].
- {lang_rule}
""".strip()

    client = _get_client()

    res = client.messages.create(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system=(
            f"Career coach AI. Return ONLY valid JSON. {lang_rule}\n\n"
            + SHARED_ANTI_HALLUCINATION_RULES
        ),
        messages=[{"role": "user", "content": prompt}],
        temperature=0.25,
        max_tokens=2048,
    )

    data = _parse_json(res.content[0].text)

    return {
        "summary": data.get("summary", ""),
        "suggested_roles": data.get("suggested_roles") or [],
        "education_fit": data.get("education_fit", ""),
        "strengths": data.get("strengths") or [],
        "gaps": data.get("gaps") or [],
        "improvement_tips": data.get("improvement_tips") or [],
        "search_keywords": data.get("search_keywords") or [],
    }
