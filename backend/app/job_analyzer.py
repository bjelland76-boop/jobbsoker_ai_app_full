import json
import os
import re
from datetime import datetime
from typing import Any

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI

from .ai_matcher import analyze_job_match, _compress_text

load_dotenv(".env")


def _get_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY mangler i backend/.env")
    return OpenAI(api_key=api_key)


def fetch_job_text(url: str) -> str:
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
        return "Kort søknad: 1 avsnitt, ca. 4–8 setninger."

    if style == "profesjonell":
        return "Profesjonell søknad: 4–6 korte avsnitt, mer formell og detaljert."

    return "Vanlig søknad: 2–3 avsnitt, naturlig norsk stil."


def _build_cv_text_for_match(profile: Any) -> str:
    # Strictly keep skills/titles/responsibilities-ish fields for token reduction.
    parts: list[str] = []

    target_role = (getattr(profile, "target_role", "") or "").strip()
    if target_role:
        parts.append(f"Target role: {target_role}")

    skills = (getattr(profile, "skills", "") or "").strip()
    if skills:
        parts.append(f"Skills: {skills}")

    exp = (getattr(profile, "experience", "") or "").strip()
    if exp:
        parts.append(f"Experience: {exp}")

    cv_free = (getattr(profile, "cv_text", "") or "").strip()
    if cv_free:
        parts.append(f"CV: {cv_free}")

    return "\n".join(parts)


def _build_cv_text_for_generation(profile: Any) -> str:
    parts: list[str] = []

    for label, attr in [
        ("Target role", "target_role"),
        ("Skills", "skills"),
        ("Experience", "experience"),
        ("Education", "education"),
        ("Languages", "languages"),
        ("CV gaps", "cv_gaps"),
        ("CV", "cv_text"),
    ]:
        v = (getattr(profile, attr, "") or "").strip()
        if v:
            parts.append(f"{label}: {v}")

    return "\n".join(parts)


def _guess_job_title_company(job_text: str) -> tuple[str, str]:
    t = _compress_text(job_text, 800)

    # Common patterns: "Title - Company", "Title | Company", etc.
    for sep in [" - ", " | ", " – ", " — "]:
        if sep in t:
            left, right = t.split(sep, 1)
            title = left.strip()[:120]
            company = right.strip()[:120]
            if len(title) >= 3:
                return title, company

    # Norwegian: "... hos Company"
    m = re.search(r"(.{3,80}?)\s+hos\s+([A-ZÆØÅ][\wÆØÅæøå .&-]{2,80})", t)
    if m:
        return (m.group(1).strip()[:120], m.group(2).strip()[:120])

    # Fallbacks
    return (t[:120].strip() or "Ukjent stilling"), ""


def generate_application_texts(
    profile: Any,
    *,
    job_title: str,
    company: str,
    job_text: str,
    application_style: str = "vanlig",
) -> dict:
    """Generate cover letter + tailored CV + email text.

    This is intentionally only called when needed (PDF/email flows), to keep the
    default /analyze-url endpoint low-cost.
    """

    style_text = _style_instructions(application_style)

    # Keep prompt inputs compact to reduce tokens.
    job_comp = _compress_text(job_text, 8000)

    # Include contact info for cover letter/email, but still keep it compact.
    cand_comp = _compress_text(
        "\n".join(
            [
                f"Name: {(getattr(profile, 'name', '') or '').strip()}",
                f"Email: {(getattr(profile, 'email', '') or '').strip()}",
                f"Phone: {(getattr(profile, 'phone', '') or '').strip()}",
                f"Address: {(getattr(profile, 'address', '') or '').strip()}",
                _build_cv_text_for_generation(profile),
                f"References: {(getattr(profile, 'references_json', '') or '').strip()}",
            ]
        ),
        6000,
    )

    prompt = f"""
Svar KUN med gyldig JSON med feltene:
cover_letter, tailored_cv, email_text

Job:
Title: {job_title}
Company: {company}
Text: {job_comp}

Candidate:
{cand_comp}

Regler:
- Skriv på norsk.
- Ikke finn på erfaring/utdanning.
- Ikke bruk placeholders som [telefon] eller [adresse].
- {style_text}

tailored_cv:
- Ren tekst (ATS-vennlig): ingen markdown, ingen tabeller, ingen emojis.
- IKKE inkluder kontaktinfo i tailored_cv.
- Struktur (seksjonstitler på egne linjer):
  Profesjonell oppsummering\nKjerneferdigheter\nArbeidserfaring\nUtdanning\nSertifiseringer (hvis tilgjengelig)\nSpråk\nReferanser
""".strip()

    client = _get_client()
    res = client.chat.completions.create(
        model=os.getenv("OPENAI_GEN_MODEL") or "gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Return ONLY JSON. Be concise."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.25,
        max_tokens=2200,
        response_format={"type": "json_object"},
    )

    data = json.loads(res.choices[0].message.content)
    return {
        "cover_letter": data.get("cover_letter", ""),
        "tailored_cv": data.get("tailored_cv", ""),
        "email_text": data.get("email_text", ""),
    }


