"""Admin statistics report, emailed Monday and Thursday 07:00 Europe/Oslo.

Test accounts are excluded from every number via TEST_EMAILS. is_tester is
deliberately NOT used as a filter: profiles 5-31 are real, grandfathered
users who have is_tester=True only to bypass the free limit.
"""

from datetime import datetime, timedelta

import pytz
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .emailer import send_email
from .models import AdminReportLog, PlayBillingPurchase, Profile, StripePayment, UsageEvent, User

REPORT_RECIPIENT = "bjelland76@gmail.com"
TEST_EMAILS = {"fb@frydenbo.no", "bjelland76@gmail.com", "frankbjelland@proton.me"}

OSLO = pytz.timezone("Europe/Oslo")
REPORT_WEEKDAYS = (0, 3)  # Monday, Thursday
REPORT_HOUR = 7
# A slot missed by a restart/deploy is caught up at startup only within this
# window, so e.g. a Sunday deploy doesn't send a stale Thursday report.
CATCH_UP_WINDOW = timedelta(hours=12)

KEY_ACTIONS = [
    ("job_analysis_completed", "Jobbanalyser"),
    ("cv_generation_completed", "CV-genereringer"),
    ("cv_analysis_completed", "CV-analyser"),
    ("application_sent", "Søknader sendt"),
]


