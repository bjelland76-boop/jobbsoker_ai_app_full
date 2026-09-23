import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';

import { useApp } from '../context/AppContext';
import { styles as sharedStyles } from '../styles/styles';
import { scheduleDeadlineReminder } from '../utils/deadlineReminder';

// Isolert Fase 6-leveranse: pop-up rett etter jobbanalyse som enten
// bekrefter en AI-funnet søknadsfrist, eller (fallback) lar brukeren skrive
// inn en dato selv -- samme fritekst-mønster som birthDate-feltet i
// ProfileScreen.js (ingen ny datovelger-komponent i denne runden).
//
// Kun ÉN <Modal> montert om gangen her, samme forsiktighet som
// CvTemplatePickerModal.js dokumenterer (React Native Web portalerer hver
// Modal til et eget DOM-lag -- en nøstet Modal kan ende opp med knapper som
// aldri mottar klikk).
function parseFreeTextDate(text) {
  const m = (text || '').trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return iso;
}

export default function DeadlineReminderModal({ visible, jobId, jobTitle, company, deadline, onClose }) {
  const { t } = useApp();
  const [freeText, setFreeText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setFreeText('');
      setError('');
      setSaving(false);
    }
  }, [visible]);

  if (!visible) return null;

  async function confirm(isoDate) {
    setSaving(true);
    setError('');
    const result = await scheduleDeadlineReminder({ jobId, jobTitle, company, deadlineDate: isoDate });
    setSaving(false);
    if (!result.ok) {
      setError(
        result.reason === 'permission_denied'
          ? t('deadline_reminder.permission_denied')
          : t('deadline_reminder.invalid_date_error'),
      );
      return;
    }
    onClose({ scheduled: true });
  }

  function handleFallbackConfirm() {
    const iso = parseFreeTextDate(freeText);
    if (!iso) {
      setError(t('deadline_reminder.fallback_format_error'));
      return;
    }
    confirm(iso);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onClose({ scheduled: false })}>
      <View style={sharedStyles.cvModalOverlay}>
        <View style={[sharedStyles.cvModalCard, st.card]}>
          {deadline ? (
            <>
              <Text style={sharedStyles.cvModalTitle}>{t('deadline_reminder.found_title')}</Text>
              <Text style={sharedStyles.cvModalSubtitle}>
                {t('deadline_reminder.found_subtitle', { date: deadline })}
              </Text>
            </>
          ) : (
            <>
              <Text style={sharedStyles.cvModalTitle}>{t('deadline_reminder.fallback_title')}</Text>
              <Text style={sharedStyles.cvModalSubtitle}>
                {t('deadline_reminder.fallback_subtitle')}
              </Text>
              <TextInput
                style={[st.input]}
                value={freeText}
                onChangeText={setFreeText}
                placeholder={t('deadline_reminder.fallback_placeholder')}
                keyboardType="numeric"
              />
            </>
          )}

          {error ? <Text style={st.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[sharedStyles.aerligSecondaryButton, { marginTop: 16 }, saving && st.disabled]}
            disabled={saving}
            onPress={() => (deadline ? confirm(deadline) : handleFallbackConfirm())}
          >
            <Text style={sharedStyles.aerligSecondaryButtonText}>
              {deadline ? t('deadline_reminder.confirm_found') : t('deadline_reminder.confirm_fallback')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[sharedStyles.aerligDangerButton, { marginTop: 10 }]}
            onPress={() => onClose({ scheduled: false })}
          >
            <Text style={sharedStyles.aerligDangerButtonText}>{t('common.no_thanks')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  card: { maxWidth: 420 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 12, fontSize: 15,
    marginTop: 12,
  },
  error: { color: '#DC2626', fontSize: 13, marginTop: 10 },
  disabled: { opacity: 0.6 },
});
