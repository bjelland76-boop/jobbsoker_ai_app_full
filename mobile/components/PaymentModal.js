import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, Linking, ActivityIndicator, StyleSheet } from 'react-native';

import { apiFetch, useApp } from '../context/AppContext';
import { styles as sharedStyles } from '../styles/styles';

const ORANGE = '#E8501A';

const LIMIT_LABEL_KEYS = {
  analyse: 'payment.limit_analyse',
  cv: 'payment.limit_cv',
  cv_analyse: 'payment.limit_cv_analyse',
  intervju: 'payment.limit_intervju',
};

// Norway (NOK) vs Vietnam (VND) pricing — country is detected server-side by IP.
const PRICES_NO = { pkg1: '19 kr', pkg5: '69 kr', pkg10: '129 kr', sub: '79 kr/mnd' };
const PRICES_VN = { pkg1: '20.000₫', pkg5: '40.000₫', pkg10: '60.000₫', sub: '50.000₫/mnd' };

export default function PaymentModal({ visible, limitType, onClose, userId, userEmail }) {
  const { t } = useApp();
  const [type, setType] = useState('subscription');
  const [selected, setSelected] = useState(5);
  const [loading, setLoading] = useState(false);
  const [country, setCountry] = useState('NO');

  useEffect(() => {
    if (visible) {
      setType('subscription');
      setSelected(5);
      setLoading(false);
      apiFetch('/user-country')
        .then((res) => setCountry(res?.country === 'VN' ? 'VN' : 'NO'))
        .catch(() => setCountry('NO'));
    }
  }, [visible]);

  if (!visible) return null;

  const prices = country === 'VN' ? PRICES_VN : PRICES_NO;
  const PACKAGES = [
    { id: 1, title: t('payment.package_1_title'), price: prices.pkg1, desc: t('payment.package_1_desc') },
    { id: 5, title: t('payment.package_5_title'), badge: t('payment.package_5_badge'), price: prices.pkg5, desc: t('payment.package_5_desc') },
    { id: 10, title: t('payment.package_10_title'), price: prices.pkg10, desc: t('payment.package_10_desc') },
  ];

  const limitLabel = t(LIMIT_LABEL_KEYS[limitType] || 'payment.limit_analyse');

  async function handlePay() {
    if (loading || !userId) return;
    setLoading(true);
    try {
      const res = await apiFetch('/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, package: selected, user_id: userId, email: userEmail || '' }),
      });
      if (res?.checkout_url) {
        Linking.openURL(res.checkout_url);
      }
    } catch (e) {
      console.error('[Assistant] create-checkout failed', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={sharedStyles.cvModalOverlay}>
        <View style={[sharedStyles.cvModalCard, st.card]}>
          <Text style={sharedStyles.cvModalTitle}>{t('payment.title')}</Text>
          <Text style={sharedStyles.cvModalSubtitle}>{t('payment.subtitle', { limitLabel })}</Text>

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

          <View>
            {PACKAGES.map((pkg) => {
              const isSelected = type === 'package' && selected === pkg.id;
              return (
                <TouchableOpacity
                  key={pkg.id}
                  style={[st.pkgCard, isSelected && st.pkgCardSelected]}
                  onPress={() => { setType('package'); setSelected(pkg.id); }}
                >
                  <View style={st.pkgRadio}>
                    <View style={[st.radio, isSelected && st.radioSelected]}>
                      {isSelected ? <Text style={st.radioCheck}>✓</Text> : null}
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text style={st.pkgTitle}>{pkg.title}</Text>
                      {pkg.badge ? <Text style={st.pkgBadge}>{pkg.badge}</Text> : null}
                    </View>
                    <Text style={st.pkgDesc}>{pkg.desc}</Text>
                  </View>
                  <Text style={st.pkgPrice}>{pkg.price}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={st.launchNote}>{t('payment.launch_note')}</Text>
          <Text style={st.stripeNote}>{t('payment.stripe_note')}</Text>

          <TouchableOpacity
            style={[st.payButton, loading && { opacity: 0.6 }]}
            onPress={handlePay}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={st.payButtonText}>{type === 'subscription' ? t('payment.subscribe_btn') : t('payment.pay_card_btn')}</Text>
            )}
          </TouchableOpacity>
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
