#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

. .venv/bin/activate

pip install -r requirements.txt

python3 scripts/bootstrap_env.py

echo ""
echo "Backend starter på: http://0.0.0.0:8000"
echo "Docs:            http://127.0.0.1:8000/docs"
echo "Health:          http://127.0.0.1:8000/health"
echo ""

# If something else is already listening, fail with a clear message.
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":8000 "; then
  echo ""
  echo "Port 8000 er allerede i bruk."
  echo "Hvis det er en gammel backend, stopp den med: ./backend/scripts/stop_backend.sh"
  echo "Deretter kjør dette scriptet på nytt."
  echo ""
  exit 1
fi

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
