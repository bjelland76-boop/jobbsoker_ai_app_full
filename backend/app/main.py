import json
import os
import hmac
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Union

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.orm import Session

from .auth import (
    create_access_token,
    get_current_user,
    get_user_by_email,
    get_user_from_token,
    hash_password,
    verify_password,
)
from .db import Base, SessionLocal, engine, get_db
from .emailer import send_email
from .models import (
    AppSetting,
    ApplicationProgress,
    GeneratedApplication,
    Job,
    JobAnalysisHistory,
    LoginCode,
    Profile,
    User,
)
from .pdfgen import OUT as GENERATED_PDFS_DIR, make_application_pdfs
from .schemas import (
    AnalyzeAndSendOut,
    ApplicationItemOut,
    CVAnalysisOut,
    EducationOptionOut,
    GeneratedApplicationItemOut,
    HealthOut,
    JobAnalysisItemOut,
    JobAnalysisOut,
    JobOut,
    ProfileOut,
    SettingsOut,
    SettingsSavedOut,
    StatsOut,
)


def ensure_profile_columns() -> None:
    """Very small, ad-hoc migration helper for the demo SQLite DB."""

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    with engine.connect() as conn:
        def ensure_col(table: str, col: str, ddl: str) -> None:
            if table not in tables:
                return
            cols = {c["name"] for c in inspector.get_columns(table)}
            if col in cols:
                return
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))

        # profiles
        ensure_col("profiles", "user_id", "user_id INTEGER")
        ensure_col("profiles", "address", "address TEXT DEFAULT ''")
        ensure_col("profiles", "postal_code", "postal_code TEXT DEFAULT ''")
        ensure_col("profiles", "postal_place", "postal_place TEXT DEFAULT ''")
        ensure_col("profiles", "photo_data", "photo_data TEXT DEFAULT ''")
        ensure_col("profiles", "include_photo_default", "include_photo_default INTEGER DEFAULT 1")
        ensure_col("profiles", "consent_analytics", "consent_analytics INTEGER DEFAULT 0")
        ensure_col("profiles", "target_role", "target_role TEXT DEFAULT ''")
        ensure_col("profiles", "education", "education TEXT DEFAULT ''")
        ensure_col("profiles", "skills", "skills TEXT DEFAULT ''")
        ensure_col("profiles", "languages", "languages TEXT DEFAULT ''")
        ensure_col("profiles", "references_json", "references_json TEXT DEFAULT ''")
        ensure_col("profiles", "cv_gaps", "cv_gaps TEXT DEFAULT ''")

        # jobs
        ensure_col("jobs", "user_id", "user_id INTEGER")

        # app_settings
        ensure_col("app_settings", "user_id", "user_id INTEGER")

        # generated_applications
        ensure_col(
            "generated_applications",
            "cv_pdf_path",
            "cv_pdf_path TEXT DEFAULT ''",
        )

        # job_analysis_history
        ensure_col(
            "job_analysis_history",
            "analysis_json",
            "analysis_json TEXT DEFAULT ''",
        )

        # login_codes (passwordless)
        ensure_col("login_codes", "ip", "ip TEXT DEFAULT ''")

        conn.commit()


def _parse_json_field(value):
    if value is None or value == "":
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return parsed
        return [parsed]
    except Exception:
        if isinstance(value, str):
            return [value]
        return value


def _serialize_profile_field(value):
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    return value


def _to_text(value) -> str:
    """Normalize possibly-structured LLM output to plain text.

    Some OpenAI responses may return nested objects for fields like tailored_cv.
    We store these as text in SQLite and render them into PDFs, so we coerce
    non-string values into pretty JSON.
    """

    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, indent=2)
    except Exception:
        return str(value)


def _format_references_block(profile: Profile) -> str:
    """Return a CV-ready references section based on profile.references_json."""

    items = _parse_json_field(getattr(profile, "references_json", ""))
    if not items:
        return "Referanser:\nReferanser oppgis ved forespørsel."

    lines: list[str] = ["Referanser:"]
    for it in items:
        if isinstance(it, str):
            name = it.strip()
            if name:
                lines.append(f"• {name}")
            continue

        if not isinstance(it, dict):
            continue

        name = str(it.get("name") or "").strip()
        relation = str(it.get("relation") or "").strip()
        contact = str(it.get("contact") or "").strip()

        main = " – ".join([x for x in [name, relation] if x])
        if not main and contact:
            main = contact
        if not main:
            continue

        if contact and contact not in main:
            lines.append(f"• {main} ({contact})")
        else:
            lines.append(f"• {main}")

    if len(lines) == 1:
        return "Referanser:\nReferanser oppgis ved forespørsel."

    return "\n".join(lines)


def _inject_references_into_cv(profile: Profile, tailored_cv: str) -> str:
    """Ensure references are present in CV text.

    We only inject references into the CV content used for PDF generation.
    (We do NOT inject into cover letter or email body.)
    """

    ref_block = _format_references_block(profile)

    cv_out = tailored_cv or ""
    if "referanser" not in (cv_out or "").casefold():
        cv_out = (cv_out.rstrip() + "\n\n" + ref_block + "\n").lstrip("\n")

    return cv_out


