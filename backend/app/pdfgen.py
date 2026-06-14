from __future__ import annotations

import base64
import io
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

def _default_data_dir() -> Path | None:
    v = (os.getenv("APP_DATA_DIR") or os.getenv("DATA_DIR") or "").strip()
    if v:
        return Path(v)
    if Path("/data").is_dir():
        return Path("/data")
    return None


data_dir = _default_data_dir()
OUT = (data_dir / "generated_pdfs") if data_dir else Path("generated_pdfs")
OUT.mkdir(parents=True, exist_ok=True)


def safe_name(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", text)[:60]


def _photo_bytes_from_data_uri(data_uri: str) -> bytes | None:
    """Accepts a 'data:image/...;base64,...' string and returns decoded bytes."""

    if not data_uri or not isinstance(data_uri, str):
        return None

    s = data_uri.strip()
    if not s:
        return None

    if s.startswith("data:"):
        try:
            b64 = s.split(",", 1)[1]
        except Exception:
            return None
    else:
        # If the app ever sends raw base64.
        b64 = s

    try:
        return base64.b64decode(b64, validate=False)
    except Exception:
        return None


def _wrap_lines(text: str, max_width: float, font_name: str, font_size: float) -> list[str]:
    """Word wrap based on actual font metrics."""

    words = (text or "").strip().split()
    if not words:
        return [""]

    lines: list[str] = []
    current = words[0]

    for w in words[1:]:
        candidate = f"{current} {w}"
        if pdfmetrics.stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = w

    lines.append(current)
    return lines


def _parse_json_list(value) -> list:
    """Parse a DB field that may contain JSON list or fallback to a simple list."""

    if value is None:
        return []

    if isinstance(value, list):
        return value

    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return parsed
            return [parsed]
        except Exception:
            # Non-JSON string
            return [s]

    # Unknown type
    return [value]


def _as_text_lines(items: list, *, max_items: int = 50) -> list[str]:
    out: list[str] = []
    for it in (items or [])[:max_items]:
        if it is None:
            continue
        if isinstance(it, str):
            s = it.strip()
            if s:
                out.append(s)
            continue
        if isinstance(it, dict):
            # Try common keys
            for k in ("name", "title", "value", "text"):
                s = str(it.get(k) or "").strip()
                if s:
                    out.append(s)
                    break
            continue
        s = str(it).strip()
        if s:
            out.append(s)
    return out


@dataclass
class _Theme:
    sidebar_bg: colors.Color
    sidebar_text: colors.Color
    sidebar_muted: colors.Color
    divider: colors.Color

    text: colors.Color
    muted: colors.Color

    box_bg: colors.Color
    box_border: colors.Color
    section_accent: colors.Color

    # Extra fields for template variation
    cv_subheader_color: colors.Color = None       # color of CV section sub-headers
    section_underline: colors.Color = None        # thin rule under CV sub-headers
    section_spacing: float = 0.0                  # extra cm between sections (kreativ)

    def __post_init__(self):
        if self.cv_subheader_color is None:
            self.cv_subheader_color = self.section_accent
        if self.section_underline is None:
            self.section_underline = colors.HexColor("#cbd5e1")


# --- Profesjonell: clean navy (default) ---
THEME_PROFESJONELL = _Theme(
    sidebar_bg=colors.HexColor("#1e3a8a"),
    sidebar_text=colors.white,
    sidebar_muted=colors.HexColor("#dbeafe"),
    divider=colors.HexColor("#93c5fd"),
    text=colors.HexColor("#0f172a"),
    muted=colors.HexColor("#334155"),
    box_bg=colors.HexColor("#f8fafc"),
    box_border=colors.HexColor("#cbd5e1"),
    section_accent=colors.HexColor("#1e3a8a"),
    cv_subheader_color=colors.HexColor("#1e3a8a"),
    section_underline=colors.HexColor("#cbd5e1"),
    section_spacing=0.0,
)

# --- Kreativ: dark sidebar, orange accents ---
THEME_KREATIV = _Theme(
    sidebar_bg=colors.HexColor("#1a1a2e"),
    sidebar_text=colors.white,
    sidebar_muted=colors.HexColor("#f5cba7"),
    divider=colors.HexColor("#E8501A"),
    text=colors.HexColor("#0f172a"),
    muted=colors.HexColor("#2d2d2d"),
    box_bg=colors.HexColor("#fff8f5"),
    box_border=colors.HexColor("#f5cba7"),
    section_accent=colors.HexColor("#E8501A"),
    cv_subheader_color=colors.HexColor("#E8501A"),
    section_underline=colors.HexColor("#E8501A"),
    section_spacing=0.18,
)

THEME = THEME_PROFESJONELL  # backward-compat alias


# CV section titles produced by the LLM (tailored_cv is plain text).
# We only use these to improve rendering/layout; we do NOT change content.
CV_SECTION_TITLES: list[str] = [
    "Profesjonell oppsummering",
    "Kjerneferdigheter",
    "Arbeidserfaring",
    "Utdanning",
    "Sertifiseringer",
    "Språk",
    "Referanser",
    # English equivalents
    "Professional Summary",
    "Core Skills",
    "Work Experience",
    "Education",
    "Certifications",
    "Languages",
    "References",
]
CV_SECTION_TITLES_CF = {t.casefold(): t for t in CV_SECTION_TITLES}

# Section rendering category sets (Norwegian + English)
_SEC_EXPERIENCE = {"arbeidserfaring", "utdanning", "work experience", "education"}
_SEC_BULLETS = {"kjerneferdigheter", "språk", "sertifiseringer", "referanser",
                "core skills", "languages", "certifications", "references"}


def _clean_company_for_pdf(company: str) -> str:
    s = " ".join((company or "").split()).strip()
    if not s:
        return ""

    # Remove common site suffixes.
    s = re.sub(r"\s*[|–-]\s*finn(?:\.no)?\s*$", "", s, flags=re.IGNORECASE).strip()
    return s


def _is_probably_job_title(title: str) -> bool:
    s = " ".join((title or "").split()).strip()
    if not s:
        return False

    # Very common noise/boilerplate
    if re.search(r"\bfinn(?:\.no)?\b", s, flags=re.IGNORECASE):
        return False

    # If it looks like a full sentence/marketing line, drop it.
    if any(ch in s for ch in ["?", "!", "."]):
        return False

    # Too long => likely ingress/slogan.
    if len(s) > 60:
        return False

    # Too many words => likely not a title.
    if len(s.split()) > 8:
        return False

    # Common marketing openers (Norwegian).
    starters = [
        "klar for",
        "vil du",
        "ønsker du",
        "er du",
        "bli med",
        "drømmer du",
        "har du lyst",
    ]
    s_cf = s.casefold()
    if any(s_cf.startswith(x) for x in starters):
        return False

    return True


def _clean_job_title_for_pdf(title: str) -> str:
    """Reduce job title noise for PDF subtitle.

    Goal: keep a short, job-title-like string. Drop ingress/slogan lines.
    """

    s = " ".join((title or "").split()).strip()
    if not s:
        return ""

    # Remove common FINN/site suffixes.
    s = re.sub(r"\s*[|–-]\s*finn(?:\.no)?\s*$", "", s, flags=re.IGNORECASE).strip()

    # If the whole string doesn't look like a title, don't show it.
    if not _is_probably_job_title(s):
        return ""

    return s


class _SidebarPdfDoc:
    def __init__(
        self,
        filename: str,
        profile,
        job,
        cover_letter: str,
        cv_text: str,
        *,
        include_photo: bool = True,
        theme: _Theme | None = None,
    ):
        self.path = OUT / filename
        self.c = canvas.Canvas(str(self.path), pagesize=A4)
        self.width, self.height = A4
        self.theme = theme or THEME_PROFESJONELL

        self.profile = profile
        self.job = job
        self.cover_letter = cover_letter
        self.cv_text = cv_text
        self.include_photo = include_photo

        # Layout
        self.sidebar_w = 6.6 * cm
        self.gutter = 0.8 * cm
        self.main_left = self.sidebar_w + self.gutter
        self.main_right_margin = 1.6 * cm
        self.main_w = self.width - self.main_left - self.main_right_margin

        self.top_margin = 1.6 * cm
        self.bottom_margin = 1.6 * cm

        self.page_no = 0
        self.y = self.height

    # ---------- Page / chrome ----------
    def _new_page(self) -> None:
        if self.page_no > 0:
            self.c.showPage()

        self.page_no += 1
        self._draw_sidebar()

        # reset cursor for main content
        self.y = self.height - self.top_margin

        # Page no (bottom right)
        self.c.setFillColor(colors.HexColor("#64748b"))
        self.c.setFont("Helvetica", 8)
        self.c.drawRightString(self.width - self.main_right_margin, 0.9 * cm, f"Side {self.page_no}")

    def _draw_sidebar(self) -> None:
        c = self.c

        # Background
        c.setFillColor(self.theme.sidebar_bg)
        c.rect(0, 0, self.sidebar_w, self.height, fill=1, stroke=0)

        # Divider line
        c.setStrokeColor(self.theme.divider)
        c.setLineWidth(1)
        c.line(self.sidebar_w, 0, self.sidebar_w, self.height)

        pad_x = 0.7 * cm
        y = self.height - 1.0 * cm

        # Photo
        photo_box = 4.7 * cm
        if self.include_photo:
            raw = (getattr(self.profile, "photo_data", "") or "").strip()
            b = _photo_bytes_from_data_uri(raw)
        else:
            b = None

        if b:
            try:
                img = ImageReader(io.BytesIO(b))
                x = pad_x
                y_img = y - photo_box
                c.setFillColor(colors.white)
                c.roundRect(x, y_img, photo_box, photo_box, 10, fill=1, stroke=0)
                c.drawImage(
                    img,
                    x,
                    y_img,
                    width=photo_box,
                    height=photo_box,
                    mask="auto",
                    preserveAspectRatio=True,
                    anchor="c",
                )
                y = y_img - 0.7 * cm
            except Exception:
                b = None

        if not b:
            # Placeholder box
            x = pad_x
            y_img = y - photo_box
            c.setFillColor(colors.HexColor("#1d4ed8"))
            c.roundRect(x, y_img, photo_box, photo_box, 10, fill=1, stroke=0)
            c.setFillColor(self.theme.sidebar_muted)
            c.setFont("Helvetica-Bold", 18)
            initials = "".join([p[:1] for p in (getattr(self.profile, "name", "") or "").split()[:2]]).upper()
            c.drawCentredString(x + photo_box / 2, y_img + photo_box / 2 - 6, initials or "CV")
            y = y_img - 0.7 * cm

        # Name
        name = (getattr(self.profile, "name", "") or "").strip() or ""
        c.setFillColor(self.theme.sidebar_text)
        c.setFont("Helvetica-Bold", 14)
        for line in _wrap_lines(name, self.sidebar_w - 2 * pad_x, "Helvetica-Bold", 14):
            c.drawString(pad_x, y, line)
            y -= 0.55 * cm

        y -= 0.2 * cm

        # Address + personal info
        contact_lines: list[str] = []

        addr = (getattr(self.profile, "address", "") or "").strip()
        postal_code = (getattr(self.profile, "postal_code", "") or "").strip()
        postal_place = (getattr(self.profile, "postal_place", "") or "").strip()
        if addr:
            contact_lines.append(addr)
        if postal_code or postal_place:
            contact_lines.append(" ".join([x for x in [postal_code, postal_place] if x]))

        phone = (getattr(self.profile, "phone", "") or "").strip()
        email = (getattr(self.profile, "email", "") or "").strip()
        if phone:
            contact_lines.append(phone)
        if email:
            contact_lines.append(email)

        if contact_lines:
            c.setFillColor(self.theme.sidebar_muted)
            c.setFont("Helvetica", 9.5)
            max_w = self.sidebar_w - 2 * pad_x
            for ln in contact_lines:
                for wln in _wrap_lines(ln, max_w, "Helvetica", 9.5):
                    c.drawString(pad_x, y, wln)
                    y -= 0.43 * cm

        y -= 0.5 * cm

        # Languages
        langs = _parse_json_list(getattr(self.profile, "languages", ""))
        lang_lines = _as_text_lines(langs)

        c.setFillColor(self.theme.sidebar_text)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(pad_x, y, "SPRÅK")
        y -= 0.45 * cm

        c.setFillColor(self.theme.sidebar_muted)
        c.setFont("Helvetica", 9.5)
        if not lang_lines:
            c.drawString(pad_x, y, "—")
            y -= 0.43 * cm
        else:
            for ln in lang_lines[:12]:
                for wln in _wrap_lines(ln, self.sidebar_w - 2 * pad_x, "Helvetica", 9.5):
                    c.drawString(pad_x, y, f"• {wln}" if wln == ln else f"  {wln}")
                    y -= 0.43 * cm

    # ---------- Main content helpers ----------
    def _ensure_space(self, needed_h: float) -> None:
        if self.y - needed_h <= self.bottom_margin:
            self._new_page()

    def _draw_main_title(self, title: str, subtitle: str | None = None) -> None:
        c = self.c
        c.setFillColor(self.theme.text)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(self.main_left, self.y, title)
        self.y -= 0.65 * cm

        if subtitle:
            c.setFillColor(colors.HexColor("#475569"))
            c.setFont("Helvetica", 9.5)
            c.drawString(self.main_left, self.y, subtitle)
            self.y -= 0.75 * cm
        else:
            self.y -= 0.35 * cm

    def _section_header(self, title: str) -> None:
        self._ensure_space(1.1 * cm)
        c = self.c
        c.setFillColor(self.theme.text)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(self.main_left, self.y, title.upper())

        # Accent underline
        c.setStrokeColor(self.theme.section_accent)
        c.setLineWidth(1.5)
        c.line(self.main_left, self.y - 0.18 * cm, self.main_left + 4.2 * cm, self.y - 0.18 * cm)

        self.y -= 0.75 * cm

    # ---------- CV rendering (tailored_cv text) ----------
    def _cv_subheader(self, title: str) -> None:
        """Render a CV subsection header inside the main CV section."""

        extra = self.theme.section_spacing * cm
        self._ensure_space((1.0 + self.theme.section_spacing) * cm)
        if self.y < (self.height - self.top_margin - 0.2 * cm):
            self.y -= (0.35 + extra) * 1  # extra air for kreativ

        c = self.c
        c.setFillColor(self.theme.cv_subheader_color)
        c.setFont("Helvetica-Bold", 12.2)
        c.drawString(self.main_left, self.y, title)

        # Thin underline/accent
        c.setStrokeColor(self.theme.section_underline)
        c.setLineWidth(0.8)
        c.line(self.main_left, self.y - 0.18 * cm, self.main_left + self.main_w, self.y - 0.18 * cm)

        self.y -= 0.65 * cm

    def _cv_bullet_lines(
        self,
        lines: list[str],
        *,
        font: str = "Helvetica",
        size: float = 10.1,
        leading: float = 0.48 * cm,
    ) -> None:
        """Render bullet lines with consistent indent + wrap."""

        c = self.c
        bullet_x = self.main_left
        text_x = self.main_left + 0.65 * cm
        max_w = self.main_w - (text_x - self.main_left)

        for raw in lines:
            stripped = (raw or "").strip()
            if not stripped:
                self.y -= 0.18 * cm
                continue

            # Normalize bullets.
            if stripped.startswith("•"):
                stripped = stripped[1:].strip()
            elif stripped.startswith("-"):
                stripped = stripped[1:].strip()

            wrapped = _wrap_lines(stripped, max_w, font, size)
            for i, wline in enumerate(wrapped):
                self._ensure_space(0.62 * cm)

                c.setFillColor(self.theme.muted)
                c.setFont(font, size)

                if i == 0:
                    c.drawString(bullet_x, self.y, "•")
                    c.drawString(text_x, self.y, wline)
                else:
                    c.drawString(text_x, self.y, wline)

                self.y -= leading

        self.y -= 0.12 * cm

    def _cv_paragraph(self, text: str, *, font: str = "Helvetica", size: float = 10.2, leading: float = 0.50 * cm) -> None:
        """Paragraph renderer for CV text (slightly tighter than cover letter)."""

        c = self.c
        max_w = self.main_w

        for raw in (text or "").split("\n"):
            line = raw.rstrip()
            if not line.strip():
                self.y -= 0.22 * cm
                continue

            wrapped = _wrap_lines(line.strip(), max_w, font, size)
            for wline in wrapped:
                self._ensure_space(0.62 * cm)
                c.setFillColor(self.theme.muted)
                c.setFont(font, size)
                c.drawString(self.main_left, self.y, wline)
                self.y -= leading

        self.y -= 0.18 * cm

    def _extract_period_tail(self, line: str) -> tuple[str, str]:
        """Try to split a line into (main_text, period_text) for right-aligned dates."""

        s = " ".join((line or "").split()).strip()
        if not s:
            return ("", "")

        # (2019–2023) style
        m = re.search(r"\(([^)]*(?:19|20)\d{2}[^)]*)\)\s*$", s)
        if m:
            period = (m.group(1) or "").strip()
            main = (s[: m.start()] or "").strip(" -–—|")
            return (main, period)

        # Trailing year range (2019 – 2023 / 2019-2023 / 2019 – Nå)
        m = re.search(
            r"((?:19|20)\d{2}[^\n]{0,18}(?:–|-)\s*(?:(?:19|20)\d{2}|nå|Nå|present|Present))\s*$",
            s,
        )
        if m:
            period = (m.group(1) or "").strip()
            main = (s[: m.start()] or "").strip(" -–—|")
            return (main, period)

        return (s, "")

    def _cv_entry_header(self, title_line: str) -> None:
        """Render one entry header line with optional right-aligned period."""

        c = self.c
        left, period = self._extract_period_tail(title_line)

        self._ensure_space(0.95 * cm)

        c.setFillColor(self.theme.text)
        c.setFont("Helvetica-Bold", 10.8)
        c.drawString(self.main_left, self.y, left or title_line)

        if period:
            c.setFillColor(colors.HexColor("#64748b"))
            c.setFont("Helvetica", 9)
            c.drawRightString(self.main_left + self.main_w, self.y, period)

        self.y -= 0.55 * cm

    def _draw_cv_text(self, text: str) -> None:
        """Render the AI-produced tailored_cv with improved layout.

        Notes:
        - We do NOT change the CV text content.
        - We only improve rendering and hide empty/noise sections.
        """

        src = (text or "").replace("\r\n", "\n").replace("\r", "\n")
        lines = src.split("\n")

        # Detect whether the CV contains the expected headings at all.
        has_any_heading = any((ln or "").strip().casefold() in CV_SECTION_TITLES_CF for ln in lines)
        if not has_any_heading:
            # Fallback to existing renderer (keeps behavior for older/free-form CV text).
            self._paragraph(text)
            return

        def _strip_bullet_prefix(s: str) -> str:
            s2 = (s or "").strip()
            if s2.startswith("•"):
                return s2[1:].strip()
            if s2.startswith("-"):
                return s2[1:].strip()
            return s2

        def _is_placeholder_line(line: str) -> bool:
            s = _strip_bullet_prefix(line)
            s_cf = " ".join(s.split()).casefold().strip(". ")
            if not s_cf:
                return True
            if s_cf in {"—", "-", "ikke oppgitt", "ikke dokumentert"}:
                return True
            if s_cf.startswith("ingen referanser"):
                return True
            if s_cf.startswith("ingen sertifisering"):
                return True
            if s_cf.startswith("referanser oppgis ved forespørsel"):
                return True
            if s_cf.startswith("ikke tilgjengelig"):
                return True
            if s_cf.startswith("ikke dokumentert"):
                return True
            if s_cf.startswith("ikke oppgitt"):
                return True
            # English placeholders (just in case)
            if s_cf in {"not provided", "not documented", "n/a"}:
                return True
            return False

        def _section_has_real_content(content_lines: list[str]) -> bool:
            for ln in content_lines:
                if not (ln or "").strip():
                    continue
                if _is_placeholder_line(ln):
                    continue
                return True
            return False

        # ---- Parse sections first (so we can skip empty sections without changing layout) ----
        sections: list[tuple[str, list[str]]] = []
        cur_section: str | None = None
        buf: list[str] = []

        for ln in lines:
            key = (ln or "").strip()
            key_cf = key.casefold()

            if key_cf in CV_SECTION_TITLES_CF:
                # Commit previous section (if any)
                if cur_section is not None:
                    sections.append((cur_section, buf))
                cur_section = CV_SECTION_TITLES_CF[key_cf]
                buf = []
                continue

            # Keep the old behavior: discard any preamble before the first recognized heading.
            if cur_section is None:
                continue

            buf.append(ln)

        if cur_section is not None:
            sections.append((cur_section, buf))

        # ---- Render sections (skip empty/noise) ----
        for section_title, raw_content in sections:
            content = [x.rstrip() for x in (raw_content or [])]

            # Trim outer blank lines.
            while content and not content[0].strip():
                content.pop(0)
            while content and not content[-1].strip():
                content.pop()

            if not content:
                continue

            # Hide empty/noise sections (e.g. "Ikke dokumentert.", "Ingen referanser oppgitt.")
            if not _section_has_real_content(content):
                continue

            self._cv_subheader(section_title)

            sec_cf = section_title.casefold()

            # Experience / education: treat non-bullet lines as entry headers.
            if sec_cf in _SEC_EXPERIENCE:
                entry_bullets: list[str] = []
                first_entry = True

                for ln in content:
                    s = (ln or "").strip()
                    if not s:
                        if entry_bullets:
                            self._cv_bullet_lines(entry_bullets)
                            entry_bullets = []
                        continue

                    # Skip placeholder/noise lines inside the section.
                    if _is_placeholder_line(s):
                        continue

                    is_bullet = s.startswith("•") or s.startswith("-")

                    if is_bullet:
                        entry_bullets.append(s)
                        continue

                    if entry_bullets:
                        self._cv_bullet_lines(entry_bullets)
                        entry_bullets = []

                    if not first_entry:
                        self.y -= 0.20 * cm
                    first_entry = False

                    self._cv_entry_header(s)

                if entry_bullets:
                    self._cv_bullet_lines(entry_bullets)

            # Bullet-friendly sections.
            elif sec_cf in _SEC_BULLETS:
                bulletish = [ln for ln in content if (ln or "").strip().startswith(("•", "-"))]
                if bulletish:
                    self._cv_bullet_lines([ln for ln in content if not _is_placeholder_line(ln)])
                else:
                    self._cv_paragraph("\n".join([ln for ln in content if not _is_placeholder_line(ln)]))

            # Summary and other text sections.
            else:
                self._cv_paragraph("\n".join([ln for ln in content if not _is_placeholder_line(ln)]))

    def _paragraph(self, text: str, *, font: str = "Helvetica", size: float = 10.2, leading: float = 0.50 * cm) -> None:
        c = self.c
        max_w = self.main_w

        for raw in (text or "").split("\n"):
            line = raw.rstrip()

            if not line.strip():
                self.y -= 0.25 * cm
                continue

            bullet = None
            stripped = line.strip()
            if stripped.startswith("•"):
                bullet = "•"
                stripped = stripped[1:].strip()
            elif stripped.startswith("-"):
                bullet = "•"
                stripped = stripped[1:].strip()

            # heading in paragraph (e.g. "Ansvar:")
            if stripped.endswith(":") and len(stripped) <= 40:
                self._ensure_space(0.65 * cm)
                c.setFillColor(self.theme.text)
                c.setFont("Helvetica-Bold", 10.4)
                c.drawString(self.main_left, self.y, stripped[:-1])
                self.y -= 0.45 * cm
                c.setFillColor(self.theme.muted)
                c.setFont(font, size)
                continue

            indent_x = self.main_left
            if bullet:
                indent_x = self.main_left + 0.55 * cm

            wrapped = _wrap_lines(stripped, max_w - (indent_x - self.main_left), font, size)
            for i, wline in enumerate(wrapped):
                self._ensure_space(0.62 * cm)
                if bullet and i == 0:
                    c.setFillColor(self.theme.muted)
                    c.setFont(font, size)
                    c.drawString(self.main_left, self.y, "•")

                c.setFillColor(self.theme.muted)
                c.setFont(font, size)
                c.drawString(indent_x, self.y, wline)
                self.y -= leading

        self.y -= 0.25 * cm

    def _boxed_cover_letter(self, title: str, text: str) -> None:
        """Draw a cover-letter box at the top of the white area.

        Goal:
        - Keep the cover letter compact when short (avoid big empty boxes)
        - Avoid splitting the cover letter if it fits on the page
        - If it doesn't fit, split cleanly (and avoid "wasted" space due to blank lines)
        """

        font = "Helvetica"
        size = 10.2
        leading = 0.50 * cm
        pad = 0.5 * cm

        lines: list[str] = []
        for raw in (text or "").split("\n"):
            if not raw.strip():
                lines.append("")
                continue
            for wln in _wrap_lines(raw.strip(), self.main_w - 2 * pad, font, size):
                lines.append(wln)

        # --- Choose a box height that doesn't create unnecessary whitespace ---
        # Minimum height: title + padding + at least one line
        min_h = (1.95 * cm)

        # Available vertical space on this page (from current y down to bottom margin)
        available_h = max(0.0, self.y - self.bottom_margin)

        # If possible, reserve space so the CV starts on the same page.
        # (We only reserve when the cover letter is short enough to allow it.)
        reserve_for_cv = 8.0 * cm

        needed_text_h = max(1, len(lines)) * leading
        needed_h = (1.45 * cm) + needed_text_h + pad  # title area + text + bottom padding

        # Case 1: Cover letter + some CV can fit on this page => keep everything on same page.
        if needed_h <= max(min_h, available_h - reserve_for_cv):
            box_h = max(min_h, needed_h)
        # Case 2: Entire cover letter fits on this page, but not together with CV => keep full letter here.
        elif needed_h <= available_h:
            box_h = max(min_h, needed_h)
        # Case 3: Cover letter is too long for the remaining space => fill what we can and continue next page.
        else:
            box_h = max(min_h, min(available_h, 11.5 * cm))

        self._ensure_space(box_h + 0.5 * cm)

        c = self.c
        x = self.main_left
        y_top = self.y

        # Box background
        c.setFillColor(self.theme.box_bg)
        c.setStrokeColor(self.theme.box_border)
        c.setLineWidth(1)
        c.roundRect(x, y_top - box_h, self.main_w, box_h, 10, fill=1, stroke=1)

        # Title
        c.setFillColor(self.theme.text)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + pad, y_top - 0.75 * cm, title)

        # Text
        c.setFillColor(self.theme.muted)
        c.setFont(font, size)

        y_txt = y_top - 1.45 * cm
        max_lines_in_box = int((box_h - 1.75 * cm) / leading)
        shown = lines[:max_lines_in_box]
        remaining = lines[max_lines_in_box:]

        for ln in shown:
            if not ln:
                # IMPORTANT: consume full line-height so we don't "waste" box space.
                y_txt -= leading
                continue
            c.drawString(x + pad, y_txt, ln)
            y_txt -= leading

        if remaining:
            c.setFillColor(colors.HexColor("#64748b"))
            c.setFont("Helvetica-Oblique", 9)
            c.drawRightString(x + self.main_w - pad, y_top - box_h + 0.35 * cm, "(fortsetter på neste side)")

        self.y = y_top - box_h - 0.7 * cm

        # If there is remaining cover letter text, print it before CV sections on a new page.
        if remaining:
            self._new_page()
            self._section_header("Søknad (fortsetter)")
            self._paragraph("\n".join([ln for ln in remaining if ln is not None]))

    # ---------- CV content ----------
    def _draw_experience(self) -> None:
        items = _parse_json_list(getattr(self.profile, "experience", ""))

        norm: list[dict] = []
        for it in items:
            if isinstance(it, dict):
                norm.append(it)
            elif isinstance(it, str) and it.strip():
                norm.append({"title": it.strip()})

        if not norm:
            self._paragraph("—")
            return

        c = self.c
        for it in norm[:30]:
            title = str(it.get("title") or "").strip()
            company = str(it.get("company") or "").strip()
            _from = str(it.get("from") or "").strip()
            _to = "Nå" if bool(it.get("current")) else str(it.get("to") or "").strip()

            head = " – ".join([x for x in [title, company] if x])
            period = " ".join([x for x in [_from, "–", _to] if x and x != "–"])

            self._ensure_space(1.2 * cm)

            c.setFillColor(self.theme.text)
            c.setFont("Helvetica-Bold", 10.6)
            c.drawString(self.main_left, self.y, head or "Erfaring")

            if period:
                c.setFillColor(colors.HexColor("#64748b"))
                c.setFont("Helvetica", 9)
                c.drawRightString(self.main_left + self.main_w, self.y, period)

            self.y -= 0.55 * cm

        self.y -= 0.1 * cm

    def _draw_education(self) -> None:
        items = _parse_json_list(getattr(self.profile, "education", ""))

        norm: list[dict] = []
        for it in items:
            if isinstance(it, dict):
                norm.append(it)
            elif isinstance(it, str) and it.strip():
                norm.append({"school": it.strip()})

        if not norm:
            self._paragraph("—")
            return

        c = self.c
        for it in norm[:30]:
            school = str(it.get("school") or "").strip()
            degree = str(it.get("degree") or "").strip()
            _from = str(it.get("from") or "").strip()
            _to = str(it.get("to") or "").strip()

            head = " – ".join([x for x in [degree, school] if x])
            period = " ".join([x for x in [_from, "–", _to] if x and x != "–"])

            self._ensure_space(1.2 * cm)

            c.setFillColor(self.theme.text)
            c.setFont("Helvetica-Bold", 10.6)
            c.drawString(self.main_left, self.y, head or "Utdanning")

            if period:
                c.setFillColor(colors.HexColor("#64748b"))
                c.setFont("Helvetica", 9)
                c.drawRightString(self.main_left + self.main_w, self.y, period)

            self.y -= 0.55 * cm

        self.y -= 0.1 * cm

    def _draw_references(self) -> None:
        items = _parse_json_list(getattr(self.profile, "references_json", ""))
        if not items:
            self._paragraph("Referanser oppgis ved forespørsel.")
            return

        lines: list[str] = []
        for it in items[:20]:
            if isinstance(it, str):
                s = it.strip()
                if s:
                    lines.append(f"• {s}")
                continue
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "").strip()
            rel = str(it.get("relation") or "").strip()
            contact = str(it.get("contact") or "").strip()
            main = " – ".join([x for x in [name, rel] if x])
            if contact:
                main = f"{main} ({contact})" if main else contact
            if main:
                lines.append(f"• {main}")

        if not lines:
            self._paragraph("Referanser oppgis ved forespørsel.")
        else:
            self._paragraph("\n".join(lines))

    def build(self) -> str:
        self._new_page()

        job_title_raw = (getattr(self.job, "title", "") or "").strip()
        company_raw = (getattr(self.job, "company", "") or "").strip()

        # Reduce job-ad noise in the subtitle. We only want:
        # - stillingstittel (when it looks like an actual title)
        # - bedriftsnavn
        job_title = _clean_job_title_for_pdf(job_title_raw)
        company = _clean_company_for_pdf(company_raw)

        subtitle = " / ".join([x for x in [job_title, company] if x])

        self._draw_main_title("Søknad + CV", subtitle=subtitle or None)
        self._boxed_cover_letter("Søknadstekst", self.cover_letter)

        # CV content
        if (self.cv_text or "").strip():
            self._section_header("CV")
            self._draw_cv_text(self.cv_text)
        else:
            # Fallback: render from profile if AI CV text is missing.
            self._section_header("Erfaring")
            self._draw_experience()

            self._section_header("Utdanning")
            self._draw_education()

            skills = (getattr(self.profile, "skills", "") or "").strip()
            if skills:
                self._section_header("Ferdigheter")
                self._paragraph(skills)

            gaps = (getattr(self.profile, "cv_gaps", "") or "").strip()
            if gaps:
                self._section_header("Hull i CV")
                self._paragraph(gaps)

            self._section_header("Referanser")
            self._draw_references()

        self.c.save()
        return str(self.path)


