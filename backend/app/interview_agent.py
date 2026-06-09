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


DEFAULT_QUESTIONS: list[str] = [
    "Fortell litt om deg selv.",
    "Hvorfor søker du denne jobben?",
    "Hva er dine største styrker?",
    "Hva vil du si er dine utviklingsområder?",
    "Fortell om en gang du løste et vanskelig problem.",
    "Hvordan håndterer du stress og høyt tempo?",
    "Hvordan liker du å jobbe i team?",
    "Hva motiverer deg i hverdagen?",
    "Hvor ser du deg selv om 2–3 år?",
    "Har du noen spørsmål til oss?",
]


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
    ans = (user_answer or "").strip()
    if not ans:
        return (
            "Skriv 3–5 setninger: kort bakgrunn, hva du kan bidra med, og en konkret situasjon som viser det.",
            "Bruk gjerne STAR: Situasjon–Oppgave–Handling–Resultat (1 setning per del).",
        )

    length = len(ans)
    if length < 160:
        return (
            "Fint utgangspunkt, men svaret er litt kort. Legg til én konkret situasjon og et resultat (helst med tall).",
            "Velg ett eksempel og avslutt med hva du lærte / hva det sier om deg.",
        )

    if length > 900:
        return (
            "Svaret har mye innhold. Stram inn: 1–2 poeng, ett tydelig eksempel og en kort avslutning.",
            "Kutt detaljer som ikke bygger hovedpoenget. Tenk: maks 60–90 sekunder muntlig.",
        )

    return (
        "God lengde. Pass på at du svarer direkte på spørsmålet og får frem hva DU gjorde og hva resultatet ble.",
        "Avslutt med koblingen til rollen: «Dette er relevant fordi …».",
    )


def _fallback_next_question(*, job_title: str, company: str, turn_index: int) -> str:
    jt = (job_title or "").strip()
    co = (company or "").strip()

    # First question: make it job-specific if we have context.
    if turn_index <= 0 and (jt or co):
        role = jt or "rollen"
        place = f" hos {co}" if co else ""
        return f"Hvorfor ønsker du {role}{place}, og hva gjør deg til en god match?"

    # Otherwise cycle a small fixed set.
    return DEFAULT_QUESTIONS[turn_index % len(DEFAULT_QUESTIONS)]


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
    """

    job_title_c = _compact(job_title, 120)
    company_c = _compact(company, 120)
    job_context_c = _compact(job_context, 900)
    user_answer_c = _compact(user_answer, 1200)

    hist = history or []
    if not isinstance(hist, list):
        hist = []

    # Keep history very short and compact (token control).
    hist_short: list[dict[str, str]] = []
    for m in hist[-4:]:
        if not isinstance(m, dict):
            continue
        role = _compact(m.get("role"), 20)
        content = _compact(m.get("content"), 280)
        if not role or not content:
            continue
        if role not in {"user", "assistant", "system"}:
            role = "user"
        hist_short.append({"role": role, "content": content})

    # Determine turn for deterministic fallback.
    user_turns = sum(1 for m in hist_short if m.get("role") == "user")
    next_q_fallback = _fallback_next_question(job_title=job_title_c, company=company_c, turn_index=user_turns)

    # If no OpenAI key configured, return deterministic coaching.
    if not os.getenv("OPENAI_API_KEY"):
        fb, tip = _fallback_feedback(user_answer_c)
        return {
            "feedback": fb,
            "question": next_q_fallback,
            "tip": tip,
        }

    # LLM path (still keep it short and strict).
    try:
        client = _get_client()

        system = (
            "Du er en intervjutrener. Svar ALLTID på norsk. "
            "Du skal gi kort feedback på kandidatens siste svar, en kort tips-linje, "
            "og deretter stille NESTE intervjuspørsmål. "
            "VIKTIG: Ikke finn opp kandidatens erfaring, utdanning, kurs, førerkort, "
            "truckførerbevis eller sertifikater. Du kan bare kommentere det som faktisk "
            "står i kandidatens svar. "
            "Svar KUN som gyldig JSON med feltene: feedback, tip, question. "
            "Hold hvert felt kort (1–3 setninger).\n\n"
            + SHARED_ANTI_HALLUCINATION_RULES
        )

        # Keep user prompt compact to reduce tokens.
        prompt_parts: list[str] = []
        if job_title_c or company_c:
            prompt_parts.append(f"Kontekst: Stilling={job_title_c or '—'}; Bedrift={company_c or '—'}")
        if job_context_c:
            prompt_parts.append(f"Jobb-kontekst (kort): {job_context_c}")
        if user_answer_c:
            prompt_parts.append(f"Kandidatens siste svar: {user_answer_c}")
        else:
            prompt_parts.append("Kandidaten har ikke svart ennå (start intervjuet).")

        # Ask for a job-appropriate next question, but ensure we always have a fallback.
        prompt_parts.append(
            "Oppgave: Gi feedback + tips på svaret (hvis det finnes), og still neste spørsmål. "
            "Neste spørsmål skal være relevant og ikke for langt."
        )

        user_prompt = "\n".join(prompt_parts)

        res = client.chat.completions.create(
            model=(os.getenv("OPENAI_GEN_MODEL") or "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": system},
                *hist_short,
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.25,
            max_tokens=350,
            response_format={"type": "json_object"},
        )

        raw = (res.choices[0].message.content or "").strip()
        data = json.loads(raw) if raw else {}

        feedback = _compact(data.get("feedback"), 600)
        tip = _compact(data.get("tip"), 300)
        question = _compact(data.get("question"), 300)

        # Defensive: keep contract stable.
        if not question:
            question = next_q_fallback

        return {
            "feedback": feedback,
            "question": question,
            "tip": tip,
        }

    except Exception:
        fb, tip = _fallback_feedback(user_answer_c)
        return {
            "feedback": fb,
            "question": next_q_fallback,
            "tip": tip,
        }
