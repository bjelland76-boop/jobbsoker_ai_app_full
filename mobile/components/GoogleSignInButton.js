import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Text, TouchableOpacity } from 'react-native';
import { useApp } from '../context/AppContext';

// Loaded via Google's official "Sign In With Google" web SDK (Google Identity
// Services), NOT the @react-native-google-signin/google-signin native module.
//
// Why: this app's real Android build is a Capacitor WebView wrapping the Expo
// web export (see mobile/android/, mobile/capacitor.config.json) — there is no
// Expo-prebuilt native project for a RN native module to link into, and Expo
// Go (used for local `expo start`) can't load native modules at all. The GIS
// web SDK runs identically in `expo start --web` (for local testing) and in
// the shipped Capacitor WebView (both are just browser contexts), so it's the
// only approach that actually works end-to-end without a native rebuild.
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

// The audience this must match is backend/app/main.py's GOOGLE_CLIENT_ID_WEB
// (verified server-side in POST /auth/google) — same value, different name
// because Expo only exposes env vars prefixed EXPO_PUBLIC_ to client code.
const GOOGLE_CLIENT_ID_WEB = (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB || '').trim();

// Official Google "G" logo (4-color), inlined so no extra asset file/dependency is needed.
const GOOGLE_G_LOGO_URI = 'data:image/svg+xml;base64,' + (
  typeof btoa === 'function'
    ? btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">'
      + '<path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.8741 2.6836-6.6154z"/>'
      + '<path fill="#34A853" d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.344 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"/>'
      + '<path fill="#FBBC05" d="M3.9641 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2822-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.9641 10.71z"/>'
      + '<path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"/>'
      + '</svg>'
    )
    : ''
);

let gsiScriptPromise = null;
function loadGsiScript() {
  if (gsiScriptPromise) return gsiScriptPromise;
  gsiScriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const existing = document.querySelector(`script[src="${GSI_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Kunne ikke laste Google-innlogging')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Kunne ikke laste Google-innlogging'));
    document.head.appendChild(script);
  });
  return gsiScriptPromise;
}

export default function GoogleSignInButton() {
  const { doGoogleAuth, googleAuthLoading, t, errText } = useApp();
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const callbackRef = useRef(doGoogleAuth);
  callbackRef.current = doGoogleAuth;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!GOOGLE_CLIENT_ID_WEB) {
      // eslint-disable-next-line no-console
      console.warn('EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB mangler — Google-innloggingsknappen er skjult');
      return;
    }

    let cancelled = false;
    loadGsiScript()
      .then(() => {
        if (cancelled || initialized.current) return;
        initialized.current = true;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID_WEB,
          callback: (response) => { callbackRef.current(response?.credential); },
        });
        setReady(true);
      })
      .catch(() => {
        // Best-effort: button stays hidden (ready=false never flips true) if the
        // script can't load (e.g. offline, blocked by an ad-blocker).
      });

    return () => { cancelled = true; };
  }, []);

  if (Platform.OS !== 'web' || !GOOGLE_CLIENT_ID_WEB) return null;

  function handlePress() {
    if (!ready || googleAuthLoading) return;
    try {
      window.google.accounts.id.prompt((notification) => {
        const skipped = notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.();
        if (skipped) {
          Alert.alert(t('common.error'), t('auth.google_signin_failed'));
        }
      });
    } catch (e) {
      Alert.alert(t('common.error'), errText(e));
    }
  }

  return (
    <TouchableOpacity
      style={{
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        borderWidth: 1.5,
        borderColor: '#e0e0e0',
        borderRadius: 8,
        paddingVertical: 11,
        backgroundColor: '#fff',
        opacity: (!ready || googleAuthLoading) ? 0.6 : 1,
      }}
      onPress={handlePress}
      disabled={!ready || googleAuthLoading}
    >
      {googleAuthLoading ? (
        <ActivityIndicator size="small" color="#555" />
      ) : (
        <Image source={{ uri: GOOGLE_G_LOGO_URI }} style={{ width: 18, height: 18 }} />
      )}
      <Text style={{ fontSize: 14, fontWeight: '500', color: '#1a1a1a' }}>
        {t('auth.google_signin')}
      </Text>
    </TouchableOpacity>
  );
}
