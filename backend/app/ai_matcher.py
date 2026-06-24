import hashlib
import json
import logging
import os
import re
import traceback
from collections import OrderedDict
from threading import Lock
from typing import Any, List, Optional, TypedDict

import anthropic
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

from .prompt_rules import SHARED_ANTI_HALLUCINATION_RULES

load_dotenv(".env")


class MatchResult(TypedDict):
    score: int
    fit: str
    strengths: List[str]
    missing: List[str]
    advice: str

    # Phase 1: small, concrete CV improvements derived from missing requirements.
    recommended_cv_changes: List[str]

    interview_probability: int
    seniority_match: int
    top_reason: str
    main_risk: str
    cv_mal: str  # "kreativ" | "profesjonell" | "klassisk"


def _compress_text(text: str, max_len: int = 2500) -> str:
    # IMPORTANT: keep this helper exact/compatible for token reduction.
    text = " ".join((text or "").split())
    return text[:max_len]


def _normalize_for_cache(text: str) -> str:
    """Normalize text for cache hashing (not for prompt).

    Goal: improve cache hit rate when job pages change slightly (timestamps,
    cookie banners, etc.) without increasing prompt size.
    """

    t = " ".join((text or "").split())
    if not t:
        return ""

    # Strip common timestamp formats.
    t = re.sub(
        r"\b\d{4}[-/.]\d{2}[-/.]\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?\b",
        " ",
        t,
        flags=re.IGNORECASE,
    )

    # Strip common "updated/published" labels (keep it conservative).
    t = re.sub(
        r"\b(?:sist\s+oppdatert|oppdatert|publisert|posted|last\s+updated|updated)\b\s*[:\-]?\s*",
        " ",
        t,
        flags=re.IGNORECASE,
    )

    # Strip common page boilerplate tokens (cookie/privacy/terms). Keep short.
    t = re.sub(
        r"\b(?:cookies?|cookieinnstillinger|cookie\s+settings|personvern|privacy\s+policy|vilk\w*|terms)\b",
        " ",
        t,
        flags=re.IGNORECASE,
    )

    # Strip copyright footer patterns.
    t = re.sub(r"(?:©|copyright)\s*\d{4}(?:\s*[-–]\s*\d{4})?", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\ball\s+rights\s+reserved\b", " ", t, flags=re.IGNORECASE)

    # Re-collapse whitespace.
    return " ".join(t.split()).strip()


def _extract_relevant(text: str) -> str:
    """Best-effort relevance filter for token reduction.

    Keeps mostly skill/requirements/responsibility-like sentences + a short head.
    """

    t = " ".join((text or "").split())
    if len(t) <= 900:
        return t

    head = t[:450]

    keywords = [
        # en
        "skills",
        "requirements",
        "qualifications",
        "responsibil",
        "duties",
        "tasks",
        "education",
        "status",
        # no
        "krav",
        "kvalifik",
        "kompetanse",
        "ferdighet",
        "erfaring",
        "ansvar",
        "arbeidsoppgaver",
        "oppgaver",
        "utdanning",
        "fullført",
        "pågående",
    ]

    # Split on sentence-ish boundaries and common bullet separators.
    chunks = re.split(r"(?<=[.!?])\s+|\s+[•\-–—]\s+", t)

    kept: list[str] = []
    seen: set[str] = set()
    for ch in chunks:
        s = ch.strip()
        if not s:
            continue

        s_norm = s.casefold()
        if any(k in s_norm for k in keywords):
            if s_norm in seen:
                continue
            seen.add(s_norm)
            kept.append(s)

        if len(" ".join(kept)) > 6000:
            break

    if not kept:
        return head

    return (head + " " + " ".join(kept)).strip()


_CLAUDE_MODEL = "claude-haiku-4-5-20251001"


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY mangler i backend/.env")
    return anthropic.Anthropic(api_key=api_key)


def _clamp_0_100(v: Any) -> int:
    try:
        n = int(v)
    except Exception:
        n = 0
    return max(0, min(100, n))


def _short_text(v: Any, max_chars: int = 160) -> str:
    s = " ".join(str(v or "").split())
    if len(s) > max_chars:
        s = s[:max_chars].rstrip()
    return s


def _normalize_list(v: Any, *, max_items: int = 3, max_item_chars: int = 60) -> list[str]:
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for it in v:
        s = _short_text(it, max_item_chars).strip("-• ").strip()
        if not s:
            continue
        if s in out:
            continue
        out.append(s)
        if len(out) >= max_items:
            break
    return out


def _normalize_result(data: Any) -> MatchResult:
    # Output contract: always return these fields, no extras.
    _CV_MAL_VALID = {"kreativ", "profesjonell", "klassisk"}

    out: MatchResult = {
        "score": 0,
        "fit": "",
        "strengths": [],
        "missing": [],
        "advice": "",
        "recommended_cv_changes": [],
        "interview_probability": 0,
        "seniority_match": 0,
        "top_reason": "",
        "main_risk": "",
        "cv_mal": "profesjonell",
    }

    if not isinstance(data, dict):
        return out

    out["score"] = _clamp_0_100(data.get("score"))
    out["interview_probability"] = _clamp_0_100(data.get("interview_probability"))
    out["seniority_match"] = _clamp_0_100(data.get("seniority_match"))

    # Phase 2: stabilize interview_probability relative to score.
    s = int(out["score"] or 0)
    ip = int(out["interview_probability"] or 0)
    ip = max(s - 20, min(s + 10, ip))
    out["interview_probability"] = _clamp_0_100(ip)

    out["fit"] = _short_text(data.get("fit"), 180)
    out["top_reason"] = _short_text(data.get("top_reason"), 160)
    out["main_risk"] = _short_text(data.get("main_risk"), 160)
    out["advice"] = _short_text(data.get("advice"), 180)

    out["strengths"] = _normalize_list(data.get("strengths"), max_items=3)
    out["missing"] = _normalize_list(data.get("missing"), max_items=3)
    out["recommended_cv_changes"] = _normalize_list(
        data.get("recommended_cv_changes"),
        max_items=3,
        max_item_chars=120,
    )

    cv_mal_raw = str(data.get("cv_mal") or "").strip().lower()
    out["cv_mal"] = cv_mal_raw if cv_mal_raw in _CV_MAL_VALID else "profesjonell"

    return out


class _LRUCache:
    def __init__(self, max_entries: int = 1000):
        self.max_entries = int(max_entries)
        self._data: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = Lock()

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            v = self._data.get(key)
            if v is None:
                return None
            self._data.move_to_end(key, last=True)
            return v

    def set(self, key: str, value: dict[str, Any]) -> None:
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key, last=True)
            self._data[key] = value
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)


