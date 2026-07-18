import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { I18nManager, Platform } from 'react-native';

import no from './locales/no.json';
import en from './locales/en.json';
import vi from './locales/vi.json';
import pl from './locales/pl.json';
import lt from './locales/lt.json';
import ar from './locales/ar.json';
import so from './locales/so.json';

const SUPPORTED = ['no', 'en', 'vi', 'pl', 'lt', 'ar', 'so'];
export const RTL_LANGUAGES = ['ar'];

export function isRtlLanguage(lang) {
  return RTL_LANGUAGES.includes(lang);
}

function detectDeviceLanguage() {
  try {
    const locales = Localization.getLocales?.();
    const code = (locales?.[0]?.languageCode ?? '').toLowerCase();
    if (SUPPORTED.includes(code)) return code;
    return 'no';
  } catch (e) {
    return 'no';
  }
}

const resources = {
  no: { translation: no },
  en: { translation: en },
  vi: { translation: vi },
  pl: { translation: pl },
  lt: { translation: lt },
  ar: { translation: ar },
  so: { translation: so },
};

try {
  i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: detectDeviceLanguage(),
      fallbackLng: 'no',
      interpolation: { escapeValue: false },
    });
} catch (e) {
  // Fallback: init without react-i18next if something goes wrong
  i18n.init({
    resources,
    lng: 'no',
    fallbackLng: 'no',
    interpolation: { escapeValue: false },
  });
}

// Native RTL (Android/iOS) only fully mirrors the layout after an app restart —
// a long-standing React Native limitation. On web there is no I18nManager
// support at all, so we drive `dir`/`lang` on the document element instead.
export function applyRtl(lang) {
  const shouldBeRtl = isRtlLanguage(lang);
  if (Platform.OS === 'web') {
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dir = shouldBeRtl ? 'rtl' : 'ltr';
        document.documentElement.lang = lang;
      }
    } catch (e) { /* ignore */ }
    return;
  }
  try {
    if (I18nManager.isRTL !== shouldBeRtl) {
      I18nManager.allowRTL(shouldBeRtl);
      I18nManager.forceRTL(shouldBeRtl);
    }
  } catch (e) { /* ignore */ }
}

applyRtl(i18n.language);

export function loadSavedLanguage(saved) {
  const lang = SUPPORTED.includes(saved) ? saved : 'no';
  if (i18n.language !== lang) {
    i18n.changeLanguage(lang);
  }
  applyRtl(lang);
}

export function changeLanguage(lang) {
  const next = SUPPORTED.includes(lang) ? lang : 'no';
  i18n.changeLanguage(next);
  applyRtl(next);
}

export default i18n;
