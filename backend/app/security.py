import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

# NOTE:
# This project originally supported encrypted storage of credentials for job
# sources. The current app no longer uses that feature, but we keep these helper
# functions for compatibility.
#
# Importing this module must NOT crash if ENCRYPTION_KEY is missing; we only
# require the key when encrypt/decrypt is actually called.

def _get_fernet() -> Fernet:
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "ENCRYPTION_KEY mangler i backend/.env (kun nødvendig hvis du bruker kryptering)."
        )
    return Fernet(key.encode())


def encrypt_text(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_text(value: str) -> str:
    return _get_fernet().decrypt(value.encode()).decode()
