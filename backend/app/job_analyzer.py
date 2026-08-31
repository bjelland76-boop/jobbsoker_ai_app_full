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
from .pdfgen import _is_probably_job_title
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

    # Fallback: fetch_job_text() flattens all whitespace (including newlines
    # between separate page elements) into single spaces, so when no
    # separator matches above, the raw t[:120] can splice together the real
    # title with adjacent page noise -- application-count badges, salary
    # widgets, duplicate/bracketed accessibility text -- with no boundary
    # between them (observed on VietnamWorks: "Customer Service Associate
    # [Customer Service Associate] 0 CV Budget: $110"). Only accept it if it
    # still looks like a plausible short title; otherwise a clean "Ukjent
    # stilling" beats showing that noise verbatim.
    fallback = t[:120].strip()
    if fallback and _is_probably_job_title(fallback):
        return fallback, ""
    return "Ukjent stilling", ""


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

    lang = (language or "no").strip().lower()
    use_english = lang == "en"
    use_vietnamese = lang == "vi"

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
        elif use_vietnamese:
            lines = [
                "THÔNG TIN NỀN ĐỂ TÙY CHỈNH (KHÔNG được xuất hiện trong CV hoặc thư xin việc):",
                "Chỉ dùng thông tin này để biết nên nhấn mạnh điều gì. Không bao giờ xuất các dữ liệu này ra kết quả.",
            ]
            if score is not None:
                lines.append(f"- Điểm phù hợp: {int(score)}% (chỉ để tham khảo nội bộ, không hiển thị trong kết quả)")
            if top_reason:
                lines.append(f"- Điểm mạnh nhất của ứng viên cho vị trí này: {top_reason}")
            if main_risk:
                lines.append(f"- Điểm thiếu sót quan trọng nhất cần bù đắp: {main_risk}")
            if strengths:
                lines.append("- Những kỹ năng này nên được nhấn mạnh trong CV: " + "; ".join(strengths))
            if missing:
                lines.append("- Những yêu cầu này còn thiếu — giảm nhẹ hoặc bù đắp bằng kinh nghiệm có thể chuyển đổi: " + "; ".join(missing))
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
- Translate ALL text to English, including job titles, education titles, and descriptions. Keep proper nouns and company names in their original form unless they have a widely recognized English equivalent.
- Do NOT invent experience or education.
- Do NOT use placeholders like [phone] or [address].
- {style_text}
- Use keywords from the job ad in the CV where the candidate genuinely has relevant experience.
- Highlight the candidate's strongest points for this role in the Key Qualifications section (see instructions below).
- IMPORTANT: NEVER output match score, match metadata or background analysis in the CV or cover letter. Only normal CV content is allowed in output.

{SHARED_ANTI_HALLUCINATION_RULES_EN}

cover_letter:
- Write in English (British or neutral international English).
- 3–4 paragraphs. No bullet points.
- Structure the letter in three explicit parts:
  1) Why THIS job specifically: must reference something concrete from the job ad text itself (a task, a requirement, a phrase from the ad) — not a generic "I am writing to apply" opener.
  2) Why the candidate fits: 2–3 concrete examples from the candidate's experience that match the actual tasks/requirements in the ad.
  3) Personal motivation / what the candidate brings: short and genuine — no cliché adjectives (see anti-cliché rules below).
- Do NOT include contact details or date in the cover letter text.

tailored_cv:
- Plain text (ATS-friendly): no markdown, no tables, no emojis.
- Do NOT include contact info in tailored_cv.
- Use ONLY information from the Candidate block. If something is missing: write neutrally, do not guess.
- Structure (section titles on their own lines, in this order):
  Key Qualifications\nProfessional Summary\nCore Skills\nWork Experience\nEducation\nCertifications (if available)\nLanguages\nReferences

Key Qualifications (important, comes FIRST in the CV, before Professional Summary):
- 3–4 short, scannable bullet points (•), not full sentences.
- Must cover: core competence, one differentiator that sets the candidate apart from other applicants, and a hint at working style.
- Identify 3–5 keywords/phrases the employer itself uses in the job ad (Job: Text above), and use them verbatim or near-verbatim wherever they genuinely match the candidate's background.
- Build on the candidate's strongest point and any strengths noted in the background information above (strongest point / skills to emphasise) — turn them into concrete CV bullets, not analysis text.
- Do not repeat the same content verbatim from Professional Summary.

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
- Anti-cliché rule (applies to Key Qualifications, Professional Summary AND the cover letter above): avoid these words/phrases unless immediately followed by a concrete example from Candidate data — "motivated", "team player", "hardworking", "passionate", "detail-oriented", "results-driven", "self-starter", "dynamic", "proactive", "excellent communication skills", "go-getter", "quick learner". A bare adjective with no evidence is not allowed.

Core Skills:
- 8–12 bullet points (•), primarily technical/concrete skills and systems.
- Soft skills only if supported by concrete examples.
- Translate every skill into English (e.g. "journalføring" → "clinical documentation", "regnskapsføring" → "bookkeeping"). Never leave a Norwegian word or phrase in the skills list.