def profile_to_dict(profile: Profile) -> dict:
    # Be defensive: older demo rows may have NULLs.
    return {
        "id": int(profile.id),
        "user_id": getattr(profile, "user_id", None),
        "name": (getattr(profile, "name", "") or ""),
        "email": (getattr(profile, "email", "") or ""),
        "phone": (getattr(profile, "phone", "") or ""),
        "address": (getattr(profile, "address", "") or ""),
        "postal_code": (getattr(profile, "postal_code", "") or ""),
        "postal_place": (getattr(profile, "postal_place", "") or ""),
        "photo_data": (getattr(profile, "photo_data", "") or ""),
        "include_photo_default": (
            True
            if getattr(profile, "include_photo_default", None) is None
            else bool(getattr(profile, "include_photo_default"))
        ),
        "consent_analytics": bool(getattr(profile, "consent_analytics", False)),
        "experience": _parse_json_field(getattr(profile, "experience", "")),
        "education": _parse_json_field(getattr(profile, "education", "")),
        "skills": (getattr(profile, "skills", "") or ""),
        "languages": _parse_json_field(getattr(profile, "languages", "")),
        "references": _parse_json_field(getattr(profile, "references_json", "")),
        "cv_gaps": (getattr(profile, "cv_gaps", "") or ""),
        "target_role": (getattr(profile, "target_role", "") or ""),
        "cv_text": (getattr(profile, "cv_text", "") or ""),
        "tone": (getattr(profile, "tone", "") or "normal"),
    }


def job_to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "user_id": getattr(job, "user_id", None),
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "url": job.url,
        "description": job.description,
        "match_score": job.match_score,
        "status": job.status,
        "created_at": job.created_at,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure tables exist before serving requests.
    Base.metadata.create_all(bind=engine)
    ensure_profile_columns()

    # Best-effort cleanup of old login codes.
    try:
        db = SessionLocal()
        _cleanup_login_codes(db)
    except Exception:
        pass
    finally:
        try:
            db.close()  # type: ignore[name-defined]
        except Exception:
            pass

    yield