class _ClassicPdfDoc:
    """Full-width, no-sidebar layout for the 'Klassisk' template.

    - No colours: all black / dark grey
    - Times-Bold for all headings (serif)
    - Name + contact centred at top, then a horizontal rule
    - Sections separated by rule lines
    """

    _MARGIN_X = 2.2 * cm
    _MARGIN_TOP = 2.2 * cm
    _MARGIN_BOTTOM = 1.8 * cm
    _FONT_BODY = "Helvetica"
    _FONT_HEAD = "Times-Bold"
    _COLOR_BLACK = colors.black
    _COLOR_DARK = colors.HexColor("#1a1a1a")
    _COLOR_MID = colors.HexColor("#333333")
    _COLOR_MUTED = colors.HexColor("#555555")
    _COLOR_RULE = colors.HexColor("#999999")

    def __init__(
        self,
        filename: str,
        profile,
        job,
        cover_letter: str,
        cv_text: str,
        *,
        include_photo: bool = True,
        cv_only: bool = False,
    ):
        self.path = OUT / filename
        self.c = canvas.Canvas(str(self.path), pagesize=A4)
        self.width, self.height = A4
        self.profile = profile
        self.job = job
        self.cover_letter = cover_letter
        self.cv_text = cv_text
        self.include_photo = include_photo
        self.cv_only = cv_only

        self.left = self._MARGIN_X
        self.right = self.width - self._MARGIN_X
        self.content_w = self.right - self.left

        self.page_no = 0
        self.y = self.height

    # ---- Page management ----

    def _new_page(self) -> None:
        if self.page_no > 0:
            self.c.showPage()
        self.page_no += 1
        self.y = self.height - self._MARGIN_TOP
        self.c.setFillColor(self._COLOR_MUTED)
        self.c.setFont(self._FONT_BODY, 8)
        self.c.drawRightString(self.right, 0.9 * cm, f"Side {self.page_no}")

    def _ensure_space(self, needed_h: float) -> None:
        if self.y - needed_h <= self._MARGIN_BOTTOM:
            self._new_page()

    # ---- Header (name + contact) ----

    def _draw_header(self) -> None:
        c = self.c
        name = (getattr(self.profile, "name", "") or "").strip()
        c.setFillColor(self._COLOR_BLACK)
        c.setFont(self._FONT_HEAD, 24)
        c.drawCentredString(self.width / 2, self.y, name or "CV")
        self.y -= 0.9 * cm

        parts: list[str] = []
        phone = (getattr(self.profile, "phone", "") or "").strip()
        email = (getattr(self.profile, "email", "") or "").strip()
        addr = (getattr(self.profile, "address", "") or "").strip()
        postal_code = (getattr(self.profile, "postal_code", "") or "").strip()
        postal_place = (getattr(self.profile, "postal_place", "") or "").strip()
        location = " ".join([x for x in [postal_code, postal_place] if x]) or addr
        if phone:
            parts.append(phone)
        if email:
            parts.append(email)
        if location:
            parts.append(location)

        if parts:
            c.setFillColor(self._COLOR_MUTED)
            c.setFont(self._FONT_BODY, 9.5)
            c.drawCentredString(self.width / 2, self.y, "  |  ".join(parts))
            self.y -= 0.55 * cm

        # Divider rule
        c.setStrokeColor(self._COLOR_BLACK)
        c.setLineWidth(1.5)
        c.line(self.left, self.y, self.right, self.y)
        self.y -= 0.65 * cm

    # ---- Section headers ----

    def _section_header(self, title: str) -> None:
        self._ensure_space(1.3 * cm)
        self.y -= 0.25 * cm
        c = self.c
        c.setFillColor(self._COLOR_BLACK)
        c.setFont(self._FONT_HEAD, 12)
        c.drawString(self.left, self.y, title.upper())
        c.setStrokeColor(self._COLOR_BLACK)
        c.setLineWidth(0.8)
        c.line(self.left, self.y - 0.2 * cm, self.right, self.y - 0.2 * cm)
        self.y -= 0.75 * cm

    def _cv_subheader(self, title: str) -> None:
        self._ensure_space(1.0 * cm)
        if self.y < (self.height - self._MARGIN_TOP - 0.2 * cm):
            self.y -= 0.3 * cm
        c = self.c
        c.setFillColor(self._COLOR_BLACK)
        c.setFont(self._FONT_HEAD, 11)
        c.drawString(self.left, self.y, title)
        c.setStrokeColor(self._COLOR_RULE)
        c.setLineWidth(0.5)
        c.line(self.left, self.y - 0.18 * cm, self.right, self.y - 0.18 * cm)
        self.y -= 0.65 * cm

    # ---- Text rendering ----

    def _wrap(self, text: str, max_w: float, font: str, size: float) -> list[str]:
        return _wrap_lines(text, max_w, font, size)

    def _paragraph(self, text: str, *, font: str = "", size: float = 10.2, leading: float = 0.50 * cm) -> None:
        font = font or self._FONT_BODY
        c = self.c
        for raw in (text or "").split("\n"):
            line = raw.rstrip()
            if not line.strip():
                self.y -= 0.22 * cm
                continue
            stripped = line.strip()
            if stripped.startswith("•") or stripped.startswith("-"):
                bullet = True
                stripped = stripped[1:].strip()
            else:
                bullet = False
            indent_x = self.left + (0.55 * cm if bullet else 0)
            max_w = self.content_w - (indent_x - self.left)
            wrapped = self._wrap(stripped, max_w, font, size)
            for i, wline in enumerate(wrapped):
                self._ensure_space(0.62 * cm)
                c.setFillColor(self._COLOR_MID)
                c.setFont(font, size)
                if bullet and i == 0:
                    c.drawString(self.left, self.y, "•")
                c.drawString(indent_x, self.y, wline)
                self.y -= leading
        self.y -= 0.18 * cm

    def _cv_paragraph(self, text: str, **kwargs) -> None:
        self._paragraph(text, **kwargs)

    def _cv_bullet_lines(self, lines: list[str], *, font: str = "", size: float = 10.1, leading: float = 0.48 * cm) -> None:
        font = font or self._FONT_BODY
        c = self.c
        bullet_x = self.left
        text_x = self.left + 0.65 * cm
        max_w = self.content_w - 0.65 * cm
        for raw in lines:
            stripped = (raw or "").strip()
            if not stripped:
                self.y -= 0.18 * cm
                continue
            if stripped.startswith("•"):
                stripped = stripped[1:].strip()
            elif stripped.startswith("-"):
                stripped = stripped[1:].strip()
            wrapped = self._wrap(stripped, max_w, font, size)
            for i, wline in enumerate(wrapped):
                self._ensure_space(0.62 * cm)
                c.setFillColor(self._COLOR_MID)
                c.setFont(font, size)
                if i == 0:
                    c.drawString(bullet_x, self.y, "•")
                    c.drawString(text_x, self.y, wline)
                else:
                    c.drawString(text_x, self.y, wline)
                self.y -= leading
        self.y -= 0.12 * cm

    def _extract_period_tail(self, line: str) -> tuple[str, str]:
        s = " ".join((line or "").split()).strip()
        if not s:
            return ("", "")
        m = re.search(r"\(([^)]*(?:19|20)\d{2}[^)]*)\)\s*$", s)
        if m:
            return (s[: m.start()].strip(" -–—|"), (m.group(1) or "").strip())
        m = re.search(
            r"((?:19|20)\d{2}[^\n]{0,18}(?:–|-)\s*(?:(?:19|20)\d{2}|nå|Nå|present|Present))\s*$",
            s,
        )
        if m:
            return (s[: m.start()].strip(" -–—|"), (m.group(1) or "").strip())
        return (s, "")

    def _cv_entry_header(self, title_line: str) -> None:
        c = self.c
        left, period = self._extract_period_tail(title_line)
        self._ensure_space(0.95 * cm)
        c.setFillColor(self._COLOR_BLACK)
        c.setFont(self._FONT_HEAD, 10.8)
        c.drawString(self.left, self.y, left or title_line)
        if period:
            c.setFillColor(self._COLOR_MUTED)
            c.setFont(self._FONT_BODY, 9)
            c.drawRightString(self.right, self.y, period)
        self.y -= 0.55 * cm

    def _draw_cv_text(self, text: str) -> None:
        """Render AI-produced tailored_cv — same section logic as sidebar variant."""
        src = (text or "").replace("\r\n", "\n").replace("\r", "\n")
        lines = src.split("\n")

        has_any_heading = any((ln or "").strip().casefold() in CV_SECTION_TITLES_CF for ln in lines)
        if not has_any_heading:
            self._paragraph(text)
            return

        def _strip_bullet_prefix(s: str) -> str:
            s2 = (s or "").strip()
            if s2.startswith("•"):
                return s2[1:].strip()
            if s2.startswith("-"):
                return s2[1:].strip()
            return s2

        def _is_placeholder(line: str) -> bool:
            s = " ".join(_strip_bullet_prefix(line).split()).casefold().strip(". ")
            if not s:
                return True
            bads = {
                "—", "-", "ikke oppgitt", "ikke dokumentert",
                "not provided", "not documented", "n/a",
            }
            if s in bads:
                return True
            starters = (
                "ingen referanser", "ingen sertifisering",
                "referanser oppgis", "ikke tilgjengelig",
                "ikke dokumentert", "ikke oppgitt",
            )
            return any(s.startswith(x) for x in starters)

        def _has_real(content: list[str]) -> bool:
            return any(
                (ln or "").strip() and not _is_placeholder(ln)
                for ln in content
            )

        sections: list[tuple[str, list[str]]] = []
        cur: str | None = None
        buf: list[str] = []
        for ln in lines:
            key_cf = (ln or "").strip().casefold()
            if key_cf in CV_SECTION_TITLES_CF:
                if cur is not None:
                    sections.append((cur, buf))
                cur = CV_SECTION_TITLES_CF[key_cf]
                buf = []
            elif cur is not None:
                buf.append(ln)
        if cur is not None:
            sections.append((cur, buf))

        for sec_title, raw in sections:
            content = [x.rstrip() for x in raw]
            while content and not content[0].strip():
                content.pop(0)
            while content and not content[-1].strip():
                content.pop()
            if not content or not _has_real(content):
                continue

            self._cv_subheader(sec_title)
            sec_cf = sec_title.casefold()

            if sec_cf in _SEC_EXPERIENCE:
                entry_bullets: list[str] = []
                first = True
                for ln in content:
                    s = (ln or "").strip()
                    if not s:
                        if entry_bullets:
                            self._cv_bullet_lines(entry_bullets)
                            entry_bullets = []
                        continue
                    if _is_placeholder(s):
                        continue
                    if s.startswith("•") or s.startswith("-"):
                        entry_bullets.append(s)
                    else:
                        if entry_bullets:
                            self._cv_bullet_lines(entry_bullets)
                            entry_bullets = []
                        if not first:
                            self.y -= 0.20 * cm
                        first = False
                        self._cv_entry_header(s)
                if entry_bullets:
                    self._cv_bullet_lines(entry_bullets)
            elif sec_cf in _SEC_BULLETS:
                real = [ln for ln in content if not _is_placeholder(ln)]
                bulletish = [ln for ln in real if (ln or "").strip().startswith(("•", "-"))]
                if bulletish:
                    self._cv_bullet_lines(real)
                else:
                    self._cv_paragraph("\n".join(real))
            else:
                real = [ln for ln in content if not _is_placeholder(ln)]
                self._cv_paragraph("\n".join(real))

    def _cover_section(self, text: str) -> None:
        """Render cover letter as a plain section (no box)."""
        self._section_header("Søknadstekst")
        self._paragraph(text)

    def build(self) -> str:
        self._new_page()
        self._draw_header()

        if not self.cv_only and (self.cover_letter or "").strip():
            self._cover_section(self.cover_letter)

        if (self.cv_text or "").strip():
            self._section_header("CV")
            self._draw_cv_text(self.cv_text)

        self.c.save()
        return str(self.path)


