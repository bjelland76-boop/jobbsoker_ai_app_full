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


THEME = _Theme(
    sidebar_bg=colors.HexColor("#1e3a8a"),
    sidebar_text=colors.white,
    sidebar_muted=colors.HexColor("#dbeafe"),
    divider=colors.HexColor("#93c5fd"),
    text=colors.HexColor("#0f172a"),
    muted=colors.HexColor("#334155"),
    box_bg=colors.HexColor("#f8fafc"),
    box_border=colors.HexColor("#cbd5e1"),
    section_accent=colors.HexColor("#1e3a8a"),
)


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
    ):
        self.path = OUT / filename
        self.c = canvas.Canvas(str(self.path), pagesize=A4)
        self.width, self.height = A4

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
        c.setFillColor(THEME.sidebar_bg)
        c.rect(0, 0, self.sidebar_w, self.height, fill=1, stroke=0)

        # Divider line
        c.setStrokeColor(THEME.divider)
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
            c.setFillColor(THEME.sidebar_muted)
            c.setFont("Helvetica-Bold", 18)
            initials = "".join([p[:1] for p in (getattr(self.profile, "name", "") or "").split()[:2]]).upper()
            c.drawCentredString(x + photo_box / 2, y_img + photo_box / 2 - 6, initials or "CV")
            y = y_img - 0.7 * cm

        # Name
        name = (getattr(self.profile, "name", "") or "").strip() or ""
        c.setFillColor(THEME.sidebar_text)
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
            c.setFillColor(THEME.sidebar_muted)
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

        c.setFillColor(THEME.sidebar_text)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(pad_x, y, "SPRÅK")
        y -= 0.45 * cm

        c.setFillColor(THEME.sidebar_muted)
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
        c.setFillColor(THEME.text)
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
        c.setFillColor(THEME.text)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(self.main_left, self.y, title.upper())

        # Accent underline
        c.setStrokeColor(THEME.section_accent)
        c.setLineWidth(1.5)
        c.line(self.main_left, self.y - 0.18 * cm, self.main_left + 4.2 * cm, self.y - 0.18 * cm)

        self.y -= 0.75 * cm

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
                c.setFillColor(THEME.text)
                c.setFont("Helvetica-Bold", 10.4)
                c.drawString(self.main_left, self.y, stripped[:-1])
                self.y -= 0.45 * cm
                c.setFillColor(THEME.muted)
                c.setFont(font, size)
                continue

            indent_x = self.main_left
            if bullet:
                indent_x = self.main_left + 0.55 * cm

            wrapped = _wrap_lines(stripped, max_w - (indent_x - self.main_left), font, size)
            for i, wline in enumerate(wrapped):
                self._ensure_space(0.62 * cm)
                if bullet and i == 0:
                    c.setFillColor(THEME.muted)
                    c.setFont(font, size)
                    c.drawString(self.main_left, self.y, "•")

                c.setFillColor(THEME.muted)
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
        c.setFillColor(THEME.box_bg)
        c.setStrokeColor(THEME.box_border)
        c.setLineWidth(1)
        c.roundRect(x, y_top - box_h, self.main_w, box_h, 10, fill=1, stroke=1)

        # Title
        c.setFillColor(THEME.text)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + pad, y_top - 0.75 * cm, title)

        # Text
        c.setFillColor(THEME.muted)
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

            c.setFillColor(THEME.text)
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

            c.setFillColor(THEME.text)
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

        job_title = (getattr(self.job, "title", "") or "").strip()
        company = (getattr(self.job, "company", "") or "").strip()
        subtitle = " / ".join([x for x in [job_title, company] if x])

        self._draw_main_title("Søknad + CV", subtitle=subtitle or None)
        self._boxed_cover_letter("Søknadstekst", self.cover_letter)

        # CV content
        if (self.cv_text or "").strip():
            self._section_header("CV")
            self._paragraph(self.cv_text)
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


def make_application_pdfs(profile, job, cover_letter: str, tailored_cv: str, *, include_photo: bool = True):
    """Generate ONE combined PDF with a modern layout.

    The PDF includes:
    - Left blue sidebar with photo + personal details + languages (from profile)
    - Right white area with a cover letter box at the top (cover_letter)
    - CV section generated from AI (tailored_cv)

    Note: We keep the (cover_path, cv_path) return signature for backward compatibility.
    """

    base = safe_name(f"{job.title}_{job.company}")
    filename = f"soknad_og_cv_{base}.pdf"

    doc = _SidebarPdfDoc(
        filename,
        profile,
        job,
        cover_letter=cover_letter,
        cv_text=tailored_cv,
        include_photo=include_photo,
    )

    combined_path = doc.build()
    return combined_path, combined_path
