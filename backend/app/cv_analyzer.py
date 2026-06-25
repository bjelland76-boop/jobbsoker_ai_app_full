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


_LANG_INSTRUCTIONS = {
    "no": ("Du er en ærlig norsk karrierecoach.", "Skriv på norsk."),
    "en": ("You are an honest career coach.", "Write in English."),
    "vi": ("Bạn là một huấn luyện viên nghề nghiệp trung thực.", "Viết bằng tiếng Việt."),
}


def analyze_profile_cv(profile, *, language: str = "no") -> dict:
    """Analyze a profile/CV and suggest suitable job types + concrete advice."""

    lang = language if language in _LANG_INSTRUCTIONS else "no"
    system_intro, lang_rule = _LANG_INSTRUCTIONS[lang]

    exp = getattr(profile, "experience", "")
    edu = getattr(profile, "education", "")
    skills = getattr(profile, "skills", "")
    target = getattr(profile, "target_role", "")
    langs = getattr(profile, "languages", "")

    prompt = f"""
{system_intro}

Analyser kandidatens CV/profil og foreslå hvilke typer jobber kandidaten realistisk kan søke på.
Vær konkret og praktisk, og ta utgangspunkt i utdanning, erfaring og ferdigheter.

Svar KUN som gyldig JSON med feltene:
- summary (kort oppsummering av profilen)
- suggested_roles (liste med 5-12 konkrete stillingstyper)
- education_fit (hva kandidaten er utdannet til / kvalifisert til å gjøre)
- strengths (liste)
- gaps (liste)
- improvement_tips (liste med konkrete tiltak)
- search_keywords (liste med søkeord til jobbsøk)

Kandidat:
Ønsket rolle (hvis oppgitt): {target}
Erfaring: {exp}
Utdanning: {edu}
Ferdigheter: {skills}
Språk: {langs}

Regler:
- Ikke finn på utdanning/erfaring.
- Ikke bruk placeholders som [adresse].
- {lang_rule}
""".strip()

    client = _get_client()

    res = client.messages.create(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system=(
            f"{system_intro} Svar kun med gyldig JSON.\n\n"
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