class _SidebarCvOnlyDoc(_SidebarPdfDoc):
    """CV-only variant of the sidebar template.

    Requirements:
    - Must NOT show job title/company/URL or other job-ad noise at the top.
    - Must only render candidate CV content (AI tailored_cv or profile fallback).
    """

    def build(self) -> str:
        self._new_page()

        # No job subtitle here (prevents "annonsetittel øverst" in CV-only PDF).
        self._draw_main_title("CV", subtitle=None)

        if (self.cv_text or "").strip():
            self._section_header("CV")
            self._draw_cv_text(self.cv_text)
        else:
            # Fallback: render from profile if AI CV text is missing.
            self._section_header("Erfaring")
            self._draw_experience()

            self._section_header("Utdanning")
            self._draw_education()

            skills = (getattr(self.profile, "skills", "") or "").strip()
            if skills:
                self._section_header("Ferdigheter")
                self._paragraph(skills)

            gaps = (getattr(self.profile, "cv_gaps", "") or "").strip()
            if gaps:
                self._section_header("Hull i CV")
                self._paragraph(gaps)

            self._section_header("Referanser")
            self._draw_references()

        self.c.save()
        return str(self.path)


_VALID_TEMPLATES = {"kreativ", "profesjonell", "klassisk"}


def _resolve_theme(template: str) -> _Theme | None:
    """Return a _Theme for sidebar templates, or None for full-width (klassisk)."""
    t = (template or "profesjonell").strip().lower()
    if t not in _VALID_TEMPLATES:
        t = "profesjonell"
    if t == "kreativ":
        return THEME_KREATIV
    if t == "klassisk":
        return None  # signals _ClassicPdfDoc
    return THEME_PROFESJONELL


