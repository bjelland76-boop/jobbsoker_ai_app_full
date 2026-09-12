import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, Linking, ActivityIndicator, StyleSheet } from 'react-native';
import { Capacitor } from '@capacitor/core';

import { apiFetch, useApp } from '../context/AppContext';
import { useProfileContext } from '../context/ProfileContext';
import { styles as sharedStyles } from '../styles/styles';
import PlayBilling from '../plugins/PlayBilling';

const ORANGE = '#E8501A';

// Play Console product ids, matching `type` state below ('subscription' | '7day').
const ANDROID_PRODUCT_IDS = { subscription: '1_maanedsabonnement', '7day': '7dager' };

const LIMIT_LABEL_KEYS = {
  analyse: 'payment.limit_analyse',
  cv: 'payment.limit_cv',
  cv_analyse: 'payment.limit_cv_analyse',
  intervju: 'payment.limit_intervju',
  anon_shared: 'payment.limit_anon_shared',
};

// Norway (NOK) vs Vietnam (VND) pricing — country is detected server-side by
// IP. Amounts verified directly against the live Stripe price objects
// (STRIPE_PRICE_SUB[_VN] / STRIPE_PRICE_7DAY[_VN]).
const PRICES_NO = { pass7: '39 kr', sub: '79 kr/mnd' };
const PRICES_VN = { pass7: '30.000₫', sub: '60.000₫/mnd' };

