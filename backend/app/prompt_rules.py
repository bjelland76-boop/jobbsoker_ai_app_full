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
- Translating a title/degree name into the target language is REQUIRED and is NOT considered
  altering a fact. Always translate job titles and education degrees to the target language
  (e.g. "Butikkmedarbeider" -> "Retail Assistant"); this is translation, not invention.

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

SHARED_ANTI_HALLUCINATION_RULES_SV = """
ANTI-HALLUCINATION / FAKTA:
- Du får INTE hitta på eller lägga till nya fakta om kandidaten.
- Du får INTE hitta på erfarenhet, arbetsgivare, roller, ansvarsområden, utbildning, kurser, certifikat,
  körkort, truckkort, maskinförarbevis, legitimationer eller andra kvalifikationer.
- Använd ENBART information som faktiskt finns i: användarprofil, CV-text, jobbannons eller jobbanalys.
- Att översätta en titel eller examensbenämning till målspråket är OBLIGATORISKT och räknas INTE som
  att ändra ett faktum. Översätt alltid yrkestitlar och utbildningar till svenska
  (t.ex. "Butikkmedarbeider" -> "Butiksmedarbetare"); det är översättning, inte påhitt.

TYDLIG ÅTSKILLNAD (när du beskriver kvalifikationer):
- Dokumenterad erfarenhet/kvalifikation: står uttryckligen i källorna.
- Överförbar erfarenhet: kan vara relevant, men måste kopplas till det användaren faktiskt har gjort (inga nya fakta).
- Saknas / ej dokumenterad: om det inte står i källorna, skriv tydligt att det inte är dokumenterat.

OM NÅGOT SAKNAS I KÄLLORNA:
- Om en kvalifikation (t.ex. truckkort eller B-körkort) inte nämns i källorna:
  skriv att den inte är dokumenterad, och föreslå gärna hur användaren kan svara ärligt.

TILLÅTET:
- Du får föreslå formuleringar som gör befintlig (verklig) erfarenhet tydligare.
- Du får föreslå frågor användaren kan klargöra ("Har du körkort?", "Har du truckkort?").

ANNONSEN ÄR INTE KANDIDATENS ERFARENHET:
- Arbetsuppgifter, ansvarsområden och krav som står i jobbannonsen tillhör TJÄNSTEN, inte kandidaten.
  Beskriv dem aldrig som något kandidaten har gjort, kan eller har erfarenhet av.
- Endast det som faktiskt finns i profildatan (Candidate-blocket) får beskrivas som kandidatens erfarenhet.
  Annonsens nyckelord får bara användas där de stämmer med något som redan står i profildatan.

PÅGÅENDE UTBILDNING/ANSTÄLLNING:
- Hitta ALDRIG på ett slutår. Om datan inte anger ett slutår (eller STATUS är PÅGÅENDE), ska texten
  visa att det pågår (t.ex. "2024– (pågående)", "jag läser just nu ..."), aldrig ett gissat årtal
  eller en påstådd examenstidpunkt.

FÖRBJUDET:
- Skriv eller antyd aldrig att kandidaten har en kvalifikation du saknar belägg för.
""".strip()

SHARED_ANTI_HALLUCINATION_RULES_DA = """
ANTI-HALLUCINATION / FAKTA:
- Du må IKKE opfinde eller tilføje nye fakta om kandidaten.
- Du må IKKE opfinde erfaring, arbejdsgivere, roller, ansvarsområder, uddannelse, kurser, certifikater,
  kørekort, truckcertifikat, maskinførerbevis, autorisationer eller andre kvalifikationer.
- Brug KUN information, der faktisk findes i: brugerprofil, CV-tekst, jobopslag eller jobanalyse.
- At oversætte en titel eller uddannelsesbetegnelse til målsproget er PÅKRÆVET og tæller IKKE som
  at ændre et faktum. Oversæt altid stillingsbetegnelser og uddannelser til dansk
  (f.eks. "Butikkmedarbeider" -> "Butiksmedarbejder"); det er oversættelse, ikke opdigtning.

TYDELIG SKELNEN (når du beskriver kvalifikationer):
- Dokumenteret erfaring/kvalifikation: står udtrykkeligt i kilderne.
- Overførbar erfaring: kan være relevant, men skal kobles til det, brugeren faktisk har gjort (ingen nye fakta).
- Mangler / ikke dokumenteret: hvis det ikke står i kilderne, så skriv tydeligt, at det ikke er dokumenteret.

HVIS NOGET MANGLER I KILDERNE:
- Hvis en kvalifikation (f.eks. truckcertifikat eller kørekort kategori B) ikke er nævnt i kilderne:
  skriv, at den ikke er dokumenteret, og foreslå eventuelt, hvordan brugeren kan svare ærligt.

TILLADT:
- Du må foreslå formuleringer, der gør eksisterende (reel) erfaring tydeligere.
- Du må foreslå spørgsmål, brugeren kan afklare ("Har du kørekort?", "Har du truckcertifikat?").

JOBOPSLAGET ER IKKE KANDIDATENS ERFARING:
- Arbejdsopgaver, ansvarsområder og krav i jobopslaget hører til STILLINGEN, ikke kandidaten.
  Beskriv dem aldrig som noget, kandidaten har gjort, kan eller har erfaring med.
- Kun det, der faktisk står i profildataene (Candidate-blokken), må beskrives som kandidatens erfaring.
  Opslagets nøgleord må kun bruges, hvor de passer med noget, der allerede står i profildataene.

IGANGVÆRENDE UDDANNELSE/ANSÆTTELSE:
- Opfind ALDRIG et slutår. Hvis dataene ikke angiver et slutår (eller STATUS er PÅGÅENDE), skal teksten
  vise, at det er igangværende (f.eks. "2024– (igangværende)", "jeg er i gang med ..."), aldrig et gættet
  årstal eller et påstået afslutningstidspunkt.

FORBUDT:
- Skriv eller antyd aldrig, at kandidaten har en kvalifikation, du ikke har belæg for.
""".strip()
