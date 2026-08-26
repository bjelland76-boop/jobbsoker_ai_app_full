import hashlib
import json
import logging
import os
import hmac
import re
import secrets
import traceback

import requests
import stripe

logger = logging.getLogger(__name__)
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Union
from urllib.parse import quote

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from google.auth.transport import requests as google_auth_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.orm import Session

from .auth import (
    create_access_token,
    get_current_user,
    get_current_user_optional,
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
    ProfileDocument,
    StripePayment,
    UsageEvent,
    User,
)
from .pdf_dedupe import compute_pdf_content_hash
from .pdfgen import (
    OUT as GENERATED_PDFS_DIR,
    make_application_pdfs,
    _references_fallback_text,
    _references_header_text,
)
from .text_sanitize import sanitize_employer_text
from .transcribe import suffix_from_mime, transcribe_path, validate_upload
from .schemas import (
    AnalyzeAndSendOut,
    ApplicationItemOut,
    ApplicationPackageOut,
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
        ensure_col("profiles", "has_seen_onboarding", "has_seen_onboarding INTEGER DEFAULT 0")
        ensure_col("profiles", "is_tester", "is_tester BOOLEAN DEFAULT FALSE")
        ensure_col("profiles", "analysis_count", "analysis_count INTEGER DEFAULT 0")
        ensure_col("profiles", "cv_generation_count", "cv_generation_count INTEGER DEFAULT 0")
        ensure_col("profiles", "cv_analysis_count", "cv_analysis_count INTEGER DEFAULT 0")
        ensure_col("profiles", "interview_count", "interview_count INTEGER DEFAULT 0")
        ensure_col("profiles", "job_credits", "job_credits INTEGER DEFAULT 0")
        ensure_col("profiles", "subscription_status", "subscription_status TEXT DEFAULT NULL")
        ensure_col("profiles", "subscription_end", "subscription_end DATETIME DEFAULT NULL")
        ensure_col("profiles", "stripe_customer_id", "stripe_customer_id TEXT DEFAULT NULL")
        ensure_col("profiles", "last_active_at", "last_active_at DATETIME DEFAULT NULL")

        # Vietnamese CV fields
        ensure_col("profiles", "height_cm", "height_cm INTEGER")
        ensure_col("profiles", "civil_status", "civil_status TEXT DEFAULT ''")
        ensure_col("profiles", "gender", "gender TEXT DEFAULT ''")
        ensure_col("profiles", "nationality", "nationality TEXT DEFAULT ''")
        ensure_col("profiles", "military_service", "military_service TEXT DEFAULT ''")

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
        ensure_col(
            "generated_applications",
            "template",
            "template TEXT DEFAULT ''",
        )
        # Nullable: older rows have unknown include_photo.
        ensure_col(
            "generated_applications",
            "include_photo",
            "include_photo INTEGER",
        )
        ensure_col(
            "generated_applications",
            "content_hash",
            "content_hash TEXT DEFAULT ''",
        )
        ensure_col(
            "generated_applications",
            "language",
            "language TEXT DEFAULT 'no'",
        )

        # job_analysis_history
        ensure_col(
            "job_analysis_history",
            "analysis_json",
            "analysis_json TEXT DEFAULT ''",
        )
        ensure_col(
            "job_analysis_history",
            "is_favorite",
            "is_favorite INTEGER DEFAULT 0",
        )

        # login_codes (passwordless)
        ensure_col("login_codes", "ip", "ip TEXT DEFAULT ''")

        conn.commit()


FREE_LIMIT = 3
_LIMIT_COUNT_ATTR = {
    "analyse": "analysis_count",
    "cv": "cv_generation_count",
    "cv_analyse": "cv_analysis_count",
    "intervju": "interview_count",
}
_FREE_LIMIT_LABELS = {
    "analyse": "analyser",
    "cv": "CV-genereringer",
    "cv_analyse": "CV-analyser",
    "intervju": "intervjuøkter",
}


def _check_free_limit(profile: Profile, limit_type: str) -> JSONResponse | None:
    """Read-only check: None if the action is allowed, else a 403 response.

    Call BEFORE doing the (expensive/slow) work, so a failure never
    consumes a free slot or a credit. Call `_consume_free_limit` only
    after the work actually succeeds.
    """
    if bool(profile.is_tester) or profile.subscription_status == "active":
        return None
    count_attr = _LIMIT_COUNT_ATTR[limit_type]
    if int(getattr(profile, count_attr) or 0) < FREE_LIMIT:
        return None
    if int(profile.job_credits or 0) > 0:
        return None
    label = _FREE_LIMIT_LABELS[limit_type]
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={
            "error": "free_limit_reached",
            "limit_type": limit_type,
            "message": f"Du har brukt dine {FREE_LIMIT} gratis {label}",
        },
    )


def _consume_free_limit(db: Session, profile: Profile, limit_type: str) -> None:
    """Call once, after the gated action has succeeded. Mirrors _check_free_limit's logic."""
    if bool(profile.is_tester) or profile.subscription_status == "active":
        return
    count_attr = _LIMIT_COUNT_ATTR[limit_type]
    count = int(getattr(profile, count_attr) or 0)
    if count < FREE_LIMIT:
        setattr(profile, count_attr, count + 1)
    else:
        profile.job_credits = max(0, int(profile.job_credits or 0) - 1)
    db.commit()


def _owns_profile(profile: "Profile | None", current_user: "User | None") -> bool:
    """True if `profile` belongs to `current_user` -- or, for an anonymous
    caller (current_user is None), if `profile` is itself anonymous
    (user_id is None). Temporary anonymous-access support: there is no
    device-id yet, so an anonymous caller can only reach a profile whose id
    it already knows (e.g. one it just created)."""
    if not profile:
        return False
    if current_user is None:
        return profile.user_id is None
    return profile.user_id == current_user.id


def _owns_job(job: "Job | None", current_user: "User | None") -> bool:
    if not job:
        return False
    if current_user is None:
        return job.user_id is None
    return job.user_id == current_user.id


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


def _format_references_block(profile: Profile, language: str = "no") -> str:
    """Return a CV-ready references section based on profile.references_json."""

    header = _references_header_text(language)
    fallback = _references_fallback_text(language)

    items = _parse_json_field(getattr(profile, "references_json", ""))
    if not items:
        return f"{header}\n{fallback}"

    lines: list[str] = [header]
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
        return f"{header}\n{fallback}"

    return "\n".join(lines)


def _inject_references_into_cv(profile: Profile, tailored_cv: str, language: str = "no") -> str:
    """Ensure references are present in CV text.

    We only inject references into the CV content used for PDF generation.
    (We do NOT inject into cover letter or email body.)
    """

    ref_block = _format_references_block(profile, language)

    cv_out = tailored_cv or ""
    lower = cv_out.casefold()
    if "referanser" not in lower and "references" not in lower:
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
        "has_seen_onboarding": bool(getattr(profile, "has_seen_onboarding", False)),
        "is_tester": bool(getattr(profile, "is_tester", False)),
        "analysis_count": int(getattr(profile, "analysis_count", 0) or 0),
        "cv_generation_count": int(getattr(profile, "cv_generation_count", 0) or 0),
        "cv_analysis_count": int(getattr(profile, "cv_analysis_count", 0) or 0),
        "interview_count": int(getattr(profile, "interview_count", 0) or 0),
        "job_credits": int(getattr(profile, "job_credits", 0) or 0),
        "subscription_status": getattr(profile, "subscription_status", None),
        "subscription_end": (
            profile.subscription_end.date().isoformat() if getattr(profile, "subscription_end", None) else None
        ),
        "height_cm": getattr(profile, "height_cm", None),
        "civil_status": (getattr(profile, "civil_status", "") or ""),
        "gender": (getattr(profile, "gender", "") or ""),
        "nationality": (getattr(profile, "nationality", "") or ""),
        "military_service": (getattr(profile, "military_service", "") or ""),
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

    # Grandfather every profile that existed before the free-analysis-limit
    # feature into unlimited (is_tester) access, so nobody already using the
    # app gets locked out. Explicit id list = exactly the profiles reviewed
    # via Render logs before this change; new signups are unaffected.
    try:
        _db = SessionLocal()
        _grandfathered_ids = [
            5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
            21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        ]
        _db.query(Profile).filter(Profile.id.in_(_grandfathered_ids)).update(
            {Profile.is_tester: True}, synchronize_session=False
        )
        _db.commit()
    except Exception as _e:
        print(f"[Grandfather] failed: {_e!r}", flush=True)
    finally:
        try:
            _db.close()
        except Exception:
            pass

    # One-time: frankbjelland@proton.me (profile id 2) asked to be
    # un-grandfathered after testing showed it bypassing the free limit.
    try:
        _db = SessionLocal()
        _db.query(Profile).where(Profile.id == 2).update(
            {Profile.is_tester: False}, synchronize_session=False
        )
        _db.commit()
    except Exception as _e:
        print(f"[Ungrandfather2] failed: {_e!r}", flush=True)
    finally:
        try:
            _db.close()
        except Exception:
            pass

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

    # Optional fields used only when generating a Vietnamese CV.
    height_cm: int | None = None
    civil_status: str = ""
    gender: str = ""
    nationality: str = ""
    military_service: str = ""


