from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class ProfileOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    name: str
    email: str
    phone: str

    address: str = ""
    postal_code: str = ""
    postal_place: str = ""
    photo_data: str = ""
    include_photo_default: bool = True

    consent_analytics: bool = False
    experience: list[Any] = Field(default_factory=list)
    education: list[Any] = Field(default_factory=list)
    skills: str
    languages: list[Any] = Field(default_factory=list)
    references: list[Any] = Field(default_factory=list)
    cv_gaps: str
    target_role: str
    cv_text: str
    tone: str
    has_seen_onboarding: bool = False


class JobOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    title: str
    company: str
    location: str
    url: str
    description: str
    match_score: float
    status: str
    created_at: Optional[datetime] = None


class SettingsOut(BaseModel):
    notification_email: str
    auto_email: bool


class SettingsSavedOut(SettingsOut):
    saved: bool = True


class GeneratedApplicationItemOut(BaseModel):
    id: int
    job: JobOut
    created_at: Optional[datetime] = None

    # Authenticated download endpoints (relative URLs).
    cover_pdf_url: str
    cv_pdf_url: str


class JobAnalysisOut(BaseModel):
    job_id: Optional[int] = None
    job_title: Optional[str] = None
    company: Optional[str] = None

    match_score: Optional[float] = None
    interview_probability: Optional[int] = None
    seniority_match: Optional[int] = None

    top_reason: Optional[str] = None
    main_risk: Optional[str] = None

    # Derived in backend code (no extra AI call)
    recruiter_explanation: dict[str, list[str]] = Field(default_factory=dict)

    honest_assessment: Optional[str] = None
    strengths: list[Any] = Field(default_factory=list)
    weaknesses: list[Any] = Field(default_factory=list)
    missing_requirements: list[Any] = Field(default_factory=list)

    # Phase 1: recommended CV changes derived from missing requirements/job fit.
    recommended_cv_changes: list[Any] = Field(default_factory=list)

    should_apply: Optional[bool] = None
    improvement_tips: list[Any] = Field(default_factory=list)

    # Suggest which application style fits best for THIS job and THIS candidate.
    # One of: kort | vanlig | profesjonell
    recommended_application_style: Optional[str] = None
    recommended_style_reason: Optional[str] = None

    cover_letter: Optional[str] = None
    tailored_cv: Optional[str] = None
    email_text: Optional[str] = None

    # Visual CV template auto-selected based on job type.
    cv_mal: str = "profesjonell"


class AnalyzeAndSendOut(BaseModel):
    """Legacy response model (kept for backwards compatibility).

    NOTE: The mobile app should prefer the unified application package response.
    """

    sent: bool
    analysis: JobAnalysisOut


class ApplicationPackageOut(BaseModel):
    """Unified output for both "Generate PDF" and "Send email" flows."""

    cv: str
    coverLetter: str
    pdfUrl: str
    cvMal: str = "profesjonell"  # which visual template was used


class EducationOptionOut(BaseModel):
    name: str
    kind: str
    kommune: Optional[str] = None


class ApplicationItemOut(BaseModel):
    job: JobOut
    applied: bool
    interviewed: bool
    got_job: bool
    updated_at: Optional[datetime] = None


class JobAnalysisItemOut(BaseModel):
    job: JobOut
    match_score: float = 0
    analyzed_at: Optional[datetime] = None
    is_favorite: bool = False


class StatsOut(BaseModel):
    total: int
    applied: int
    interviewed: int
    got_job: int
    interview_rate: float
    hire_rate: float


class CVAnalysisOut(BaseModel):
    summary: str = ""
    suggested_roles: list[Any] = Field(default_factory=list)
    education_fit: str = ""
    strengths: list[Any] = Field(default_factory=list)
    gaps: list[Any] = Field(default_factory=list)
    improvement_tips: list[Any] = Field(default_factory=list)
    search_keywords: list[Any] = Field(default_factory=list)


class HealthOut(BaseModel):
    status: str
    checks: dict[str, Any]
