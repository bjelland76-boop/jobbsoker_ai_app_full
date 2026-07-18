import json
import os
import re

import anthropic
from dotenv import load_dotenv

from .prompt_rules import SHARED_ANTI_HALLUCINATION_RULES

load_dotenv(".env")

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY mangler i backend/.env")
    return anthropic.Anthropic(api_key=api_key)


def _parse_json(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return json.loads(raw)


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
