"""Interview practice agent.

This module backs the mobile UI's POST /interview/chat endpoint.

Design goals:
- Keep token usage low (short prompts, short history)
- Always answer in Norwegian
- Never invent user background (experience/education/certificates)
- Return a strict JSON shape: {feedback, question, tip}

The endpoint will fall back to a deterministic (non-AI) response when
OPENAI_API_KEY is missing.
"""

from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv

from .prompt_rules import SHARED_ANTI_HALLUCINATION_RULES

# Optional dependency at runtime (tests/CI may not have a key configured).
try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore[assignment]


load_dotenv(".env")


TOPIC_ORDER: list[str] = [
    "erfaring",
    "motivasjon",
    "samarbeid",
    "stress",
    "svakheter",
    "eksempel",
]

# Very small, deterministic question bank used for:
# - fallback (no OpenAI key)
# - safety fallback if the LLM generates an overly deep follow-up
QUESTION_BANK: dict[str, list[str]] = {
    "erfaring": [
        "Fortell kort om din mest relevante erfaring for denne rollen.",
        "Hva har du gjort tidligere som ligner mest på dette ansvaret?",
    ],
    "motivasjon": [
        "Hvorfor søker du denne jobben akkurat nå?",
        "Hva gjør at du vil jobbe hos oss?",
    ],
    "samarbeid": [
        "Hvordan liker du å jobbe i team?",
        "Fortell om et godt samarbeid du har hatt – hva gjorde det vellykket?",
    ],
    "stress": [
        "Hvordan håndterer du stress eller høyt tempo?",
        "Hva gjør du når du får flere frister samtidig?",
    ],
    "svakheter": [
        "Hva vil du si er et utviklingsområde hos deg – og hva gjør du med det?",
        "Hva er en ting du ønsker å bli bedre på i jobben?",
    ],
    "eksempel": [
        "Gi ett konkret eksempel på en utfordring du løste – hva gjorde du, og hva ble resultatet?",
        "Fortell om en gang du gjorde en feil – hva lærte du?",
    ],
}


def _compact(text: Any, limit: int) -> str:
    s = "" if text is None else str(text)
    s = " ".join(s.replace("\r", " ").replace("\n", " ").split()).strip()
    if len(s) > limit:
        return s[:limit].rstrip() + "…"
    return s


def _get_client() -> "OpenAI":
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY mangler")
    if OpenAI is None:
        raise RuntimeError("openai-pakken er ikke tilgjengelig")
    return OpenAI(api_key=api_key)


def _fallback_feedback(user_answer: str) -> tuple[str, str]:
    """Short, warm fallback coaching.

    Returns (feedback, tip). Either may be empty.
    """

    ans = (user_answer or "").strip()
    if not ans:
        return (
            "Skriv 2–4 setninger: hva du kan, og ett konkret eksempel.",
            "",
        )

    length = len(ans)

    # Keep it short and not language-police.
    if length < 140:
        return (
            "Bra start. Legg til ett konkret eksempel og et resultat.",
            "",
        )

    if length > 850:
        return (
            "Bra innhold. Stram inn til 1–2 poeng og ett eksempel.",
            "",
        )

    return (
        "Godt svar. Pass på at du sier tydelig hva du gjorde og hva utfallet ble.",
        "",
    )


def _topic_for_turn(turn_index: int) -> str:
    if turn_index < 0:
        turn_index = 0
    return TOPIC_ORDER[turn_index % len(TOPIC_ORDER)]


def _is_followup_question(text: str) -> bool:
    t = (text or "").casefold()
    return any(
        k in t
        for k in [
            "utdyp",
            "fortell mer",
            "kan du si mer",
            "kan du gi et eksempel",
            "hva gjorde du",
            "hvordan gjorde du",
            "hva skjedde",
        ]
    )


def _fallback_next_question(*, job_title: str, company: str, turn_index: int) -> str:
    jt = (job_title or "").strip()
    co = (company or "").strip()

    # First question: make it job-specific if we have context.
    if turn_index <= 0 and (jt or co):
        role = jt or "rollen"
        place = f" hos {co}" if co else ""
        return f"Hvorfor ønsker du {role}{place}, og hva gjør deg til en god match?"

    topic = _topic_for_turn(turn_index)
    bank = QUESTION_BANK.get(topic) or []
    if bank:
        return bank[turn_index % len(bank)]

    return "Fortell litt om deg selv."