Work Experience:
- Only roles found in Candidate Experience.
- Translate Norwegian job titles into their natural English equivalent (e.g. "Butikkmedarbeider" → "Retail Assistant", "Daglig leder" → "General Manager"). Never leave a job title untranslated.
- Company names: keep well-known brand/company names as-is (e.g. "Rema 1000", "Equinor"). Translate generic public-sector or descriptive employer names into English (e.g. "Kristiansand kommune" → "Municipality of Kristiansand").
- For each role: 2–5 short bullet points (do not invent). Distinguish clearly between:
  1) Task — what the role actually involved (duties, scope, systems used).
  2) Result — what was concretely achieved (numbers, improvement, scale, efficiency gain).
  At least 1–2 bullet points per role must prioritise a Result where the candidate data actually supports one; do not fabricate a result if none is documented — in that case, write a task-focused bullet instead.

Education:
- Only institutions found in Candidate Education.
- Translate degree/programme titles into English (e.g. "Bachelor i sykepleie" → "Bachelor's Degree in Nursing").
- Institution names: translate consistently into English (e.g. "Universitetet i Agder" → "University of Agder", "Norges Handelshøyskole" → "Norwegian School of Economics"). Keep the institution's own official English name if it is commonly used; otherwise translate the Norwegian name directly rather than leaving it untranslated.
- For periods: use the EXACT year values from the data (e.g. "2022–2025").
- If STATUS is PÅGÅENDE: write the period as e.g. "2023– (In Progress)". If STATUS is FULLFØRT: write ONLY the years (e.g. "2022–2025"), never add "In Progress" or similar.

Languages:
- List each language as "Language (Level)" e.g. "Norwegian (Native)", "English (Fluent)".
- Use the level exactly as given in the Candidate data (translated to English if writing in English).

cover_letter:
- NEVER mention language level (e.g. do not write "fluent in English", "native Norwegian speaker") — omit language proficiency entirely.
""".strip()
    elif use_vietnamese:
        _anti_halluc_vi = """
CHỐNG BỊA ĐẶT / SỰ THẬT:
- KHÔNG được bịa đặt hoặc thêm bất kỳ sự thật mới nào về ứng viên.
- KHÔNG được bịa đặt kinh nghiệm, nhà tuyển dụng, vai trò, trách nhiệm, học vấn, khóa học, chứng chỉ,
  bằng lái xe, chứng chỉ vận hành xe nâng, chứng chỉ vận hành máy móc, giấy phép hành nghề hoặc bằng cấp khác.
- CHỈ sử dụng thông tin thực sự có trong: hồ sơ ứng viên, CV, mô tả công việc hoặc phân tích công việc.
- Dịch chức danh/tên bằng cấp sang ngôn ngữ đích là BẮT BUỘC và KHÔNG bị coi là thay đổi sự thật.
  Luôn dịch chức danh công việc và bằng cấp sang tiếng Việt (ví dụ: "Butikkmedarbeider" → "Nhân viên bán hàng"); đây là dịch thuật, không phải bịa đặt.

PHÂN BIỆT RÕ RÀNG (khi mô tả trình độ chuyên môn):
- Kinh nghiệm/trình độ đã ghi nhận: được nêu rõ trong nguồn dữ liệu.
- Kinh nghiệm có thể chuyển đổi: có thể liên quan, nhưng phải gắn với những gì ứng viên thực sự đã làm (không thêm sự thật mới).
- Thiếu / chưa ghi nhận: nếu không có trong nguồn dữ liệu, hãy nêu rõ là chưa được ghi nhận.

NẾU THIẾU THÔNG TIN TRONG NGUỒN DỮ LIỆU:
- Nếu một trình độ (ví dụ chứng chỉ vận hành xe nâng hoặc bằng lái xe hạng B) không được nhắc đến:
  hãy nêu rõ là chưa được ghi nhận, và có thể gợi ý cách ứng viên trả lời trung thực.

ĐƯỢC PHÉP:
- Bạn có thể đề xuất cách diễn đạt làm rõ hơn kinh nghiệm hiện có (có thật).
- Bạn có thể đề xuất câu hỏi làm rõ ("Bạn có bằng lái xe không?", "Bạn có chứng chỉ vận hành xe nâng không?").

NGHIÊM CẤM:
- Không được viết hoặc ngụ ý rằng ứng viên có một trình độ mà bạn không có bằng chứng.
""".strip()
        prompt = f"""
Trả lời CHỈ bằng JSON hợp lệ với các trường:
cover_letter, tailored_cv, email_text

Job:
Title: {job_title}
Company: {company}
Text: {job_comp}

Candidate:
{cand_comp}

