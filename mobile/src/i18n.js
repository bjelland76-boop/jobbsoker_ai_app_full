import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import no from './locales/no.json';
import en from './locales/en.json';
import vi from './locales/vi.json';

const SUPPORTED = ['no', 'en', 'vi'];

function detectDeviceLanguage() {
  try {
    const locales = Localization.getLocales?.();
    const code = (locales?.[0]?.languageCode ?? '').toLowerCase();
    if (code === 'vi') return 'vi';
    if (code === 'en') return 'en';
    return 'no';
  } catch (e) {
    return 'no';
  }
}

try {
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        no: { translation: no },
        en: { translation: en },
        vi: { translation: vi },
      },
      lng: detectDeviceLanguage(),
      fallbackLng: 'no',
      interpolation: { escapeValue: false },
    });
} catch (e) {
  // Fallback: init without react-i18next if something goes wrong
  i18n.init({
    resources: { no: { translation: no }, en: { translation: en }, vi: { translation: vi } },
    lng: 'no',
    fallbackLng: 'no',
    interpolation: { escapeValue: false },
  });
}

export function loadSavedLanguage(saved) {
  const lang = SUPPORTED.includes(saved) ? saved : 'no';
  if (i18n.language !== lang) {
    i18n.changeLanguage(lang);
  }
}

export function changeLanguage(lang) {
  const next = SUPPORTED.includes(lang) ? lang : 'no';
  i18n.changeLanguage(next);
}

export default i18n;