def analyze_job_url(
    profile: Any,
    url: str,
    application_style: str = "vanlig",
    *,
    generate_documents: bool = False,
) -> dict:
    """Analyze a job ad URL.

    Default behavior is low-token matching only. Full document generation is
    optional and can be enabled by the caller.

    NOTE: We include an internal field "__job_text" for persistence, which the
    API layer should pop before returning/saving analysis JSON.
    """

    job_text = fetch_job_text(url)
    cv_text = _build_cv_text_for_match(profile)

    match = analyze_job_match(job_text, cv_text)
    job_title, company = _guess_job_title_company(job_text)

    allowed_styles = {"kort", "vanlig", "profesjonell"}
    style_norm = (application_style or "vanlig").strip().lower()
    if style_norm not in allowed_styles:
        style_norm = "vanlig"

    missing = match.get("missing") or []
    strengths = match.get("strengths") or []

    top_reason = (match.get("top_reason") or "").strip()
    main_risk = (match.get("main_risk") or "").strip()

    why_score: list[str] = []
    for s in [top_reason, *strengths]:
        s2 = (str(s or "").strip() or "")
        if s2 and s2 not in why_score:
            why_score.append(s2)
        if len(why_score) >= 3:
            break

    score_risks: list[str] = []
    for s in [main_risk, *missing]:
        s2 = (str(s or "").strip() or "")
        if s2 and s2 not in score_risks:
            score_risks.append(s2)
        if len(score_risks) >= 3:
            break

    match_model = (os.getenv("OPENAI_MATCH_MODEL") or "gpt-4o-mini").strip() or "gpt-4o-mini"

    result: dict[str, Any] = {
        # Phase 5: lightweight analytics fields (stored in analysis_json).
        "analysis_version": 2,
        "match_model": match_model,
        "analysis_timestamp": datetime.utcnow().isoformat() + "Z",

        "job_title": job_title,
        "company": company,
        "match_score": float(match.get("score", 0)),
        "interview_probability": int(match.get("interview_probability", 0) or 0),
        "seniority_match": int(match.get("seniority_match", 0) or 0),
        "top_reason": top_reason,
        "main_risk": main_risk,
        "recruiter_explanation": {
            "why_score": why_score,
            "score_risks": score_risks,
        },
        "honest_assessment": (match.get("fit") or "").strip(),
        "strengths": strengths,
        "weaknesses": [],
        "missing_requirements": missing,
        # Phase 1: pass through from the single matcher call.
        "recommended_cv_changes": match.get("recommended_cv_changes") or [],
        "should_apply": bool(int(match.get("score", 0)) >= 60),
        "improvement_tips": [x for x in [(match.get("advice") or "").strip()] if x],
        "recommended_application_style": style_norm,
        "recommended_style_reason": "Bruker-valgt stil.",
        "__job_text": _compress_text(job_text, 3000),
    }

    if generate_documents:
        docs = generate_application_texts(
            profile,
            job_title=job_title,
            company=company,
            job_text=job_text,
            application_style=style_norm,
        )
        result.update(docs)

    return result
