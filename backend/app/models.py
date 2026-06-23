from sqlalchemy import Integer, String, Text, Boolean, DateTime, ForeignKey, Float, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(250), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(50), default="")

    # Address fields
    address: Mapped[str] = mapped_column(Text, default="")
    postal_code: Mapped[str] = mapped_column(String(20), default="")
    postal_place: Mapped[str] = mapped_column(String(120), default="")

    # Profile photo stored as data URI (e.g. data:image/jpeg;base64,...) for demo simplicity.
    photo_data: Mapped[str] = mapped_column(Text, default="")

    # Default preference: include photo in generated PDFs.
    include_photo_default: Mapped[bool] = mapped_column(Boolean, default=True)

    consent_analytics: Mapped[bool] = mapped_column(Boolean, default=False)
    target_role: Mapped[str] = mapped_column(String(200), default="")
    cv_text: Mapped[str] = mapped_column(Text, default="")
    experience: Mapped[str] = mapped_column(Text, default="")
    education: Mapped[str] = mapped_column(Text, default="")
    skills: Mapped[str] = mapped_column(Text, default="")
    languages: Mapped[str] = mapped_column(Text, default="")

    # References stored as JSON text: [{name, relation, contact}, ...]
    # NOTE: can't call the column "references" because it's reserved SQL.
    references_json: Mapped[str] = mapped_column(Text, default="")

    cv_gaps: Mapped[str] = mapped_column(Text, default="")
    tone: Mapped[str] = mapped_column(String(50), default="normal")
    has_seen_onboarding: Mapped[bool] = mapped_column(Boolean, default=False)

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(250))
    company: Mapped[str] = mapped_column(String(250), default="")
    location: Mapped[str] = mapped_column(String(120), default="")
    url: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    match_score: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(50), default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class GeneratedApplication(Base):
    __tablename__ = "generated_applications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"))
    cover_letter: Mapped[str] = mapped_column(Text)
    tailored_cv: Mapped[str] = mapped_column(Text)
    email_text: Mapped[str] = mapped_column(Text)

    # Server-side generated PDF paths (demo). We keep both so the mobile app can
    # fetch them later via authenticated endpoints.
    pdf_path: Mapped[str] = mapped_column(Text, default="")
    cv_pdf_path: Mapped[str] = mapped_column(Text, default="")

    # Phase 4: PDF generation dedupe metadata.
    template: Mapped[str] = mapped_column(String(80), default="")
    include_photo: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)

    # Phase 4/production: content-based PDF dedupe.
    # TEXT column with default '' (legacy rows). Indexed for fast lookups.
    content_hash: Mapped[str] = mapped_column(Text, default="", index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ApplicationProgress(Base):
    __tablename__ = "application_progress"
    __table_args__ = (
        UniqueConstraint("profile_id", "job_id", name="uq_progress_profile_job"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"))
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))

    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    interviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    got_job: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class JobAnalysisHistory(Base):
    __tablename__ = "job_analysis_history"
    __table_args__ = (
        UniqueConstraint("profile_id", "job_id", name="uq_analysis_profile_job"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"))
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))

    match_score: Mapped[float] = mapped_column(Float, default=0)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)

    # Cache of the latest analysis result so the mobile app can re-open an
    # analysis without calling OpenAI again.
    analysis_json: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LoginCode(Base):
    __tablename__ = "login_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(250), index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    code_hash: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)

    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    notification_email: Mapped[str] = mapped_column(String(250), default="")
    auto_email: Mapped[bool] = mapped_column(Boolean, default=True)


class ProfileDocument(Base):
    __tablename__ = "profile_documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    filename: Mapped[str] = mapped_column(String(250))
    document_type: Mapped[str] = mapped_column(String(100), default="Annet")
    description: Mapped[str] = mapped_column(Text, default="")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UsageEvent(Base):
    __tablename__ = "usage_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    metadata: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