def interview_chat(
    *,
    job_title: str = "",
    company: str = "",
    job_context: str = "",
    user_answer: str = "",
    history: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    """Generate interview coaching feedback + next question.

    Returns strict JSON-like dict:
      {"feedback": "...", "question": "...", "tip": "..."}

    Behavioral goals (v2):
    - Short, warm, realistic (not over-eager)
    - One question at a time
    - Avoid digging deep on the same theme more than one follow-up
    - After ~6–8 user answers: short final assessment
    """

    job_title_c = _compact(job_title, 120)
    company_c = _compact(company, 120)
    job_context_c = _compact(job_context, 750)
    user_answer_c = _compact(user_answer, 1200)

    hist = history or []
    if not isinstance(hist, list):
        hist = []

    # Count turns from provided history (frontend typically sends last ~8 messages).
    user_turns_total = 0
    assistant_turns_total = 0
    for m in hist:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip().lower()
        if role == "user":
            user_turns_total += 1
        elif role == "assistant":
            assistant_turns_total += 1

    # Keep history very short and compact (token control).
    hist_short: list[dict[str, str]] = []
    for m in hist[-4:]:
        if not isinstance(m, dict):
            continue
        role = _compact(m.get("role"), 20)
        content = _compact(m.get("content"), 260)
        if not role or not content:
            continue
        if role not in {"user", "assistant", "system"}:
            role = "user"
        hist_short.append({"role": role, "content": content})

    # Extract last assistant question (best-effort) to avoid too many follow-ups.
    last_assistant_lines: list[str] = []
    for m in reversed(hist_short):
        if m.get("role") == "assistant":
            last_assistant_lines = [x.strip() for x in (m.get("content") or "").split("\n") if x.strip()]
            break
    last_question = last_assistant_lines[-1] if last_assistant_lines else ""

    # Avoid asking a follow-up if we already did one.
    assistant_questions = []
    for m in hist_short:
        if m.get("role") != "assistant":
            continue
        lines = [x.strip() for x in (m.get("content") or "").split("\n") if x.strip()]
        if lines:
            assistant_questions.append(lines[-1])
    followup_count_in_window = sum(1 for q in assistant_questions[-2:] if _is_followup_question(q))
    avoid_followup = followup_count_in_window >= 2

    turn_index = user_turns_total
    next_topic = _topic_for_turn(turn_index)

    # Final assessment trigger after ~6–8 answers.
    is_final = user_turns_total >= 6

    next_q_fallback = _fallback_next_question(job_title=job_title_c, company=company_c, turn_index=turn_index)

    # If no OpenAI key configured, return deterministic coaching.
    if not os.getenv("OPENAI_API_KEY"):
        fb, tip = _fallback_feedback(user_answer_c)
        if is_final:
            fb = "Sterke sider: Du svarer tydelig når du bruker konkrete eksempler. Bør forbedres: avslutt oftere med resultat og relevans."
            tip = "Ett råd: øv på ett kort STAR-eksempel du kan bruke på flere spørsmål."
            q = "Vil du ta ett siste spørsmål, eller avslutte for i dag?"
            return {"feedback": _compact(fb, 520), "tip": _compact(tip, 260), "question": _compact(q, 220)}

        # Keep it lightweight: only provide feedback OR tip most turns.
        if turn_index % 2 == 0:
            tip = ""
        else:
            fb = ""

        return {
            "feedback": _compact(fb, 420),
            "question": _compact(next_q_fallback, 220),
            "tip": _compact(tip, 220),
        }

    # LLM path (still keep it short and strict).
    try:
        client = _get_client()

        system = (
            "Du er en intervjutrener (varm, ærlig, realistisk). Svar ALLTID på norsk. "
            "Ikke vær språkpoliti med mindre svaret er uforståelig. "
            "Du skal gi KORT coaching og stille NESTE intervjuspørsmål. "
            "Du skal IKKE grave for dypt i samme tema: maks én oppfølger før du bytter tema. "
            "Variér mellom temaene: erfaring, motivasjon, samarbeid, stress/press, svakheter/mangler, konkrete eksempler. "
            "Returner KUN gyldig JSON med feltene: feedback, tip, question.\n\n"
            "Regler:\n"
            "- feedback: 0–2 setninger (kan være tom).\n"
            "- tip: 0–1 setning (kan være tom).\n"
            "- question: ett (1) realistisk intervjuspørsmål, maks ca 25 ord.\n"
            "- Ingen punktlister. Ikke bruk overskrifter som 'Feedback:' eller 'Tips:' i teksten.\n"
            "- Ikke finn opp kandidatens bakgrunn eller kvalifikasjoner. Kommenter bare det som står i svaret.\n\n"
            + SHARED_ANTI_HALLUCINATION_RULES
        )

        prompt_parts: list[str] = []
        prompt_parts.append(f"Turn: {turn_index} (brukersvar så langt: {user_turns_total}).")
        if job_title_c or company_c:
            prompt_parts.append(f"Stilling={job_title_c or '—'}; Bedrift={company_c or '—'}")
        if job_context_c:
            prompt_parts.append(f"Jobb-kontekst (kort): {job_context_c}")

        if user_answer_c:
            prompt_parts.append(f"Siste svar: {user_answer_c}")
        else:
            prompt_parts.append("Start intervjuet (kandidaten har ikke svart ennå).")

        if last_question:
            prompt_parts.append(f"Forrige spørsmål: {last_question}")

        if avoid_followup:
            prompt_parts.append("VIKTIG: Ikke still en oppfølger nå. Bytt tema.")

        if is_final:
            prompt_parts.append(
                "Nå skal du avslutte intervjuøving med en kort sluttvurdering. "
                "feedback skal inneholde: sterke sider + bør forbedres (2–3 korte setninger totalt). "
                "tip skal inneholde: ett konkret råd (1 setning). "
                "question skal være: et kort avslutningsspørsmål (ja/nei / ferdig?)."
            )
        else:
            prompt_parts.append(
                f"Neste tema å prioritere: {next_topic}. "
                "Still ett realistisk spørsmål innen det temaet."
            )

        user_prompt = "\n".join(prompt_parts)

        res = client.chat.completions.create(
            model=(os.getenv("OPENAI_GEN_MODEL") or "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": system},
                *hist_short,
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=260,
            response_format={"type": "json_object"},
        )

        raw = (res.choices[0].message.content or "").strip()
        data = json.loads(raw) if raw else {}

        feedback = _compact(data.get("feedback"), 420)
        tip = _compact(data.get("tip"), 220)
        question = _compact(data.get("question"), 220)

        # Defensive: keep contract stable.
        if not question:
            question = next_q_fallback

        # Keep outputs light (token + UX): not both feedback and tip every time.
        if not is_final:
            if feedback and tip:
                if turn_index % 2 == 0:
                    tip = ""
                else:
                    feedback = ""

        # Safety: if the LLM still asks a deep follow-up when we want to avoid it,
        # replace with a deterministic topic question.
        if avoid_followup and _is_followup_question(question):
            question = next_q_fallback

        return {
            "feedback": feedback,
            "question": question,
            "tip": tip,
        }

    except Exception:
        fb, tip = _fallback_feedback(user_answer_c)
        if is_final:
            fb = "Sterke sider: Du svarer tydelig når du bruker konkrete eksempler. Bør forbedres: avslutt oftere med resultat og relevans."
            tip = "Ett råd: øv på ett kort STAR-eksempel du kan bruke på flere spørsmål."
            q = "Vil du ta ett siste spørsmål, eller avslutte for i dag?"
            return {"feedback": _compact(fb, 520), "tip": _compact(tip, 260), "question": _compact(q, 220)}

        if turn_index % 2 == 0:
            tip = ""
        else:
            fb = ""

        return {
            "feedback": _compact(fb, 420),
            "question": _compact(next_q_fallback, 220),
            "tip": _compact(tip, 220),
        }