{match_block + chr(10) if match_block else ""}Quy tắc:
- QUAN TRỌNG NHẤT: Dù tin tuyển dụng (mô tả công việc) hay dữ liệu hồ sơ của ứng viên được viết bằng ngôn ngữ nào (tiếng Anh, tiếng Na Uy, hay ngôn ngữ khác), TOÀN BỘ nội dung đầu ra PHẢI được viết bằng tiếng Việt. Dịch mọi thứ sang tiếng Việt — không được để sót bất kỳ từ, cụm từ hay câu nào bằng ngôn ngữ khác trong kết quả.
- Không được bịa đặt kinh nghiệm/học vấn.
- Không sử dụng các placeholder như [điện thoại] hoặc [địa chỉ].
- {style_text}
- Sử dụng từ khóa từ tin tuyển dụng trong CV ở những nơi ứng viên thực sự có kinh nghiệm liên quan.
- Nêu bật những điểm mạnh nhất của ứng viên cho vị trí này trong phần NĂNG LỰC NỔI BẬT (xem hướng dẫn bên dưới).
- QUAN TRỌNG: KHÔNG BAO GIỜ xuất ra điểm phù hợp (match score), siêu dữ liệu phân tích hoặc thông tin nền trong CV hay thư xin việc. Chỉ nội dung CV thông thường mới được phép xuất hiện.
- KHÔNG đưa thông tin cá nhân (ngày sinh, chiều cao, tình trạng hôn nhân, giới tính, quốc tịch, nghĩa vụ quân sự) vào tailored_cv — những thông tin này đã được hiển thị riêng ở phần đầu CV, không được lặp lại trong nội dung.

{_anti_halluc_vi}

cover_letter:
- Viết bằng tiếng Việt, văn phong chuyên nghiệp và tự nhiên như người bản xứ viết — không phải văn phong dịch máy.
- 3–4 đoạn văn. Không dùng gạch đầu dòng.
- Cấu trúc thư theo ba phần rõ ràng:
  1) Tại sao lại là công việc NÀY: phải nhắc đến điều gì đó cụ thể từ chính nội dung tin tuyển dụng (một nhiệm vụ, một yêu cầu, một cụm từ trong tin) — không mở đầu chung chung kiểu "Tôi viết đơn này để ứng tuyển".
  2) Tại sao ứng viên phù hợp: 2–3 ví dụ cụ thể từ kinh nghiệm của ứng viên khớp với các nhiệm vụ/yêu cầu thực tế trong tin tuyển dụng.
  3) Động lực cá nhân / điều ứng viên mang lại: ngắn gọn, chân thật — không dùng tính từ sáo rỗng (xem quy tắc chống sáo rỗng bên dưới).
- KHÔNG đưa thông tin liên hệ hoặc ngày tháng vào nội dung thư xin việc.

tailored_cv:
- Văn bản thuần (thân thiện với hệ thống ATS): không dùng markdown, không dùng bảng, không dùng emoji.
- KHÔNG đưa thông tin liên hệ vào tailored_cv.
- Chỉ sử dụng thông tin từ khối Candidate. Nếu thiếu thông tin: viết trung lập, không phỏng đoán.
- Cấu trúc (tiêu đề từng mục trên dòng riêng, theo đúng thứ tự này):
  NĂNG LỰC NỔI BẬT\nTÓM TẮT BẢN THÂN\nKỸ NĂNG CHUYÊN MÔN\nKINH NGHIỆM LÀM VIỆC\nHỌC VẤN\nCHỨNG CHỈ (nếu có)\nNGOẠI NGỮ\nNGƯỜI THAM CHIẾU

NĂNG LỰC NỔI BẬT (quan trọng, đặt ĐẦU TIÊN trong CV, trước TÓM TẮT BẢN THÂN):
- 3–4 gạch đầu dòng (•) ngắn gọn, dễ đọc lướt, không viết thành câu đầy đủ.
- Phải bao gồm: năng lực cốt lõi, một điểm khác biệt giúp ứng viên nổi bật so với ứng viên khác, và một gợi ý về phong cách làm việc.
- Xác định 3–5 từ khóa/cụm từ mà chính nhà tuyển dụng sử dụng trong tin tuyển dụng (phần Job: Text ở trên), và sử dụng lại các từ khóa đó (nguyên văn hoặc gần giống) ở những chỗ thực sự phù hợp với kinh nghiệm của ứng viên.
- Dựa trên điểm mạnh nhất của ứng viên và các điểm mạnh được nêu trong thông tin nền ở trên — chuyển chúng thành các gạch đầu dòng CV cụ thể, không viết dạng phân tích.
- Không lặp lại nguyên văn nội dung đã có trong TÓM TẮT BẢN THÂN.

TÓM TẮT BẢN THÂN (quan trọng):
- 3–5 câu (không viết dạng gạch đầu dòng).
- Phải đọc như được viết cho một ứng viên có thật: cụ thể, dựa trên sự thật và liên quan đến công việc.
- Ưu tiên theo thứ tự sau, khi có đủ dữ liệu trong Candidate:
  1) số năm kinh nghiệm (dùng "Estimated total years experience" nếu có, nếu không thì bỏ qua số năm)
  2) ngành nghề/lĩnh vực
  3) trách nhiệm công việc (vận hành, chăm sóc khách hàng, hậu cần, thu mua, v.v.)
  4) kết quả/cải tiến đã được ghi nhận (ưu tiên dùng các điểm trong "Evidence")
  5) cải tiến hệ thống, quy trình, hiệu quả, hậu cần
  6) lãnh đạo/trách nhiệm đặc biệt (nếu có nêu)