def _escape_html(text: str) -> str:
    return (str(text or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _to_oslo(dt_utc: datetime) -> datetime:
    return pytz.utc.localize(dt_utc).astimezone(OSLO)


def latest_slot_utc(now_utc: datetime) -> datetime:
    """Most recent Mon/Thu 07:00 Oslo time at or before now_utc (naive UTC)."""
    now_oslo = _to_oslo(now_utc)
    for days_back in range(8):
        day = (now_oslo - timedelta(days=days_back)).date()
        if day.weekday() not in REPORT_WEEKDAYS:
            continue
        slot = OSLO.localize(datetime(day.year, day.month, day.day, REPORT_HOUR))
        if slot <= now_oslo:
            return slot.astimezone(pytz.utc).replace(tzinfo=None)
    raise RuntimeError("no report slot found in the last 8 days")


def _test_user_ids(db: Session) -> list[int]:
    ids = set(db.scalars(select(User.id).where(func.lower(User.email).in_(TEST_EMAILS))))
    ids |= set(
        db.scalars(
            select(Profile.user_id).where(
                func.lower(Profile.email).in_(TEST_EMAILS), Profile.user_id.is_not(None)
            )
        )
    )
    return sorted(ids)


def _test_anon_ids(db: Session, test_user_ids: list[int]) -> list[str]:
    """Device ids that have ever logged events while signed in as a test account."""
    if not test_user_ids:
        return []
    return list(
        db.scalars(
            select(UsageEvent.anon_id)
            .where(UsageEvent.user_id.in_(test_user_ids), UsageEvent.anon_id.is_not(None))
            .distinct()
        )
    )


def build_stats(db: Session, since: datetime, until: datetime) -> dict:
    test_uids = _test_user_ids(db)
    test_anons = _test_anon_ids(db, test_uids)

    # NULL-safe exclusions: a plain NOT IN drops rows where the column is NULL.
    event_filter = [
        UsageEvent.created_at >= since,
        UsageEvent.created_at < until,
        or_(UsageEvent.user_id.is_(None), UsageEvent.user_id.not_in(test_uids)),
        or_(UsageEvent.anon_id.is_(None), UsageEvent.anon_id.not_in(test_anons)),
    ]
    profile_filter = [
        or_(Profile.user_id.is_(None), Profile.user_id.not_in(test_uids)),
        func.lower(Profile.email).not_in(TEST_EMAILS),
    ]

    profiles_total = db.scalar(select(func.count(Profile.id)).where(*profile_filter)) or 0
    # profiles has no created_at; a profile's signup time is its user's.
    profiles_new = db.scalar(
        select(func.count(Profile.id))
        .join(User, User.id == Profile.user_id)
        .where(*profile_filter, User.created_at >= since, User.created_at < until)
    ) or 0
    grandfathered_or_tester = db.scalar(
        select(func.count(Profile.id)).where(*profile_filter, Profile.is_tester.is_(True))
    ) or 0

    active_users = db.scalar(
        select(func.count(func.distinct(UsageEvent.user_id))).where(
            *event_filter, UsageEvent.user_id.is_not(None)
        )
    ) or 0
    anon_devices = db.scalar(
        select(func.count(func.distinct(UsageEvent.anon_id))).where(
            *event_filter, UsageEvent.anon_id.is_not(None)
        )
    ) or 0

    # action -> {"total", "logged_in", "anonymous"}
    actions: dict[str, dict[str, int]] = {}
    for action, is_anon, cnt in db.execute(
        select(UsageEvent.action, UsageEvent.user_id.is_(None), func.count(UsageEvent.id))
        .where(*event_filter)
        .group_by(UsageEvent.action, UsageEvent.user_id.is_(None))
    ):
        row = actions.setdefault(action, {"total": 0, "logged_in": 0, "anonymous": 0})
        row["total"] += cnt
        row["anonymous" if is_anon else "logged_in"] += cnt

    subscriptions: dict[str, int] = {}
    for status, cnt in db.execute(
        select(Profile.subscription_status, func.count(Profile.id))
        .where(*profile_filter)
        .group_by(Profile.subscription_status)
    ):
        subscriptions[status or "ingen"] = cnt
    expiring_soon = db.scalar(
        select(func.count(Profile.id)).where(
            *profile_filter,
            Profile.subscription_status == "active",
            Profile.subscription_end.is_not(None),
            Profile.subscription_end >= until,
            Profile.subscription_end < until + timedelta(days=7),
        )
    ) or 0

    play_purchases = [
        {"product_id": product_id, "status": status, "count": cnt}
        for product_id, status, cnt in db.execute(
            select(PlayBillingPurchase.product_id, PlayBillingPurchase.status, func.count(PlayBillingPurchase.id))
            .where(
                PlayBillingPurchase.verified_at >= since,
                PlayBillingPurchase.verified_at < until,
                PlayBillingPurchase.user_id.not_in(test_uids),
            )
            .group_by(PlayBillingPurchase.product_id, PlayBillingPurchase.status)
            .order_by(func.count(PlayBillingPurchase.id).desc())
        )
    ]
    stripe_count, stripe_credits = db.execute(
        select(func.count(StripePayment.id), func.coalesce(func.sum(StripePayment.credits), 0)).where(
            StripePayment.confirmed_at >= since,
            StripePayment.confirmed_at < until,
            StripePayment.user_id.not_in(test_uids),
        )
    ).one()

    return {
        "since": since,
        "until": until,
        "profiles_total": profiles_total,
        "profiles_new": profiles_new,
        "grandfathered_or_tester": grandfathered_or_tester,
        "active_users": active_users,
        "anon_devices": anon_devices,
        "actions": actions,
        "subscriptions": subscriptions,
        "expiring_soon": expiring_soon,
        "play_purchases": play_purchases,
        "stripe_count": stripe_count,
        "stripe_credits": stripe_credits,
        "excluded_test_users": len(test_uids),
        "excluded_test_devices": len(test_anons),
    }


def render_report(stats: dict) -> tuple[str, str, str]:
    since_o, until_o = _to_oslo(stats["since"]), _to_oslo(stats["until"])
    days = (stats["until"] - stats["since"]).total_seconds() / 86400
    period = f"{since_o:%d.%m %H:%M} → {until_o:%d.%m %H:%M} ({days:.1f} dager)"

    actions = stats["actions"]
    key_names = {name for name, _ in KEY_ACTIONS}
    key_rows = [(label, actions.get(name, {"total": 0, "logged_in": 0, "anonymous": 0})) for name, label in KEY_ACTIONS]
    other_rows = sorted(
        ((name, row) for name, row in actions.items() if name not in key_names),
        key=lambda item: -item[1]["total"],
    )
    analyses = actions.get("job_analysis_completed", {}).get("total", 0)
    play_total = sum(p["count"] for p in stats["play_purchases"])

    subject = (
        f"ReadyCV-statistikk: +{stats['profiles_new']} profiler, {analyses} analyser "
        f"({since_o:%d.%m}–{until_o:%d.%m})"
    )

    def fmt_row(label: str, row: dict) -> str:
        return f"  {label + ':':<34}{row['total']:>6}   (innlogget {row['logged_in']}, anonym {row['anonymous']})"

    lines = [
        f"ReadyCV – statistikk {period}",
        "Testkontoer er holdt utenfor alle tall.",
        "",
        "BRUKERE",
        f"  {'Registrerte profiler:':<34}{stats['profiles_total']:>6}  (+{stats['profiles_new']})",
        f"  {'Aktive innloggede brukere:':<34}{stats['active_users']:>6}",
        f"  {'Unike anonyme enheter:':<34}{stats['anon_devices']:>6}",
        f"  {'Profiler med ubegrenset tilgang:':<34}{stats['grandfathered_or_tester']:>6}  (is_tester, inkl. grandfathered)",
        "",
        "HANDLINGER I PERIODEN",
        *[fmt_row(label, row) for label, row in key_rows],
    ]
    if other_rows:
        lines += ["", "  Øvrige hendelser:"]
        lines += [fmt_row(name, row) for name, row in other_rows]
    lines += [
        "",
        "ABONNEMENT",
        "  " + " · ".join(f"{k}: {v}" for k, v in sorted(stats["subscriptions"].items(), key=lambda kv: -kv[1])),
        f"  Aktive som utløper neste 7 dager: {stats['expiring_soon']}",
        "",
        "KJØP I PERIODEN",
        f"  Play Billing: {play_total}"
        + (
            "  (" + ", ".join(f"{p['product_id']} [{p['status']}] ×{p['count']}" for p in stats["play_purchases"]) + ")"
            if stats["play_purchases"]
            else ""
        ),
        f"  Stripe:       {stats['stripe_count']}  ({stats['stripe_credits']} kreditter)",
        "",
        f"Ekskludert: {stats['excluded_test_users']} testkontoer, {stats['excluded_test_devices']} testenheter.",
    ]
    body = "\n".join(lines)

    td = 'style="padding:3px 12px 3px 0;border-bottom:1px solid #eee"'
    tdr = 'style="padding:3px 12px 3px 0;border-bottom:1px solid #eee;text-align:right"'

    def html_table(rows: list[tuple]) -> str:
        cells = "".join(
            "<tr>" + "".join(f"<td {tdr if i else td}>{_escape_html(c)}</td>" for i, c in enumerate(r)) + "</tr>"
            for r in rows
        )
        return f'<table style="border-collapse:collapse;font-size:14px">{cells}</table>'

    def h(title: str) -> str:
        return f'<h3 style="margin:20px 0 6px;font-size:15px">{_escape_html(title)}</h3>'

    action_rows = [("", "Totalt", "Innlogget", "Anonym")] + [
        (label, row["total"], row["logged_in"], row["anonymous"]) for label, row in key_rows
    ] + [(name, row["total"], row["logged_in"], row["anonymous"]) for name, row in other_rows]

    html = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;max-width:560px">'
        f'<h2 style="margin:0 0 4px;font-size:18px">ReadyCV – statistikk</h2>'
        f'<p style="margin:0;color:#666;font-size:13px">{_escape_html(period)}<br>Testkontoer er holdt utenfor alle tall.</p>'
        + h("Brukere")
        + html_table([
            ("Registrerte profiler", f"{stats['profiles_total']} (+{stats['profiles_new']})"),
            ("Aktive innloggede brukere", stats["active_users"]),
            ("Unike anonyme enheter", stats["anon_devices"]),
            ("Profiler med ubegrenset tilgang", stats["grandfathered_or_tester"]),
        ])
        + h("Handlinger i perioden")
        + html_table(action_rows)
        + h("Abonnement")
        + html_table(
            sorted(stats["subscriptions"].items(), key=lambda kv: -kv[1])
            + [("Aktive som utløper neste 7 dager", stats["expiring_soon"])]
        )
        + h("Kjøp i perioden")
        + html_table(
            [("Play Billing totalt", play_total)]
            + [(f"  {p['product_id']} [{p['status']}]", p["count"]) for p in stats["play_purchases"]]
            + [("Stripe", f"{stats['stripe_count']} ({stats['stripe_credits']} kreditter)")]
        )
        + f'<p style="margin-top:20px;color:#999;font-size:12px">Ekskludert: {stats["excluded_test_users"]} testkontoer, '
        f'{stats["excluded_test_devices"]} testenheter.</p></div>'
    )
    return subject, body, html


def _previous_period_end(db: Session, fallback: datetime) -> datetime:
    last = db.scalar(
        select(AdminReportLog.period_end)
        .where(AdminReportLog.kind == "scheduled")
        .order_by(AdminReportLog.period_end.desc())
        .limit(1)
    )
    return last or fallback


def send_stats_report(kind: str = "scheduled", now: datetime | None = None) -> dict:
    """Builds and sends one report covering the time since the last scheduled
    report. Manual sends are logged as kind="manual" and don't move the
    scheduled period forward.
    """
    now = now or datetime.utcnow()
    db = SessionLocal()
    try:
        since = _previous_period_end(db, fallback=now - timedelta(days=7))
        stats = build_stats(db, since, now)
        subject, body, html = render_report(stats)
        result = send_email(REPORT_RECIPIENT, subject, body, html=html)
        if isinstance(result, dict) and result.get("sent") is False:
            print(f"[StatsReport] send failed: {result.get('reason')}", flush=True)
            return {"sent": False, "reason": result.get("reason"), "subject": subject}
        db.add(AdminReportLog(kind=kind, period_start=since, period_end=now, sent_at=datetime.utcnow()))
        db.commit()
        print(f"[StatsReport] sent ({kind}): {subject}", flush=True)
        return {"sent": True, "subject": subject, "body": body}
    finally:
        db.close()


def maybe_send_scheduled_report() -> None:
    """Idempotent: sends the report for the latest Mon/Thu 07:00 slot unless one
    was already sent for it. Called by the cron trigger and once at startup,
    so a restart/deploy colliding with 07:00 neither loses nor doubles it.
    """
    try:
        now = datetime.utcnow()
        slot = latest_slot_utc(now)
        if now - slot > CATCH_UP_WINDOW:
            return
        db = SessionLocal()
        try:
            already_sent = db.scalar(
                select(func.count(AdminReportLog.id)).where(
                    AdminReportLog.kind == "scheduled", AdminReportLog.sent_at >= slot
                )
            )
        finally:
            db.close()
        if already_sent:
            return
        send_stats_report("scheduled", now=now)
    except Exception as e:
        print(f"[StatsReport] job error: {e!r}", flush=True)
