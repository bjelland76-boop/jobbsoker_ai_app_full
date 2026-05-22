# Ærlig JobbCoach – URL-basert annonseanalyse

Dette er en fungerende utviklerpakke for en AI-app som lar deg **lime inn URL til en jobbannonse**, få en **ærlig analyse** og (valgfritt) generere **søknad + tilpasset CV** som PDF.

## Innhold

- React Native / Expo mobilapp
- FastAPI backend
- SQLite database
- Profil/CV
- Annonseanalyse fra URL (OpenAI)
- Generering av søknad + CV
- PDF-generering
- SMTP e-poststøtte (valgfritt)
- Historikk over analyser

## Viktig

Dette er ikke en ferdig APK. Det er et utviklerprosjekt som kan kjøres lokalt.
Appen inneholder **ikke jobbsøk / scraping / innlogging mot jobbkilder**.

## Start backend

### Enkelt (anbefalt)

```bash
./backend/scripts/dev_backend.sh
```

Stoppe backend:

```bash
./backend/scripts/stop_backend.sh
```

Scriptet oppretter `.venv`, installerer avhengigheter, sørger for at `backend/.env` finnes,
og genererer `JWT_SECRET` hvis den mangler.

### Manuelt

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate

cp .env.example .env
python3 scripts/bootstrap_env.py

pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Åpne API docs:

```text
http://localhost:8000/docs
```

Helsesjekk:

```text
http://localhost:8000/health
```

## Start mobilapp (Expo / React Native)

### Enkelt (anbefalt)

```bash
./mobile/scripts/dev_mobile.sh
```

Stoppe Expo:

```bash
./mobile/scripts/stop_mobile.sh
```

### Manuelt

```bash
cd mobile
npm install
npm start
```

## Testflyt (URL-only)

1. Start backend
2. Start mobilappen
3. Logg inn / lag konto
4. Lagre profil
5. Gå til **Ny analyse** og lim inn annonse-URL
6. Trykk **Analyser jobb**
7. (Valgfritt) Trykk **Send søknad** for å få PDF på e-post
8. Se genererte PDF-er i **Profil → Dokumenter**

## Web-app (for Capacitor)

Dette repoet inneholder også en enkel web-frontend i `web/` (React + Vite) som kan pakkes med Capacitor.

Kjør lokalt:

```bash
cd web
npm install

# peker til backend (dev)
# Linux/macOS:
VITE_API_URL=http://localhost:8000 npm run dev
# Windows (PowerShell):
# $env:VITE_API_URL="http://localhost:8000"; npm run dev
```

### Bygg Android (Capacitor) → AAB

1) Bygg web:

```bash
cd web
VITE_API_URL=https://DIN-BACKEND-URL npm run build
```

2) Legg til Android-plattform (første gang):

```bash
npx cap add android
```

3) Sync og åpne i Android Studio:

```bash
npx cap sync
npx cap open android
```

4) I Android Studio: Build → Generate Signed Bundle / APK → **Android App Bundle (AAB)**.

> Merk: `mobile/` (Expo) og `web/` (Capacitor) er to forskjellige klienter som kan bruke samme backend.

## Deploy (Render / /data)

Backend støtter nå en persistent data-mappe.

- Sett `APP_DATA_DIR=/data` i produksjon (Render Disk mount)
- Da lagres:
  - SQLite DB: `/data/jobbsoker.db`
  - PDF-er: `/data/generated_pdfs/`

Hvis `DATABASE_URL` er satt, brukes den alltid som "source of truth".

### Render Blueprint

Repoet inneholder `render.yaml` (Blueprint) som foreslår:
- Web Service (Docker) med `rootDir=backend`
- Disk mount på `/data`
- SMTP-variabler (provider-agnostic; default er Gmail-friendly)

Du må fortsatt sette hemmelige variabler i Render (sync=false):
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `FROM_EMAIL`

### SMTP-alternativer

#### Gmail (raskest for test)

Gmail krever **App Password** (og at 2FA er aktivert på kontoen).

Sett i Render:
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USER=<din@gmail.com>`
- `SMTP_PASSWORD=<GMAIL_APP_PASSWORD>`
- `FROM_EMAIL=<din@gmail.com>`

Valgfritt:
- `REPLY_TO_EMAIL=<din@gmail.com>`
- `SMTP_USE_TLS=true`
- `SMTP_TIMEOUT_SECONDS=20`

#### SendGrid (bedre ved større volum)

SendGrid kan være veldig bra for mange testere, men kan kreve betalingsoppsett.

- `SMTP_HOST=smtp.sendgrid.net`
- `SMTP_PORT=587`
- `SMTP_USER=apikey`
- `SMTP_PASSWORD=<SENDGRID_API_KEY>`
- `FROM_EMAIL=<verified sender>`