app = FastAPI(title="AI Jobbsøker", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProfileIn(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""
    postal_code: str = ""
    postal_place: str = ""
    photo_data: str = ""
    include_photo_default: bool = True
    consent_analytics: bool = False
    target_role: str = ""
    experience: Union[str, list[dict]] = ""
    education: Union[str, list[dict]] = ""
    skills: str = ""
    languages: Union[str, list[str]] = ""
    references: Union[str, list[dict]] = ""
    cv_gaps: str = ""
    cv_text: str = ""
    tone: str = "normal"


class SettingsIn(BaseModel):
    notification_email: str = ""
    auto_email: bool = True


class AnalyzeUrlIn(BaseModel):
    profile_id: int
    url: str
    application_style: str = "vanlig"  # kort | vanlig | profesjonell


class AnalyzeCvIn(BaseModel):
    profile_id: int


class SendAnalysisIn(BaseModel):
    profile_id: int
    url: str
    to_email: str
    application_style: str = "vanlig"  # kort | vanlig | profesjonell
    include_photo: bool = True


class ProgressIn(BaseModel):
    applied: bool | None = None
    interviewed: bool | None = None
    got_job: bool | None = None


class RegisterIn(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class RequestCodeIn(BaseModel):
    email: str


class VerifyCodeIn(BaseModel):
    email: str
    code: str
    # Optional: only used when creating a new account via passwordless login.
    name: str | None = None


class CodeSentOut(BaseModel):
    sent: bool


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int


class EmailExistsOut(BaseModel):
    exists: bool


@app.get("/", tags=["meta"])
def root():
    return {"status": "ok", "app": "AI Jobbsøker"}


@app.get("/health", response_model=HealthOut, tags=["meta"])
def health(db: Session = Depends(get_db)):
    checks: dict[str, object] = {}

    # DB check
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception as e:
        checks["database"] = False
        checks["database_error"] = str(e)

    checks["jwt_secret_present"] = bool(os.getenv("JWT_SECRET"))
    checks["openai_key_present"] = bool(os.getenv("OPENAI_API_KEY"))

    smtp_host = os.getenv("SMTP_HOST")
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("FROM_EMAIL") or smtp_user

    checks["smtp_configured"] = bool(smtp_host and smtp_user and smtp_password and from_email)

    required_ok = bool(checks["database"] and checks["jwt_secret_present"])
    status_text = "ok" if required_ok else "degraded"

    return {"status": status_text, "checks": checks}


@app.post("/auth/register", response_model=TokenOut, tags=["auth"])
def register(data: RegisterIn, db: Session = Depends(get_db)):
    email = (data.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig e-post")
    if not data.password or len(data.password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passord må være minst 6 tegn")

    if get_user_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bruker finnes allerede")

    user = User(email=email, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    # Claim existing demo data (if any) to this user.
    for table in ["profiles", "jobs", "app_settings"]:
        try:
            db.execute(text(f"UPDATE {table} SET user_id=:uid WHERE user_id IS NULL"), {"uid": user.id})
        except Exception:
            pass
    db.commit()

    # Ensure the new user has at least one profile so the app can greet them by name.
    existing_profile = db.scalars(select(Profile).where(Profile.user_id == user.id)).first()

    display_name = (data.name or "").strip()
    if not display_name:
        display_name = (email.split("@", 1)[0] or "Bruker").strip()

    if existing_profile:
        # If demo data was claimed, make sure the greeting uses the user's chosen name.
        if (existing_profile.name or "").strip() in {"", "Ærlig JobbCoach"} or (data.name or "").strip():
            existing_profile.name = display_name
        if not (existing_profile.email or "").strip():
            existing_profile.email = email
        db.commit()
    else:
        p = Profile(
            user_id=user.id,
            name=display_name,
            email=email,
            phone="",
            address="",
            include_photo_default=True,
            consent_analytics=False,
            target_role="",
            cv_text="",
            experience="",
            education="",
            skills="",
            languages="[]",
            references_json="[]",
            cv_gaps="",
            tone="normal",
        )
        db.add(p)
        db.commit()

    return {"access_token": create_access_token(user_id=user.id), "user_id": user.id, "token_type": "bearer"}


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _client_ip(request: Request | None) -> str:
    if not request:
        return ""

    # If behind a proxy, respect X-Forwarded-For (first IP)
    xff = request.headers.get("x-forwarded-for") or request.headers.get("x-forwarded_for")
    if xff:
        return (xff.split(",")[0] or "").strip()

    return (getattr(getattr(request, "client", None), "host", None) or "").strip()


def _code_hash(code: str) -> str:
    # HMAC with JWT_SECRET so the DB does not store the code in cleartext.
    secret = os.getenv("JWT_SECRET") or ""
    if not secret:
        # Should never happen (health requires it), but be explicit.
        raise RuntimeError("JWT_SECRET mangler")

    msg = (code or "").strip().encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, digestmod="sha256").hexdigest()


def _cleanup_login_codes(db: Session, *, keep_days: int = 7) -> None:
    """Best-effort cleanup to keep login_codes from growing forever."""

    cutoff = datetime.utcnow() - timedelta(days=keep_days)
    try:
        db.execute(
            delete(LoginCode).where(
                (LoginCode.expires_at < cutoff)
                | ((LoginCode.used_at.is_not(None)) & (LoginCode.used_at < cutoff))
            )
        )
        db.commit()
    except Exception:
        # Never block login flow on cleanup.
        try:
            db.rollback()
        except Exception:
            pass


def _ensure_user_and_profile(db: Session, email: str, *, display_name: str | None = None) -> User:
    """Create user + default profile if missing.

    `display_name` is optional and is only applied when creating a new profile
    (or when the existing profile still has a default/placeholder name).
    """

    email_local = (email.split("@", 1)[0] or "Bruker").strip() or "Bruker"
    wanted_name = (display_name or "").strip() or None

    def _should_overwrite_name(current: str | None) -> bool:
        cur = (current or "").strip()
        if not cur:
            return True
        return cur in {email_local, "Bruker", "Ærlig JobbCoach"}

    user = get_user_by_email(db, email)
    if user:
        existing_profile = db.scalars(select(Profile).where(Profile.user_id == user.id)).first()
        if existing_profile:
            # Best-effort: if this looks like an auto-generated name, allow overwriting
            # with the chosen display name.
            if wanted_name and _should_overwrite_name(getattr(existing_profile, "name", "")):
                existing_profile.name = wanted_name
                if not (existing_profile.email or "").strip():
                    existing_profile.email = email
                db.commit()
            return user

    if not user:
        # passwordless => keep empty password_hash (not used)
        user = User(email=email, password_hash="")
        db.add(user)
        db.commit()
        db.refresh(user)

        # Claim existing demo data (if any) to this user.
        for table in ["profiles", "jobs", "app_settings"]:
            try:
                db.execute(text(f"UPDATE {table} SET user_id=:uid WHERE user_id IS NULL"), {"uid": user.id})
            except Exception:
                pass
        db.commit()

    # Ensure the user has at least one profile for greeting + profile flow.
    p = Profile(
        user_id=user.id,
        name=(wanted_name or email_local),
        email=email,
        phone="",
        address="",
        include_photo_default=True,
        consent_analytics=False,
        target_role="",
        cv_text="",
        experience="",
        education="",
        skills="",
        languages="[]",
        references_json="[]",
        cv_gaps="",
        tone="normal",
    )
    db.add(p)
    db.commit()

    return user


@app.post("/auth/request-code", response_model=CodeSentOut, tags=["auth"])
def request_login_code(
    data: RequestCodeIn,
    request: Request,
    db: Session = Depends(get_db),
):
    # Keep the table small.
    _cleanup_login_codes(db)

    email = _normalize_email(data.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig e-post")

    now = datetime.utcnow()
    ip = _client_ip(request)

    # Rate limits
    # - prevent rapid-fire sends
    # - prevent mass-spam from one IP
    email_min_interval_seconds = 30
    email_max_per_hour = 5
    ip_max_per_hour = 20

    recent = db.scalars(
        select(LoginCode)
        .where(
            LoginCode.email == email,
            LoginCode.created_at >= (now - timedelta(seconds=email_min_interval_seconds)),
        )
        .order_by(LoginCode.created_at.desc())
    ).first()

    if recent:
        # Return OK without sending another mail (avoid spamming).
        return {"sent": True}

    hour_start = now - timedelta(hours=1)
    email_count = db.scalar(
        select(func.count(LoginCode.id)).where(
            LoginCode.email == email,
            LoginCode.created_at >= hour_start,
        )
    ) or 0

    ip_count = 0
    if ip:
        ip_count = db.scalar(
            select(func.count(LoginCode.id)).where(
                LoginCode.ip == ip,
                LoginCode.created_at >= hour_start,
            )
        ) or 0

    if int(email_count) >= email_max_per_hour or int(ip_count) >= ip_max_per_hour:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="For mange forsøk. Vent litt og prøv igjen.",
        )

    # Invalidate any previous unused codes for this email (avoid many valid codes).
    try:
        db.execute(
            text(
                "UPDATE login_codes SET used_at=:now WHERE email=:email AND used_at IS NULL AND expires_at>=:now"
            ),
            {"now": now, "email": email},
        )
        db.commit()
    except Exception:
        pass

    code = f"{secrets.randbelow(1_000_000):06d}"

    row = LoginCode(
        email=email,
        ip=ip,
        user_id=None,
        code_hash=_code_hash(code),
        attempts=0,
        expires_at=now + timedelta(minutes=10),
        used_at=None,
    )
    db.add(row)
    db.commit()

    subject = "Din innloggingskode"
    body = (
        "Her er din engangskode for innlogging:\n\n"
        f"{code}\n\n"
        "Koden er gyldig i 10 minutter.\n"
        "Når du logger inn vil du være innlogget i 14 dager.\n"
    )

    email_result = send_email(email, subject, body)
    if isinstance(email_result, dict) and email_result.get("sent") is False:
        # Best-effort cleanup
        try:
            db.delete(row)
            db.commit()
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(email_result.get("reason") or "Kunne ikke sende e-post"))

    return {"sent": True}


@app.post("/auth/verify-code", response_model=TokenOut, tags=["auth"])
def verify_login_code(data: VerifyCodeIn, request: Request, db: Session = Depends(get_db)):
    email = _normalize_email(data.email)
    code = (data.code or "").strip()

    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig e-post")

    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig kode")

    now = datetime.utcnow()

    ip = _client_ip(request)

    row = db.scalars(
        select(LoginCode)
        .where(
            LoginCode.email == email,
            LoginCode.used_at.is_(None),
            LoginCode.expires_at >= now,
        )
        .order_by(LoginCode.created_at.desc())
    ).first()

    # Small IP-based verify limiter (best-effort):
    # if one IP is hammering verification, block.
    if ip:
        window = now - timedelta(minutes=15)
        ip_created = db.scalar(
            select(func.count(LoginCode.id)).where(
                LoginCode.ip == ip,
                LoginCode.created_at >= window,
            )
        ) or 0
        if int(ip_created) >= 60:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="For mange forsøk. Vent litt og prøv igjen.",
            )

    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Koden er utløpt eller ugyldig")

    if int(getattr(row, "attempts", 0) or 0) >= 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="For mange forsøk. Be om ny kode.")

    if not hmac.compare_digest(row.code_hash or "", _code_hash(code)):
        row.attempts = int(getattr(row, "attempts", 0) or 0) + 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Koden er utløpt eller ugyldig")

    row.used_at = now
    db.commit()

    existed = bool(get_user_by_email(db, email))
    wanted_name = (data.name or "").strip() if not existed else None

    user = _ensure_user_and_profile(db, email, display_name=wanted_name)

    return {"access_token": create_access_token(user_id=user.id), "user_id": user.id, "token_type": "bearer"}


@app.post("/auth/login", response_model=TokenOut, tags=["auth"], deprecated=True)
def login(data: LoginIn, db: Session = Depends(get_db)):
    """Deprecated password login (kept for backwards compatibility)."""

    email = (data.email or "").strip().lower()
    user = get_user_by_email(db, email)
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Feil e-post eller passord")

    return {"access_token": create_access_token(user_id=user.id), "user_id": user.id, "token_type": "bearer"}


@app.get("/auth/me", tags=["auth"])
def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email}


@app.get("/auth/email-exists", response_model=EmailExistsOut, tags=["auth"])
def email_exists(email: str = Query(...), db: Session = Depends(get_db)):
    """Used by the frontend to decide whether to show Login vs Create account flow."""

    e = _normalize_email(email)
    if not e or "@" not in e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig e-post")

    return {"exists": bool(get_user_by_email(db, e))}


@app.delete("/me", tags=["auth"])
def delete_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete the authenticated user and all their data (GDPR-friendly)."""

    profile_ids = list(db.scalars(select(Profile.id).where(Profile.user_id == current_user.id)).all())
    job_ids = list(db.scalars(select(Job.id).where(Job.user_id == current_user.id)).all())

    # Collect PDF files to remove (best-effort).
    pdf_paths: list[str] = []
    if profile_ids:
        gen_rows = db.scalars(
            select(GeneratedApplication).where(GeneratedApplication.profile_id.in_(profile_ids))
        ).all()
        for r in gen_rows:
            if getattr(r, "pdf_path", ""):
                pdf_paths.append(r.pdf_path)
            if getattr(r, "cv_pdf_path", ""):
                pdf_paths.append(r.cv_pdf_path)

    # Delete dependent rows first.
    if profile_ids:
        db.execute(delete(ApplicationProgress).where(ApplicationProgress.profile_id.in_(profile_ids)))
        db.execute(delete(JobAnalysisHistory).where(JobAnalysisHistory.profile_id.in_(profile_ids)))
        db.execute(delete(GeneratedApplication).where(GeneratedApplication.profile_id.in_(profile_ids)))

    if job_ids:
        db.execute(delete(ApplicationProgress).where(ApplicationProgress.job_id.in_(job_ids)))
        db.execute(delete(JobAnalysisHistory).where(JobAnalysisHistory.job_id.in_(job_ids)))
        db.execute(delete(GeneratedApplication).where(GeneratedApplication.job_id.in_(job_ids)))

    db.execute(delete(Job).where(Job.user_id == current_user.id))
    db.execute(delete(Profile).where(Profile.user_id == current_user.id))
    db.execute(delete(AppSetting).where(AppSetting.user_id == current_user.id))
    db.execute(delete(User).where(User.id == current_user.id))

    db.commit()

    base_dir = GENERATED_PDFS_DIR.resolve()
    removed = 0
    for rel in pdf_paths:
        try:
            p = Path(rel).resolve()
            if base_dir != p and base_dir not in p.parents:
                continue
            if p.exists() and p.is_file():
                p.unlink()
                removed += 1
        except Exception:
            pass

    return {"deleted": True, "pdf_files_removed": removed}


@app.get(
    "/education-options",
    response_model=list[EducationOptionOut],
    tags=["education"],
)
def education_options(
    q: str = Query(default="", description="Søkestreng"),
    kind: str = Query(
        default="all",
        description="all | vgs | universitet | nettskole",
    ),
    limit: int = Query(default=50, ge=1, le=200),
):
    """Autocomplete for education institutions.

    - vgs is sourced from Udirs NSR API (cached)
    - universitet/nettskole is a curated list

    Note: For VGS we return name + kommune (when known).
    """

    from .education_catalog import get_static, get_videregaende_skoler, search_in

    items: list[dict] = []

    if kind in {"all", "vgs"}:
        vgs = get_videregaende_skoler()
        items.extend(search_in(vgs, q))

    if kind in {"all", "universitet"}:
        uni = get_static("universitet")
        items.extend(search_in(uni, q))

    if kind in {"all", "nettskole"}:
        ns = get_static("nettskole")
        items.extend(search_in(ns, q))

    # De-duplicate by name (case-insensitive)
    seen: set[str] = set()
    out: list[dict] = []
    for it in items:
        key = (it.get("name") or "").casefold().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "name": it.get("name"),
            "kind": it.get("kind"),
            "kommune": it.get("kommune"),
        })

    # Basic deterministic ordering
    out.sort(key=lambda x: (x.get("kind") or "", (x.get("name") or "").casefold()))

    return out[:limit]


@app.get("/profiles", response_model=list[ProfileOut])
def get_profiles(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profiles = db.scalars(select(Profile).where(Profile.user_id == current_user.id)).all()
    return [profile_to_dict(profile) for profile in profiles]


@app.get("/profiles/{profile_id}", response_model=ProfileOut)
def get_profile(profile_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profil ikke funnet")
    return profile_to_dict(profile)


@app.post("/profiles", response_model=ProfileOut)
def create_profile(data: ProfileIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    payload = data.model_dump()
    payload["experience"] = _serialize_profile_field(payload.get("experience"))
    payload["education"] = _serialize_profile_field(payload.get("education"))
    payload["languages"] = _serialize_profile_field(payload.get("languages"))

    # Map API field "references" -> DB column "references_json"
    payload["references_json"] = _serialize_profile_field(payload.pop("references", ""))

    payload["user_id"] = current_user.id
    profile = Profile(**payload)
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return profile_to_dict(profile)


@app.put("/profiles/{profile_id}", response_model=ProfileOut)
def update_profile(profile_id: int, data: ProfileIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profil ikke funnet")

    for key, value in data.model_dump(exclude_unset=True).items():
        if key in {"experience", "education", "languages", "references"}:
            value = _serialize_profile_field(value)
        if key == "references":
            key = "references_json"
        setattr(profile, key, value)

    db.commit()
    db.refresh(profile)

    return profile_to_dict(profile)


@app.get("/settings", response_model=SettingsOut)
def get_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = db.scalars(select(AppSetting).where(AppSetting.user_id == current_user.id)).first()
    if not s:
        return {"notification_email": "", "auto_email": True}

    return {
        "notification_email": s.notification_email,
        "auto_email": s.auto_email,
    }


@app.post("/settings", response_model=SettingsSavedOut)
def save_settings(data: SettingsIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = db.scalars(select(AppSetting).where(AppSetting.user_id == current_user.id)).first()
    if not s:
        s = AppSetting(user_id=current_user.id)
        db.add(s)

    s.notification_email = data.notification_email
    s.auto_email = data.auto_email

    db.commit()
    db.refresh(s)

    return {
        "saved": True,
        "notification_email": s.notification_email,
        "auto_email": s.auto_email,
    }


def _upsert_analysis_history(
    db: Session,
    profile_id: int,
    job_id: int,
    match_score: float | int | None,
    analysis_json: str | None = None,
) -> JobAnalysisHistory:
    row = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
        )
    ).first()

    if not row:
        row = JobAnalysisHistory(profile_id=profile_id, job_id=job_id)
        db.add(row)

    row.match_score = float(match_score or 0)
    row.hidden = False

    if analysis_json is not None:
        row.analysis_json = analysis_json

    row.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(row)
    return row


def _upsert_progress(db: Session, profile_id: int, job_id: int) -> ApplicationProgress:
    row = db.scalars(
        select(ApplicationProgress).where(
            ApplicationProgress.profile_id == profile_id,
            ApplicationProgress.job_id == job_id,
        )
    ).first()

    if row:
        return row

    row = ApplicationProgress(profile_id=profile_id, job_id=job_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get(
    "/generated-applications",
    response_model=list[GeneratedApplicationItemOut],
    tags=["generated"],
)
def list_generated_applications(
    profile_id: int = Query(..., ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    rows = db.execute(
        select(GeneratedApplication, Job)
        .join(Job, GeneratedApplication.job_id == Job.id)
        .where(
            GeneratedApplication.profile_id == profile_id,
            Job.user_id == current_user.id,
        )
        .order_by(GeneratedApplication.created_at.desc())
    ).all()

    out: list[dict] = []
    for approw, job in rows:
        out.append(
            {
                "id": approw.id,
                "job": job_to_dict(job),
                "created_at": approw.created_at,
                "cover_pdf_url": f"/generated-applications/{approw.id}/pdf/cover",
                "cv_pdf_url": f"/generated-applications/{approw.id}/pdf/cv",
            }
        )

    return out


@app.get(
    "/generated-applications/{application_id}/pdf/{kind}",
    tags=["generated"],
)
def download_generated_pdf(
    application_id: int,
    kind: str,
    token: str | None = Query(default=None, description="JWT token (for opening PDFs in browser/Expo)"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    # Auth: this endpoint is often opened in a browser where Authorization headers
    # are not easily set. For the demo we also accept a token via query string.
    token_str = None
    if authorization and isinstance(authorization, str) and authorization.lower().startswith("bearer "):
        token_str = authorization.split(" ", 1)[1].strip()
    if not token_str:
        token_str = (token or "").strip() or None

    if not token_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ikke innlogget")

    current_user = get_user_from_token(token_str, db)

    approw = db.get(GeneratedApplication, application_id)
    if not approw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke dokument")

    profile = db.get(Profile, approw.profile_id)
    job = db.get(Job, approw.job_id)
    if not profile or not job or profile.user_id != current_user.id or job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke dokument")

    kind_norm = (kind or "").strip().lower()
    if kind_norm not in {"cover", "cv"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig type")

    rel_path = approw.pdf_path if kind_norm == "cover" else (getattr(approw, "cv_pdf_path", "") or approw.pdf_path)
    if not rel_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF ikke funnet")

    base_dir = GENERATED_PDFS_DIR.resolve()
    file_path = Path(rel_path).resolve()

    # Prevent path traversal and only allow serving files from generated_pdfs.
    if base_dir != file_path and base_dir not in file_path.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig filsti")

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF ikke funnet")

    return FileResponse(
        str(file_path),
        media_type="application/pdf",
        filename=file_path.name,
    )


@app.post("/analyze-cv", response_model=CVAnalysisOut, tags=["cv"])
def analyze_cv(
    data: AnalyzeCvIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .cv_analyzer import analyze_profile_cv

    profile = db.get(Profile, data.profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    try:
        return analyze_profile_cv(profile)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/job-analyses", response_model=list[JobAnalysisItemOut], tags=["analysis"])
def list_job_analyses(
    profile_id: int = Query(..., ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    rows = db.execute(
        select(JobAnalysisHistory, Job)
        .join(Job, JobAnalysisHistory.job_id == Job.id)
        .where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.hidden == False,  # noqa: E712
        )
        .order_by(JobAnalysisHistory.updated_at.desc())
    ).all()

    out: list[dict] = []
    for hist, job in rows:
        out.append(
            {
                "job": job_to_dict(job),
                "match_score": float(hist.match_score or 0),
                "analyzed_at": hist.updated_at,
            }
        )

    return out


@app.get(
    "/job-analyses/{job_id}",
    response_model=JobAnalysisOut,
    tags=["analysis"],
)
def get_job_analysis(
    job_id: int,
    profile_id: int = Query(..., ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    job = db.get(Job, job_id)
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke jobb")

    row = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
            JobAnalysisHistory.hidden == False,  # noqa: E712
        )
    ).first()

    if not row or not getattr(row, "analysis_json", ""):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyse ikke funnet")

    try:
        data = json.loads(row.analysis_json)
    except Exception:
        data = {}

    if not isinstance(data, dict):
        data = {"data": data}

    data["job_id"] = job_id
    return data


@app.post(
    "/job-analyses/{job_id}/generate-pdf",
    response_model=GeneratedApplicationItemOut,
    tags=["generated"],
)
def generate_pdfs_from_saved_analysis(
    job_id: int,
    profile_id: int = Query(..., ge=1),
    include_photo: bool = Query(default=True),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate PDFs from a previously saved analysis (no new OpenAI call)."""

    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    job = db.get(Job, job_id)
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke jobb")

    row = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
            JobAnalysisHistory.hidden == False,  # noqa: E712
        )
    ).first()

    if not row or not getattr(row, "analysis_json", ""):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fant ikke lagret analyse. Kjør analyse på nytt.",
        )

    try:
        data = json.loads(row.analysis_json)
    except Exception:
        data = {}

    if not isinstance(data, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig analysetekst")

    cover_letter = _to_text(data.get("cover_letter"))
    tailored_cv = _to_text(data.get("tailored_cv"))
    email_text = _to_text(data.get("email_text"))

    pdf_tailored_cv = _inject_references_into_cv(profile, tailored_cv)

    if not cover_letter.strip() or not tailored_cv.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Analysen mangler søknad/CV-tekst. Kjør analyse på nytt.",
        )

    cover_pdf, cv_pdf = make_application_pdfs(
        profile,
        job,
        cover_letter,
        pdf_tailored_cv,
        include_photo=include_photo,
    )

    approw = GeneratedApplication(
        job_id=job.id,
        profile_id=profile.id,
        email_text=email_text,
        cover_letter=cover_letter,
        tailored_cv=tailored_cv,
        pdf_path=cover_pdf,
        cv_pdf_path=cv_pdf,
    )

    db.add(approw)
    db.commit()
    db.refresh(approw)

    # Optional but useful: show this job under "Søknader" tracking.
    _upsert_progress(db, profile.id, job.id)

    return {
        "id": approw.id,
        "job": job_to_dict(job),
        "created_at": approw.created_at,
        "cover_pdf_url": f"/generated-applications/{approw.id}/pdf/cover",
        "cv_pdf_url": f"/generated-applications/{approw.id}/pdf/cv",
    }