class SettingsIn(BaseModel):
    notification_email: str = ""
    auto_email: bool = True


class AnalyzeUrlIn(BaseModel):
    profile_id: int
    url: str = ""
    # Pasted job ad text, used instead of `url` when the job posting has no
    # stable URL. At least one of `url` / `job_text` must be non-empty.
    job_text: str = ""
    application_style: str = "vanlig"  # kort | vanlig | profesjonell
    language: str = "no"


class AnalyzeCvIn(BaseModel):
    profile_id: int
    language: str = "no"


class CreateCheckoutIn(BaseModel):
    package: int = 0  # 1 | 5 | 10 (ignored when type == "subscription")
    user_id: int
    email: str = ""
    type: str = "package"  # "package" | "subscription"


class SendAnalysisIn(BaseModel):
    profile_id: int
    url: str = ""
    # Pasted job ad text, used instead of `url` when the job posting has no
    # stable URL. At least one of `url` / `job_text` must be non-empty.
    job_text: str = ""
    # Optional: when missing/empty, we only generate the package (no email send).
    to_email: str | None = None
    application_style: str = "vanlig"  # kort | vanlig | profesjonell
    include_photo: bool = True
    language: str = "no"  # "no" | "en"
    template: str | None = None  # "kreativ"|"profesjonell"|"klassisk"|"moderne"|"skandinavisk"|"vietnamesisk"; None = use AI-recommended cv_mal


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


class GoogleSignInIn(BaseModel):
    id_token: str


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
    checks["anthropic_key_present"] = bool(os.getenv("ANTHROPIC_API_KEY"))

    checks["resend_configured"] = bool(os.getenv("RESEND_API_KEY"))

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


def _job_lookup_key(url: str, job_text: str) -> str:
    """Stable identifier for a Job row.

    Pasted-text submissions have no real URL, so we derive a pseudo-URL from
    a hash of the pasted text — re-analyzing identical pasted text updates
    the same Job row (mirrors the URL-based dedup for scraped job ads)
    instead of creating a new row every time.
    """
    url = (url or "").strip()
    if url:
        return url
    return f"pasted-text:{hashlib.sha256((job_text or '').strip().encode('utf-8')).hexdigest()[:24]}"


def _client_ip(request: Request | None) -> str:
    if not request:
        return ""

    # If behind a proxy, respect X-Forwarded-For (first IP)
    xff = request.headers.get("x-forwarded-for") or request.headers.get("x-forwarded_for")
    if xff:
        return (xff.split(",")[0] or "").strip()

    return (getattr(getattr(request, "client", None), "host", None) or "").strip()


def _lookup_country_by_ip(ip: str) -> str:
    """Best-effort country lookup via the free ip-api.com geo-IP service.

    Falls back to "NO" (Norway) on any failure, missing IP, or private/local
    IP (e.g. local dev, or behind a proxy that didn't set X-Forwarded-For) —
    never blocks checkout on a flaky third-party API.
    """
    ip = (ip or "").strip()
    if not ip or ip.startswith(("127.", "10.", "192.168.", "::1")):
        return "NO"

    try:
        resp = requests.get(f"http://ip-api.com/json/{ip}", params={"fields": "countryCode"}, timeout=3)
        resp.raise_for_status()
        country = (resp.json() or {}).get("countryCode") or "NO"
        return str(country).strip().upper() or "NO"
    except Exception:
        return "NO"


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

        # NOTE: this used to also run "UPDATE profiles/jobs/app_settings SET
        # user_id=:uid WHERE user_id IS NULL" here, to claim legacy pre-auth
        # demo data for whichever account signed up first. Removed: now that
        # anonymous (user_id IS NULL) profiles/jobs are a deliberate, ongoing
        # state -- created continuously by the temporary anonymous-access
        # mode -- this would silently hand EVERY anonymous user's data to
        # whichever unrelated stranger happens to create the next account.
        # If per-device claiming is wanted later, it must be scoped by
        # device-id, not a blanket "every NULL row" sweep.

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
    try:
        return _request_login_code(data, request, db)
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR i request-code: {e}")
        print(traceback.format_exc())
        raise


def _request_login_code(data: RequestCodeIn, request: Request, db: Session):
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
    email_max_per_hour = 15
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
            detail="For mange forsøk – vent noen minutter og prøv igjen.",
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
    html = (
        f"<p>Din engangskode for innlogging er: <strong>{code}</strong></p>"
        "<p>Koden er gyldig i 10 minutter.<br>"
        "Når du logger inn vil du være innlogget i 14 dager.</p>"
    )

    email_result = send_email(email, subject, body, html=html)
    if isinstance(email_result, dict) and email_result.get("sent") is False:
        reason = str(email_result.get("reason") or "Kunne ikke sende e-post")
        print(f"ERROR i request-code: send_email feilet: {reason}")
        # Best-effort cleanup
        try:
            db.delete(row)
            db.commit()
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=reason)

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


def _get_or_create_user_from_google(db: Session, idinfo: dict) -> User:
    """Shared by /auth/google (inline id_token, used by the web preview) and
    /auth/google/callback (authorization-code exchange, used by the packaged
    Android app — see that endpoint's docstring for why it needs a separate path).
    """
    email = _normalize_email(idinfo.get("email") or "")
    if not email or "@" not in email:
        raise ValueError("invalid_email")

    existed = bool(get_user_by_email(db, email))
    wanted_name = (idinfo.get("name") or "").strip() if not existed else None
    return _ensure_user_and_profile(db, email, display_name=wanted_name)


@app.post("/auth/google", response_model=TokenOut, tags=["auth"])
def google_sign_in(data: GoogleSignInIn, db: Session = Depends(get_db)):
    client_id = os.getenv("GOOGLE_CLIENT_ID_WEB")
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_CLIENT_ID_WEB mangler i backend-konfigurasjonen",
        )

    token = (data.id_token or "").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mangler id_token")

    try:
        idinfo = google_id_token.verify_oauth2_token(
            token, google_auth_requests.Request(), client_id
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ugyldig Google-token")

    if not idinfo.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google-kontoen din har ikke en bekreftet e-postadresse",
        )

    try:
        user = _get_or_create_user_from_google(db, idinfo)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig e-post fra Google")

    return {"access_token": create_access_token(user_id=user.id), "user_id": user.id, "token_type": "bearer"}


# The packaged Android app is a Capacitor WebView, and Google's servers deliberately
# 403-reject Sign-In requests whose User-Agent identifies them as an embedded WebView
# (phishing prevention — confirmed via live traffic inspection, not client-side
# fixable). So on native Android, sign-in instead opens a real Chrome Custom Tab
# (see mobile/components/GoogleSignInButton.js) running the standard OAuth
# authorization-code flow, which redirects here with a `code` to exchange, and this
# hands the resulting JWT back to the app via a `com.aerlig.app://` deep link.
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_OAUTH_REDIRECT_URI = (os.getenv("GOOGLE_OAUTH_REDIRECT_URI") or "").strip() or (
    "https://jobbsoker-ai-backend.onrender.com/auth/google/callback"
)
MOBILE_DEEP_LINK_SCHEME = "com.aerlig.app"


