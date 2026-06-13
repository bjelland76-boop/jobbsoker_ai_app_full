"""Interview practice agent — structured 8-question interview simulation.

Design:
- 8 main topics in a fixed order, mirroring a real job interview
- Phase 0: personalised opening (why this job/company)
- Phase 1-2: job-specific questions derived from job_context
- Phase 3-7: standard interview topics
- Phase 8+: rich final analysis (no more questions)
- Max 1 follow-up per topic, then forced topic change
- Stateless: all state derived from the history sent by the frontend
"""

from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv

from .prompt_rules import SHARED_ANTI_HALLUCINATION_RULES

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore[assignment]

load_dotenv(".env")

TOTAL_QUESTIONS = 8

# Ordered phases — each defines what topic the AI should cover.
PHASES: list[dict[str, str]] = [
    {
        "label": "Åpning",
        "instruction": (
            "Still ett personlig åpningsspørsmål: Hvorfor søker kandidaten akkurat denne "
            "stillingen hos akkurat denne bedriften? Tilpass til job_title og company."
        ),
    },
    {
        "label": "Jobbspesifikk #1",
        "instruction": (
            "Les job_context nøye. Still ett spørsmål direkte knyttet til et konkret krav, "
            "ansvar eller ferdighet som nevnes der. Henvis til noe spesifikt fra stillingen."
        ),
    },
    {
        "label": "Jobbspesifikk #2",
        "instruction": (
            "Les job_context igjen. Still ett nytt spørsmål om et ANNET konkret krav eller "
            "ansvar fra stillingen — ikke gjenbruk temaet fra forrige spørsmål."
        ),
    },
    {
        "label": "Erfaring",
        "instruction": (
            "Still ett spørsmål om kandidatens mest relevante arbeidserfaring for denne rollen."
        ),
    },
    {
        "label": "Samarbeid",
        "instruction": (
            "Still ett spørsmål om teamarbeid, samarbeidsstil, eller en konkret situasjon "
            "der kandidaten samarbeidet med andre."
        ),
    },
    {
        "label": "Stress og prioritering",
        "instruction": (
            "Still ett spørsmål om hvordan kandidaten håndterer stress, høyt tempo "
            "eller motstridende frister."
        ),
    },
    {
        "label": "Svakheter / utvikling",
        "instruction": (
            "Still ett spørsmål om kandidatens svakheter eller hva de aktivt jobber "
            "med å forbedre seg på."
        ),
    },
    {
        "label": "Konkret eksempel (STAR)",
        "instruction": (
            "Be kandidaten om ett konkret eksempel med situasjon, handling og resultat "
            "(STAR-metoden). Gjerne knyttet til noe relevant fra stillingen."
        ),
    },
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


def _count_roles(hist: list[dict]) -> tuple[int, int]:
    """Return (user_turns, assistant_turns) from history."""
    user_turns = sum(1 for m in hist if isinstance(m, dict) and str(m.get("role") or "").strip() == "user")
    assistant_turns = sum(1 for m in hist if isinstance(m, dict) and str(m.get("role") or "").strip() == "assistant")
    return user_turns, assistant_turns


def _last_assistant_content(hist: list[dict]) -> str:
    for m in reversed(hist):
        if isinstance(m, dict) and str(m.get("role") or "").strip() == "assistant":
            return str(m.get("content") or "").strip()
    return ""


def _fallback_question(phase: int, job_title: str, company: str) -> str:
    fallbacks = [
        f"Hvorfor søker du stillingen som {job_title or 'denne rollen'}{(' hos ' + company) if company else ''}?",
        "Kan du beskrive et relevant ansvar du har hatt i en tidligere jobb?",
        "Hvilken erfaring har du som er direkte relevant for denne stillingen?",
        "Fortell om din mest relevante arbeidserfaring.",
        "Hvordan foretrekker du å samarbeide med kolleger?",
        "Hvordan håndterer du perioder med mye press og knappe frister?",
        "Hva vil du si er et utviklingsområde hos deg, og hva gjør du med det?",
        "Gi ett konkret eksempel på en utfordring du løste — hva gjorde du og hva ble resultatet?",
    ]
    return fallbacks[min(phase, len(fallbacks) - 1)]


def _fallback_feedback(user_answer: str) -> str:
    ans = (user_answer or "").strip()
    if not ans:
        return "Prøv å svare med 2–4 setninger og ett konkret eksempel."
    if len(ans) < 140:
        return "Bra start. Legg til ett konkret eksempel og hva resultatet ble."
    if len(ans) > 850:
        return "Godt innhold. Stram inn til 1–2 poeng med ett eksempel."
    return "Godt svar. Pass på å si tydelig hva du gjorde og hva utfallet ble."


def _build_final_analysis(
    *,
    job_title: str,
    company: str,
    job_context: str,
    hist_full: list[dict[str, str]],
) -> dict[str, str]:
    """Call the LLM with full history to produce a rich final analysis."""

    client = _get_client()

    history_text = "\n".join(
        f"[{m['role'].upper()}]: {m['content']}"
        for m in hist_full
        if isinstance(m, dict) and m.get("role") and m.get("content")
    )

    system = (
        "Du er en erfaren intervjutrener. Svar ALLTID på norsk. "
        "Du skal nå gi en strukturert sluttanalyse av dette øvingsintervjuet. "
        "Returner KUN gyldig JSON med feltene: feedback, tip, question.\n\n"
        "VIKTIG: Alle felter skal være ENKLE TEKSTSTRENGER — ikke objekter, ikke lister.\n\n"
        "- feedback: Skriv 4–6 sammenhengende setninger som dekker: "
        "  Først sterke sider med ett konkret eksempel fra intervjuet. "
        "  Deretter ett eller to forbedringsområder. "
        "  Til slutt en kort jobbspesifikk vurdering av om kandidaten passer for stillingen. "
        "  ALT i én sammenhengende tekststreng.\n"
        "- tip: Én konkret, handlingsorientert setning kandidaten kan bruke i et ekte intervju.\n"
        "- question: Kort avslutningsmelding, f.eks. 'Bra jobbet! Lykke til med intervjuet.' (ikke et spørsmål).\n\n"
        + SHARED_ANTI_HALLUCINATION_RULES
    )

    user_prompt_parts = [
        f"Stilling: {job_title or '—'} | Bedrift: {company or '—'}",
    ]
    if job_context:
        user_prompt_parts.append(f"Jobb-kontekst: {_compact(job_context, 800)}")
    user_prompt_parts.append(f"\nHele intervjuhistorikken:\n{history_text}")
    user_prompt_parts.append(
        "\nGi nå en ærlig, konkret sluttanalyse som nevnt i instruksjonene."
    )

    res = client.chat.completions.create(
        model=(os.getenv("OPENAI_GEN_MODEL") or "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": "\n".join(user_prompt_parts)},
        ],
        temperature=0.3,
        max_tokens=420,
        response_format={"type": "json_object"},
    )

    raw = (res.choices[0].message.content or "").strip()
    data = json.loads(raw) if raw else {}

    return {
        "feedback": _compact(data.get("feedback"), 900),
        "tip": _compact(data.get("tip"), 280),
        "question": _compact(data.get("question"), 120),
        "is_final": True,
    }