- Quy tắc chống sáo rỗng (áp dụng cho NĂNG LỰC NỔI BẬT, TÓM TẮT BẢN THÂN VÀ thư xin việc ở trên): tránh các từ/cụm từ sau trừ khi đi kèm ngay ví dụ cụ thể từ dữ liệu Candidate — "nhiệt tình", "chăm chỉ", "cầu tiến", "có trách nhiệm cao", "năng động", "hòa đồng", "sáng tạo", "làm việc nhóm tốt", "chịu được áp lực cao", "tinh thần học hỏi cao", "nhiệt huyết", "tận tâm". Một tính từ trần trụi không có bằng chứng đi kèm là không được phép.

KỸ NĂNG CHUYÊN MÔN:
- 8–12 gạch đầu dòng (•), chủ yếu là kỹ năng/hệ thống chuyên môn cụ thể.
- Kỹ năng mềm chỉ khi có ví dụ cụ thể đi kèm.
- Dịch mọi kỹ năng sang tiếng Việt (ví dụ: "journalføring" → "ghi chép hồ sơ lâm sàng", "regnskapsføring" → "kế toán sổ sách"). Không được để sót bất kỳ từ tiếng Na Uy hay tiếng Anh nào trong danh sách kỹ năng.

KINH NGHIỆM LÀM VIỆC:
- Chỉ những vị trí có trong Candidate Experience.
- Dịch chức danh công việc sang tiếng Việt tự nhiên (ví dụ: "Butikkmedarbeider" → "Nhân viên bán hàng", "Daglig leder" → "Giám đốc điều hành"). Không được để sót chức danh chưa dịch.
- Tên công ty: giữ nguyên tên thương hiệu/công ty nổi tiếng (ví dụ: "Rema 1000", "Equinor"). Dịch tên nhà tuyển dụng khu vực công/mô tả chung sang tiếng Việt (ví dụ: "Kristiansand kommune" → "Chính quyền thành phố Kristiansand").
- Với mỗi vị trí: 2–5 gạch đầu dòng ngắn gọn (không bịa đặt). Phân biệt rõ ràng giữa:
  1) Nhiệm vụ — công việc thực tế bao gồm những gì (trách nhiệm, phạm vi, hệ thống sử dụng).
  2) Kết quả — điều đã đạt được cụ thể (con số, cải tiến, quy mô, hiệu quả).
  Ít nhất 1–2 gạch đầu dòng mỗi vị trí phải ưu tiên Kết quả khi dữ liệu ứng viên thực sự có căn cứ; không bịa ra kết quả nếu không có tài liệu — trong trường hợp đó, viết một gạch đầu dòng về nhiệm vụ thay thế.

HỌC VẤN:
- Chỉ những cơ sở đào tạo có trong Candidate Education.
- Dịch tên bằng cấp/chương trình học sang tiếng Việt (ví dụ: "Bachelor i sykepleie" → "Cử nhân Điều dưỡng").
- Tên cơ sở đào tạo: dịch nhất quán sang tiếng Việt (ví dụ: "Universitetet i Agder" → "Đại học Agder"). Giữ tên tiếng Anh chính thức của cơ sở nếu đó là tên thường dùng; nếu không, dịch trực tiếp tên tiếng Na Uy thay vì để nguyên chưa dịch.
- Với thời gian học: dùng CHÍNH XÁC các năm trong dữ liệu (ví dụ: "2022–2025").
- Nếu STATUS là PÅGÅENDE: viết thời gian dạng ví dụ "2023– (đang học)". Nếu STATUS là FULLFØRT: chỉ viết các năm (ví dụ: "2022–2025"), không thêm "đang học" hay tương tự.

NGOẠI NGỮ:
- Liệt kê mỗi ngôn ngữ theo dạng "Tên ngôn ngữ (Trình độ)", ví dụ "Tiếng Na Uy (Bản ngữ)", "Tiếng Anh (Thành thạo)".
- Sử dụng đúng trình độ như trong dữ liệu Candidate (dịch sang tiếng Việt).

cover_letter:
- KHÔNG BAO GIỜ đề cập đến trình độ ngôn ngữ (ví dụ không viết "thành thạo tiếng Anh", "tiếng mẹ đẻ là tiếng Na Uy") — bỏ qua hoàn toàn phần trình độ ngôn ngữ.
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
- Fremhev kandidatens sterkeste sider for denne jobben i Nøkkelkvalifikasjoner-seksjonen (se instruks under).
- VIKTIG: Skriv ALDRI ut matchprosent, matchscore, analysemetadata eller bakgrunnsinformasjonen i selve CV-en eller søknadsbrevet. Kun vanlig CV-innhold er tillatt i output.

{SHARED_ANTI_HALLUCINATION_RULES}

cover_letter:
- Skriv på norsk, profesjonell og naturlig tone — ikke maskinoversatt stil.
- 3–4 avsnitt. Ingen punktlister.
- Strukturer brevet i tre tydelige deler:
  1) Hvorfor akkurat DENNE jobben: må referere noe konkret fra selve annonseteksten (en arbeidsoppgave, et krav, en formulering fra annonsen) — ikke en generisk åpning som "Jeg søker herved stillingen".
  2) Hvorfor kandidaten passer: 2–3 konkrete eksempler fra kandidatens erfaring som matcher de faktiske oppgavene/kravene i annonsen.
  3) Personlig motivasjon / hva kandidaten tilfører: kort og ekte — ikke klisjé-adjektiver (se anti-klisjé-regler under).
