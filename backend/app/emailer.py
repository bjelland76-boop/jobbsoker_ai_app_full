import os

import resend
from dotenv import load_dotenv

load_dotenv(".env")

resend.api_key = os.getenv("RESEND_API_KEY")

DEFAULT_FROM_EMAIL = "Ærlig Jobbcoach <kode@aerlig.no>"


def _escape_html(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def send_email(to_email: str, subject: str, body: str, attachments=None, html: str = None):
    """Send an email via Resend.

    Environment variables:
      RESEND_API_KEY (required)
      FROM_EMAIL (optional, defaults to "Ærlig Jobbcoach <kode@aerlig.no>")
      REPLY_TO_EMAIL (optional)
    """

    attachments = attachments or []

    if not resend.api_key:
        return {"sent": False, "reason": "Resend er ikke konfigurert (RESEND_API_KEY mangler)"}

    to_email = (to_email or "").strip()
    if not to_email:
        return {"sent": False, "reason": "Mangler mottaker-e-post"}

    from_email = (os.getenv("FROM_EMAIL") or DEFAULT_FROM_EMAIL).strip()
    reply_to = (os.getenv("REPLY_TO_EMAIL") or "").strip()

    params = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "text": body or "",
        "html": html or f"<p>{_escape_html(body).replace(chr(10), '<br>')}</p>",
    }
    if reply_to:
        params["reply_to"] = reply_to

    email_attachments = []
    for file_path in attachments:
        try:
            with open(file_path, "rb") as f:
                data = f.read()
            email_attachments.append({
                "filename": os.path.basename(file_path),
                "content": list(data),
            })
        except Exception as e:
            return {"sent": False, "reason": f"Kunne ikke lese vedlegg: {e}"}
    if email_attachments:
        params["attachments"] = email_attachments

    try:
        resend.Emails.send(params)
        return {"sent": True}
    except Exception as e:
        return {"sent": False, "reason": f"Resend-feil: {e}"}