def make_application_pdfs(
    profile,
    job,
    cover_letter: str,
    tailored_cv: str,
    *,
    include_photo: bool = True,
    template: str = "profesjonell",
):
    """Generate TWO PDFs — combined (søknad+CV) and CV-only.

    `template` is one of: "kreativ", "profesjonell", "klassisk".
    Returns (combined_pdf_path, cv_only_pdf_path).
    """

    base = safe_name(f"{job.title}_{job.company}")
    combined_filename = f"soknad_og_cv_{base}.pdf"
    cv_filename = f"cv_{base}.pdf"

    theme = _resolve_theme(template)

    if theme is None:
        # Klassisk: full-width, no sidebar
        combined_doc = _ClassicPdfDoc(
            combined_filename, profile, job,
            cover_letter, tailored_cv,
            include_photo=include_photo,
        )
        cv_doc = _ClassicPdfDoc(
            cv_filename, profile, job,
            "", tailored_cv,
            include_photo=include_photo,
            cv_only=True,
        )
    else:
        combined_doc = _SidebarPdfDoc(
            combined_filename, profile, job,
            cover_letter=cover_letter, cv_text=tailored_cv,
            include_photo=include_photo, theme=theme,
        )
        cv_doc = _SidebarCvOnlyDoc(
            cv_filename, profile, job,
            cover_letter="", cv_text=tailored_cv,
            include_photo=include_photo, theme=theme,
        )

    combined_path = combined_doc.build()
    cv_path = cv_doc.build()

    return combined_path, cv_path