- IKKE inkluder kontaktinfo eller dato i søknadsbrevteksten.

tailored_cv:
- Ren tekst (ATS-vennlig): ingen markdown, ingen tabeller, ingen emojis.
- IKKE inkluder kontaktinfo i tailored_cv.
- Bruk KUN informasjon fra Candidate-blokken. Hvis noe ikke er oppgitt: skriv mer nøytralt, ikke gjett.
- Struktur (seksjonstitler på egne linjer, i denne rekkefølgen):
  Nøkkelkvalifikasjoner\nProfesjonell oppsummering\nKjerneferdigheter\nArbeidserfaring\nUtdanning\nSertifiseringer (hvis tilgjengelig)\nSpråk\nReferanser

Nøkkelkvalifikasjoner (viktig, kommer FØRST i CV-en, før Profesjonell oppsummering):
- 3–4 korte, skannbare punkter (•), ikke fulle setninger.
- Skal dekke: kjernekompetanse, én ting som skiller kandidaten fra andre søkere, og en antydning om arbeidsstil.
- Identifiser 3–5 nøkkelord/fraser som arbeidsgiveren selv bruker i stillingsannonsen (Job: Text over), og bruk disse ordrett eller nær ordrett der de faktisk stemmer med kandidatens bakgrunn.
- Bygg videre på kandidatens sterkeste side og eventuelle styrker nevnt i bakgrunnsinformasjonen over (sterkeste side / ferdigheter som bør vektlegges) — skriv dem om til konkrete CV-punkter, ikke som analysetekst.
- Ikke gjenta ordrett det samme innholdet som i Profesjonell oppsummering.

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
- Anti-klisjé-regel (gjelder Profesjonell oppsummering, Nøkkelkvalifikasjoner OG søknadsbrevet over): unngå disse ordene/frasene med mindre de umiddelbart følges av et konkret eksempel fra Candidate-data — "engasjert", "serviceinnstilt", "motivert", "positiv", "gode samarbeidsevner", "strukturert", "løsningsorientert", "fleksibel", "ansvarsfull", "nøyaktig", "initiativrik", "utadvendt", "lærevillig", "resultatorientert", "høy arbeidsmoral". Et bart adjektiv uten belegg er ikke tillatt.
- Hvis Candidate-data inneholder konkrete prestasjoner (tall, forbedringer, systemer), bruk disse før generiske beskrivelser.

Kjerneferdigheter:
- 8–12 punkter (•), primært faglige/konkrete ferdigheter og systemer.
- Soft skills kun hvis støttet av konkrete eksempler eller ansvar.

Arbeidserfaring:
- Kun roller som finnes i Candidate Experience.
- For hver rolle: 2–5 korte punkter (ikke oppfinn). Skill tydelig mellom:
  1) Oppgave — hva stillingen faktisk innebar (ansvar, omfang, systemer brukt).
  2) Resultat — hva som konkret ble oppnådd (tall, forbedring, omfang, effektivisering).
  Minst 1–2 punkter per rolle skal prioritere Resultat der kandidatdata faktisk støtter det; ikke finn på et resultat hvis det ikke er dokumentert — skriv da et oppgavefokusert punkt i stedet.

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
        # Raised from 2200: the Key Qualifications section (Del 1) and the
        # task/result work-experience split (Del 2) add real output length,
        # and Vietnamese needs noticeably more tokens per word than en/no.
        # At 2200 this truncated mid-JSON-string for vi (JSONDecodeError),
        # returning a 500 to the client.
        max_tokens=3500,
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
_MARKERS_VI = ("###THU_XIN_VIEC", "###CV", "###EMAIL")


def _parse_marker_output(text: str, language: str) -> dict[str, str]:
    markers = {"en": _MARKERS_EN, "vi": _MARKERS_VI}.get(language, _MARKERS_NO)
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

    lang = (language or "no").strip().lower()
    use_english = lang == "en"
    use_vietnamese = lang == "vi"
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
        elif use_vietnamese:
            mb = ["THÔNG TIN NỀN (KHÔNG được xuất hiện trong CV hoặc thư xin việc):"]
            if score is not None:
                mb.append(f"- Điểm phù hợp: {int(score)}% (chỉ để tham khảo nội bộ)")
            if top_reason:
                mb.append(f"- Điểm mạnh nhất cho vị trí này: {top_reason}")
            if main_risk:
                mb.append(f"- Điểm thiếu sót cần bù đắp: {main_risk}")
            if strengths:
                mb.append("- Nhấn mạnh: " + "; ".join(strengths))
            if missing:
                mb.append("- Giảm nhẹ/bù đắp: " + "; ".join(missing))
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

    m1, m2, m3 = {"en": _MARKERS_EN, "vi": _MARKERS_VI}.get(lang, _MARKERS_NO)

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
- Translate ALL text to English, including job titles, education titles, and descriptions. Keep proper nouns and company names in their original form unless they have a widely recognized English equivalent.
- Do NOT invent experience or education.
- Do NOT use placeholders like [phone] or [address].
- {style_text}
- Use keywords from the job ad in the CV where the candidate genuinely has relevant experience.
- NEVER output match score, match metadata or background analysis in the CV or cover letter.
- Anti-cliché rule (applies to Key Qualifications, Professional Summary AND the cover letter): avoid these words/phrases unless immediately followed by a concrete example from Candidate data — "motivated", "team player", "hardworking", "passionate", "detail-oriented", "results-driven", "self-starter", "dynamic", "proactive", "excellent communication skills", "go-getter", "quick learner". A bare adjective with no evidence is not allowed.

