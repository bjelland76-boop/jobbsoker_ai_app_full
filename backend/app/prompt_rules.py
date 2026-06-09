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
