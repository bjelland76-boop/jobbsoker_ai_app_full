import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Text, TouchableOpacity } from 'react-native';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { API, useApp } from '../context/AppContext';

// The audience/client this must match is backend/app/main.py's GOOGLE_CLIENT_ID_WEB.
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

// --- Plain web / browser preview: inline Google Identity Services --------------
// This is the ONLY path that works inside the packaged Android app's WebView too
// would be nice, but it isn't: Google's servers deliberately 403-reject Sign-In
// requests whose User-Agent identifies them as an embedded WebView (phishing
// prevention — confirmed via live traffic inspection on-device, not something any
// client-side config can work around). So this path only runs when NOT inside the
// native Capacitor shell; see the native path below for the packaged app.
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

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

// --- Packaged Android app: Chrome Custom Tab + OAuth authorization-code flow ---
// Opens the real Google login in an actual browser (Custom Tab), which Google is
// happy to serve. Google redirects the Custom Tab to backend /auth/google/callback,
// which exchanges the code server-side and hands our own JWT back to the app via a
// com.aerlig.app://auth-callback deep link, caught below.
const DEEP_LINK_PREFIX = 'com.aerlig.app://auth-callback';

let pendingState = null;
let deepLinkListenerAttached = false;

function randomState() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function attachDeepLinkListener(onToken, onError) {
  if (deepLinkListenerAttached) return;
  deepLinkListenerAttached = true;
  CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    if (!url || !url.startsWith(DEEP_LINK_PREFIX)) return;
    Browser.close().catch(() => {});

    let parsed;
    try { parsed = new URL(url); } catch (e) { onError('bad_url'); return; }

    const token = parsed.searchParams.get('token');
    const error = parsed.searchParams.get('error');
    const returnedState = parsed.searchParams.get('state');
    // Only enforce the state check if we still have it in memory — the app process
    // may have been backgrounded/killed while the Custom Tab was open, in which case
    // there's nothing to compare against. The JWT itself is already a trusted,
    // backend-issued credential at this point either way.
    const expected = pendingState;
    pendingState = null;
    if (expected && returnedState && expected !== returnedState) { onError('state_mismatch'); return; }

    if (token) onToken(token);
    else onError(error || 'unknown');
  });
}

export default function GoogleSignInButton() {
  const { doGoogleAuth, applyAuthToken, googleAuthLoading, t, errText } = useApp();
  const isNative = Capacitor.isNativePlatform();

  // The native Custom Tab flow has no script to wait for — it's ready immediately.
  const [ready, setReady] = useState(isNative);
  const initialized = useRef(false);
  const callbackRef = useRef(doGoogleAuth);
  callbackRef.current = doGoogleAuth;

  useEffect(() => {
    if (Platform.OS !== 'web' || !GOOGLE_CLIENT_ID_WEB) return;

    if (isNative) {
      attachDeepLinkListener(
        (token) => { applyAuthToken(token); },
        (reason) => {
          if (reason === 'access_denied') return; // user cancelled — not an error
          Alert.alert(t('common.error'), t('auth.google_signin_failed'));
        },
      );
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
        // Best-effort: button stays disabled if the script can't load
        // (e.g. offline, blocked by an ad-blocker).
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative]);

  if (Platform.OS !== 'web' || !GOOGLE_CLIENT_ID_WEB) return null;

  async function handlePress() {
    if (!ready || googleAuthLoading) return;

    if (isNative) {
      try {
        const state = randomState();
        pendingState = state;
        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID_WEB,
          redirect_uri: `${API}/auth/google/callback`,
          response_type: 'code',
          scope: 'openid email profile',
          state,
        }).toString();
        await Browser.open({ url: authUrl });
      } catch (e) {
        Alert.alert(t('common.error'), errText(e));
      }
      return;
    }

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
