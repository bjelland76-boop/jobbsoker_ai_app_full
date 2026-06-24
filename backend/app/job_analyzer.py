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
from .prompt_rules import SHARED_ANTI_HALLUCINATION_RULES, SHARED_ANTI_HALLUCINATION_RULES_EN

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


def _completed_edu_degree_names(profile: Any) -> list[str]:
    """Return lowercase degree names for all FULLFØRT education entries."""
    try:
        items = json.loads(getattr(profile, "education", "") or "[]")
    except Exception:
        return []
    if not isinstance(items, list):
        return []
    names: list[str] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        status = str(it.get("status") or "fullfort").strip().lower()
        if status != "pagaende":
            degree = str(it.get("degree") or "").strip().lower()
            school = str(it.get("school") or "").strip().lower()
            if degree:
                names.append(degree)
            if school:
                names.append(school)
    return names


def _filter_completed_edu_from_match(match: dict, completed_names: list[str]) -> dict:
    """Remove match fields that incorrectly suggest completing FULLFØRT education."""
    if not completed_names:
        return match

    def _mentions_completed(text: str) -> bool:
        t = text.lower()
        return any(name in t for name in completed_names)

    def _filter_list(items: list) -> list:
        return [x for x in (items or []) if not _mentions_completed(str(x))]

    result = dict(match)
    result["recommended_cv_changes"] = _filter_list(result.get("recommended_cv_changes") or [])
    result["missing"] = _filter_list(result.get("missing") or [])
    # Clear main_risk if it singles out completed education
    if _mentions_completed(str(result.get("main_risk") or "")):
        result["main_risk"] = ""
    return result


def _format_education_for_prompt(edu_raw: Any) -> str:
    """Format education JSON into readable text with explicit STATUS for LLM context."""
    if not edu_raw:
        return ""
    try:
        items = json.loads(edu_raw) if isinstance(edu_raw, str) else edu_raw
    except Exception:
        return str(edu_raw)
    if not isinstance(items, list):
        return str(items)
    lines = []
    for it in items:
        if isinstance(it, str):
            lines.append(it)
            continue
        if not isinstance(it, dict):
            continue
        degree = str(it.get("degree") or "").strip()
        school = str(it.get("school") or "").strip()
        _from = str(it.get("from") or "").strip()
        _to = str(it.get("to") or "").strip()
        status = str(it.get("status") or "fullfort").strip().lower()
        parts = [x for x in [degree, school] if x]
        period = "–".join([x for x in [_from, _to] if x])
        if period:
            parts.append(period)
        parts.append("STATUS: " + ("PÅGÅENDE" if status == "pagaende" else "FULLFØRT"))
        lines.append(", ".join(parts))
    return "; ".join(lines)


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

    edu_formatted = _format_education_for_prompt(getattr(profile, "education", "") or "")
    if edu_formatted:
        parts.append(f"Education: {edu_formatted}")

    lang_raw = (getattr(profile, "languages", "") or "").strip()
    if lang_raw:
        try:
            lang_list = json.loads(lang_raw)
            if isinstance(lang_list, list):
                lang_raw = ", ".join(str(l) for l in lang_list if l)
        except Exception:
            pass
        if lang_raw:
            parts.append(f"Languages: {lang_raw}")

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
        ("Languages", "languages"),
        ("CV gaps", "cv_gaps"),
        ("CV", "cv_text"),
    ]:
        v = (getattr(profile, attr, "") or "").strip()
        if v:
            parts.append(f"{label}: {v}")

    # Education formatted with explicit STATUS to prevent misinterpretation
    edu_formatted = _format_education_for_prompt(getattr(profile, "education", "") or "")
    if edu_formatted:
        # Insert after Experience (before Languages)
        lang_idx = next((i for i, p in enumerate(parts) if p.startswith("Languages:")), len(parts))
        parts.insert(lang_idx, f"Education: {edu_formatted}")

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
    document_context: str = "",
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
                (
                    "Additional documents (certificates, transcripts, etc.):\n" + document_context
                    if document_context.strip()
                    else ""
                ),
            ]
        ),
        6000,
    )

    use_english = (language or "no").strip().lower() == "en"

    match_block = ""
    if match_context and isinstance(match_context, dict):
        score = match_context.get("score")
        strengths = [str(s) for s in (match_context.get("strengths") or [])[:3] if s]
        missing = [str(m) for m in (match_context.get("missing") or [])[:3] if m]
        top_reason = (match_context.get("top_reason") or "").strip()
        main_risk = (match_context.get("main_risk") or "").strip()
        if use_english:
            lines = [
                "BACKGROUND FOR TAILORING (MUST NOT appear in CV or cover letter):",
                "Use this ONLY to know what to emphasise. Never output these data in the result.",
            ]
            if score is not None:
                lines.append(f"- Match score: {int(score)}% (internal reference only, never show in output)")
            if top_reason:
                lines.append(f"- Candidate's strongest point for this role: {top_reason}")
            if main_risk:
                lines.append(f"- Most important gap to compensate for: {main_risk}")
            if strengths:
                lines.append("- These skills should be emphasised in the CV: " + "; ".join(strengths))
            if missing:
                lines.append("- These requirements are missing — downplay or compensate with transferable experience: " + "; ".join(missing))
        else:
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

