from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import User

load_dotenv(".env")

_ALGORITHM = "HS256"
_ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 14  # 14 days (passwordless code login)

_security = HTTPBearer(auto_error=False)
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET mangler i backend/.env (bootstrap_env.py kan generere den)")
    return secret


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def create_access_token(*, user_id: int) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=_ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_ALGORITHM)


def get_user_from_token(token: str, db: Session) -> User:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ikke innlogget")

    try:
        data = jwt.decode(token, _jwt_secret(), algorithms=[_ALGORITHM])
        sub = data.get("sub")
        user_id = int(sub)
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ugyldig token")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ugyldig bruker")

    return user


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_security),
    db: Session = Depends(get_db),
) -> User:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ikke innlogget")

    return get_user_from_token(creds.credentials, db)


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.scalars(select(User).where(User.email == email)).first()
