import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(".env")


def _get_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY mangler i backend/.env")
    return OpenAI(api_key=api_key)


def analyze_profile_cv(profile) -> dict:
    """Analyze a profile/CV and suggest suitable job types + concrete advice.

    This is meant to be *job-market guidance*, not a job-ad analysis.
    """

    # Build a relatively compact but information-dense candidate summary.
    exp = getattr(profile, "experience", "")
    edu = getattr(profile, "education", "")
    skills = getattr(profile, "skills", "")
    target = getattr(profile, "target_role", "")
    langs = getattr(profile, "languages", "")

    prompt = f"""
Du er en ærlig norsk karrierecoach.

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
- Skriv på norsk.
""".strip()

    client = _get_client()

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Du er en ærlig norsk karrierecoach og svarer kun med gyldig JSON."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.25,
        response_format={"type": "json_object"},
    )

    data = json.loads(res.choices[0].message.content)

    # Normalize output to expected fields.
    return {
        "summary": data.get("summary", ""),
        "suggested_roles": data.get("suggested_roles") or [],
        "education_fit": data.get("education_fit", ""),
        "strengths": data.get("strengths") or [],
        "gaps": data.get("gaps") or [],
        "improvement_tips": data.get("improvement_tips") or [],
        "search_keywords": data.get("search_keywords") or [],
    }