{SHARED_ANTI_HALLUCINATION_RULES_EN}

cover_letter:
- Write in English (British or neutral international English).
- 3–4 paragraphs. No bullet points.
- Opening: mention the role and company by name, state why the candidate is a strong fit.
- Body: highlight 2–3 concrete strengths from the candidate's experience relevant to the role.
- Closing: express interest in an interview, polite and professional tone.
- Do NOT include contact details or date in the cover letter text.

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

Education:
- Only institutions found in Candidate Education.
- For periods: use the EXACT year values from the data (e.g. "2022–2025").
- If STATUS is PÅGÅENDE: write the period as e.g. "2023– (In Progress)". If STATUS is FULLFØRT: write ONLY the years (e.g. "2022–2025"), never add "In Progress" or similar.

Languages:
- List each language as "Language (Level)" e.g. "Norwegian (Native)", "English (Fluent)".
- Use the level exactly as given in the Candidate data (translated to English if writing in English).

cover_letter:
- NEVER mention language level (e.g. do not write "fluent in English", "native Norwegian speaker") — omit language proficiency entirely.
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

Utdanning:
- Kun institusjoner som finnes i Candidate Education.
- For perioder: bruk de NØYAKTIGE årstallene fra dataen (f.eks. "2022–2025").
- Hvis STATUS er PÅGÅENDE: skriv perioden som f.eks. "2023– (pågående)". Hvis STATUS er FULLFØRT: skriv KUN årstallene (f.eks. "2022–2025"), legg ALDRI til "pågående" eller lignende.

Språk:
- Skriv hvert språk som "Språknavn (Nivå)" f.eks. "Norsk (Morsmål)", "Engelsk (Flytende)".
- Bruk nivået nøyaktig slik det er oppgitt i Candidate-dataen.

cover_letter:
- Nevn ALDRI språknivå i søknadsbrevet — verken direkte ("flytende norsk") eller indirekte ("morsmål er norsk"). Utelat språkferdigheter fullstendig fra søknadsteksten.
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
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data, _ = json.JSONDecoder().raw_decode(raw.lstrip())
    return {
        "cover_letter": data.get("cover_letter", ""),
        "tailored_cv": data.get("tailored_cv", ""),
        "email_text": data.get("email_text", ""),
    }


_MARKERS_NO = ("###SØKNADSBREV", "###CV", "###EPOST")
_MARKERS_EN = ("###COVER_LETTER", "###TAILORED_CV", "###EMAIL")


def _parse_marker_output(text: str, use_english: bool) -> dict[str, str]:
    markers = _MARKERS_EN if use_english else _MARKERS_NO
    fields = ("cover_letter", "tailored_cv", "email_text")
    result: dict[str, str] = {f: "" for f in fields}
    positions = [text.find(m) for m in markers]
    for i, (marker, field) in enumerate(zip(markers, fields)):
        if positions[i] < 0:
            continue
        start = positions[i] + len(marker)
        end = len(text)
        for j in range(i + 1, len(markers)):
            if positions[j] > positions[i]:
                end = positions[j]
                break
        result[field] = text[start:end].strip()
    return result