@app.post(
    "/job-analyses/{job_id}/hide/{profile_id}",
    response_model=dict,
    tags=["analysis"],
)
def hide_job_analysis(
    job_id: int,
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    row = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
        )
    ).first()

    if not row:
        # Nothing to hide; treat as success.
        return {"hidden": True}

    row.hidden = True
    row.updated_at = datetime.utcnow()
    db.commit()

    return {"hidden": True}


@app.post("/analyze-url", response_model=JobAnalysisOut)
def analyze_url(
    data: AnalyzeUrlIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .job_analyzer import analyze_job_url

    profile = db.get(Profile, data.profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    try:
        result = analyze_job_url(profile, data.url, application_style=data.application_style)

        # Persist job so it can be tracked in the app later.
        job = db.scalars(select(Job).where(Job.url == data.url, Job.user_id == current_user.id)).first()
        if not job:
            job = Job(
                user_id=current_user.id,
                title=result.get("job_title") or "Ukjent stilling",
                company=result.get("company") or "",
                location="",
                url=data.url,
                description="",
                match_score=float(result.get("match_score") or 0),
                status="analyzed",
            )
            db.add(job)
        else:
            # Update existing job with latest analysis results.
            job.title = result.get("job_title") or job.title
            job.company = result.get("company") or job.company
            job.match_score = float(result.get("match_score") or job.match_score)
            job.status = "analyzed"
        db.commit()
        db.refresh(job)

        _upsert_analysis_history(
            db,
            data.profile_id,
            job.id,
            result.get("match_score"),
            analysis_json=json.dumps(result, ensure_ascii=False),
        )

        result["job_id"] = job.id
        return result
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/analyze-url-and-send", response_model=AnalyzeAndSendOut)
def analyze_url_and_send(
    data: SendAnalysisIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .job_analyzer import analyze_job_url

    profile = db.get(Profile, data.profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    try:
        result = analyze_job_url(profile, data.url, application_style=data.application_style)

        # Persist job so it can be tracked in the app.
        job = db.scalars(select(Job).where(Job.url == data.url, Job.user_id == current_user.id)).first()
        if not job:
            job = Job(
                user_id=current_user.id,
                title=result.get("job_title") or "Ukjent stilling",
                company=result.get("company") or "",
                location="",
                url=data.url,
                description="",
                match_score=float(result.get("match_score") or 0),
                status="analyzed",
            )
            db.add(job)
        else:
            # Update existing job with latest analysis results.
            job.title = result.get("job_title") or job.title
            job.company = result.get("company") or job.company
            job.match_score = float(result.get("match_score") or job.match_score)
            job.status = "analyzed"
        db.commit()
        db.refresh(job)

        cover_letter = _to_text(result.get("cover_letter"))
        tailored_cv = _to_text(result.get("tailored_cv"))
        email_text = _to_text(result.get("email_text"))

        pdf_tailored_cv = _inject_references_into_cv(profile, tailored_cv)

        cover_pdf, cv_pdf = make_application_pdfs(
            profile,
            job,
            cover_letter,
            pdf_tailored_cv,
            include_photo=bool(data.include_photo),
        )

        # Persist generated content.
        approw = GeneratedApplication(
            job_id=job.id,
            profile_id=profile.id,
            email_text=email_text,
            cover_letter=cover_letter,
            tailored_cv=tailored_cv,
            pdf_path=cover_pdf,
            cv_pdf_path=cv_pdf,
        )

        db.add(approw)
        db.commit()
        db.refresh(approw)

        _upsert_progress(db, profile.id, job.id)
        _upsert_analysis_history(
            db,
            profile.id,
            job.id,
            result.get("match_score"),
            analysis_json=json.dumps(result, ensure_ascii=False),
        )

        body = (
            f"{email_text}\n\n"
            f"Match-score: {result.get('match_score')}%\n\n"
            f"Ærlig vurdering:\n{_to_text(result.get('honest_assessment'))}\n\n"
            f"--- SØKNAD ---\n{cover_letter}\n\n"
            f"--- CV ---\n{tailored_cv}"
        )

        attachments = [cover_pdf]
        if cv_pdf and cv_pdf != cover_pdf:
            attachments.append(cv_pdf)

        email_result = send_email(
            data.to_email,
            f"Jobbanalyse: {result.get('job_title', 'stilling')}",
            body,
            attachments=attachments,
        )

        actually_sent = True
        if isinstance(email_result, dict) and email_result.get("sent") is False:
            actually_sent = False

        result["job_id"] = job.id

        return {"sent": actually_sent, "analysis": result}

    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


def _calc_stats(rows: list[ApplicationProgress]) -> dict:
    total = len(rows)
    applied = sum(1 for r in rows if r.applied)
    interviewed = sum(1 for r in rows if r.interviewed)
    got_job = sum(1 for r in rows if r.got_job)

    interview_rate = (interviewed / applied) if applied else 0.0
    hire_rate = (got_job / applied) if applied else 0.0

    return {
        "total": total,
        "applied": applied,
        "interviewed": interviewed,
        "got_job": got_job,
        "interview_rate": float(round(interview_rate, 4)),
        "hire_rate": float(round(hire_rate, 4)),
    }


@app.get("/applications", response_model=list[ApplicationItemOut], tags=["applications"])
def list_applications(
    profile_id: int = Query(..., ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    rows = db.execute(
        select(ApplicationProgress, Job)
        .join(Job, ApplicationProgress.job_id == Job.id)
        .where(ApplicationProgress.profile_id == profile_id)
        .order_by(ApplicationProgress.updated_at.desc())
    ).all()

    out: list[dict] = []
    for progress, job in rows:
        out.append(
            {
                "job": job_to_dict(job),
                "applied": bool(progress.applied),
                "interviewed": bool(progress.interviewed),
                "got_job": bool(progress.got_job),
                "updated_at": progress.updated_at,
            }
        )

    return out


@app.post(
    "/applications/{job_id}/progress/{profile_id}",
    response_model=ApplicationItemOut,
    tags=["applications"],
)
def update_progress(
    job_id: int,
    profile_id: int,
    data: ProgressIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = db.get(Job, job_id)
    profile = db.get(Profile, profile_id)
    if not job or not profile or profile.user_id != current_user.id or job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke jobb eller profil")

    row = db.scalars(
        select(ApplicationProgress).where(
            ApplicationProgress.profile_id == profile_id,
            ApplicationProgress.job_id == job_id,
        )
    ).first()

    if not row:
        row = ApplicationProgress(profile_id=profile_id, job_id=job_id)
        db.add(row)

    payload = data.model_dump(exclude_none=True)
    for k, v in payload.items():
        setattr(row, k, v)

    # If you got the job, you obviously applied and were interviewed.
    if row.got_job:
        row.applied = True
        row.interviewed = True

    row.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(row)

    return {
        "job": job_to_dict(job),
        "applied": bool(row.applied),
        "interviewed": bool(row.interviewed),
        "got_job": bool(row.got_job),
        "updated_at": row.updated_at,
    }


@app.get("/stats/me", response_model=StatsOut, tags=["stats"])
def stats_me(
    profile_id: int = Query(..., ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    rows = db.scalars(
        select(ApplicationProgress).where(ApplicationProgress.profile_id == profile_id)
    ).all()
    return _calc_stats(rows)


@app.get("/stats/global", response_model=StatsOut, tags=["stats"])
def stats_global(db: Session = Depends(get_db)):
    # Only include profiles that have opted-in to anonymous statistics.
    rows = db.scalars(
        select(ApplicationProgress)
        .join(Profile, ApplicationProgress.profile_id == Profile.id)
        .where(Profile.consent_analytics == True)  # noqa: E712
    ).all()
    return _calc_stats(rows)
