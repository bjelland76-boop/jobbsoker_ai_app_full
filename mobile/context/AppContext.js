import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform, NativeModules } from 'react-native';

import { I18N } from '../i18n/no';

// ---------------------------------------------------------------------------
// API setup (module-level so apiFetch works without React)
// ---------------------------------------------------------------------------

function guessDevHost() {
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (!scriptURL || typeof scriptURL !== 'string') return null;
  try {
    const u = new URL(scriptURL);
    return u?.hostname || null;
  } catch (e) {
    const m = scriptURL.match(/^[a-zA-Z]+:\/\/([^:\/]+)(?::\d+)?\//);
    return m ? m[1] : null;
  }
}

function validateApiBaseUrl(rawApiBaseUrl, { envProvided = false } = {}) {
  const api = (rawApiBaseUrl || '').trim();
  // eslint-disable-next-line no-undef
  const isDev = (typeof __DEV__ !== 'undefined') ? __DEV__ : true;
  function fail(msg) {
    const full = `[API] ${msg}`;
    console.error(full);
    throw new Error(full);
  }
  if (!api) {
    if (!isDev) fail('Missing API base URL. Set EXPO_PUBLIC_API_URL to a public https://... backend URL for release builds.');
    return api;
  }
  let hostname = '';
  try {
    const u = new URL(api);
    hostname = String(u?.hostname || '');
  } catch (e) {
    if (!isDev) fail(`Invalid API base URL: "${api}". It must be an absolute http(s) URL.`);
    console.warn('[API] Could not parse API base URL (dev):', api);
    return api;
  }
  if (!isDev && hostname === 'localhost') {
    fail(`API base URL "${api}" points to localhost, which is not reachable in release builds.`);
  }
  if (!isDev && !envProvided) {
    console.warn('[API] Using auto-detected API URL in release mode. Set EXPO_PUBLIC_API_URL for reliability.');
  }
  return api;
}

const DEV_HOST = guessDevHost();
const ENV_API = (process.env.EXPO_PUBLIC_API_URL || '').trim();
const AUTO_API = Platform.OS === 'web'
  ? 'http://localhost:8000'
  : DEV_HOST
    ? `http://${DEV_HOST}:8000`
    : 'http://localhost:8000';

export const API = validateApiBaseUrl(ENV_API || AUTO_API, { envProvided: !!ENV_API });

if (__DEV__) console.log('API base URL:', API);

let AUTH_TOKEN = null;
let UNAUTHORIZED_HANDLER = null;

export function setAuthToken(token) {
  AUTH_TOKEN = token;
}

export function setUnauthorizedHandler(fn) {
  UNAUTHORIZED_HANDLER = fn;
}

export async function apiFetch(path, options) {
  const opts = options ? { ...options } : {};
  const headers = { ...(opts.headers || {}) };
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  opts.headers = headers;

  const r = await fetch(API + path, opts);

  let data = null;
  try { data = await r.json(); } catch (e) { /* ignore */ }

  if (r.status === 401) {
    const msg = (data && (data.detail || data.error)) || 'Sesjonen er utløpt. Logg inn på nytt.';
    try { if (UNAUTHORIZED_HANDLER) await UNAUTHORIZED_HANDLER(); } catch (e) { /* ignore */ }
    throw new Error(msg);
  }

  if (!r.ok) {
    const msg = (data && (data.detail || data.error)) || r.statusText || 'Ukjent feil';
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }

  return data;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Auth state
  const [authReady, setAuthReady] = useState(false);
  const [authTokenState, setAuthTokenState] = useState(null);
  const [userId, setUserId] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [authLoading, setAuthLoading] = useState(false);

  // App-wide UI state
  const [uiLanguage, setUiLanguage] = useState('no');
  const [activeTab, setActiveTab] = useState('home');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [faqOpenIndex, setFaqOpenIndex] = useState(-1);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Startup: restore persisted token + language
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      try { await AsyncStorage.removeItem('authToken'); } catch (e) { /* ignore */ }
      setAuthToken(null);
      setAuthTokenState(null);
      resetAuthState();
    });

    async function initAuth() {
      try {
        const lang = await AsyncStorage.getItem('uiLanguage');
        if (lang === 'en' || lang === 'vi') setUiLanguage(lang);
        else if (lang) setUiLanguage('no');

        const t = await AsyncStorage.getItem('authToken');
        if (t) {
          setAuthToken(t);
          setAuthTokenState(t);
          // Fire-and-forget usage event
          apiFetch('/events/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'app_opened', metadata: null }),
          }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      setAuthReady(true);
    }

    initAuth();
    return () => setUnauthorizedHandler(null);
  }, []);

  // Resolve userId from server when token changes
  useEffect(() => {
    if (!authTokenState) { setUserId(null); return; }
    apiFetch('/auth/me')
      .then((me) => setUserId(me?.id ?? null))
      .catch(() => setUserId(null));
  }, [authTokenState]);

  // Resend cooldown countdown
  useEffect(() => {
    if (!resendCooldown) return;
    const t = setTimeout(() => setResendCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // ---------------------------------------------------------------------------
  // Auth functions
  // ---------------------------------------------------------------------------

  function resetAuthState() {
    setUserId(null);
    setActiveTab('home');
    setAuthEmail('');
    setAuthCode('');
    setCodeSent(false);
    setResendCooldown(0);
  }

  async function doAuth() {
    if (!authEmail) { Alert.alert('Feil', 'Skriv inn e-post'); return; }
    setAuthLoading(true);
    try {
      if (!codeSent) {
        await apiFetch('/auth/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail }),
        });
        setCodeSent(true);
        setAuthCode('');
        setResendCooldown(30);
        Alert.alert('Kode sendt', 'Sjekk e-posten din for en engangskode.');
      } else {
        if (!authCode || String(authCode).trim().length < 4) {
          Alert.alert('Feil', 'Skriv inn engangskoden');
          setAuthLoading(false);
          return;
        }
        const res = await apiFetch('/auth/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail, code: String(authCode).trim() }),
        });
        const token = res?.access_token;
        if (!token) throw new Error('Mangler token fra server');
        setAuthToken(token);
        setAuthTokenState(token);
        await AsyncStorage.setItem('authToken', token);
        setCodeSent(false);
        setResendCooldown(0);
        setAuthCode('');
        setActiveTab('home');
      }
    } catch (e) {
      if (e.status === 429) Alert.alert('For mange forsøk', 'Vent noen minutter og prøv igjen.');
      else Alert.alert('Feil', errText(e));
    }
    setAuthLoading(false);
  }

  async function logout() {
    try { await AsyncStorage.removeItem('authToken'); } catch (e) { /* ignore */ }
    setAuthToken(null);
    setAuthTokenState(null);
    resetAuthState();
  }

  async function deleteAccount() {
    const msg = 'Dette sletter kontoen din og all lagret data (profil, analyser, dokumenter og statistikk). Dette kan ikke angres.';
    const doDelete = async () => {
      try {
        await apiFetch('/me', { method: 'DELETE' });
        Alert.alert('Slettet', 'Kontoen og alle data er slettet.');
        await logout();
      } catch (e) {
        Alert.alert('Feil', errText(e));
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm('Slett konto og data\n\n' + msg)) await doDelete();
      return;
    }
    Alert.alert('Slett konto og data', msg, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Slett', style: 'destructive', onPress: doDelete },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function errText(e) {
    return (e && e.message) ? String(e.message) : String(e);
  }

  function logEvent(action, metadata = null) {
    apiFetch('/events/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, metadata }),
    }).catch(() => {});
  }

  async function setAndPersistUiLanguage(nextLang) {
    const v = ['en', 'vi'].includes(nextLang) ? nextLang : 'no';
    setUiLanguage(v);
    try { await AsyncStorage.setItem('uiLanguage', v); } catch (e) { /* ignore */ }
  }

  const strings = I18N[uiLanguage] || I18N.no;
  const t = (key) => strings[key] ?? I18N.no[key] ?? String(key);

  // ---------------------------------------------------------------------------
  // Provider value
  // ---------------------------------------------------------------------------

  return (
    <AppContext.Provider value={{
      // Auth state
      authReady,
      authTokenState, setAuthTokenState,
      userId,
      authEmail, setAuthEmail,
      authCode, setAuthCode,
      codeSent, setCodeSent,
      resendCooldown, setResendCooldown,
      authLoading,
      // UI state
      uiLanguage, setUiLanguage,
      activeTab, setActiveTab,
      showOnboarding, setShowOnboarding,
      showFaq, setShowFaq,
      faqOpenIndex, setFaqOpenIndex,
      // Functions
      doAuth,
      logout,
      deleteAccount,
      logEvent,
      errText,
      setAndPersistUiLanguage,
      t,
      // Utilities (exported for screens that import directly)
      resetAuthState,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