def stream_application_texts(
    profile: Any,
    *,
    job_title: str,
    company: str,
    job_text: str,
    application_style: str = "vanlig",
    match_context: dict | None = None,
    language: str = "no",
    document_context: str = "",
):
    """Generator: yields ("chunk", str) for each streaming chunk from Claude,
    then ("done", dict) with cover_letter / tailored_cv / email_text."""

    use_english = (language or "no").strip().lower() == "en"
    style_text = _style_instructions(application_style)
    job_comp = _compress_text(job_text, 8000)
    years = _estimate_years_experience(profile)
    evidence = _extract_evidence_snippets(profile)
    evidence_block = "\n".join([f"- {x}" for x in evidence]) if evidence else ""

    cand_comp = _compress_text(
        "\n".join([
            f"Name: {(getattr(profile, 'name', '') or '').strip()}",
            f"Email: {(getattr(profile, 'email', '') or '').strip()}",
            f"Phone: {(getattr(profile, 'phone', '') or '').strip()}",
            f"Address: {(getattr(profile, 'address', '') or '').strip()}",
            (f"Estimated total years experience: {years}" if isinstance(years, int) else ""),
            _build_cv_text_for_generation(profile),
            f"References: {(getattr(profile, 'references_json', '') or '').strip()}",
            (
                "Evidence (candidate-provided):\n" + evidence_block
                if evidence_block
                else "Evidence: (none provided)"
            ),
            (
                "Additional documents:\n" + document_context
                if document_context.strip()
                else ""
            ),
        ]),
        6000,
    )

    match_block = ""
    if match_context and isinstance(match_context, dict):
        score = match_context.get("score")
        strengths = [str(s) for s in (match_context.get("strengths") or [])[:3] if s]
        missing = [str(m) for m in (match_context.get("missing") or [])[:3] if m]
        top_reason = (match_context.get("top_reason") or "").strip()
        main_risk = (match_context.get("main_risk") or "").strip()
        if use_english:
            mb = ["BACKGROUND FOR TAILORING (never output this in CV or cover letter):"]
            if score is not None:
                mb.append(f"- Match score: {int(score)}% (internal only)")
            if top_reason:
                mb.append(f"- Strongest point for this role: {top_reason}")
            if main_risk:
                mb.append(f"- Gap to compensate for: {main_risk}")
            if strengths:
                mb.append("- Emphasise: " + "; ".join(strengths))
            if missing:
                mb.append("- Downplay/compensate: " + "; ".join(missing))
        else:
            mb = ["BAKGRUNNSINFORMASJON (skal IKKE skrives ut i CV eller søknadsbrev):"]
            if score is not None:
                mb.append(f"- Matchprosent: {int(score)}% (kun intern referanse)")
            if top_reason:
                mb.append(f"- Sterkeste side for denne jobben: {top_reason}")
            if main_risk:
                mb.append(f"- Gap å kompensere for: {main_risk}")
            if strengths:
                mb.append("- Vektlegg: " + "; ".join(strengths))
            if missing:
                mb.append("- Tone ned/kompenser: " + "; ".join(missing))
        match_block = "\n".join(mb)

    m1, m2, m3 = (_MARKERS_EN if use_english else _MARKERS_NO)

    if use_english:
        prompt = f"""Output EXACTLY these three sections with their headers and NO other text:

{m1}
[cover letter here]

{m2}
[tailored CV here]

{m3}
[short email here]

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
- NEVER output match score, match metadata or background analysis in the CV or cover letter.

{SHARED_ANTI_HALLUCINATION_RULES_EN}

{m1}: 3–4 paragraphs, no bullet points. Mention role and company by name. No contact details or date.
{m2}: Plain text (ATS-friendly), no markdown, no tables. Sections in order: Professional Summary / Core Skills / Work Experience / Education / Languages / References. Professional Summary: 3–5 concrete sentences. Core Skills: 8–12 bullets (•). Work Experience: only actual roles from Candidate data, 2–5 bullets each. Education periods: use EXACT year values from data; if STATUS is PÅGÅENDE write e.g. "2023– (In Progress)"; if STATUS is FULLFØRT write only the years (e.g. "2022–2025"). Languages: format as "Language (Level)" e.g. "Norwegian (Native)".
{m3}: 3–4 sentences, polite, reference the role and company. NEVER mention language level or language proficiency in the cover letter.""".strip()
    else:
        prompt = f"""Svar med NØYAKTIG disse tre seksjonene med overskrifter, ingenting annet:

{m1}
[søknadsbrev her]

{m2}
[tilpasset CV her]

{m3}
[kort e-post her]

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
- ALDRI skriv ut matchprosent, analysemetadata eller bakgrunnsinformasjon i CV eller søknadsbrev.

{SHARED_ANTI_HALLUCINATION_RULES}

{m1}: {style_text} Ingen punktlister. Nevn stilling og bedrift med navn. Ingen kontaktinfo eller dato.
{m2}: Ren tekst (ATS-vennlig), ingen markdown, ingen tabeller. Seksjoner i rekkefølge: Profesjonell oppsummering / Kjerneferdigheter / Arbeidserfaring / Utdanning / Språk / Referanser. Profesjonell oppsummering: 3–5 konkrete setninger. Kjerneferdigheter: 8–12 punkter (•). Arbeidserfaring: kun roller fra Candidate-data, 2–5 punkter hver. Utdanningsperioder: bruk NØYAKTIGE årstall fra dataen; hvis STATUS er PÅGÅENDE skriv f.eks. "2023– (pågående)"; hvis STATUS er FULLFØRT skriv kun årstallene (f.eks. "2022–2025"). Språk: skriv som "Språknavn (Nivå)" f.eks. "Norsk (Morsmål)".
{m3}: 3–4 setninger, høflig, referer til stilling og bedrift. Nevn ALDRI språknivå i søknadsbrevet.""".strip()

    client = _get_client()
    full_text = ""

    with client.messages.stream(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system=(
            "You are a professional job application assistant. Output only the requested sections."
            if use_english
            else "Du er en profesjonell jobbsøknad-assistent. Skriv kun de forespurte seksjonene."
        ),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2500,
        temperature=0.25,
    ) as stream:
        for text_chunk in stream.text_stream:
            full_text += text_chunk
            yield ("chunk", text_chunk)

    yield ("done", _parse_marker_output(full_text, use_english))


def analyze_job_url(
    profile: Any,
    url: str,
    application_style: str = "vanlig",
    *,
    generate_documents: bool = False,
    language: str = "no",
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
    match = _filter_completed_edu_from_match(match, _completed_edu_degree_names(profile))
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
            language=language,
        )
        result.update(docs)

    return result
