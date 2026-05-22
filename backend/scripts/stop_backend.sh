#!/usr/bin/env bash
set -euo pipefail

# Stop FastAPI/uvicorn started by dev_backend.sh
pkill -f "uvicorn app.main:app" || true
