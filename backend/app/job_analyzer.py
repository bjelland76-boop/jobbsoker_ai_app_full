import json
import os
import re
from datetime import datetime
from typing import Any

import requests
from bs4 import BeautifulSoup
import anthropic
from dotenv import load_dotenv

from .ai_matcher import analyze_job_match, _compress_text
from .prompt_rules import SHARED_ANTI_HALLUCINATION_RULES

load_dotenv(".env")


_CLAUDE_MODEL = "claude-haiku-4-5-20251001"


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY mangler i backend/.env")
    return anthropic.Anthropic(api_key=api_key)


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


def _parse_json_maybe(value: Any):
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if not isinstance(value, str):
        return None

    s = value.strip()
    if not s:
        return None

    try:
        return json.loads(s)
    except Exception:
        return None


def _estimate_years_experience(profile: Any) -> int | None:
    """Best-effort estimate of total years of experience.

    We only use structured experience entries (JSON list of dicts) to avoid
    guessing from random years mentioned elsewhere.
    """

    exp_raw = getattr(profile, "experience", None)
    parsed = _parse_json_maybe(exp_raw)
    if not isinstance(parsed, list):
        return None

    def _year_from_text(v: Any) -> int | None:
        s = str(v or "").strip()
        if not s:
            return None
        m = re.search(r"\b(19|20)\d{2}\b", s)
        if not m:
            return None
        try:
            return int(m.group(0))
        except Exception:
            return None

    years_from: list[int] = []
    years_to: list[int] = []

    now_year = datetime.utcnow().year

    for it in parsed:
        if not isinstance(it, dict):
            continue

        y_from = _year_from_text(it.get("from"))
        y_to = _year_from_text(it.get("to"))

        if bool(it.get("current")) and y_from:
            y_to = now_year

        if y_from and 1900 <= y_from <= now_year + 1:
            years_from.append(y_from)
        if y_to and 1900 <= y_to <= now_year + 1:
            years_to.append(y_to)

    if not years_from or not years_to:
        return None

    start = min(years_from)
    end = max(years_to)
    if end < start:
        return None

    years = end - start
    if years < 1 or years > 60:
        return None

    return years


