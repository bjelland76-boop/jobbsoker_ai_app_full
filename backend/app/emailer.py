import os
import smtplib
import socket
from email.message import EmailMessage

from dotenv import load_dotenv

load_dotenv(".env")


def _env_bool(key: str, default: bool) -> bool:
    v = (os.getenv(key) or "").strip().lower()
    if not v:
        return default
    return v in {"1", "true", "yes", "y", "on"}


def send_email(to_email: str, subject: str, body: str, attachments=None):
    """Send an email with optional PDF attachments.

    Environment variables (recommended):
      SMTP_HOST
      SMTP_PORT (default 587)
      SMTP_USER
      SMTP_PASSWORD
      FROM_EMAIL

    Optional:
      REPLY_TO_EMAIL (adds a Reply-To header)
      SMTP_USE_TLS (default true)
      SMTP_USE_SSL (default false; if true typically use port 465)
      SMTP_TIMEOUT_SECONDS (default 20)

    SendGrid SMTP example:
      SMTP_HOST=smtp.sendgrid.net
      SMTP_PORT=587
      SMTP_USER=apikey
      SMTP_PASSWORD=<SENDGRID_API_KEY>
      FROM_EMAIL=<verified sender>
    """

    attachments = attachments or []

    host = (os.getenv("SMTP_HOST") or "").strip()
    user = (os.getenv("SMTP_USER") or "").strip()
    password = (os.getenv("SMTP_PASSWORD") or "").strip()
    from_email = (os.getenv("FROM_EMAIL") or user or "").strip()

    port = int((os.getenv("SMTP_PORT") or "587").strip() or "587")
    use_tls = _env_bool("SMTP_USE_TLS", True)
    use_ssl = _env_bool("SMTP_USE_SSL", False)
    timeout_s = int((os.getenv("SMTP_TIMEOUT_SECONDS") or "20").strip() or "20")

    if not host or not user or not password or not from_email:
        return {"sent": False, "reason": "SMTP er ikke konfigurert"}

    reply_to = (os.getenv("REPLY_TO_EMAIL") or "").strip()

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = (to_email or "").strip()
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)

    for file_path in attachments:
        try:
            with open(file_path, "rb") as f:
                data = f.read()
            filename = os.path.basename(file_path)
            msg.add_attachment(
                data,
                maintype="application",
                subtype="pdf",
                filename=filename,
            )
        except Exception as e:
            return {"sent": False, "reason": f"Kunne ikke lese vedlegg: {e}"}

    try:
        if use_ssl:
            smtp = smtplib.SMTP_SSL(host, port, timeout=timeout_s)
        else:
            smtp = smtplib.SMTP(host, port, timeout=timeout_s)

        with smtp:
            # STARTTLS if enabled and not already SSL.
            if use_tls and not use_ssl:
                smtp.starttls()

            smtp.login(user, password)
            smtp.send_message(msg)

        return {"sent": True}

    except (smtplib.SMTPException, socket.timeout, OSError) as e:
        return {"sent": False, "reason": f"SMTP-feil: {e}"}
