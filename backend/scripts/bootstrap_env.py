import os
import re
from pathlib import Path

from cryptography.fernet import Fernet


ROOT = Path(__file__).resolve().parents[1]
ENV_EXAMPLE = ROOT / ".env.example"
ENV_FILE = ROOT / ".env"


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def ensure_env_file() -> None:
    if ENV_FILE.exists():
        return

    if ENV_EXAMPLE.exists():
        _write_text(ENV_FILE, _load_text(ENV_EXAMPLE))
    else:
        _write_text(ENV_FILE, "")


def ensure_key(name: str) -> None:
    content = _load_text(ENV_FILE)

    # If key exists and is non-empty, keep it.
    m = re.search(rf"^{re.escape(name)}=(.*)$", content, flags=re.MULTILINE)
    if m and m.group(1).strip():
        return

    value = Fernet.generate_key().decode("utf-8")

    if m:
        content = re.sub(
            rf"^{re.escape(name)}=.*$",
            f"{name}={value}",
            content,
            flags=re.MULTILINE,
        )
    else:
        if content and not content.endswith("\n"):
            content += "\n"
        content += f"{name}={value}\n"

    _write_text(ENV_FILE, content)


def main() -> None:
    ensure_env_file()
    # JWT signing secret for demo auth
    ensure_key("JWT_SECRET")

    print(f"OK: .env klar: {ENV_FILE}")


if __name__ == "__main__":
    main()
