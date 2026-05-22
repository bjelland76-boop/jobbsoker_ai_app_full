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


def generate_application(profile, job):
    prompt = f"""
Svar KUN som gyldig JSON med disse feltene:
email_text, cover_letter, tailored_cv, match_reason

Skriv på norsk.

Kandidat:
Navn: {profile.name}
Erfaring: {profile.experience}
Ferdigheter: {profile.skills}
Språk: {profile.languages}
Hull i CV: {profile.cv_gaps}

Jobb:
Stilling: {job.title}
Bedrift: {job.company}
Beskrivelse: {job.description}

Regler:
- Ikke bruk placeholders som [telefon] eller [adresse]
- Ikke finn på erfaring
- Skriv naturlig og troverdig
- Søknaden skal være normal norsk stil
- CV skal være mer profesjonell med tydelige seksjoner (Kontaktinfo, Erfaring, Utdanning, Ferdigheter, Språk)
- Bruk overskrifter og punktlister i CV
"""

    client = _get_client()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Du lager norske jobbsøknader og svarer kun med gyldig JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.35,
        response_format={"type": "json_object"}
    )

    data = json.loads(response.choices[0].message.content)

    return {
        "email_text": data.get("email_text", ""),
        "cover_letter": data.get("cover_letter", ""),
        "tailored_cv": data.get("tailored_cv", ""),
    }
