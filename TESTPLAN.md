# TESTPLAN

Dette dokumentet beskriver en manuell testplan for mobil-appen.

## 1. Innlogging

### 1.1 Ny bruker
- Åpne appen (fresh install / rydd AsyncStorage).
- Gå til innlogging.
- Skriv inn e-postadresse som ikke finnes fra før.
- Trykk **Send engangskode**.
- Hent engangskode fra e-post.
- Tast inn koden og fullfør innlogging.
- Verifiser at du blir logget inn og kommer til Hjem.

**Forventet:**
- Kode blir sendt.
- Innlogging lykkes og token lagres.

### 1.2 Eksisterende bruker
- Logg ut hvis du er innlogget.
- Skriv inn e-postadresse som finnes.
- Be om engangskode og logg inn.

**Forventet:**
- Innlogging lykkes.
- Eksisterende data (profil/analyser) kan lastes.

### 1.3 Feil kode
- Be om engangskode.
- Tast inn feil kode.

**Forventet:**
- Tydelig feilmelding.
- Ingen innlogging / token.

## 2. Profil

### 2.1 Lagre profil
- Gå til **Profil**.
- Fyll inn navn, e-post, telefon, adresse, postnr/poststed.
- Trykk **Lagre profil**.

**Forventet:**
- Bekreftelse på at profilen er lagret.
- Ingen feilmeldinger.

### 2.2 Laste profil
- Lukk appen helt og start på nytt.
- Logg inn på nytt ved behov.
- Gå til **Profil** og bekreft at felter er lastet inn.

**Forventet:**
- Profilfelter er forhåndsutfylt med data fra backend.

### 2.3 Ferdigheter
- I **Profil**, legg inn et sett med ferdigheter (stikkord).
- Lagre profil.
- Start en jobbanalyse eller søknadsgenerering.

**Forventet:**
- Ferdigheter lagres uten å bli overskrevet.
- Ferdigheter påvirker (synlig/indirekte) søknadstekst.

### 2.4 Erfaring
- Legg til minst 2 erfaring-entries.
- Marker én som “Jobber her fremdeles”.
- Lagre profil.
- Restart appen og bekreft at erfaringene er lastet.

**Forventet:**
- Erfaringer persisteres.
- “Nå”-logikk fungerer (til-dato tom når current=true).

### 2.5 Utdanning
- Legg til utdanning.
- Test skolevelger:
  - Åpne liste
  - Søk minst 2 bokstaver
  - Velg et forslag
- Lagre profil.
- Restart appen og bekreft at utdanning er lastet.

**Forventet:**
- Utdanning persisteres.
- Skolevelger gir forventede forslag og valg lagres.

## 3. Jobbanalyse

### 3.1 Lim inn annonse
- Gå til **Ny søknad** eller **Analyser jobbannonse**.
- Lim inn en gyldig jobbannonse-URL.

**Forventet:**
- URL blir stående i feltet.
- Ingen valideringsfeil før analyse.

### 3.2 Analyser jobb
- Trykk **Analyser jobb** / **Start analyse**.

**Forventet:**
- Loading vises.
- Resultat med matchscore og vurdering vises.
- “Tidligere analyser” blir oppdatert (best effort).

### 3.3 Åpne lagret analyse
- Under **Tidligere analyser**, trykk **Åpne analyse**.

**Forventet:**
- Tidligere analyse lastes.
- Navigasjon til Analyse-skjerm.

## 4. CV-analyse
- Gå til **Analyser CV / profil**.
- Trykk **Analyser profilen min**.

**Forventet:**
- Resultat med oppsummering/styrker/gap/tips og søkeord vises.
- Feil håndteres med melding.

## 5. PDF

### 5.1 Generer samlet PDF
- Gå til en ferdig jobbanalyse.
- Trykk **Generer PDF (uten e-post)**.

**Forventet:**
- Appen genererer pakke (søknad + CV).
- Når pdfUrl finnes: navigerer til Dokumenter og viser bekreftelse.

### 5.2 Åpne PDF
- Åpne en generert PDF fra:
  - knappen **Åpne PDF** (fra pakkevisning), og/eller
  - **Dokumenter**-listen.

**Forventet:**
- Lenken åpnes i nettleser / PDF-viewer.
- Hvis åpning feiler: URL vises i alert.

## 6. E-post

### 6.1 Send søknad
- I jobbanalyse: fyll inn mottaker-e-post.
- Trykk **Send søknad (e-post)**.

**Forventet:**
- Generering lykkes.
- Bekreftelsesmelding vises.

### 6.2 Bekreft søknadstekst i body
- Sjekk mottatt e-post.

**Forventet:**
- Søknadstekst er i e-post-body (lesbar og komplett).

### 6.3 Bekreft CV-only PDF som vedlegg
- I mottatt e-post: sjekk vedlegg.

**Forventet:**
- Vedlegg finnes.
- Vedlegg er “CV-only PDF” (i tråd med forventet funksjon/konfig).

## 7. Intervju

### 7.1 Start intervju
- Gå til **Intervju-øving**.
- Bekreft at første spørsmål vises.

**Forventet:**
- Spørsmål vises og du kan skrive notater.

### 7.2 Send minst 3 svar
- Skriv notater/svar for minst 3 spørsmål.
- Bruk Neste/Forrige og se at notater bevares per spørsmål.

**Forventet:**
- Notater lagres i app-state for hvert index.

### 7.3 Bekreft feedback
- Noter eventuelle feedback-mekanismer hvis de finnes i UI.

**Forventet:**
- Hvis feedback finnes: den vises konsistent.
- Hvis ikke: registrer som observasjon.

### 7.4 Bekreft oppfølgingsspørsmål
- Noter om det finnes oppfølgingsspørsmål eller dynamikk.

**Forventet:**
- Hvis oppfølgingsspørsmål finnes: de kommer etter svar.
- Hvis ikke: registrer som observasjon.

## 8. Søknadsliste

### 8.1 Åpne
- Gå til **Søknader**.
- Trykk **Oppdater liste**.

**Forventet:**
- Liste vises.
- Status (søkt/intervju/jobb) kan toggles.

### 8.2 Skjul jobb
- Fra **Analyser jobbannonse** → Tidligere analyser: trykk **Fjern fra listen**.

**Forventet:**
- Elementet forsvinner fra listen i appen.

### 8.3 Bekreft at backend-data ikke slettes
- Etter “Fjern fra listen”, gjør en ny refresh (oppdater liste / restart app / logg inn igjen).
- Verifiser at jobben ikke er slettet i backend, kun skjult for profilen.

**Forventet:**
- Data er ikke slettet permanent.
- Oppførsel samsvarer med “hide”-funksjon (ikke delete).

## 9. Mobiltest

### 9.1 Liten skjerm
- Test på en liten Android-enhet eller emulator.
- Sjekk at:
  - tekst ikke klippes
  - knapper er tappbare
  - scrolling fungerer

### 9.2 Normal skjerm
- Test på normal moderne telefon.
- Gå gjennom hovedflytene: innlogging → profil → analyse → PDF/dokumenter.

### 9.3 Mørk modus (hvis støttet)
- Slå på systemets dark mode.
- Åpne appen.

**Forventet:**
- UI forblir lesbar (kontrast).
- Ingen uventede fargekombinasjoner.

## 10. Kjente feil / observasjoner
- Loggfør:
  - Plattform (Android/iOS/Web)
  - Build-type (dev/release)
  - API base URL
  - Steg for å reprodusere
  - Forventet vs faktisk
  - Screenshots/Video (hvis mulig)
