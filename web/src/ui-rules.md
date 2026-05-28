# UI Rules (IMPORTANT)

Dette prosjektet skal følge disse reglene:

## 1. Ingen duplikater
Hver funksjon skal kun finnes ett sted i UI.
Eksempler:
- "Analyser jobbannonse" = 1 knapp totalt
- "Profil" = 1 inngang totalt
- "Søknadsstatus" = 1 inngang totalt

## 2. Dashboard struktur
Hovedskjerm skal alltid ha:

- Topp: kort velkomst / status
- Midten: maks 3 primary actions
- Bunn: sekundære handlinger (settings, info)

## 3. Navigation rules
- Ikke lag flere entry points til samme feature
- Ikke lag “snarveier” som dupliserer eksisterende knapper
- All navigation skal gå gjennom hovedmenyen eller dashboard

## 4. UI simplicity
- Minimalistisk design
- Ingen overflødige knapper
- Konsistent styling
- Mobile-first

## 5. AI instruction
Når du endrer UI:
- fjern duplikater først
- ikke legg til nye features
- behold eksisterende routing og backend-logikk