# Bounded, thread-safe in-memory cache.
MATCH_CACHE = _LRUCache(max_entries=1000)


def _cache_key(
    *,
    model: str,
    job: str,
    cv: str,
    max_len: int,
    extract_relevant: bool,
) -> str:
    payload = f"m={model}|len={max_len}|ext={1 if extract_relevant else 0}|j={job}|c={cv}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def analyze_job_match(
    job_text: str,
    cv_text: str,
    *,
    max_len: int = 2500,
    extract_relevant: bool = True,
    use_cache: bool = True,
    model: Optional[str] = None,
) -> MatchResult:
    """Low-token semantic match between JOB and CV.

    - Single compact prompt
    - JSON-only output
    - Aggressive input trimming
    - Bounded LRU cache

    `max_len` and `extract_relevant` exist mainly for validation/testing.
    """

    max_len_i = int(max_len or 2500)

    if extract_relevant:
        job_src = _extract_relevant(job_text)
        cv_src = _extract_relevant(cv_text)
    else:
        job_src = " ".join((job_text or "").split())
        cv_src = " ".join((cv_text or "").split())

    job_comp = _compress_text(job_src, max_len_i)
    cv_comp = _compress_text(cv_src, max_len_i)

    model_id = (model or os.getenv("CLAUDE_MODEL") or _CLAUDE_MODEL).strip() or _CLAUDE_MODEL

    # Phase 3: improve cache hit rate by hashing a more normalized variant.
    job_key = _normalize_for_cache(job_comp)
    cv_key = _normalize_for_cache(cv_comp)

    key = _cache_key(model=model_id, job=job_key, cv=cv_key, max_len=max_len_i, extract_relevant=extract_relevant)
    if use_cache:
        cached = MATCH_CACHE.get(key)
        if isinstance(cached, dict):
            return _normalize_result(cached)

    system_prompt = (
        "Recruiter AI. Return ONLY JSON. Be concise.\n\n" + SHARED_ANTI_HALLUCINATION_RULES
    )

    # Very compact schema instruction to minimize tokens.
    prompt = (
        f"JOB:{job_comp}\nCV:{cv_comp}\n"
        "INFERENCE RULES (apply before listing missing):\n"
        "- Skills that are LOGICALLY IMPLIED by long experience must NOT appear in missing. "
        "Examples: 10+ years warehouse/parts work implies invoicing, stock counting, goods receipt, forklift, ERP basics. "
        "20+ years in a trade implies all common sub-tasks of that trade. "
        "Only list something as missing if the CV gives no reasonable basis to infer it.\n"
        "- Certifications/licences (fagbrev, forklift licence, etc.) listed under experience or education count as documented.\n"
        "- Do NOT flag soft skills (teamwork, communication) as missing — assume them unless the job explicitly tests them.\n"
        "- EDUCATION STATUS: Education entries marked STATUS: FULLFØRT are COMPLETED qualifications. "
        "Do NOT flag them as missing, incomplete, or suggest the candidate still needs to complete them. "
        "Only education marked STATUS: PÅGÅENDE is currently in progress. "
        "A recently completed degree (e.g. 2024–2025) is a strength, not a weakness.\n"
        "- LANGUAGE REQUIREMENTS: If the job mentions language requirements (e.g. 'flytende norsk', 'English required', 'B2', 'norsk skriftlig'), "
        "compare with the CV's Languages field. Level mapping: 'Morsmål'/'Flytende' satisfies fluency/B2+ requirements; "
        "'Godt' satisfies intermediate requirements but NOT fluency; 'Grunnleggende'/'Nybegynner' does NOT satisfy fluency requirements. "
        "If the candidate's level is insufficient for a required language, reduce score, add to 'missing', and mention it in 'main_risk' "
        "with a short explanation (e.g. 'Job requires fluent Norwegian; candidate shows Grunnleggende'). "
        "If no language level is listed in CV but the language appears in experience/education, assume adequate proficiency.\n"
        "Return JSON: {"
        '"score":0-100,'
        '"interview_probability":0-100,'
        '"seniority_match":0-100,'
        '"fit":"1 short sentence",'
        '"top_reason":"1 short sentence",'
        '"main_risk":"1 short sentence — only a real gap, not an implied skill",'
        '"strengths":["max 3"],'
        '"missing":["max 3; only genuine gaps not inferable from stated experience"],'
        '"recommended_cv_changes":["max 3; actionable CV edits addressing missing requirements; <=120 chars; no generic"],'
        '"advice":"1 short sentence",'
        '"cv_mal":"profesjonell (DEFAULT for de fleste stillinger: salg/IT/helse/bygg/kontor/service/logistikk/HR) | kreativ (KUN for: designer/UX/grafisk/animasjon/reklame/media/innhold) | klassisk (KUN for: advokat/jurist/revisor/forsker/akademiker/offentlig forvaltning) — velg basert på stillingstittelen i JOB-seksjonen"'
        "}"
    )

    try:
        client = _get_client()
        res = client.messages.create(
            model=model_id,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=800,
        )

        raw = res.content[0].text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```\s*$", "", raw)
        data = json.loads(raw)
        normalized = _normalize_result(data)

        MATCH_CACHE.set(key, dict(normalized))
        return normalized

    except Exception as exc:
        # Never raise from the matcher (keep API stable); return safe defaults.
        # Do NOT cache failures so retries can succeed after transient errors.
        logger.error("analyze_job_match failed — returning score=0. model=%s error=%s\n%s",
                     model_id, exc, traceback.format_exc())
        normalized = _normalize_result({})
        return normalized
