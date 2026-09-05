from __future__ import annotations

import os

import requests
from fastapi import HTTPException, status

# Interview questions are short -- this is generous headroom, and caps
# accidental/abusive Azure Speech usage from a single call.
MAX_TTS_CHARS = 1000

# Neural voices available for Norwegian Bokmaal (nb-NO) on Azure AI Speech.
# FinnNeural reads in a calm, even register that fits a job-interview
# question better than a more expressive newsreader-style voice -- but this
# is a judgment call, not a measured fact. Listen to both in the Azure
# Speech Studio voice gallery and override via AZURE_SPEECH_VOICE if you'd
# rather use nb-NO-IselinNeural (or another nb-NO neural voice).
DEFAULT_VOICE = "nb-NO-FinnNeural"

AUDIO_OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3"


def _escape_xml(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def synthesize_speech(text: str) -> bytes:
    """Turn `text` into spoken audio (mp3 bytes) via the Azure AI Speech REST API.

    Raises HTTPException on missing/oversized input, missing config, or an
    Azure API error -- callers can let it propagate straight to FastAPI.
    """

    clean_text = (text or "").strip()
    if not clean_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mangler tekst å lese opp")
    if len(clean_text) > MAX_TTS_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Teksten er for lang (maks {MAX_TTS_CHARS} tegn)",
        )

    key = (os.getenv("AZURE_SPEECH_KEY") or "").strip()
    region = (os.getenv("AZURE_SPEECH_REGION") or "").strip()
    if not key or not region:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Azure Speech er ikke konfigurert (AZURE_SPEECH_KEY/AZURE_SPEECH_REGION mangler)",
        )

    voice = (os.getenv("AZURE_SPEECH_VOICE") or "").strip() or DEFAULT_VOICE

    ssml = (
        "<speak version='1.0' xml:lang='nb-NO'>"
        f"<voice name='{voice}'>{_escape_xml(clean_text)}</voice>"
        "</speak>"
    )

    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": AUDIO_OUTPUT_FORMAT,
        "User-Agent": "AerligJobbcoach",
    }

    try:
        resp = requests.post(url, headers=headers, data=ssml.encode("utf-8"), timeout=15)
    except requests.RequestException as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Kunne ikke nå Azure Speech: {e}")

    if resp.status_code != 200:
        detail = (resp.text or f"HTTP {resp.status_code}")[:300]
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Azure Speech-feil: {detail}")

    if not resp.content:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Azure Speech returnerte tom lyd")

    return resp.content