{SHARED_ANTI_HALLUCINATION_RULES_EN}

{m1}: 3–4 paragraphs, no bullet points. Three explicit parts: 1) why THIS job specifically — reference something concrete from the job ad text itself; 2) why the candidate fits — 2–3 concrete examples matching the ad's actual tasks/requirements; 3) personal motivation/what the candidate brings — short, genuine, no cliché adjectives. No contact details or date.
{m2}: Plain text (ATS-friendly), no markdown, no tables. Sections in order: Key Qualifications / Professional Summary / Core Skills / Work Experience / Education / Languages / References. Key Qualifications: 3–4 short bullets (•) — core competence, one differentiator, a work-style hint; identify 3–5 keywords/phrases the employer uses in the job ad and use them where genuinely accurate; draw on the candidate's strongest point/strengths from the background info above; do not repeat Professional Summary verbatim. Professional Summary: 3–5 concrete sentences. Core Skills: 8–12 bullets (•); translate every skill into English (e.g. "journalføring" → "clinical documentation") — never leave a Norwegian word in the skills list. Work Experience: only actual roles from Candidate data, 2–5 bullets each, distinguishing Task (what the role involved) from Result (concrete numbers/improvement/scale achieved) — at least 1–2 bullets per role must prioritise a Result where the data supports one, otherwise write a task-focused bullet instead; translate Norwegian job titles into their natural English equivalent (e.g. "Butikkmedarbeider" → "Retail Assistant") — never leave a job title untranslated; keep well-known brand/company names as-is but translate generic public-sector employer names (e.g. "Kristiansand kommune" → "Municipality of Kristiansand"). Education: translate degree/programme titles into English (e.g. "Bachelor i sykepleie" → "Bachelor's Degree in Nursing"); translate institution names consistently into English (e.g. "Universitetet i Agder" → "University of Agder"), using the institution's own official English name where commonly used; periods use EXACT year values from data; if STATUS is PÅGÅENDE write e.g. "2023– (In Progress)"; if STATUS is FULLFØRT write only the years (e.g. "2022–2025"). Languages: format as "Language (Level)" e.g. "Norwegian (Native)".
{m3}: 3–4 sentences, polite, reference the role and company. NEVER mention language level or language proficiency in the cover letter.""".strip()
    elif use_vietnamese:
        _anti_halluc_vi = """
CHỐNG BỊA ĐẶT / SỰ THẬT:
- KHÔNG được bịa đặt hoặc thêm bất kỳ sự thật mới nào về ứng viên.
- KHÔNG được bịa đặt kinh nghiệm, nhà tuyển dụng, vai trò, trách nhiệm, học vấn, khóa học, chứng chỉ,
  bằng lái xe, chứng chỉ vận hành xe nâng, chứng chỉ vận hành máy móc, giấy phép hành nghề hoặc bằng cấp khác.
- CHỈ sử dụng thông tin thực sự có trong: hồ sơ ứng viên, CV, mô tả công việc hoặc phân tích công việc.
- Dịch chức danh/tên bằng cấp sang ngôn ngữ đích là BẮT BUỘC và KHÔNG bị coi là thay đổi sự thật.

PHÂN BIỆT RÕ RÀNG (khi mô tả trình độ chuyên môn):
- Kinh nghiệm/trình độ đã ghi nhận: được nêu rõ trong nguồn dữ liệu.
- Kinh nghiệm có thể chuyển đổi: có thể liên quan, nhưng phải gắn với những gì ứng viên thực sự đã làm.
- Thiếu / chưa ghi nhận: nếu không có trong nguồn dữ liệu, hãy nêu rõ là chưa được ghi nhận.

NGHIÊM CẤM:
- Không được viết hoặc ngụ ý rằng ứng viên có một trình độ mà bạn không có bằng chứng.
""".strip()
        prompt = f"""Xuất ra CHÍNH XÁC ba mục sau đây với tiêu đề tương ứng, không có nội dung nào khác:

{m1}
[thư xin việc ở đây]

{m2}
[CV đã tùy chỉnh ở đây]

{m3}
[email ngắn ở đây]

Job:
Title: {job_title}
Company: {company}
Text: {job_comp}

Candidate:
{cand_comp}