def interview_chat(
    *,
    job_title: str = "",
    company: str = "",
    job_context: str = "",
    user_answer: str = "",
    history: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    """Generate interview coaching feedback + next question (or final analysis).

    Returns:
      {"feedback": "...", "question": "...", "tip": "...", "is_final": bool}

    Flow:
    - Phase 0 (user_turns == 0): Opening question, no feedback yet
    - Phase 1–7 (user_turns 1–7): Feedback on answer + next phase question
                                   (or 1 follow-up if appropriate)
    - Phase 8+ (user_turns >= 8): Final analysis, no more questions
    """

    job_title_c = _compact(job_title, 120)
    company_c = _compact(company, 120)
    job_context_c = _compact(job_context, 900)
    user_answer_c = _compact(user_answer, 1200)

    hist: list[dict] = history if isinstance(history, list) else []

    user_turns, assistant_turns = _count_roles(hist)

    # --- Final analysis ---
    if user_turns >= TOTAL_QUESTIONS:
        if not os.getenv("OPENAI_API_KEY"):
            return {
                "feedback": (
                    "Sterke sider: Du svarer tydelig når du bruker konkrete eksempler. "
                    "Forbedringsområder: Avslutt svarene med resultat og relevans for stillingen."
                ),
                "tip": "Øv på ett STAR-eksempel du kan tilpasse til mange spørsmål.",
                "question": "Bra jobbet! Lykke til med intervjuet.",
                "is_final": True,
            }

        try:
            # Build a clean history for analysis (all turns, compact)
            hist_full: list[dict[str, str]] = []
            for m in hist:
                if not isinstance(m, dict):
                    continue
                role = str(m.get("role") or "").strip().lower()
                content = _compact(m.get("content"), 400)
                if role in {"user", "assistant"} and content:
                    hist_full.append({"role": role, "content": content})

            return _build_final_analysis(
                job_title=job_title_c,
                company=company_c,
                job_context=job_context_c,
                hist_full=hist_full,
            )
        except Exception:
            return {
                "feedback": (
                    "Sterke sider: Du svarer tydelig når du bruker konkrete eksempler. "
                    "Forbedringsområder: Avslutt svarene med resultat og relevans for stillingen."
                ),
                "tip": "Øv på ett STAR-eksempel du kan tilpasse til mange spørsmål.",
                "question": "Bra jobbet! Lykke til med intervjuet.",
                "is_final": True,
            }

    # --- Determine current phase and follow-up status ---
    phase = min(user_turns, TOTAL_QUESTIONS - 1)
    phase_info = PHASES[phase]

    # Check if the last AI turn was a follow-up (= same topic, not a main phase question).
    # We detect this by comparing assistant_turns vs user_turns:
    # Normal: assistant_turns == user_turns + 1 (AI always goes first)
    # After follow-up: user answered the follow-up, so user_turns advanced but phase didn't
    # We track this via whether assistant_turns > user_turns + 1 would have been the case.
    # Simplest signal: look at the last assistant message and the one before it.
    # If they're both within the same phase range → a follow-up was just used.
    last_ai_content = _last_assistant_content(hist)

    # Count assistant messages in the last 4 turns within the current phase window.
    recent = hist[-4:] if len(hist) >= 4 else hist
    recent_assistant = [m for m in recent if isinstance(m, dict) and str(m.get("role") or "") == "assistant"]
    # If there are 2+ assistant messages in the recent window and user_turns put us at phase N,
    # a follow-up was likely already used in this phase.
    follow_up_already_used = len(recent_assistant) >= 2 and assistant_turns > user_turns + 1

    questions_remaining = TOTAL_QUESTIONS - user_turns

    # --- Build short history for the LLM (last 6 messages, compact) ---
    hist_short: list[dict[str, str]] = []
    for m in hist[-6:]:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip().lower()
        content = _compact(m.get("content"), 300)
        if role not in {"user", "assistant", "system"} or not content:
            continue
        hist_short.append({"role": role, "content": content})

    # --- No OpenAI key — deterministic fallback ---
    if not os.getenv("OPENAI_API_KEY"):
        feedback = _fallback_feedback(user_answer_c) if user_answer_c else ""
        question = _fallback_question(phase, job_title_c, company_c)
        return {
            "feedback": feedback,
            "question": question,
            "tip": "",
            "is_final": False,
        }

    # --- LLM path ---
    try:
        client = _get_client()

        system = (
            "Du er en profesjonell intervjuer i et realistisk jobbintervju. Svar ALLTID på norsk. "
            "Du representerer arbeidsgiveren og skal stille gode, relevante intervjuspørsmål. "
            "Du gir KORT og ærlig coaching etter hvert svar — ikke overdrevent positiv. "
            "Returner KUN gyldig JSON med feltene: feedback, tip, question.\n\n"
            "Regler:\n"
            "- feedback: 0–2 korte setninger om siste svar. Tom streng hvis kandidaten ikke har svart ennå.\n"
            "- tip: 0–1 setning med ett konkret råd. Kan være tom.\n"
            "- question: NØYAKTIG ETT intervjuspørsmål, maks ~25 ord.\n"
            "- Ikke bruk punktlister. Ikke skriv 'Feedback:' eller 'Tips:' som overskrifter.\n"
            "- Ikke finn opp kandidatens bakgrunn. Kommenter bare det som faktisk ble sagt.\n"
            "- MAKS 1 oppfølgingsspørsmål per tema. Etter det: ALLTID bytt til neste tema.\n\n"
            + SHARED_ANTI_HALLUCINATION_RULES
        )

        prompt_parts: list[str] = [
            f"Stilling: {job_title_c or '—'} | Bedrift: {company_c or '—'}",
            f"Spørsmål {user_turns + 1} av {TOTAL_QUESTIONS} | Tema: {phase_info['label']}",
            f"Spørsmål igjen etter dette: {questions_remaining - 1}",
        ]

        if job_context_c and phase <= 2:
            prompt_parts.append(f"Jobb-kontekst (bruk aktivt for spørsmål 1–3): {job_context_c}")
        elif job_context_c:
            prompt_parts.append(f"Jobb-kontekst (referanse): {_compact(job_context, 300)}")

        if user_answer_c:
            prompt_parts.append(f"Kandidatens siste svar: {user_answer_c}")
        else:
            prompt_parts.append("Kandidaten har ikke svart ennå. Ikke gi feedback. Still åpningsspørsmålet.")

        if last_ai_content:
            prompt_parts.append(f"Ditt forrige spørsmål: {_compact(last_ai_content, 200)}")

        if follow_up_already_used:
            prompt_parts.append(
                "VIKTIG: Du har allerede stilt én oppfølger til dette temaet. "
                "Du MÅ nå gå videre til neste tema. IKKE still en oppfølger."
            )

        prompt_parts.append(f"Instruksjon for dette spørsmålet: {phase_info['instruction']}")

        if questions_remaining == 1:
            prompt_parts.append(
                "Dette er siste spørsmål (spørsmål 8 av 8). "
                "Gjør det til et godt avslutningsspørsmål."
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
            max_tokens=300,
            response_format={"type": "json_object"},
        )

        raw = (res.choices[0].message.content or "").strip()
        data = json.loads(raw) if raw else {}

        feedback = _compact(data.get("feedback"), 500)
        tip = _compact(data.get("tip"), 260)
        question = _compact(data.get("question"), 240)

        if not question:
            question = _fallback_question(phase, job_title_c, company_c)

        # Don't show both feedback and tip every turn — keep it light
        if feedback and tip and not follow_up_already_used:
            if user_turns % 2 == 0:
                tip = ""
            else:
                feedback = ""

        return {
            "feedback": feedback,
            "question": question,
            "tip": tip,
            "is_final": False,
        }

    except Exception:
        return {
            "feedback": _fallback_feedback(user_answer_c) if user_answer_c else "",
            "question": _fallback_question(phase, job_title_c, company_c),
            "tip": "",
            "is_final": False,
        }
