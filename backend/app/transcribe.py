from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import HTTPException, status
from openai import OpenAI

# OpenAI Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, webm
# We accept common mobile recording MIME types that map to those formats.
ALLOWED_MIME_TYPES: set[str] = {
    "audio/mpeg",  # mp3
    "audio/mp3",
    "audio/mp4",  # m4a/mp4 container
    "audio/x-m4a",
    "audio/m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/aac",
}

# Keep this conservative. Whisper also has its own limits.
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB


def transcribe_path(file_path: str | Path) -> str:
    """Transcribe an audio file using OpenAI audio transcription.

    The caller is responsible for deleting the file.
    """

    model = (os.getenv("OPENAI_TRANSCRIBE_MODEL") or "whisper-1").strip() or "whisper-1"

    client = OpenAI()

    with open(str(file_path), "rb") as f:
        res = client.audio.transcriptions.create(
            model=model,
            file=f,
        )

    # openai==1.x returns an object with `.text`
    text = getattr(res, "text", None)
    if text is None:
        # Defensive fallback
        text = str(res)

    return str(text or "")


def suffix_from_mime(content_type: str | None) -> str:
    ct = (content_type or "").split(";", 1)[0].strip().lower()

    if ct in {"audio/mpeg", "audio/mp3"}:
        return ".mp3"
    if ct in {"audio/mp4", "audio/x-m4a", "audio/m4a"}:
        return ".m4a"
    if ct in {"audio/wav", "audio/x-wav"}:
        return ".wav"
    if ct == "audio/webm":
        return ".webm"
    if ct == "audio/ogg":
        return ".ogg"
    if ct == "audio/aac":
        return ".aac"

    return ".audio"


def validate_upload(
    *,
    content_type: str | None,
    size_bytes: int,
) -> None:
    ct = (content_type or "").split(";", 1)[0].strip().lower()

    if size_bytes <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tom lydfil")

    if size_bytes > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Lydfilen er for stor (maks {MAX_AUDIO_BYTES // (1024 * 1024)} MB)",
        )

    # Content-Type can be missing/blank on some clients.
    if ct and ct not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ugyldig filtype: {ct}",
        )


def save_to_tempfile(*, data: bytes, content_type: str | None) -> Path:
    """Write bytes to a temp file and return its path (caller must delete)."""

    suf = suffix_from_mime(content_type)

    fd, name = tempfile.mkstemp(prefix="transcribe_", suffix=suf)
    p = Path(name)

    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    except Exception:
        # Best-effort cleanup if write fails.
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass
        raise

    return p
