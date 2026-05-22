import json
import os

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(".env")


def _get_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY mangler i backend/.env")
    return OpenAI(api_key=api_key)

def fetch_job_text(url: str):
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    text = " ".join(soup.get_text("\n").split())
    return text[:12000]

def _style_instructions(application_style: str) -> str:
    style = (application_style or "").strip().lower()

    if style == "kort":
        return (
            "Søknadstype: KORT. "
            "Søknaden skal være kort og rett på sak: 1 avsnitt, ca. 4–8 setninger. "
            "Ca. 600–1200 tegn. "
            "Ingen overskrifter eller fylltekst."
        )

    if style == "profesjonell":
        return (
            "Søknadstype: PROFESJONELL. "
            "Søknaden skal være mer formell og detaljert: 4–6 avsnitt (korte avsnitt). "
            "Ca. 3000–5000 tegn. "
            "Struktur: innledning, relevant erfaring, dokumentert kompetanse, motivasjon, hvorfor deg/oss, avslutning."
        )

    # default
    return (
        "Søknadstype: VANLIG. "
        "Søknaden skal være i normal, menneskelig norsk stil: 2–3 avsnitt, ca. 10–18 setninger. "
        "Ca. 1500–2800 tegn."
    )


def analyze_job_url(profile, url: str, application_style: str = "vanlig"):
    job_text = fetch_job_text(url)

    style_text = _style_instructions(application_style)

    prompt = f"""
Du er en ærlig norsk karrierecoach.

Analyser jobbannonsen opp mot kandidaten.
Svar KUN som gyldig JSON med disse feltene:

job_title
company
match_score
honest_assessment
strengths
weaknesses
missing_requirements
should_apply
improvement_tips

recommended_application_style
recommended_style_reason

cover_letter
tailored_cv
email_text

Kandidat:
Navn: {profile.name}
Adresse (hvis oppgitt): {getattr(profile, 'address', '')}
E-post: {profile.email}
Telefon: {profile.phone}
Erfaring: {profile.experience}
Utdanning: {profile.education}
Ferdigheter: {profile.skills}

Jobbannonse:
{job_text}

Regler:
- Vær ærlig, men hjelpsom
- Ikke finn på erfaring
- Ikke si høy match hvis kravene ikke passer
- Skriv på norsk
- match_score skal være 0-100
- strengths, weaknesses, missing_requirements og improvement_tips skal være lister
- recommended_application_style må være en av: kort | vanlig | profesjonell
- recommended_style_reason skal være en kort forklaring (1–3 setninger)
- Ikke bruk placeholders som [telefon] eller [adresse]

{style_text}

I JSON-feltene:
- recommended_application_style: velg den stilen som passer BEST for denne jobben og kandidaten (realistisk og effektivt)
  - kort: når kandidaten har noe relevant men lite å vinne på lang tekst, eller når jobben er enkel/operativ
  - vanlig: standardvalg for de fleste jobber
  - profesjonell: når jobben er senior/konkurransepreget og kandidaten har relevant erfaring/utdanning å dokumentere
- cover_letter skal følge søknadstypen over
- tailored_cv skal være tilpasset stillingen og passe til søknadstypen (kortere ved KORT)
- I tailored_cv: Ta med kontaktinfo øverst (navn, adresse hvis oppgitt, e-post, telefon)
- email_text skal være en kort e-posttekst som passer til søknadstypen
"""

    client = _get_client()

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Du er en ærlig, praktisk og realistisk karrierecoach."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.25,
        response_format={"type": "json_object"}
    )

    return json.loads(res.choices[0].message.content)
