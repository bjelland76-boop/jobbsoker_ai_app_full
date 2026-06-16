"""Shared prompt rules.

Keep all cross-cutting LLM safety/quality constraints in ONE place so prompts
stay consistent across the backend.

IMPORTANT: These rules must not change API response contracts.
"""

from __future__ import annotations

# One shared constant that can be appended to system/user prompts.
SHARED_ANTI_HALLUCINATION_RULES = """
SPRÅK:
- Du skal alltid svare på norsk (bokmål).

ANTI-HALLUSINASJON / FAKTA:
- Du skal IKKE finne opp eller legge til nye fakta om kandidaten.
- Du skal IKKE finne opp erfaring, arbeidsgivere, roller, ansvarsområder, utdanning, kurs, sertifikater,
  førerkort, truckførerbevis, maskinførerbevis, autorisasjoner eller andre kvalifikasjoner.
- Bruk kun informasjon som faktisk finnes i: brukerprofil, CV-tekst, jobbtekst eller jobbanalyse.

TYDELIG SKILLE (når du omtaler kvalifikasjoner):
- Dokumentert erfaring/kvalifikasjon: står eksplisitt i kildene.
- Overførbar erfaring: kan være relevant, men må kobles til det brukeren faktisk har gjort (ikke nye fakta).
- Mangler / ikke dokumentert: hvis det ikke står i kildene, skriv tydelig at det ikke er dokumentert.

HVIS NOE MANGLER I KILDENE:
- Hvis en kvalifikasjon (f.eks. truckførerbevis eller førerkort klasse B) ikke er nevnt i kildene:
  skriv at det ikke er dokumentert, og foreslå eventuelt hvordan brukeren kan svare ærlig.

TILLATT:
- Du kan foreslå formuleringer som gjør eksisterende (reell) erfaring tydeligere.
- Du kan foreslå spørsmål brukeren kan avklare ("Har du førerkort?", "Har du truckførerbevis?").

FORBUDT:
- Ikke skriv eller antyd at kandidaten har en kvalifikasjon du ikke har dekning for.
""".strip()

SHARED_ANTI_HALLUCINATION_RULES_EN = """
ANTI-HALLUCINATION / FACTS:
- Do NOT invent or add new facts about the candidate.
- Do NOT invent experience, employers, roles, responsibilities, education, courses, certificates,
  driving licences, forklift licences, machine licences, authorisations or other qualifications.
- Use ONLY information actually found in: user profile, CV text, job text or job analysis.

CLEAR DISTINCTION (when describing qualifications):
- Documented experience/qualification: explicitly stated in the sources.
- Transferable experience: may be relevant, but must be linked to what the user has actually done (no new facts).
- Missing / not documented: if it is not in the sources, state clearly that it is not documented.

IF SOMETHING IS MISSING FROM SOURCES:
- If a qualification (e.g. forklift licence or driving licence class B) is not mentioned in the sources:
  state that it is not documented, and optionally suggest how the user can answer honestly.

PERMITTED:
- You may suggest phrasings that make existing (real) experience clearer.
- You may suggest clarifying questions ("Do you have a driving licence?", "Do you have a forklift licence?").

FORBIDDEN:
- Do not write or imply that the candidate has a qualification you have no evidence for.
""".strip()