export default function PaymentModal({ visible, limitType, onClose, userId, userEmail }) {
  const { t, authTokenState, openAuthScreen } = useApp();
  const { refreshSubscription } = useProfileContext() || {};
  const [type, setType] = useState('subscription');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [country, setCountry] = useState('NO');

  useEffect(() => {
    if (visible) {
      setType('subscription');
      setLoading(false);
      apiFetch('/user-country')
        .then((res) => setCountry(res?.country === 'VN' ? 'VN' : 'NO'))
        .catch(() => setCountry('NO'));
    }
  }, [visible]);

  if (!visible) return null;

  const prices = country === 'VN' ? PRICES_VN : PRICES_NO;
  const limitLabel = t(LIMIT_LABEL_KEYS[limitType] || 'payment.limit_analyse');
  const subtitle = limitType === 'anon_shared'
    ? t('payment.subtitle_anon_shared')
    : t('payment.subtitle', { limitLabel });

  // Android: real Google Play Billing (native plugin, see
  // mobile/plugins/PlayBilling.js). Web keeps the Stripe-in-browser flow below,
  // completely unchanged.
  const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

  async function handleAndroidPurchase() {
    const productId = ANDROID_PRODUCT_IDS[type];
    try {
      await PlayBilling.startConnection();

      let purchase;
      try {
        purchase = await PlayBilling.purchase({ productId });
      } catch (e) {
        // User backing out of the native purchase dialog is not an error --
        // just settle the modal quietly, no alert.
        if (String(e?.message || e).includes('Bruker avbrøt kjøpet')) {
          onClose?.();
          return;
        }
        throw e;
      }

      // Authoritative granting happens server-side (verifies the token
      // against the Play Developer API before touching subscription_status)
      // -- acknowledge with Google only after that succeeds, so a failed
      // verify-purchase call leaves the purchase unacknowledged and
      // recoverable via restorePurchases() rather than silently accepted.
      await apiFetch('/play-billing/verify-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_token: purchase.purchaseToken, product_id: productId }),
      });

      try {
        // Subscriptions (SUBS) must only ever be acknowledged. "7dager" is
        // an INAPP one-time product and must be consumed instead --
        // consumeAsync() acknowledges it as a side effect, so calling
        // acknowledgePurchase() too would be redundant. Getting this branch
        // wrong for INAPP products is exactly what caused every account
        // that ever bought "7dager" to be permanently blocked from buying
        // it again (Google keeps an acknowledged-but-unconsumed INAPP
        // purchase as "owned" forever).
        if (type === 'subscription') {
          await PlayBilling.acknowledgePurchase({ purchaseToken: purchase.purchaseToken });
        } else {
          await PlayBilling.consumePurchase({ purchaseToken: purchase.purchaseToken });
        }
      } catch (e) {
        // Entitlement is already granted at this point (verify-purchase
        // above succeeded) -- an acknowledge/consume failure here shouldn't
        // read as a failed purchase to the user. restorePurchases() on a
        // later launch can retry it.
        console.error('[Assistant] acknowledge/consume failed after successful verify-purchase', e);
      }

      await refreshSubscription?.();
      onClose?.();
      // Real money just changed hands -- Alert.alert is a no-op in this
      // app's web build (react-native-web's `static alert(){}` stub, and
      // Platform.OS is always "web" here, including inside the Android
      // app's Capacitor WebView), so it was previously showing the user
      // literally nothing after a successful charge. window.alert() is a
      // real browser dialog and always works.
      window.alert(
        `${t('payment.android_success_title')}\n\n${type === 'subscription' ? t('payment.android_success_sub') : t('payment.android_success_pass')}`
      );
    } catch (e) {
      console.error('[Assistant] Android Play Billing purchase failed', e);
      window.alert(`${t('payment.android_error_title')}\n\n${e?.message || t('payment.android_error_generic')}`);
    }
  }

  async function handlePay() {
    if (loading) return;
    if (!authTokenState) {
      // Login is required before any purchase can be attached to an
      // account (Stripe checkout needs current_user) -- no longer a free
      // alternative to paying, just the first step toward it. Close this
      // modal first so its RN <Modal> layer can't sit above the login
      // overlay (a plain absolutely-positioned <View> in App.js).
      onClose?.();
      openAuthScreen?.();
      return;
    }
    if (!userId) return;
    setLoading(true);

    if (platform === 'android') {
      await handleAndroidPurchase();
      setLoading(false);
      return;
    }

    try {
      const res = await apiFetch('/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, user_id: userId, email: userEmail || '' }),
      });
      if (res?.checkout_url) {
        Linking.openURL(res.checkout_url);
      }
    } catch (e) {
      console.error('[Assistant] create-checkout failed', e);
      window.alert(`${t('payment.checkout_error_title')}\n\n${e?.message || t('payment.checkout_error_body')}`);
    } finally {
      setLoading(false);
    }
  }

  // "Gjenopprett kjøp" -- permanent feature (not a one-off dev tool), for
  // two overlapping cases: (1) repairing an INAPP purchase that was
  // acknowledged-but-never-consumed (the exact bug that made every account
  // that ever bought "7dager" permanently unable to buy it again -- see
  // handleAndroidPurchase()'s type-branch above), and (2) the general
  // "reinstalled the app / switched device" case, where Google still shows
  // the purchase as owned but this account's own backend profile never
  // got the entitlement. Both are fixed the same way: find what Google
  // Play says this account owns, re-verify each with the backend
  // (idempotent), then consume (INAPP) or acknowledge (SUBS, if somehow
  // still unacknowledged) it.
  async function handleRestorePurchases() {
    if (restoring) return;
    setRestoring(true);
    try {
      await PlayBilling.startConnection();
      const { purchases } = await PlayBilling.restorePurchases();

      let fixedCount = 0;
      for (const p of purchases || []) {
        const productId = (p.products || [])[0];
        if (!productId) continue;

        try {
          await apiFetch('/play-billing/verify-purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchase_token: p.purchaseToken, product_id: productId }),
          });
        } catch (e) {
          console.error('[Assistant] restorePurchases: verify-purchase failed for', productId, e);
          continue;
        }

        try {
          if (productId === '7dager') {
            await PlayBilling.consumePurchase({ purchaseToken: p.purchaseToken });
          } else if (!p.isAcknowledged) {
            await PlayBilling.acknowledgePurchase({ purchaseToken: p.purchaseToken });
          }
          fixedCount += 1;
        } catch (e) {
          console.error('[Assistant] restorePurchases: consume/acknowledge failed for', productId, e);
        }
      }

      await refreshSubscription?.();
      window.alert(
        fixedCount > 0
          ? `${t('payment.restore_success_title')}\n\n${t('payment.restore_success_body')}`
          : `${t('payment.restore_none_title')}\n\n${t('payment.restore_none_body')}`
      );
    } catch (e) {
      console.error('[Assistant] restorePurchases failed', e);
      window.alert(`${t('payment.restore_error_title')}\n\n${e?.message || t('payment.restore_error_body')}`);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={sharedStyles.cvModalOverlay}>
        <View style={[sharedStyles.cvModalCard, st.card]}>
          <Text style={sharedStyles.cvModalTitle}>{t('payment.title')}</Text>
          <Text style={sharedStyles.cvModalSubtitle}>{subtitle}</Text>

          {!authTokenState && (
            <View style={st.loginNotice}>
              <Text style={st.loginNoticeText}>{t('payment.login_required_notice')}</Text>
              <TouchableOpacity style={st.loginBtn} onPress={() => { onClose?.(); openAuthScreen?.(); }}>
                <Text style={st.loginBtnText}>{t('auth.login')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ marginTop: 4 }}>
            <TouchableOpacity
              style={[st.pkgCard, type === 'subscription' && st.pkgCardSelected]}
              onPress={() => setType('subscription')}
            >
              <View style={st.pkgRadio}>
                <View style={[st.radio, type === 'subscription' && st.radioSelected]}>
                  {type === 'subscription' ? <Text style={st.radioCheck}>✓</Text> : null}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={st.pkgTitle}>{t('payment.subscription_title')}</Text>
                </View>
                <Text style={st.pkgDesc}>{t('payment.subscription_desc')}</Text>
              </View>
              <Text style={st.pkgPrice}>{prices.sub}</Text>
            </TouchableOpacity>
          </View>

          <View style={st.dividerRow}>
            <View style={st.dividerLine} />
            <Text style={st.dividerText}>{t('payment.or')}</Text>
            <View style={st.dividerLine} />
          </View>

          <TouchableOpacity
            style={[st.pkgCard, type === '7day' && st.pkgCardSelected]}
            onPress={() => setType('7day')}
          >
            <View style={st.pkgRadio}>
              <View style={[st.radio, type === '7day' && st.radioSelected]}>
                {type === '7day' ? <Text style={st.radioCheck}>✓</Text> : null}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.pkgTitle}>{t('payment.pass7_title')}</Text>
              <Text style={st.pkgDesc}>{t('payment.pass7_desc')}</Text>
            </View>
            <Text style={st.pkgPrice}>{prices.pass7}</Text>
          </TouchableOpacity>

          <Text style={st.launchNote}>{t('payment.launch_note')}</Text>
          <Text style={st.stripeNote}>
            {platform === 'android' ? t('payment.android_play_billing_note') : t('payment.stripe_note')}
          </Text>

          <TouchableOpacity
            style={[st.payButton, loading && { opacity: 0.6 }]}
            onPress={handlePay}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={st.payButtonText}>
                {!authTokenState
                  ? t('auth.login')
                  : (type === 'subscription' ? t('payment.subscribe_btn') : t('payment.pay_card_btn'))}
              </Text>
            )}
          </TouchableOpacity>
          {platform === 'android' && authTokenState ? (
            <TouchableOpacity
              style={[sharedStyles.aerligSecondaryButton, { marginTop: 10 }, restoring && { opacity: 0.6 }]}
              onPress={handleRestorePurchases}
              disabled={restoring}
            >
              {restoring ? (
                <ActivityIndicator size="small" color={ORANGE} />
              ) : (
                <Text style={sharedStyles.aerligSecondaryButtonText}>{t('payment.restore_btn')}</Text>
              )}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[sharedStyles.aerligDangerButton, { marginTop: 10 }]} onPress={onClose}>
            <Text style={sharedStyles.aerligDangerButtonText}>{t('payment.not_now')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  card: { maxWidth: 440 },
  loginNotice: {
    backgroundColor: '#FFF8F5',
    borderWidth: 1.5,
    borderColor: ORANGE,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  loginNoticeText: { flex: 1, fontSize: 12.5, color: '#6B7280', lineHeight: 17 },
  loginBtn: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  loginBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pkgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  pkgCardSelected: { borderColor: ORANGE, backgroundColor: '#FFF8F5' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dividerText: { marginHorizontal: 10, fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  pkgRadio: { marginRight: 10 },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: ORANGE, backgroundColor: ORANGE },
  radioCheck: { color: '#fff', fontSize: 12, fontWeight: '900' },
  pkgTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginRight: 6 },
  pkgBadge: { fontSize: 11, fontWeight: '700', color: ORANGE },
  pkgDesc: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  pkgPrice: { fontSize: 16, fontWeight: '800', color: '#111827', marginLeft: 8 },
  launchNote: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 14 },
  stripeNote: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 2, marginBottom: 4 },
  payButton: {
    marginTop: 12,
    backgroundColor: ORANGE,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  payButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