def _extract_evidence_snippets(profile: Any, *, max_items: int = 5) -> list[str]:
    """Extract candidate-provided concrete snippets to steer the summary away from generic fluff.

    We do NOT invent facts here; we just pick short fragments that look like:
    - numbers/quantities ("30 år", "%", "1 200")
    - improvements/results ("reduserte svinn", "effektiviserte", "forbedret system")
    - logistics/warehouse/system improvements
    """

    blob = "\n".join(
        [
            str(getattr(profile, "experience", "") or ""),
            str(getattr(profile, "cv_text", "") or ""),
            str(getattr(profile, "skills", "") or ""),
            str(getattr(profile, "cv_gaps", "") or ""),
        ]
    )

    # If experience is structured JSON, include a simplified view too.
    parsed = _parse_json_maybe(getattr(profile, "experience", None))
    if isinstance(parsed, list):
        for it in parsed[:40]:
            if isinstance(it, dict):
                blob += "\n" + " ".join(
                    [
                        str(it.get("title") or ""),
                        str(it.get("company") or ""),
                        str(it.get("from") or ""),
                        str(it.get("to") or ""),
                    ]
                ).strip()

    # Split into short-ish candidate-provided fragments.
    raw_parts = re.split(r"\n+|(?<=[.!?])\s+", blob)

    keywords = [
        "svinn",
        "effektiv",
        "effektiviser",
        "forbedr",
        "optimaliser",
        "system",
        "rutine",
        "prosess",
        "logist",
        "lager",
        "innkjøp",
        "plukk",
        "pakking",
        "varemottak",
        "inventar",
        "erp",
        "sap",
        "visma",
        "microsoft dynamics",
        "power bi",
        "excel",
        "automatis",
        "lean",
        "kpi",
        "led",
        "ansvar",
    ]

    out: list[str] = []
    seen: set[str] = set()
    for part in raw_parts:
        s = " ".join(str(part or "").split()).strip("-• ")
        if not s:
            continue

        s_cf = s.casefold()
        if s_cf in seen:
            continue

        has_number = bool(re.search(r"\b\d+[\d .,/]*\b", s))
        has_kw = any(k in s_cf for k in keywords)

        if not (has_number or has_kw):
            continue

        # Keep snippets reasonably short.
        if len(s) > 220:
            s = s[:220].rstrip()

        seen.add(s_cf)
        out.append(s)
        if len(out) >= max_items:
            break

    return out


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
    match_context: dict | None = None,
    language: str = "no",
) -> dict:
    """Generate cover letter + tailored CV + email text.

    This is intentionally only called when needed (PDF/email flows), to keep the
    default /analyze-url endpoint low-cost.
    """

    style_text = _style_instructions(application_style)

    # Keep prompt inputs compact to reduce tokens.
    job_comp = _compress_text(job_text, 8000)

    # Include contact info for cover letter/email, but still keep it compact.
    years = _estimate_years_experience(profile)
    evidence = _extract_evidence_snippets(profile)

    evidence_block = "\n".join([f"- {x}" for x in evidence]) if evidence else ""

    cand_comp = _compress_text(
        "\n".join(
            [
                f"Name: {(getattr(profile, 'name', '') or '').strip()}",
                f"Email: {(getattr(profile, 'email', '') or '').strip()}",
                f"Phone: {(getattr(profile, 'phone', '') or '').strip()}",
                f"Address: {(getattr(profile, 'address', '') or '').strip()}",
                (f"Estimated total years experience: {years}" if isinstance(years, int) else ""),
                _build_cv_text_for_generation(profile),
                f"References: {(getattr(profile, 'references_json', '') or '').strip()}",
                (
                    "Evidence (candidate-provided; use these BEFORE generic claims):\n" + evidence_block
                    if evidence_block
                    else "Evidence: (none provided)"
                ),
            ]
        ),
        6000,
    )

    match_block = ""
    if match_context and isinstance(match_context, dict):
        score = match_context.get("score")
        strengths = [str(s) for s in (match_context.get("strengths") or [])[:3] if s]
        missing = [str(m) for m in (match_context.get("missing") or [])[:3] if m]
        top_reason = (match_context.get("top_reason") or "").strip()
        main_risk = (match_context.get("main_risk") or "").strip()
        lines = [
            "BAKGRUNNSINFORMASJON FOR TILPASNING (skal IKKE skrives ut i CV eller søknadsbrev):",
            "Bruk dette KUN til å vite hva som skal vektlegges. Disse dataene skal aldri vises i output.",
        ]
        if score is not None:
            lines.append(f"- Matchprosent: {int(score)}% (kun intern referanse, aldri vis i output)")
        if top_reason:
            lines.append(f"- Kandidatens sterkeste side for denne jobben: {top_reason}")
        if main_risk:
            lines.append(f"- Viktigste gap å kompensere for: {main_risk}")
        if strengths:
            lines.append("- Disse ferdighetene bør vektlegges i CV-en: " + "; ".join(strengths))
        if missing:
            lines.append("- Disse kravene mangler — tone ned eller kompenser med overførbar erfaring: " + "; ".join(missing))
        match_block = "\n".join(lines)

    use_english = (language or "no").strip().lower() == "en"

    if use_english:
        prompt = f"""
Reply ONLY with valid JSON with fields:
cover_letter, tailored_cv, email_text

Job:
Title: {job_title}
Company: {company}
Text: {job_comp}

Candidate:
{cand_comp}

{match_block + chr(10) if match_block else ""}Rules:
- Write in English (British or neutral international English).
- Do NOT invent experience or education.
- Do NOT use placeholders like [phone] or [address].
- {style_text}
- Use keywords from the job ad in the CV where the candidate genuinely has relevant experience.
- Highlight the candidate's strongest points for this role at the top of Professional Summary.
- IMPORTANT: NEVER output match score, match metadata or background analysis in the CV or cover letter. Only normal CV content is allowed in output.

{SHARED_ANTI_HALLUCINATION_RULES}

tailored_cv:
- Plain text (ATS-friendly): no markdown, no tables, no emojis.
- Do NOT include contact info in tailored_cv.
- Use ONLY information from the Candidate block. If something is missing: write neutrally, do not guess.
- Structure (section titles on their own lines, in this order):
  Professional Summary\nCore Skills\nWork Experience\nEducation\nCertifications (if available)\nLanguages\nReferences

Professional Summary (important):
- 3–5 sentences (not bullet points).
- Must read as written for a real candidate: concrete, fact-based and relevant to the role.
- Prioritise in this order when supported by Candidate data:
  1) years of experience (use "Estimated total years experience" if provided, otherwise omit years)
  2) industry/sector
  3) responsibilities (operations, customer contact, logistics, procurement, etc.)
  4) documented results / improvements (use Evidence points first)
  5) systems, process improvements, efficiency, logistics
  6) leadership / special responsibilities (if stated)
- Avoid generic phrases like "motivated", "team player", "positive attitude" unless followed by a concrete example from Candidate data.

Core Skills:
- 8–12 bullet points (•), primarily technical/concrete skills and systems.
- Soft skills only if supported by concrete examples.

Work Experience:
- Only roles found in Candidate Experience.
- For each role: 2–5 short bullet points with responsibilities/results (do not invent).
""".strip()
    else:
        prompt = f"""
Svar KUN med gyldig JSON med feltene:
cover_letter, tailored_cv, email_text

Job:
Title: {job_title}
Company: {company}
Text: {job_comp}

Candidate:
{cand_comp}

{match_block + chr(10) if match_block else ""}Regler:
- Skriv på norsk.
- Ikke finn på erfaring/utdanning.
- Ikke bruk placeholders som [telefon] eller [adresse].
- {style_text}
- Bruk nøkkelord fra stillingsannonsen i CV-en der kandidaten faktisk har relevant erfaring.
- Fremhev kandidatens sterkeste sider for denne jobben øverst i Profesjonell oppsummering.
- VIKTIG: Skriv ALDRI ut matchprosent, matchscore, analysemetadata eller bakgrunnsinformasjonen i selve CV-en eller søknadsbrevet. Kun vanlig CV-innhold er tillatt i output.

{SHARED_ANTI_HALLUCINATION_RULES}

tailored_cv:
- Ren tekst (ATS-vennlig): ingen markdown, ingen tabeller, ingen emojis.
- IKKE inkluder kontaktinfo i tailored_cv.
- Bruk KUN informasjon fra Candidate-blokken. Hvis noe ikke er oppgitt: skriv mer nøytralt, ikke gjett.
- Struktur (seksjonstitler på egne linjer, i denne rekkefølgen):
  Profesjonell oppsummering\nKjerneferdigheter\nArbeidserfaring\nUtdanning\nSertifiseringer (hvis tilgjengelig)\nSpråk\nReferanser

Profesjonell oppsummering (viktig):
- 3–5 setninger (ikke punktliste).
- Må fremstå som skrevet for en reell kandidat: konkret, faktabasert og relevant for jobben.
- Prioriter i denne rekkefølgen når det finnes grunnlag i Candidate-data:
  1) antall år erfaring (bruk "Estimated total years experience" hvis oppgitt, ellers ikke nevne årstall)
  2) bransje (hva slags bransje/område erfaringen er fra)
  3) ansvarsområder (drift, kundekontakt, logistikk/lagerstyring, innkjøp, varemottak, etc.)
  4) dokumenterte resultater / forbedringer (bruk "Evidence"-punktene først)
  5) systemforbedringer, prosessforbedringer, svinn/effektivitet, logistikk/lagerstyring
  6) ledelse/spesialansvar (hvis oppgitt)
- Unngå generiske uttrykk som "engasjert", "serviceinnstilt", "motivert", "positiv", "gode samarbeidsevner" med mindre du følger opp med et konkret eksempel fra Candidate-data.
- Hvis Candidate-data inneholder konkrete prestasjoner (tall, forbedringer, systemer), bruk disse før generiske beskrivelser.

Kjerneferdigheter:
- 8–12 punkter (•), primært faglige/konkrete ferdigheter og systemer.
- Soft skills kun hvis støttet av konkrete eksempler eller ansvar.

Arbeidserfaring:
- Kun roller som finnes i Candidate Experience.
- For hver rolle: 2–5 korte punkter med ansvar/resultater (ikke oppfinn).
""".strip()

    client = _get_client()
    res = client.messages.create(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system="Return ONLY JSON. Be concise.",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.25,
        max_tokens=2200,
    )

    raw = res.content[0].text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    data = json.loads(raw)
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

    match_model = (os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL).strip() or _CLAUDE_MODEL

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
            match_context=match,
        )
        result.update(docs)

    return result