{match_block + chr(10) if match_block else ""}Quy tắc:
- QUAN TRỌNG NHẤT: Dù tin tuyển dụng hay dữ liệu hồ sơ ứng viên được viết bằng ngôn ngữ nào (tiếng Anh, tiếng Na Uy, hay ngôn ngữ khác), TOÀN BỘ nội dung đầu ra PHẢI được viết bằng tiếng Việt. Dịch mọi thứ sang tiếng Việt — không được để sót từ, cụm từ hay câu nào bằng ngôn ngữ khác.
- Không được bịa đặt kinh nghiệm/học vấn.
- Không sử dụng placeholder như [điện thoại] hoặc [địa chỉ].
- {style_text}
- Sử dụng từ khóa từ tin tuyển dụng trong CV ở những nơi ứng viên thực sự có kinh nghiệm liên quan.
- KHÔNG BAO GIỜ xuất ra điểm phù hợp, siêu dữ liệu phân tích hoặc thông tin nền trong CV hay thư xin việc.
- KHÔNG đưa thông tin cá nhân (ngày sinh, chiều cao, tình trạng hôn nhân, giới tính, quốc tịch, nghĩa vụ quân sự) vào phần CV — những thông tin này đã được hiển thị riêng ở phần đầu CV.
- Quy tắc chống sáo rỗng (áp dụng cho NĂNG LỰC NỔI BẬT, TÓM TẮT BẢN THÂN VÀ thư xin việc): tránh các từ/cụm từ sau trừ khi đi kèm ngay ví dụ cụ thể từ dữ liệu Candidate — "nhiệt tình", "chăm chỉ", "cầu tiến", "có trách nhiệm cao", "năng động", "hòa đồng", "sáng tạo", "làm việc nhóm tốt", "chịu được áp lực cao", "tinh thần học hỏi cao", "nhiệt huyết", "tận tâm". Một tính từ trần trụi không có bằng chứng đi kèm là không được phép.

{_anti_halluc_vi}

