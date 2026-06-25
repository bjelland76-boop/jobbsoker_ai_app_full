import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import no from './locales/no.json';
import en from './locales/en.json';
import vi from './locales/vi.json';

const SUPPORTED = ['no', 'en', 'vi'];

function detectDeviceLanguage() {
  const locale = Localization.getLocales?.()?.[0]?.languageCode ?? 'no';
  if (locale === 'vi') return 'vi';
  if (locale === 'en') return 'en';
  return 'no';
}

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