def _google_callback_page(*, deep_link: str, message: str) -> HTMLResponse:
    html = f"""<!doctype html>
<html lang="no"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url={deep_link}">
<title>Ærlig</title>
<style>body{{font-family:sans-serif;text-align:center;padding:48px 20px;color:#1a1a1a}}
a{{display:inline-block;margin-top:16px;background:#E8501A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none}}</style>
</head><body>
<p>{message}</p>
<a href="{deep_link}">Åpne Ærlig-appen</a>
<script>window.location.href = {json.dumps(deep_link)};</script>
</body></html>"""
    return HTMLResponse(html)


@app.get("/auth/google/callback", tags=["auth"])
def google_oauth_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: Session = Depends(get_db),
):
    state_qs = f"&state={quote(state)}" if state else ""

    if error or not code:
        deep_link = f"{MOBILE_DEEP_LINK_SCHEME}://auth-callback?error={quote(error or 'missing_code')}{state_qs}"
        return _google_callback_page(deep_link=deep_link, message="Innloggingen ble avbrutt eller feilet.")

    client_id = os.getenv("GOOGLE_CLIENT_ID_WEB")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        deep_link = f"{MOBILE_DEEP_LINK_SCHEME}://auth-callback?error=server_config{state_qs}"
        return _google_callback_page(deep_link=deep_link, message="Serverfeil under innlogging.")

    try:
        token_resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": GOOGLE_OAUTH_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        token_resp.raise_for_status()
        id_token_str = token_resp.json().get("id_token")
        if not id_token_str:
            raise ValueError("Mangler id_token i svar fra Google")

        idinfo = google_id_token.verify_oauth2_token(
            id_token_str, google_auth_requests.Request(), client_id
        )
    except Exception as e:
        print(f"ERROR i /auth/google/callback: kode-utveksling feilet: {e}")
        deep_link = f"{MOBILE_DEEP_LINK_SCHEME}://auth-callback?error=exchange_failed{state_qs}"
        return _google_callback_page(deep_link=deep_link, message="Kunne ikke fullføre innlogging med Google.")

    if not idinfo.get("email_verified"):
        deep_link = f"{MOBILE_DEEP_LINK_SCHEME}://auth-callback?error=email_not_verified{state_qs}"
        return _google_callback_page(
            deep_link=deep_link, message="Google-kontoen din har ikke en bekreftet e-postadresse."
        )

    try:
        user = _get_or_create_user_from_google(db, idinfo)
    except ValueError:
        deep_link = f"{MOBILE_DEEP_LINK_SCHEME}://auth-callback?error=invalid_email{state_qs}"
        return _google_callback_page(deep_link=deep_link, message="Ugyldig e-post fra Google.")

    jwt_token = create_access_token(user_id=user.id)
    deep_link = f"{MOBILE_DEEP_LINK_SCHEME}://auth-callback?token={quote(jwt_token)}{state_qs}"
    return _google_callback_page(deep_link=deep_link, message="Innlogging fullført. Åpner appen …")


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
def get_profiles(current_user: User | None = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    if current_user is None:
        # Anonymous: no device-id yet, so there is no identity to list
        # profiles for -- the anonymous flow creates one via POST /profiles
        # and then addresses it directly by id.
        return []
    profiles = db.scalars(select(Profile).where(Profile.user_id == current_user.id)).all()

    now = datetime.utcnow()
    out = []
    for profile in profiles:
        show_reminder = (
            profile.subscription_status == "active"
            and profile.last_active_at is not None
            and (now - profile.last_active_at).days >= 60
        )
        profile.last_active_at = now
        d = profile_to_dict(profile)
        d["show_inactivity_reminder"] = show_reminder
        out.append(d)
    db.commit()

    return out


@app.get("/profiles/{profile_id}", response_model=ProfileOut)
def get_profile(profile_id: int, current_user: User | None = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profil ikke funnet")
    return profile_to_dict(profile)


@app.post("/profiles", response_model=ProfileOut)
def create_profile(data: ProfileIn, current_user: User | None = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    payload = data.model_dump()
    payload["experience"] = _serialize_profile_field(payload.get("experience"))
    payload["education"] = _serialize_profile_field(payload.get("education"))
    payload["languages"] = _serialize_profile_field(payload.get("languages"))

    # Map API field "references" -> DB column "references_json"
    payload["references_json"] = _serialize_profile_field(payload.pop("references", ""))

    payload["user_id"] = current_user.id if current_user else None
    profile = Profile(**payload)
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return profile_to_dict(profile)


@app.put("/profiles/{profile_id}", response_model=ProfileOut)
def update_profile(profile_id: int, data: ProfileIn, current_user: User | None = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
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


@app.patch("/profiles/{profile_id}/onboarding", response_model=ProfileOut)
def mark_onboarding_seen(profile_id: int, current_user: User | None = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profil ikke funnet")
    profile.has_seen_onboarding = True
    db.commit()
    db.refresh(profile)
    return profile_to_dict(profile)


@app.post("/profile/import-cv")
async def import_cv(
    file: UploadFile = File(...),
):
    """Extract profile fields from an uploaded CV (PDF, docx, or image).

    Stateless (no DB write), so it never needed the caller's identity --
    open to anonymous callers."""
    from .cv_importer import extract_and_parse

    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Filen er for stor (maks 20 MB)")

    try:
        result = extract_and_parse(file.filename or "", file.content_type or "", data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunne ikke lese filen: {e}")

    return result


@app.post("/profile/documents")
async def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form(default="Annet"),
    description: str = Form(default=""),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Upload a document (PDF or image), extract text, and store it."""
    from .cv_importer import extract_document_text

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Filen er for stor (maks 10 MB)")

    try:
        extracted = extract_document_text(file.filename or "", file.content_type or "", data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunne ikke lese filen: {e}")

    if current_user is None:
        # Midlertidig anonym modus: ProfileDocument.user_id er NOT NULL og vi
        # bygger ikke enhets-ID-infrastruktur ennå, så anonyme opplastinger
        # lagres ikke server-side -- kun den uttrukne teksten returneres, og
        # klienten må selv holde på den (se rapportens seksjon 2).
        return {
            "id": None,
            "filename": file.filename or "ukjent",
            "document_type": document_type,
            "description": description,
            "extracted_text": extracted,
            "created_at": datetime.utcnow().isoformat(),
        }

    doc = ProfileDocument(
        user_id=current_user.id,
        filename=file.filename or "ukjent",
        document_type=document_type,
        description=description,
        extracted_text=extracted,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return {
        "id": doc.id,
        "filename": doc.filename,
        "document_type": doc.document_type,
        "description": doc.description,
        "created_at": doc.created_at.isoformat(),
    }


@app.get("/profile/documents")
def get_documents(
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    if current_user is None:
        # Anonymous uploads are never persisted (see upload_document above),
        # so there is nothing to list.
        return []
    docs = db.scalars(
        select(ProfileDocument)
        .where(ProfileDocument.user_id == current_user.id)
        .order_by(ProfileDocument.created_at.desc())
    ).all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "document_type": d.document_type,
            "description": d.description,
            "created_at": d.created_at.isoformat(),
        }
        for d in docs
    ]


@app.delete("/profile/documents/{doc_id}")
def delete_document(
    doc_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    if current_user is None:
        # Nothing is ever persisted anonymously, so there is nothing to delete.
        raise HTTPException(status_code=404, detail="Dokument ikke funnet")
    doc = db.scalars(
        select(ProfileDocument).where(
            ProfileDocument.id == doc_id,
            ProfileDocument.user_id == current_user.id,
        )
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument ikke funnet")
    db.delete(doc)
    db.commit()
    return {"ok": True}


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


_CV_PRESERVE_KEYS = (
    "tailored_cv", "cover_letter", "email_text",
    "tailored_cv_en", "cover_letter_en", "email_text_en",
    "tailored_for_job", "cv_mal",
)


def _preserve_cv_keys_on_reanalysis(
    db: Session, profile_id: int, job_id: int, new_result: dict
) -> None:
    """Copy previously generated CV texts into new_result so re-analysing does not wipe them."""
    existing = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
        )
    ).first()
    if not existing or not existing.analysis_json:
        return
    try:
        old = json.loads(existing.analysis_json)
    except Exception:
        return
    for key in _CV_PRESERVE_KEYS:
        if old.get(key) and not new_result.get(key):
            new_result[key] = old[key]


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
                "language": getattr(approw, "language", "no") or "no",
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
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    from .cv_analyzer import analyze_profile_cv

    profile = db.get(Profile, data.profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    # Anonym bruk er midlertidig ubegrenset -- se rapportens seksjon 3.
    if current_user is not None:
        blocked = _check_free_limit(profile, "cv_analyse")
        if blocked is not None:
            return blocked

    try:
        result = analyze_profile_cv(profile, language=data.language)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if current_user is not None:
        _consume_free_limit(db, profile, "cv_analyse")
    return result


@app.get("/job-analyses", response_model=list[JobAnalysisItemOut], tags=["analysis"])
def list_job_analyses(
    profile_id: int = Query(..., ge=1),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
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
                "is_favorite": bool(hist.is_favorite),
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
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    job = db.get(Job, job_id)
    if not _owns_job(job, current_user):
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
    data["has_tailored_cv_no"] = bool(_to_text(data.get("tailored_cv")))
    data["has_tailored_cv_en"] = bool(_to_text(data.get("tailored_cv_en")))
    return data


@app.post(
    "/job-analyses/{job_id}/generate-pdf",
    response_model=GeneratedApplicationItemOut,
    tags=["generated"],
    deprecated=True,
)
def generate_pdfs_from_saved_analysis(
    job_id: int,
    profile_id: int = Query(..., ge=1),
    include_photo: bool = Query(default=True),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """DEPRECATED stub.

    This endpoint is intentionally disabled to enforce a single generation pipeline.
    Use POST /analyze-url-and-send instead.
    """

    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Deprecated. Use POST /analyze-url-and-send",
    )

    profile = db.get(Profile, profile_id)  # unreachable — kept for reference
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

    # If the saved analysis was produced in low-cost mode (no documents),
    # generate cover_letter + tailored_cv on demand.
    if not cover_letter.strip() or not tailored_cv.strip():
        from .job_analyzer import fetch_job_text, generate_application_texts

        job_text = (job.description or "").strip()
        if not job_text:
            job_text = fetch_job_text(job.url)
            # Best-effort: persist compact job text for later use.
            try:
                job.description = " ".join(job_text.split())[:3000]
                db.commit()
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass

        style_norm = str(data.get("recommended_application_style") or "vanlig").strip().lower()
        gen = generate_application_texts(
            profile,
            job_title=(job.title or ""),
            company=(job.company or ""),
            job_text=job_text,
            application_style=style_norm,
        )

        cover_letter = _to_text(gen.get("cover_letter"))
        tailored_cv = _to_text(gen.get("tailored_cv"))
        email_text = _to_text(gen.get("email_text") or email_text)

        data["cover_letter"] = cover_letter
        data["tailored_cv"] = tailored_cv
        data["email_text"] = email_text

        row.analysis_json = json.dumps(data, ensure_ascii=False)
        row.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)

    pdf_tailored_cv = _inject_references_into_cv(profile, tailored_cv)

    if not cover_letter.strip() or not tailored_cv.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Analysen mangler søknad/CV-tekst. Kjør analyse på nytt.",
        )

    # Phase 4/production: PDF generation dedupe.
    template_id = "sidebar_v1"

    content_hash = compute_pdf_content_hash(
        template_id=template_id,
        include_photo=bool(include_photo),
        cover_letter=cover_letter,
        rendered_cv_text=pdf_tailored_cv,
        profile=profile,
        job=job,
    )

    def _pdf_exists(rel_path: str) -> bool:
        if not rel_path:
            return False
        base_dir = GENERATED_PDFS_DIR.resolve()
        try:
            p = Path(rel_path).resolve()
            if base_dir != p and base_dir not in p.parents:
                return False
            return p.exists() and p.is_file()
        except Exception:
            return False

    existing = db.scalars(
        select(GeneratedApplication)
        .where(
            GeneratedApplication.profile_id == profile.id,
            GeneratedApplication.job_id == job.id,
            GeneratedApplication.content_hash == content_hash,
        )
        .order_by(GeneratedApplication.created_at.desc())
    ).first()

    if existing:
        cover_rel = (getattr(existing, "pdf_path", "") or "").strip()
        cv_rel = (getattr(existing, "cv_pdf_path", "") or cover_rel).strip()
        if cover_rel and cv_rel and _pdf_exists(cover_rel) and _pdf_exists(cv_rel):
            _upsert_progress(db, profile.id, job.id)
            return {
                "id": existing.id,
                "job": job_to_dict(job),
                "created_at": existing.created_at,
                "cover_pdf_url": f"/generated-applications/{existing.id}/pdf/cover",
                "cv_pdf_url": f"/generated-applications/{existing.id}/pdf/cv",
            }

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
        template=template_id,
        include_photo=include_photo,
        content_hash=content_hash,
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
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
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


@app.patch(
    "/job-analyses/{job_id}/favorite/{profile_id}",
    response_model=dict,
    tags=["analysis"],
)
def toggle_favorite_analysis(
    job_id: int,
    profile_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    row = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
        )
    ).first()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyse ikke funnet")

    row.is_favorite = not row.is_favorite
    db.commit()

    return {"is_favorite": row.is_favorite}


@app.post(
    "/job-analyses/{job_id}/generate-tailored-cv",
    response_model=ApplicationPackageOut,
    tags=["analysis"],
)
def generate_tailored_cv(
    job_id: int,
    profile_id: int = Query(..., ge=1),
    application_style: str = Query(default="vanlig"),
    include_photo: bool = Query(default=True),
    template: str = Query(default=""),  # "kreativ"|"profesjonell"|"klassisk"|"moderne"|"skandinavisk"|"vietnamesisk"; empty = use stored cv_mal
    language: str = Query(default="no"),  # "no" | "en"
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Generate a job-tailored CV using the stored match analysis for this job.

    If `template` is provided AND the CV texts are already stored for the requested
    language, skip the Claude call and only regenerate the PDF with the new visual template.
    Norwegian and English variants are cached separately.
    """
    from .job_analyzer import generate_application_texts, fetch_job_text

    _VALID_TEMPLATES = {"kreativ", "profesjonell", "klassisk", "moderne", "skandinavisk", "vietnamesisk"}

    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    job = db.get(Job, job_id)
    if not _owns_job(job, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke jobb")

    row = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
            JobAnalysisHistory.hidden == False,  # noqa: E712
        )
    ).first()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kjør jobbanalyse først")

    try:
        stored = json.loads(row.analysis_json) if row.analysis_json else {}
    except Exception:
        stored = {}

    # Resolve which template to use
    template_norm = (template or "").strip().lower()
    if template_norm not in _VALID_TEMPLATES:
        template_norm = ""
    effective_template = template_norm or str(stored.get("cv_mal") or "profesjonell")
    if effective_template not in _VALID_TEMPLATES:
        effective_template = "profesjonell"

    # Language-specific storage keys: Norwegian uses legacy keys, English uses _en suffix
    lang = "en" if (language or "no").strip().lower() == "en" else "no"
    cv_key = "tailored_cv" if lang == "no" else "tailored_cv_en"
    letter_key = "cover_letter" if lang == "no" else "cover_letter_en"
    email_key = "email_text" if lang == "no" else "email_text_en"

    # If a template change is requested AND we have existing texts for this language → skip Claude
    stored_cv = _to_text(stored.get(cv_key))
    stored_letter = _to_text(stored.get(letter_key))
    stored_email = _to_text(stored.get(email_key))
    skip_claude = bool(template_norm) and bool(stored_cv) and bool(stored_letter)

    if not skip_claude and current_user is not None:
        # Anonym bruk er midlertidig ubegrenset -- se rapportens seksjon 3.
        blocked = _check_free_limit(profile, "cv")
        if blocked is not None:
            return blocked

    if skip_claude:
        cover_letter = stored_letter
        tailored_cv = stored_cv
        email_text_val = stored_email
    else:
        match_context = {
            "score": stored.get("match_score"),
            "strengths": stored.get("strengths") or [],
            "missing": stored.get("missing_requirements") or [],
            "top_reason": stored.get("top_reason") or "",
            "main_risk": stored.get("main_risk") or "",
        }

        job_text = (job.description or "").strip()
        if not job_text:
            try:
                job_text = fetch_job_text(job.url)
                job.description = " ".join(job_text.split())[:3000]
                db.commit()
            except Exception:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kunne ikke hente jobbannonse")

        style_norm = (application_style or "vanlig").strip().lower()
        if style_norm not in {"kort", "vanlig", "profesjonell"}:
            style_norm = "vanlig"

        # Anonymous callers never have persisted documents (see upload_document),
        # so this naturally comes back empty for them -- no special-casing needed.
        user_docs = db.scalars(
            select(ProfileDocument).where(ProfileDocument.user_id == (current_user.id if current_user else None))
        ).all()
        doc_context = "\n\n".join(
            f"[{d.document_type}: {d.filename}]\n{d.extracted_text}"
            for d in user_docs
            if d.extracted_text.strip()
        )

        try:
            gen = generate_application_texts(
                profile,
                job_title=job.title or "",
                company=job.company or "",
                job_text=job_text,
                application_style=style_norm,
                match_context=match_context,
                language=lang,
                document_context=doc_context,
            )
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

        cover_letter = _to_text(gen.get("cover_letter"))
        tailored_cv = _to_text(gen.get("tailored_cv"))
        email_text_val = _to_text(gen.get("email_text"))

        # Persist generated texts back into the stored analysis (language-specific keys)
        stored[cv_key] = tailored_cv
        stored[letter_key] = cover_letter
        stored[email_key] = email_text_val
        stored["tailored_for_job"] = True

        if current_user is not None:
            _consume_free_limit(db, profile, "cv")

    # Always persist effective template
    stored["cv_mal"] = effective_template
    row.analysis_json = json.dumps(stored, ensure_ascii=False)
    row.updated_at = datetime.utcnow()

    pdf_tailored_cv = _inject_references_into_cv(profile, tailored_cv, lang)
    include_photo_bool = bool(include_photo) and bool(getattr(profile, "photo_data", ""))

    pdf_url = ""
    try:
        template_id = f"{effective_template}_v1"
        content_hash = compute_pdf_content_hash(
            template_id=template_id,
            include_photo=include_photo_bool,
            cover_letter=cover_letter,
            rendered_cv_text=pdf_tailored_cv,
            profile=profile,
            job=job,
        )
        cover_pdf, cv_pdf = make_application_pdfs(
            profile, job, cover_letter, pdf_tailored_cv,
            include_photo=include_photo_bool,
            template=effective_template,
            language=lang,
        )
        approw = GeneratedApplication(
            job_id=job.id,
            profile_id=profile.id,
            email_text=email_text_val,
            cover_letter=cover_letter,
            tailored_cv=tailored_cv,
            pdf_path=cover_pdf,
            cv_pdf_path=cv_pdf,
            template=template_id,
            include_photo=include_photo_bool,
            content_hash=content_hash,
            language=lang,
        )
        db.add(approw)
        db.commit()
        db.refresh(approw)
        _upsert_progress(db, profile.id, job.id)
        pdf_url = f"/generated-applications/{approw.id}/pdf/cover"
    except Exception:
        db.commit()

    return {"cv": tailored_cv, "coverLetter": cover_letter, "pdfUrl": pdf_url, "cvMal": effective_template, "language": lang}


@app.post(
    "/job-analyses/{job_id}/stream-documents",
    tags=["analysis"],
)
def stream_documents(
    job_id: int,
    profile_id: int = Query(..., ge=1),
    application_style: str = Query(default="vanlig"),
    include_photo: bool = Query(default=True),
    language: str = Query(default="no"),
    template: str = Query(default=""),  # "kreativ"|"profesjonell"|"klassisk"|"moderne"|"skandinavisk"|"vietnamesisk"; empty = use stored cv_mal
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Stream cover letter + CV + email as SSE chunks, then generate PDF and persist."""
    from .job_analyzer import stream_application_texts, fetch_job_text
    from .db import SessionLocal as _SessionLocal

    profile = db.get(Profile, profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=404, detail="Fant ikke profil")

    # Anonym bruk er midlertidig ubegrenset -- se rapportens seksjon 3.
    is_anonymous = current_user is None
    if not is_anonymous:
        blocked = _check_free_limit(profile, "cv")
        if blocked is not None:
            return blocked

    job = db.get(Job, job_id)
    if not _owns_job(job, current_user):
        raise HTTPException(status_code=404, detail="Fant ikke jobb")

    row = db.scalars(
        select(JobAnalysisHistory).where(
            JobAnalysisHistory.profile_id == profile_id,
            JobAnalysisHistory.job_id == job_id,
            JobAnalysisHistory.hidden == False,  # noqa: E712
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Kjør jobbanalyse først")

    try:
        stored = json.loads(row.analysis_json) if row.analysis_json else {}
    except Exception:
        stored = {}

    match_context = {
        "score": stored.get("match_score"),
        "strengths": stored.get("strengths") or [],
        "missing": stored.get("missing_requirements") or [],
        "top_reason": stored.get("top_reason") or "",
        "main_risk": stored.get("main_risk") or "",
    }

    job_text = (job.description or "").strip()
    if not job_text:
        try:
            job_text = fetch_job_text(job.url)
            job.description = " ".join(job_text.split())[:3000]
            db.commit()
        except Exception:
            raise HTTPException(status_code=400, detail="Kunne ikke hente jobbannonse")

    style_norm = (application_style or "vanlig").strip().lower()
    if style_norm not in {"kort", "vanlig", "profesjonell"}:
        style_norm = "vanlig"
    lang = (language or "no").strip().lower()

    # Anonymous callers never have persisted documents (see upload_document),
    # so this naturally comes back empty for them -- no special-casing needed.
    user_docs = db.scalars(
        select(ProfileDocument).where(ProfileDocument.user_id == (current_user.id if current_user else None))
    ).all()
    doc_context = "\n\n".join(
        f"[{d.document_type}: {d.filename}]\n{d.extracted_text}"
        for d in user_docs
        if d.extracted_text.strip()
    )

    _VALID_TEMPLATES = {"kreativ", "profesjonell", "klassisk", "moderne", "skandinavisk", "vietnamesisk"}
    template_norm = (template or "").strip().lower()
    if template_norm not in _VALID_TEMPLATES:
        template_norm = ""
    effective_template = template_norm or str(stored.get("cv_mal") or "profesjonell")
    if effective_template not in _VALID_TEMPLATES:
        effective_template = "profesjonell"
    row_id = row.id
    job_id_val = job.id
    profile_id_val = profile.id
    job_title_val = job.title or ""
    company_val = job.company or ""
    include_photo_bool = bool(include_photo) and bool(getattr(profile, "photo_data", ""))

    def event_generator():
        cover_letter = ""
        tailored_cv = ""
        email_text_val = ""

        try:
            for event_type, data in stream_application_texts(
                profile,
                job_title=job_title_val,
                company=company_val,
                job_text=job_text,
                application_style=style_norm,
                match_context=match_context,
                language=lang,
                document_context=doc_context,
            ):
                if event_type == "chunk":
                    yield f"data: {json.dumps({'t': 'c', 'v': data})}\n\n"
                elif event_type == "done":
                    cover_letter = data.get("cover_letter", "")
                    tailored_cv = data.get("tailored_cv", "")
                    email_text_val = data.get("email_text", "")
        except Exception as exc:
            yield f"data: {json.dumps({'t': 'e', 'msg': str(exc)})}\n\n"
            return

        if not is_anonymous:
            with _SessionLocal() as _consume_db:
                _p = _consume_db.get(Profile, profile_id_val)
                if _p:
                    _consume_free_limit(_consume_db, _p, "cv")

        # Persist text + generate PDFs with a fresh session (original db may be closed)
        pdf_url = ""
        with _SessionLocal() as fresh_db:
            try:
                cv_key = "cover_letter_en" if lang == "en" else "cover_letter"
                letter_key = "tailored_cv_en" if lang == "en" else "tailored_cv"
                email_key = "email_text_en" if lang == "en" else "email_text"
                stored[cv_key] = cover_letter
                stored[letter_key] = tailored_cv
                stored[email_key] = email_text_val
                stored["tailored_for_job"] = True
                stored["cv_mal"] = effective_template

                hist = fresh_db.get(JobAnalysisHistory, row_id)
                if hist:
                    hist.analysis_json = json.dumps(stored, ensure_ascii=False)
                    hist.updated_at = datetime.utcnow()

                pdf_tailored_cv = _inject_references_into_cv(profile, tailored_cv, lang)
                content_hash = compute_pdf_content_hash(
                    template_id=f"{effective_template}_v1",
                    include_photo=include_photo_bool,
                    cover_letter=cover_letter,
                    rendered_cv_text=pdf_tailored_cv,
                    profile=profile,
                    job=type("J", (), {"id": job_id_val, "title": job_title_val, "company": company_val})(),
                )
                existing = fresh_db.scalars(
                    select(GeneratedApplication).where(
                        GeneratedApplication.content_hash == content_hash,
                        GeneratedApplication.content_hash != "",
                    )
                ).first()
                if not existing:
                    cover_pdf, cv_pdf = make_application_pdfs(
                        profile,
                        type("J", (), {"id": job_id_val, "title": job_title_val, "company": company_val})(),
                        cover_letter,
                        pdf_tailored_cv,
                        include_photo=include_photo_bool,
                        template=effective_template,
                        language=lang,
                    )
                    approw = GeneratedApplication(
                        job_id=job_id_val,
                        profile_id=profile_id_val,
                        cover_letter=cover_letter,
                        tailored_cv=tailored_cv,
                        email_text=email_text_val,
                        pdf_path=cover_pdf,
                        cv_pdf_path=cv_pdf,
                        template=f"{effective_template}_v1",
                        include_photo=include_photo_bool,
                        content_hash=content_hash,
                        language=lang,
                    )
                    fresh_db.add(approw)
                    fresh_db.commit()
                    fresh_db.refresh(approw)
                    pdf_url = f"/generated-applications/{approw.id}/pdf/cover"
                else:
                    fresh_db.commit()
                    pdf_url = f"/generated-applications/{existing.id}/pdf/cover"
            except Exception:
                try:
                    fresh_db.rollback()
                except Exception:
                    pass

        yield f"data: {json.dumps({'t': 'd', 'coverLetter': cover_letter, 'cv': tailored_cv, 'emailText': email_text_val, 'pdfUrl': pdf_url, 'cvMal': effective_template})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def generateApplicationPackage(
    profile: Profile,
    url: str,
    *,
    job_text: str = "",
    application_style: str = "vanlig",
    include_photo: bool = True,
    language: str = "no",
    template_override: str | None = None,
    current_user: User,
    db: Session,
) -> tuple[dict, dict]:
    """Generate a full application package: cover letter + CV + unified PDF.

    Returns:
      (package_out, email_meta)

    package_out (strict contract):
      {"cv": "...", "coverLetter": "...", "pdfUrl": "..."}

    email_meta (internal use):
      {"subject": "...", "body": "...", "attachments": ["/path.pdf", ...]}

    This function is the single source of truth for both:
    - "Generate PDF"
    - "Send email"
    """

    from .job_analyzer import analyze_job_url

    url = (url or "").strip()
    job_text = (job_text or "").strip()
    job_key = _job_lookup_key(url, job_text)

    result = analyze_job_url(
        profile,
        url,
        application_style=application_style,
        generate_documents=True,
        language=language,
        job_text_override=job_text or None,
    )

    job_desc = (result.pop("__job_text", "") or "").strip()

    # Persist job so it can be tracked in the app.
    job = db.scalars(select(Job).where(Job.url == job_key, Job.user_id == current_user.id)).first()
    if not job:
        job = Job(
            user_id=current_user.id,
            title=result.get("job_title") or "Ukjent stilling",
            company=result.get("company") or "",
            location="",
            url=job_key,
            description=job_desc,
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
        if job_desc:
            job.description = job_desc

    db.commit()
    db.refresh(job)

    # Keep RAW values for API response + DB storage.
    # Employer-facing outputs (PDF + email body) will use sanitized variants.
    cover_letter_raw = _to_text(result.get("cover_letter"))
    tailored_cv_raw = _to_text(result.get("tailored_cv"))
    email_text_raw = _to_text(result.get("email_text"))

    cover_letter = cover_letter_raw
    tailored_cv = tailored_cv_raw
    email_text = email_text_raw

    # Persist analysis even if document generation is incomplete.
    _upsert_analysis_history(
        db,
        profile.id,
        job.id,
        result.get("match_score"),
        analysis_json=json.dumps(result, ensure_ascii=False),
    )

    package: dict[str, str] = {
        "cv": tailored_cv or "",
        "coverLetter": cover_letter or "",
        "pdfUrl": "",
    }

    # Only generate PDFs when we have both texts (prevents PDF generator crashes).
    cover_pdf = ""
    cv_pdf = ""
    if cover_letter_raw.strip() and tailored_cv_raw.strip():
        # Inject references first (still employer-safe). Then sanitize for employer-facing outputs.
        pdf_tailored_cv_raw = _inject_references_into_cv(profile, tailored_cv_raw, language)

        employer_cover_letter = sanitize_employer_text(cover_letter_raw)
        employer_tailored_cv = sanitize_employer_text(pdf_tailored_cv_raw)

        _VALID_TEMPLATES = {"kreativ", "profesjonell", "klassisk", "moderne", "skandinavisk", "vietnamesisk"}
        override_norm = (template_override or "").strip().lower()
        cv_mal = override_norm if override_norm in _VALID_TEMPLATES else str(result.get("cv_mal") or "profesjonell")
        cover_pdf, cv_pdf = make_application_pdfs(
            profile,
            job,
            employer_cover_letter,
            employer_tailored_cv,
            include_photo=bool(include_photo),
            template=cv_mal,
            language=language,
        )

        # Persist generated content.
        template_id = f"{cv_mal}_v1"
        include_photo_flag = bool(include_photo)

        # IMPORTANT: hash must match the actual employer-facing PDF content.
        content_hash = compute_pdf_content_hash(
            template_id=template_id,
            include_photo=include_photo_flag,
            cover_letter=employer_cover_letter,
            rendered_cv_text=employer_tailored_cv,
            profile=profile,
            job=job,
        )

        # Store RAW texts in DB (app can re-open what the model produced), but PDFs are sanitized.
        approw = GeneratedApplication(
            job_id=job.id,
            profile_id=profile.id,
            email_text=email_text_raw,
            cover_letter=cover_letter_raw,
            tailored_cv=tailored_cv_raw,
            pdf_path=cover_pdf,
            cv_pdf_path=cv_pdf,
            template=template_id,
            include_photo=include_photo_flag,
            content_hash=content_hash,
            language=language,
        )

        db.add(approw)
        db.commit()
        db.refresh(approw)

        _upsert_progress(db, profile.id, job.id)

        package["pdfUrl"] = f"/generated-applications/{approw.id}/pdf/cover"
        _consume_free_limit(db, profile, "cv")

    # Email contract:
    # - Body: cover letter text (søknadstekst)
    # - Attachment: CV-only PDF
    # Employer-facing: sanitize so internal analysis never leaks.
    body_raw = (cover_letter_raw or "").strip() or (email_text_raw or "").strip()
    body = sanitize_employer_text(body_raw)

    attachments: list[str] = []
    if cv_pdf:
        attachments.append(cv_pdf)

    email_meta = {
        "subject": f"Jobbanalyse: {result.get('job_title', 'stilling')}",
        "body": body,
        "attachments": attachments,
    }

    return package, email_meta


_PACKAGE_PRICE_ENV = {1: "STRIPE_PRICE_1", 5: "STRIPE_PRICE_5", 10: "STRIPE_PRICE_10"}
_PACKAGE_PRICE_ENV_VN = {1: "STRIPE_PRICE_1_VN", 5: "STRIPE_PRICE_5_VN", 10: "STRIPE_PRICE_10_VN"}
_PACKAGE_CREDITS = {1: 3, 5: 15, 10: 30}


def _grant_credits(db: Session, *, user_id: int, credits: int) -> Profile | None:
    """Add `credits` job credits to a user's profile.

    Provider-agnostic: called today only by the Stripe webhook, but written
    so a future Play Billing purchase-verification endpoint can call the
    exact same function rather than duplicating this mutation. Provider-
    specific concerns (idempotency keys, webhook signature checks, etc.)
    stay in the caller — this only does the actual credit grant.
    """
    profile = db.scalars(select(Profile).where(Profile.user_id == user_id)).first()
    if not profile:
        return None
    profile.job_credits = int(profile.job_credits or 0) + credits
    db.commit()
    return profile


def _set_subscription_status(db: Session, *, profile: Profile, subscription_status: str, subscription_end) -> None:
    """Update subscription_status/subscription_end on a profile.

    Provider-agnostic — see _grant_credits() docstring. Provider-specific
    identifiers (e.g. Profile.stripe_customer_id) are set by the caller,
    not here, since they don't generalize across payment providers.
    """
    profile.subscription_status = subscription_status
    profile.subscription_end = subscription_end
    db.commit()


@app.get("/user-country", tags=["billing"])
def user_country(request: Request):
    """Best-effort country lookup for the requesting client's IP, used by the
    payment modal to decide which currency/price list to display."""
    country = _lookup_country_by_ip(_client_ip(request))
    return {"country": "VN" if country == "VN" else "NO"}


@app.post("/create-checkout", tags=["billing"])
def create_checkout(
    data: CreateCheckoutIn,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    # Never let a client buy credits/subscribe onto an arbitrary user_id —
    # only the authenticated user's own account.
    if data.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="user_id samsvarer ikke med innlogget bruker")

    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe er ikke konfigurert (STRIPE_SECRET_KEY mangler)")
    stripe.api_key = secret_key
    stripe.api_version = "2025-03-31.basil"

    is_vn = _lookup_country_by_ip(_client_ip(request)) == "VN"

    if data.type == "subscription":
        price_env = "STRIPE_PRICE_SUB_VN" if is_vn else "STRIPE_PRICE_SUB"
        price_id = os.getenv(price_env)
        if not price_id:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Stripe er ikke konfigurert ({price_env} mangler)")

        try:
            session = stripe.checkout.Session.create(
                mode="subscription",
                line_items=[{"price": price_id, "quantity": 1}],
                success_url="https://app.aerlig.no/betalt?type=subscription&session_id={CHECKOUT_SESSION_ID}",
                cancel_url="https://app.aerlig.no",
                customer_email=data.email or current_user.email,
                metadata={"user_id": str(current_user.id)},
                # Checkout Session metadata is NOT copied onto the Subscription
                # object Stripe creates — without this, customer.subscription.*
                # webhook events carry no user_id and we can never look up which
                # profile to mark as active.
                subscription_data={"metadata": {"user_id": str(current_user.id)}},
            )
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Stripe-feil: {e}")

        return {"checkout_url": session.url}

    if data.package not in _PACKAGE_CREDITS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ugyldig pakke")

    price_env = (_PACKAGE_PRICE_ENV_VN if is_vn else _PACKAGE_PRICE_ENV)[data.package]
    price_id = os.getenv(price_env)
    if not price_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Stripe er ikke konfigurert ({price_env} mangler)")

    credits = _PACKAGE_CREDITS[data.package]

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"https://app.aerlig.no/betalt?credits={credits}&user_id={current_user.id}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url="https://app.aerlig.no",
            customer_email=data.email or current_user.email,
            metadata={"user_id": str(current_user.id), "credits": str(credits)},
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Stripe-feil: {e}")

    return {"checkout_url": session.url}


@app.post("/stripe-webhook", tags=["billing"])
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Authoritative payment confirmation via Stripe webhook.

    No user auth here — the caller is Stripe's servers, not a logged-in user.
    Trust comes entirely from verifying the signature against
    STRIPE_WEBHOOK_SECRET using the raw request body. Idempotent: a Checkout
    Session id can only ever grant credits once (see StripePayment).
    """

    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not webhook_secret:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe webhook er ikke konfigurert (STRIPE_WEBHOOK_SECRET mangler)")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Ugyldig webhook-signatur: {e}")

    event_type = event.get("type")

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        # Subscription-mode checkouts also fire this event but carry no
        # "credits" metadata (that's granted via the subscription.* events
        # below) — skip them here rather than logging a spurious error.
        if session.get("mode") != "payment":
            return {"received": True}

        session_id = session.get("id") or ""
        meta = session.get("metadata") or {}

        try:
            meta_user_id = int(meta.get("user_id"))
            credits = int(meta.get("credits"))
        except (TypeError, ValueError):
            logger.error("[stripe-webhook] invalid metadata on session %s: %r", session_id, meta)
            return {"received": True}

        existing = db.scalars(
            select(StripePayment).where(StripePayment.session_id == session_id)
        ).first()
        if not existing and session_id:
            profile = _grant_credits(db, user_id=meta_user_id, credits=credits)
            if profile:
                db.add(StripePayment(session_id=session_id, user_id=meta_user_id, credits=credits))
                db.commit()
            else:
                logger.error("[stripe-webhook] no profile for user_id %s (session %s)", meta_user_id, session_id)

    elif event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        sub = event["data"]["object"]
        customer_id = sub.get("customer") or ""

        status_map = {
            "active": "active",
            "trialing": "active",
            "past_due": "past_due",
            "unpaid": "past_due",
            "canceled": "cancelled",
            "incomplete_expired": "cancelled",
        }
        our_status = status_map.get(sub.get("status") or "", "cancelled")
        if event_type == "customer.subscription.deleted":
            our_status = "cancelled"

        period_end = sub.get("current_period_end")
        if not period_end:
            items = (sub.get("items") or {}).get("data") or []
            if items:
                period_end = items[0].get("current_period_end")
        end_dt = datetime.utcfromtimestamp(period_end) if period_end else None

        profile = None
        meta_user_id = (sub.get("metadata") or {}).get("user_id")
        if meta_user_id:
            try:
                profile = db.scalars(select(Profile).where(Profile.user_id == int(meta_user_id))).first()
            except (TypeError, ValueError):
                profile = None
        if not profile and customer_id:
            profile = db.scalars(select(Profile).where(Profile.stripe_customer_id == customer_id)).first()

        if profile:
            if customer_id:
                profile.stripe_customer_id = customer_id
            _set_subscription_status(db, profile=profile, subscription_status=our_status, subscription_end=end_dt)
        else:
            logger.error("[stripe-webhook] no profile found for subscription customer %s", customer_id)

    elif event_type == "invoice.payment_failed":
        invoice = event["data"]["object"]
        customer_id = invoice.get("customer") or ""
        profile = (
            db.scalars(select(Profile).where(Profile.stripe_customer_id == customer_id)).first()
            if customer_id
            else None
        )
        if profile:
            _set_subscription_status(
                db, profile=profile, subscription_status="past_due", subscription_end=profile.subscription_end
            )

    return {"received": True}


@app.post("/create-portal-session", tags=["billing"])
def create_portal_session(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.scalars(select(Profile).where(Profile.user_id == current_user.id)).first()
    if not profile or not profile.stripe_customer_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ingen aktiv Stripe-kunde funnet")

    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe er ikke konfigurert (STRIPE_SECRET_KEY mangler)")
    stripe.api_key = secret_key
    stripe.api_version = "2025-03-31.basil"

    try:
        session = stripe.billing_portal.Session.create(
            customer=profile.stripe_customer_id,
            return_url="https://app.aerlig.no",
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Stripe-feil: {e}")

    return {"portal_url": session.url}


@app.post("/analyze-url", response_model=JobAnalysisOut)
def analyze_url(
    data: AnalyzeUrlIn,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    from .job_analyzer import analyze_job_url

    profile = db.get(Profile, data.profile_id)
    if not _owns_profile(profile, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    url = (data.url or "").strip()
    job_text = (data.job_text or "").strip()
    if not url and not job_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mangler URL eller jobbtekst")
    job_key = _job_lookup_key(url, job_text)

    # Anonym bruk er midlertidig ubegrenset -- se rapportens seksjon 3.
    if current_user is not None:
        blocked = _check_free_limit(profile, "analyse")
        if blocked is not None:
            return blocked

    owner_id = current_user.id if current_user else None

    try:
        result = analyze_job_url(
            profile,
            url,
            application_style=data.application_style,
            generate_documents=False,
            language=data.language,
            job_text_override=job_text or None,
        )
        job_desc = (result.pop("__job_text", "") or "").strip()

        # Persist job so it can be tracked in the app later.
        job = db.scalars(select(Job).where(Job.url == job_key, Job.user_id == owner_id)).first()
        if not job:
            job = Job(
                user_id=owner_id,
                title=result.get("job_title") or "Ukjent stilling",
                company=result.get("company") or "",
                location="",
                url=job_key,
                description=job_desc,
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
            if job_desc:
                job.description = job_desc
        db.commit()
        db.refresh(job)

        # Preserve any previously generated CV texts when re-analyzing the same job
        _preserve_cv_keys_on_reanalysis(db, data.profile_id, job.id, result)

        _upsert_analysis_history(
            db,
            data.profile_id,
            job.id,
            result.get("match_score"),
            analysis_json=json.dumps(result, ensure_ascii=False),
        )

        result["job_id"] = job.id
        result["has_tailored_cv_no"] = bool(_to_text(result.get("tailored_cv")))
        result["has_tailored_cv_en"] = bool(_to_text(result.get("tailored_cv_en")))

        if current_user is not None:
            _consume_free_limit(db, profile, "analyse")

        return result
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/analyze-url-and-send", response_model=ApplicationPackageOut)
def analyze_url_and_send(
    data: SendAnalysisIn,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Unified generation endpoint.

    CORE RULE:
    - Always generate the full application package first (single source of truth)
    - Optional side effect (email) is triggered only after we have the full package
    - Always return the same strict response contract

    Response:
      {"cv": "...", "coverLetter": "...", "pdfUrl": "..."}
    """

    profile = db.get(Profile, data.profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fant ikke profil")

    if not (data.url or "").strip() and not (data.job_text or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mangler URL eller jobbtekst")

    blocked = _check_free_limit(profile, "cv")
    if blocked is not None:
        return blocked

    result: dict = {"cv": "", "coverLetter": "", "pdfUrl": ""}
    email_meta: dict = {}

    # Always call the unified generator first.
    try:
        result, email_meta = generateApplicationPackage(
            profile,
            data.url,
            job_text=data.job_text,
            application_style=data.application_style,
            include_photo=bool(data.include_photo),
            language=data.language,
            template_override=data.template,
            current_user=current_user,
            db=db,
        )
    except Exception:
        # Never change response shape on failures; keep empty package.
        result = {"cv": "", "coverLetter": "", "pdfUrl": ""}
        email_meta = {}

    # Defensive normalization: never return missing keys or null fields.
    if not isinstance(result, dict):
        result = {"cv": "", "coverLetter": "", "pdfUrl": ""}

    for key in ["cv", "coverLetter", "pdfUrl"]:
        v = result.get(key)
        if v is None:
            result[key] = ""
        elif not isinstance(v, str):
            result[key] = _to_text(v)

    to_email = (data.to_email or "").strip()
    if to_email:
        # Side effect is best-effort and must not change the response contract.
        background_tasks.add_task(
            send_email,
            to_email,
            (email_meta.get("subject") if isinstance(email_meta, dict) else None) or "Jobbanalyse",
            (email_meta.get("body") if isinstance(email_meta, dict) else None) or "",
            attachments=list((email_meta.get("attachments") if isinstance(email_meta, dict) else None) or []),
        )

    return result


@app.post("/interview/chat", tags=["interview"])
async def interview_chat_api(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Interview practice chat endpoint used by the mobile UI.

    Frontend calls: POST /interview/chat
    Body: { job_title, company, job_context, user_answer, history }

    Response (strict): { feedback, question, tip }

    Stateless: a new interview SESSION is identified by an empty `history`
    (see startInterview() in the mobile app). The free-limit is charged once
    per session (on the empty-history call), never per message.
    """

    from .interview_agent import interview_chat

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    history = payload.get("history")
    if not isinstance(history, list):
        history = []

    is_new_session = not history
    profile = None
    if is_new_session:
        profile = db.scalars(select(Profile).where(Profile.user_id == current_user.id)).first()
        if profile:
            blocked = _check_free_limit(profile, "intervju")
            if blocked is not None:
                return blocked

    out = interview_chat(
        job_title=str(payload.get("job_title") or ""),
        company=str(payload.get("company") or ""),
        job_context=str(payload.get("job_context") or ""),
        user_answer=str(payload.get("user_answer") or ""),
        history=history,
    )

    if is_new_session and profile:
        _consume_free_limit(db, profile, "intervju")

    return {
        "feedback": str(out.get("feedback") or ""),
        "question": str(out.get("question") or ""),
        "tip": str(out.get("tip") or ""),
        "is_final": bool(out.get("is_final")),
    }


@app.post("/interview/transcribe", tags=["interview"])
async def interview_transcribe_api(
    audio: UploadFile = File(..., description='Audio file (multipart/form-data field name: "audio")'),
    language: str = Form(default="no", description="UI language code (no/en/vi/pl/lt/ar/so), used as a Whisper language hint"),
    current_user: User = Depends(get_current_user),
):
    """Transcribe a recorded interview answer.

    Contract:
      - Auth required
      - multipart/form-data with file field name: `audio`
      - Response: {"text": "..."}

    Audio is NOT stored permanently (temp file is deleted).
    """

    # Auth-only dependency (avoid unused variable warnings).
    _ = current_user

    content_type = (audio.content_type or "").strip()

    # Read into memory and validate size/type BEFORE sending to OpenAI.
    raw = await audio.read()
    size_bytes = len(raw or b"")

    validate_upload(content_type=content_type, size_bytes=size_bytes)

    import tempfile
    from pathlib import Path

    tmp_path: Path | None = None
    try:
        suf = suffix_from_mime(content_type)
        with tempfile.NamedTemporaryFile(prefix="interview_", suffix=suf, delete=False) as f:
            f.write(raw)
            tmp_path = Path(f.name)

        text = transcribe_path(tmp_path, language=language)
        return {"text": str(text or "")}
    finally:
        if tmp_path:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass



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


# ---------------------------------------------------------------------------
# Usage event logging
# ---------------------------------------------------------------------------

class EventLogIn(BaseModel):
    action: str
    metadata: Optional[dict] = None


@app.post("/events/log", status_code=204, tags=["events"])
def log_event(
    data: EventLogIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    action = (data.action or "").strip()[:100]
    if not action:
        return
    meta_str = ""
    if data.metadata:
        try:
            import json as _json
            meta_str = _json.dumps(data.metadata, ensure_ascii=False)[:500]
        except Exception:
            pass
    event = UsageEvent(user_id=current_user.id, action=action, event_meta=meta_str)
    db.add(event)
    db.commit()


@app.post("/events/anonymous-open", status_code=204, tags=["events"])
def log_anonymous_open(db: Session = Depends(get_db)):
    event = UsageEvent(user_id=None, action="app_open_anonymous", event_meta="")
    db.add(event)
    db.commit()


_ADMIN_EMAIL = "bjelland76@gmail.com"


@app.get("/events/stats", tags=["events"])
def event_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.email != _ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Ikke tilgang")

    cutoff = datetime.utcnow() - timedelta(days=7)

    # Top 10 actions last 7 days
    top_rows = db.execute(
        text(
            "SELECT action, COUNT(*) as cnt FROM usage_events "
            "WHERE created_at >= :cutoff GROUP BY action ORDER BY cnt DESC LIMIT 10"
        ),
        {"cutoff": cutoff},
    ).fetchall()
    top_actions = [{"action": r[0], "count": r[1]} for r in top_rows]

    # Unique users per day last 7 days
    daily_rows = db.execute(
        text(
            "SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as users "
            "FROM usage_events WHERE created_at >= :cutoff "
            "GROUP BY day ORDER BY day DESC"
        ),
        {"cutoff": cutoff},
    ).fetchall()
    daily_users = [{"day": str(r[0]), "unique_users": r[1]} for r in daily_rows]

    # Template breakdown
    template_rows = db.execute(
        text(
            "SELECT action, COUNT(*) as cnt FROM usage_events "
            "WHERE action IN ('cv_template_profesjonell','cv_template_kreativ','cv_template_klassisk') "
            "AND created_at >= :cutoff GROUP BY action ORDER BY cnt DESC"
        ),
        {"cutoff": cutoff},
    ).fetchall()
    templates = [{"template": r[0].replace("cv_template_", ""), "count": r[1]} for r in template_rows]

    return {"top_actions": top_actions, "daily_users": daily_users, "templates": templates}
