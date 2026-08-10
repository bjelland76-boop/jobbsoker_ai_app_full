import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, Linking, ActivityIndicator, StyleSheet } from 'react-native';

import { apiFetch } from '../context/AppContext';
import { styles as sharedStyles } from '../styles/styles';

const ORANGE = '#E8501A';

const LIMIT_LABELS = {
  analyse: 'analyser',
  cv: 'CV-genereringer',
  intervju: 'intervjuøkter',
};

const PACKAGES = [
  { id: 1, title: '1 jobbpakke', price: '19 kr', desc: 'CV + søknad + intervju for én jobb' },
  { id: 5, title: '5 jobbpakker', badge: '⭐ Mest populær', price: '69 kr', desc: 'Spar 27%' },
  { id: 10, title: '10 jobbpakker', price: '129 kr', desc: 'Spar 32%' },
];

export default function PaymentModal({ visible, limitType, onClose, userId, userEmail }) {
  const [selected, setSelected] = useState(5);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(5);
      setLoading(false);
    }
  }, [visible]);

  if (!visible) return null;

  const limitLabel = LIMIT_LABELS[limitType] || 'analyser';

  async function handlePay() {
    if (loading || !userId) return;
    setLoading(true);
    try {
      const res = await apiFetch('/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: selected, user_id: userId, email: userEmail || '' }),
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
          <Text style={sharedStyles.cvModalTitle}>Fortsett med Ærlig</Text>
          <Text style={sharedStyles.cvModalSubtitle}>Du har brukt dine 3 gratis {limitLabel}</Text>

          <View style={{ marginTop: 4 }}>
            {PACKAGES.map((pkg) => {
              const isSelected = selected === pkg.id;
              return (
                <TouchableOpacity
                  key={pkg.id}
                  style={[st.pkgCard, isSelected && st.pkgCardSelected]}
                  onPress={() => setSelected(pkg.id)}
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

          <Text style={st.launchNote}>Lanseringspris — begrenset periode 🎉</Text>
          <Text style={st.stripeNote}>Betaling via Stripe — trygt og enkelt</Text>

          <TouchableOpacity
            style={[st.payButton, loading && { opacity: 0.6 }]}
            onPress={handlePay}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={st.payButtonText}>Betal med kort</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[sharedStyles.aerligDangerButton, { marginTop: 10 }]} onPress={onClose}>
            <Text style={sharedStyles.aerligDangerButtonText}>Ikke nå</Text>
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