{m1}: {style_text} Không dùng gạch đầu dòng. Ba phần rõ ràng: 1) tại sao lại là công việc NÀY — nhắc đến điều cụ thể từ chính tin tuyển dụng; 2) tại sao ứng viên phù hợp — 2–3 ví dụ cụ thể khớp với nhiệm vụ/yêu cầu thực tế trong tin; 3) động lực cá nhân/điều ứng viên mang lại — ngắn gọn, chân thật, không dùng tính từ sáo rỗng. Không có thông tin liên hệ hoặc ngày tháng.
{m2}: Văn bản thuần (thân thiện với ATS), không markdown, không bảng. Các mục theo thứ tự: NĂNG LỰC NỔI BẬT / TÓM TẮT BẢN THÂN / KỸ NĂNG CHUYÊN MÔN / KINH NGHIỆM LÀM VIỆC / HỌC VẤN / NGOẠI NGỮ / NGƯỜI THAM CHIẾU. NĂNG LỰC NỔI BẬT: 3–4 gạch đầu dòng (•) ngắn gọn — năng lực cốt lõi, một điểm khác biệt, một gợi ý về phong cách làm việc; xác định 3–5 từ khóa/cụm từ nhà tuyển dụng dùng trong tin tuyển dụng và sử dụng chúng khi thực sự phù hợp; dựa trên điểm mạnh nhất/thế mạnh của ứng viên từ thông tin nền ở trên; không lặp lại nguyên văn TÓM TẮT BẢN THÂN. TÓM TẮT BẢN THÂN: 3–5 câu cụ thể. KỸ NĂNG CHUYÊN MÔN: 8–12 gạch đầu dòng (•); dịch mọi kỹ năng sang tiếng Việt (ví dụ "journalføring" → "ghi chép hồ sơ lâm sàng") — không để sót từ tiếng Na Uy hay tiếng Anh nào. KINH NGHIỆM LÀM VIỆC: chỉ những vị trí có thật trong dữ liệu Candidate, 2–5 gạch đầu dòng mỗi vị trí, phân biệt Nhiệm vụ (công việc bao gồm những gì) và Kết quả (con số/cải tiến/quy mô cụ thể đạt được) — ít nhất 1–2 gạch đầu dòng mỗi vị trí phải ưu tiên Kết quả khi dữ liệu có căn cứ, nếu không thì viết gạch đầu dòng về nhiệm vụ thay thế; dịch chức danh sang tiếng Việt tự nhiên (ví dụ "Butikkmedarbeider" → "Nhân viên bán hàng") — không để sót chức danh chưa dịch; giữ nguyên tên thương hiệu/công ty nổi tiếng nhưng dịch tên nhà tuyển dụng khu vực công chung chung (ví dụ "Kristiansand kommune" → "Chính quyền thành phố Kristiansand"). HỌC VẤN: dịch tên bằng cấp/chương trình sang tiếng Việt (ví dụ "Bachelor i sykepleie" → "Cử nhân Điều dưỡng"); dịch tên cơ sở đào tạo nhất quán sang tiếng Việt (ví dụ "Universitetet i Agder" → "Đại học Agder"); dùng CHÍNH XÁC các năm trong dữ liệu; nếu STATUS là PÅGÅENDE viết ví dụ "2023– (đang học)"; nếu STATUS là FULLFØRT chỉ viết các năm (ví dụ "2022–2025"). NGOẠI NGỮ: định dạng "Tên ngôn ngữ (Trình độ)" ví dụ "Tiếng Na Uy (Bản ngữ)".
{m3}: 3–4 câu, lịch sự, nhắc đến vị trí và công ty. KHÔNG BAO GIỜ đề cập đến trình độ ngôn ngữ trong thư xin việc.""".strip()
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
- Anti-klisjé-regel (gjelder Nøkkelkvalifikasjoner, Profesjonell oppsummering OG søknadsbrevet): unngå disse ordene/frasene med mindre de umiddelbart følges av et konkret eksempel fra Candidate-data — "engasjert", "serviceinnstilt", "motivert", "positiv", "gode samarbeidsevner", "strukturert", "løsningsorientert", "fleksibel", "ansvarsfull", "nøyaktig", "initiativrik", "utadvendt", "lærevillig", "resultatorientert", "høy arbeidsmoral". Et bart adjektiv uten belegg er ikke tillatt.

{SHARED_ANTI_HALLUCINATION_RULES}

{m1}: {style_text} Ingen punktlister. Tre tydelige deler: 1) hvorfor akkurat DENNE jobben — referer noe konkret fra selve annonseteksten; 2) hvorfor kandidaten passer — 2–3 konkrete eksempler som matcher annonsens faktiske oppgaver/krav; 3) personlig motivasjon/hva kandidaten tilfører — kort, ekte, ikke klisjé-adjektiver. Ingen kontaktinfo eller dato.
{m2}: Ren tekst (ATS-vennlig), ingen markdown, ingen tabeller. Seksjoner i rekkefølge: Nøkkelkvalifikasjoner / Profesjonell oppsummering / Kjerneferdigheter / Arbeidserfaring / Utdanning / Språk / Referanser. Nøkkelkvalifikasjoner: 3–4 korte punkter (•) — kjernekompetanse, én differensiator, en antydning om arbeidsstil; identifiser 3–5 nøkkelord/fraser arbeidsgiveren bruker i annonsen og bruk dem der de faktisk stemmer; bygg på kandidatens sterkeste side/styrker fra bakgrunnsinfoen over; ikke gjenta Profesjonell oppsummering ordrett. Profesjonell oppsummering: 3–5 konkrete setninger. Kjerneferdigheter: 8–12 punkter (•). Arbeidserfaring: kun roller fra Candidate-data, 2–5 punkter hver, skill mellom Oppgave (hva stillingen innebar) og Resultat (konkrete tall/forbedring/omfang oppnådd) — minst 1–2 punkter per rolle skal prioritere Resultat der data støtter det, ellers skriv et oppgavefokusert punkt. Utdanningsperioder: bruk NØYAKTIGE årstall fra dataen; hvis STATUS er PÅGÅENDE skriv f.eks. "2023– (pågående)"; hvis STATUS er FULLFØRT skriv kun årstallene (f.eks. "2022–2025"). Språk: skriv som "Språknavn (Nivå)" f.eks. "Norsk (Morsmål)".
{m3}: 3–4 setninger, høflig, referer til stilling og bedrift. Nevn ALDRI språknivå i søknadsbrevet.""".strip()

    client = _get_client()
    full_text = ""

    with client.messages.stream(
        model=os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL,
        system=(
            "You are a professional job application assistant. Output only the requested sections."
            if use_english
            else "Bạn là trợ lý viết hồ sơ xin việc chuyên nghiệp. Chỉ viết các mục được yêu cầu, bằng tiếng Việt."
            if use_vietnamese
            else "Du er en profesjonell jobbsøknad-assistent. Skriv kun de forespurte seksjonene."
        ),
        messages=[{"role": "user", "content": prompt}],
        # Raised from 2500 for the same reason as generate_application_texts()'s
        # max_tokens: Del 1/2/3 add real output length, and Vietnamese needs
        # more tokens per word than en/no.
        max_tokens=3500,
        temperature=0.25,
    ) as stream:
        for text_chunk in stream.text_stream:
            full_text += text_chunk
            yield ("chunk", text_chunk)

    yield ("done", _parse_marker_output(full_text, lang))


def analyze_job_url(
    profile: Any,
    url: str,
    application_style: str = "vanlig",
    *,
    generate_documents: bool = False,
    language: str = "no",
    job_text_override: str | None = None,
) -> dict:
    """Analyze a job ad, either by fetching `url` or using pasted text directly.

    Default behavior is low-token matching only. Full document generation is
    optional and can be enabled by the caller.

    `job_text_override`: when given (non-empty), used as the job ad content
    as-is instead of fetching/scraping `url` — lets callers support pasting
    a job ad's text directly for postings that have no stable URL.

    NOTE: We include an internal field "__job_text" for persistence, which the
    API layer should pop before returning/saving analysis JSON.
    """

    job_text = (job_text_override or "").strip() or fetch_job_text(url)
    cv_text = _build_cv_text_for_match(profile)

    match = analyze_job_match(job_text, cv_text, language=language)
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
