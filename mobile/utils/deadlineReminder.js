import { LocalNotifications } from '@capacitor/local-notifications';
import i18n from '../src/i18n';

// Plain utility function, not a React component -- no access to useApp()'s
// t(), so this calls the raw i18next instance directly (same underlying
// mechanism AppContext.js's own t() wraps).
function t(key, options) {
  try { return i18n.t(key, options) || key; } catch (e) { return key; }
}

// Isolert Fase 6-leveranse (frist/intervju-varsling): planlegg ETT lokalt
// varsel for en søknadsfrist, helt device-lokalt -- ingen backend, ingen
// ekstern kalender. Se DeadlineReminderModal.js for pop-up-en som kaller
// dette, og useJobAnalysis.js for hvor pop-up-en trigges.
//
// jobId brukes direkte som varsel-ID (1:1) -- re-bekrefter brukeren samme
// jobb senere, overskriver schedule() ganske enkelt det forrige varselet
// for samme ID i stedet for å opprette et duplikat.
export async function scheduleDeadlineReminder({ jobId, jobTitle, company, deadlineDate }) {
  const { display } = await LocalNotifications.checkPermissions();
  if (display !== 'granted') {
    const { display: after } = await LocalNotifications.requestPermissions();
    if (after !== 'granted') return { ok: false, reason: 'permission_denied' };
  }

  // Fast, ikke-konfigurerbart tidspunkt for denne isolerte leveransen:
  // dagen før kl. 09:00 (selvvalgt varslingstidspunkt er en Jobbkalender
  // (B)-funksjon, ikke del av denne runden).
  const deadline = new Date(`${deadlineDate}T09:00:00`);
  if (Number.isNaN(deadline.getTime())) return { ok: false, reason: 'invalid_date' };

  let fireAt = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);
  const now = new Date();
  if (fireAt <= now) {
    // Fristen er i dag/i morgen tidlig, eller allerede nær forfall --
    // ikke planlegg et varsel i fortiden (LocalNotifications avviser/
    // fyrer det umiddelbart uansett). Gi i stedet et lite varsel snart.
    fireAt = new Date(now.getTime() + 5 * 60 * 1000);
  }

  const title = t('deadline_reminder.notification_title');
  const body = company
    ? t('deadline_reminder.notification_body_with_company', { job: jobTitle || t('deadline_reminder.notification_job_fallback'), company, date: deadlineDate })
    : t('deadline_reminder.notification_body', { job: jobTitle || t('deadline_reminder.notification_job_fallback'), date: deadlineDate });

  await LocalNotifications.schedule({
    notifications: [{
      id: jobId,
      title,
      body,
      schedule: { at: fireAt, allowWhileIdle: true },
    }],
  });

  return { ok: true, fireAt };
}
