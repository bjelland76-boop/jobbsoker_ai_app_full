import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import { useApp } from '../context/AppContext';
import { styles as sharedStyles } from '../styles/styles';

const ORANGE = '#E8501A';
const RED = '#DA020E';

const TEMPLATES = [
  { key: 'kreativ', name: 'Kreativ' },
  { key: 'profesjonell', name: 'Profesjonell' },
  { key: 'klassisk', name: 'Klassisk' },
  { key: 'moderne', name: 'Moderne' },
  { key: 'skandinavisk', name: 'Skandinavisk' },
  { key: 'vietnamesisk', name: 'Vietnamesisk', flag: '🇻🇳', desc: 'Tilpasset vietnamesisk arbeidsmarked' },
];

const TEMPLATE_NAME_BY_KEY = TEMPLATES.reduce((acc, t) => {
  acc[t.key] = t.name;
  return acc;
}, {});

const EXAMPLE = {
  name: 'Vy Nguyen',
  title: 'Medisinsk sekretær',
  contact: 'vy@epost.no · 411 11 921 · Kristiansand',
  initials: 'VN',
  experience: [
    { role: 'Medisinsk sekretær', employer: 'NKI Nettstudier', period: '2024 – 2025', desc: 'Pasientadministrasjon og journalføring i helsesektoren.' },
    { role: 'Assistent for visedirektør', employer: 'Thanh Thanh Cong', period: '2016 – 2018', desc: 'Koordinering av oppgaver og dokumenthåndtering.' },
  ],
  education: [{ degree: 'Bachelor i engelsk', school: 'University of Education', period: '2010 – 2014' }],
  skills: ['Pasientadministrasjon', 'Microsoft Office', 'SAP', 'Journalføring'],
};

function Radio({ selected }) {
  return (
    <View style={[st.radio, selected && st.radioSelected]}>
      {selected ? <Text style={st.radioCheck}>✓</Text> : null}
    </View>
  );
}

// --- Miniature layout-pattern previews (abstract, no real content) ---

function MiniLine({ w, h = 2, color = '#cbd5e1', mt = 4, radius = 1 }) {
  return <View style={{ width: w, height: h, backgroundColor: color, marginTop: mt, borderRadius: radius }} />;
}

function MiniKreativ() {
  return (
    <View style={st.miniBox}>
      <View style={{ width: '38%', backgroundColor: '#1a1a2e', padding: 6 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ORANGE }} />
        <MiniLine w="80%" h={2} color="#f5cba7" mt={8} />
        <MiniLine w="60%" h={2} color="#f5cba7" mt={4} />
        <MiniLine w="70%" h={2} color={ORANGE} mt={10} />
        <MiniLine w="50%" h={2} color="#f5cba7" mt={4} />
      </View>
      <View style={{ flex: 1, backgroundColor: '#fff', padding: 6 }}>
        <MiniLine w="70%" h={3} color={ORANGE} mt={2} />
        <MiniLine w="90%" h={2} color="#cbd5e1" mt={8} />
        <MiniLine w="60%" h={2} color="#cbd5e1" mt={4} />
        <MiniLine w="80%" h={2} color="#cbd5e1" mt={10} />
        <MiniLine w="50%" h={2} color="#cbd5e1" mt={4} />
      </View>
    </View>
  );
}

function MiniProfesjonell() {
  return (
    <View style={[st.miniBox, { backgroundColor: '#fff', padding: 8 }]}>
      <MiniLine w="65%" h={4} color="#1e3a8a" mt={0} />
      <MiniLine w="40%" h={2} color="#93c5fd" mt={6} />
      <MiniLine w="85%" h={2} color="#cbd5e1" mt={10} />
      <MiniLine w="70%" h={2} color="#cbd5e1" mt={4} />
      <MiniLine w="55%" h={2} color="#e2e8f0" mt={4} />
    </View>
  );
}

function MiniKlassisk() {
  return (
    <View style={[st.miniBox, { backgroundColor: '#fff', padding: 8, alignItems: 'center' }]}>
      <MiniLine w="55%" h={3} color="#111827" mt={0} />
      <MiniLine w="90%" h={1} color="#111827" mt={6} />
      <MiniLine w="40%" h={2} color="#374151" mt={10} />
      <MiniLine w="70%" h={2} color="#6b7280" mt={5} />
      <MiniLine w="60%" h={2} color="#6b7280" mt={4} />
    </View>
  );
}

function MiniModerne() {
  return (
    <View style={st.miniBox}>
      <View style={{ width: 4, backgroundColor: ORANGE }} />
      <View style={{ flex: 1, backgroundColor: '#fff', padding: 7 }}>
        <MiniLine w="75%" h={3} color="#0f172a" mt={0} />
        <MiniLine w="35%" h={2} color="#9ca3af" mt={8} />
        <MiniLine w="85%" h={2} color="#d1d5db" mt={10} />
        <MiniLine w="50%" h={2} color="#d1d5db" mt={4} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: ORANGE, marginRight: 4 }} />
          <MiniLine w="55%" h={2} color="#d1d5db" mt={0} />
        </View>
      </View>
    </View>
  );
}

function MiniSkandinavisk() {
  return (
    <View style={[st.miniBox, { backgroundColor: '#FAFAF8', padding: 8, borderWidth: 1, borderColor: '#eee' }]}>
      <MiniLine w="45%" h={2} color="#374151" mt={0} />
      <MiniLine w="30%" h={1.5} color="#9ca3af" mt={8} />
      <MiniLine w="85%" h={1} color="#e5e7eb" mt={12} />
      <MiniLine w="60%" h={1.5} color="#9ca3af" mt={8} />
      <MiniLine w="70%" h={1.5} color="#9ca3af" mt={5} />
    </View>
  );
}

function MiniVietnamesisk() {
  return (
    <View style={[st.miniBox, { backgroundColor: '#fff', padding: 8, alignItems: 'center' }]}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: RED }} />
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: RED, marginTop: 10 }} />
      <MiniLine w="55%" h={3} color="#111827" mt={8} />
      <MiniLine w="90%" h={1} color={RED} mt={6} />
      <MiniLine w="40%" h={2} color={RED} mt={8} />
      <MiniLine w="70%" h={2} color="#6b7280" mt={5} />
    </View>
  );
}

const MINI_BY_KEY = {
  kreativ: MiniKreativ,
  profesjonell: MiniProfesjonell,
  klassisk: MiniKlassisk,
  moderne: MiniModerne,
  skandinavisk: MiniSkandinavisk,
  vietnamesisk: MiniVietnamesisk,
};

// --- Enlarged previews with example content ---

function FullSectionLabel({ text, color, style }) {
  return <Text style={[st.fullSectionLabel, { color }, style]}>{text}</Text>;
}

function FullKreativ() {
  return (
    <View style={st.fullBoxRow}>
      <View style={st.fullSidebar}>
        <View style={st.fullAvatar}><Text style={st.fullAvatarText}>{EXAMPLE.initials}</Text></View>
        <FullSectionLabel text="KONTAKT" color={ORANGE} style={{ marginTop: 14 }} />
        <Text style={st.fullSidebarText}>{EXAMPLE.contact}</Text>
        <FullSectionLabel text="FERDIGHETER" color={ORANGE} style={{ marginTop: 14 }} />
        {EXAMPLE.skills.slice(0, 2).map((s) => <Text key={s} style={st.fullSidebarText}>{s}</Text>)}
      </View>
      <View style={st.fullMain}>
        <Text style={[st.fullName, { color: '#1a1a2e' }]}>{EXAMPLE.name}</Text>
        <Text style={[st.fullTitle, { color: ORANGE }]}>{EXAMPLE.title}</Text>
        <FullSectionLabel text="ERFARING" color={ORANGE} style={{ marginTop: 14 }} />
        {EXAMPLE.experience.map((e) => (
          <View key={e.role} style={{ marginTop: 6 }}>
            <Text style={st.fullEntryTitle}>{e.role}</Text>
            <Text style={st.fullEntryMeta}>{e.employer} · {e.period}</Text>
          </View>
        ))}
        <FullSectionLabel text="UTDANNING" color={ORANGE} style={{ marginTop: 14 }} />
        {EXAMPLE.education.map((ed) => (
          <View key={ed.degree} style={{ marginTop: 6 }}>
            <Text style={st.fullEntryTitle}>{ed.degree}</Text>
            <Text style={st.fullEntryMeta}>{ed.school} · {ed.period}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FullProfesjonell() {
  return (
    <View style={[st.fullBox, { borderTopWidth: 4, borderTopColor: '#1e3a8a' }]}>
      <Text style={st.fullName}>{EXAMPLE.name}</Text>
      <Text style={[st.fullTitle, { color: '#64748b' }]}>{EXAMPLE.title}</Text>
      <Text style={st.fullContact}>{EXAMPLE.contact}</Text>
      <FullSectionLabel text="ERFARING" color="#1e3a8a" style={{ marginTop: 14 }} />
      {EXAMPLE.experience.map((e) => (
        <View key={e.role} style={{ marginTop: 6 }}>
          <Text style={st.fullEntryTitle}>{e.role}</Text>
          <Text style={st.fullEntryMeta}>{e.employer} · {e.period}</Text>
        </View>
      ))}
      <FullSectionLabel text="FERDIGHETER" color="#1e3a8a" style={{ marginTop: 14 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
        {EXAMPLE.skills.map((s) => (
          <View key={s} style={st.chip}><Text style={st.chipText}>{s}</Text></View>
        ))}
      </View>
    </View>
  );
}

function FullKlassisk() {
  return (
    <View style={[st.fullBox, { alignItems: 'center' }]}>
      <Text style={[st.fullName, { textTransform: 'uppercase', fontFamily: undefined }]}>{EXAMPLE.name}</Text>
      <Text style={st.fullContact}>{EXAMPLE.contact}</Text>
      <View style={{ width: '100%', height: 1.5, backgroundColor: '#111827', marginTop: 10, marginBottom: 4 }} />
      <View style={{ width: '100%', height: 0.5, backgroundColor: '#999', marginBottom: 12 }} />
      <View style={{ width: '100%' }}>
        <FullSectionLabel text="ERFARING" color="#111827" style={{ textAlign: 'center' }} />
        {EXAMPLE.experience.map((e) => (
          <View key={e.role} style={{ marginTop: 6 }}>
            <Text style={[st.fullEntryTitle, { fontStyle: 'normal' }]}>{e.role}</Text>
            <Text style={st.fullEntryMeta}>{e.employer} · {e.period}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FullModerne() {
  return (
    <View style={st.fullBoxRow}>
      <View style={{ width: 5, backgroundColor: ORANGE }} />
      <View style={[st.fullMain, { flex: 1, paddingLeft: 16 }]}>
        <Text style={[st.fullName, { letterSpacing: 1 }]}>{EXAMPLE.name}</Text>
        <Text style={[st.fullTitle, { color: ORANGE }]}>{EXAMPLE.title}</Text>
        <Text style={st.fullContact}>{EXAMPLE.contact}</Text>
        <FullSectionLabel text="ERFARING" color="#6b7280" style={{ marginTop: 14 }} />
        {EXAMPLE.experience.map((e) => (
          <View key={e.role} style={{ marginTop: 6, flexDirection: 'row' }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: ORANGE, marginTop: 6, marginRight: 6 }} />
            <View>
              <Text style={st.fullEntryTitle}>{e.role}</Text>
              <Text style={st.fullEntryMeta}>{e.employer} · {e.period}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function FullSkandinavisk() {
  return (
    <View style={[st.fullBox, { backgroundColor: '#FAFAF8' }]}>
      <Text style={[st.fullName, { fontWeight: '400', color: '#1f2937' }]}>{EXAMPLE.name}</Text>
      <Text style={[st.fullTitle, { color: '#9ca3af', fontWeight: '400' }]}>{EXAMPLE.title}</Text>
      <Text style={[st.fullContact, { color: '#9ca3af' }]}>{EXAMPLE.contact}</Text>
      <View style={{ width: '100%', height: 0.5, backgroundColor: '#e5e7eb', marginTop: 14, marginBottom: 14 }} />
      <FullSectionLabel text="ERFARING" color="#9ca3af" />
      {EXAMPLE.experience.map((e) => (
        <View key={e.role} style={{ marginTop: 10 }}>
          <Text style={[st.fullEntryTitle, { fontWeight: '600' }]}>{e.role}</Text>
          <Text style={st.fullEntryMeta}>{e.employer} · {e.period}</Text>
        </View>
      ))}
    </View>
  );
}

function FullVietnamesisk() {
  return (
    <View style={[st.fullBox, { alignItems: 'center' }]}>
      <View style={[st.fullAvatar, { width: 56, height: 56, borderRadius: 28, backgroundColor: RED }]}>
        <Text style={st.fullAvatarText}>{EXAMPLE.initials}</Text>
      </View>
      <Text style={[st.fullName, { marginTop: 10 }]}>{EXAMPLE.name}</Text>
      <Text style={st.fullContact}>{EXAMPLE.contact}</Text>
      <View style={{ width: '100%', height: 1.5, backgroundColor: RED, marginTop: 10, marginBottom: 12 }} />
      <View style={{ width: '100%' }}>
        <FullSectionLabel text="THÔNG TIN CÁ NHÂN" color={RED} />
        <Text style={[st.fullEntryMeta, { marginTop: 4 }]}>Chiều cao: 160 cm  ·  Giới tính: Nữ</Text>
        <FullSectionLabel text="ERFARING" color={RED} style={{ marginTop: 14 }} />
        {EXAMPLE.experience.map((e) => (
          <View key={e.role} style={{ marginTop: 6 }}>
            <Text style={st.fullEntryTitle}>{e.role}</Text>
            <Text style={st.fullEntryMeta}>{e.employer} · {e.period}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const FULL_BY_KEY = {
  kreativ: FullKreativ,
  profesjonell: FullProfesjonell,
  klassisk: FullKlassisk,
  moderne: FullModerne,
  skandinavisk: FullSkandinavisk,
  vietnamesisk: FullVietnamesisk,
};

export default function CvTemplatePickerModal({ visible, onClose, onConfirm, recommendedTemplate }) {
  const { t } = useApp();
  const [pendingSelection, setPendingSelection] = useState(null);
  const [expandedTemplate, setExpandedTemplate] = useState(null);

  useEffect(() => {
    if (visible) {
      setPendingSelection(null);
      setExpandedTemplate(null);
    }
  }, [visible]);

  if (!visible) return null;

  const recommendedName = TEMPLATE_NAME_BY_KEY[recommendedTemplate] || TEMPLATE_NAME_BY_KEY.profesjonell;

  function handleConfirm() {
    if (!pendingSelection) return;
    onConfirm(pendingSelection === 'anbefalt' ? '' : pendingSelection);
  }

  const ExpandedFull = expandedTemplate ? FULL_BY_KEY[expandedTemplate] : null;

  // IMPORTANT: only ever mount ONE <Modal> for this component. React Native
  // Web portals every Modal to a separate DOM layer; a second, nested Modal
  // (for the enlarged preview) can end up stacked so its buttons never
  // receive clicks. Toggle content within a single Modal instead.
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={expandedTemplate ? () => setExpandedTemplate(null) : onClose}
    >
      <View style={sharedStyles.cvModalOverlay}>
        <View style={[sharedStyles.cvModalCard, expandedTemplate ? st.expandedCard : st.card]}>
          {expandedTemplate ? (
            <>
              <Text style={sharedStyles.cvModalTitle}>{TEMPLATE_NAME_BY_KEY[expandedTemplate]}</Text>
              <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                {ExpandedFull ? <ExpandedFull /> : null}
              </ScrollView>
              <View style={st.expandedButtonRow}>
                <TouchableOpacity style={[sharedStyles.aerligDangerButton, { flex: 1, marginRight: 8 }]} onPress={() => setExpandedTemplate(null)}>
                  <Text style={sharedStyles.aerligDangerButtonText}>{t('cv_template.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[sharedStyles.aerligSecondaryButton, { flex: 1 }]}
                  onPress={() => {
                    setPendingSelection(expandedTemplate);
                    setExpandedTemplate(null);
                  }}
                >
                  <Text style={sharedStyles.aerligSecondaryButtonText}>{t('cv_template.choose_this_template')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={st.header}>
                <Text style={sharedStyles.cvModalTitle}>{t('cv_template.title')}</Text>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={st.closeX}>×</Text>
                </TouchableOpacity>
              </View>
              <Text style={sharedStyles.cvModalSubtitle}>{t('cv_template.subtitle')}</Text>

              <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
                <View style={st.grid}>
                  {TEMPLATES.map((tpl) => {
                    const isFullWidth = tpl.key === 'skandinavisk' || tpl.key === 'vietnamesisk';
                    const Mini = MINI_BY_KEY[tpl.key];
                    const selected = pendingSelection === tpl.key;
                    return (
                      <TouchableOpacity
                        key={tpl.key}
                        style={[st.thumbCard, isFullWidth ? st.thumbCardFull : st.thumbCardHalf, selected && st.thumbCardSelected]}
                        onPress={() => setExpandedTemplate(tpl.key)}
                      >
                        <Mini />
                        <Text style={st.thumbName}>{tpl.flag ? `${tpl.flag} ${tpl.name}` : tpl.name}</Text>
                        {tpl.desc ? <Text style={st.thumbDesc}>{tpl.desc}</Text> : null}
                        <View style={st.thumbRadioRow}>
                          <Radio selected={selected} />
                          <Text style={st.thumbRadioLabel}>{selected ? t('cv_template.selected') : t('cv_template.choose_this')}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={st.divider} />

                <TouchableOpacity
                  style={[st.recommendedRow, pendingSelection === 'anbefalt' && st.recommendedRowSelected]}
                  onPress={() => setPendingSelection('anbefalt')}
                >
                  <Text style={st.sparkle}>✨</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={st.recommendedTitle}>{t('cv_template.recommended_title')}</Text>
                    <Text style={st.recommendedSubtitle}>
                      {pendingSelection === 'anbefalt'
                        ? `${t('cv_template.recommended_result_prefix')} ${recommendedName}`
                        : t('cv_template.recommended_subtitle')}
                    </Text>
                  </View>
                  <Radio selected={pendingSelection === 'anbefalt'} />
                </TouchableOpacity>
              </ScrollView>

              <TouchableOpacity
                style={[sharedStyles.aerligSecondaryButton, { marginTop: 16 }, !pendingSelection && st.disabledButton]}
                disabled={!pendingSelection}
                onPress={handleConfirm}
              >
                <Text style={sharedStyles.aerligSecondaryButtonText}>{t('cv_template.generate_cv')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sharedStyles.aerligDangerButton, { marginTop: 10 }]} onPress={onClose}>
                <Text style={sharedStyles.aerligDangerButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  card: { maxWidth: 480 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  closeX: { fontSize: 26, color: '#6B7280', lineHeight: 26 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8 },
  thumbCard: {
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 8,
    marginBottom: 12,
  },
  thumbCardHalf: { width: '48%' },
  thumbCardFull: { width: '100%' },
  thumbCardSelected: { borderColor: ORANGE, backgroundColor: '#FFF8F5' },
  miniBox: { height: 90, borderRadius: 6, overflow: 'hidden', flexDirection: 'row', backgroundColor: '#fff' },
  thumbName: { fontSize: 14, fontWeight: '700', color: '#111827', marginTop: 8 },
  thumbDesc: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  thumbRadioRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  thumbRadioLabel: { fontSize: 12, color: '#6B7280', marginLeft: 6 },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: ORANGE, backgroundColor: ORANGE },
  radioCheck: { color: '#fff', fontSize: 11, fontWeight: '900' },
  divider: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 14 },
  recommendedRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF8F5',
    borderWidth: 1.5, borderColor: '#FDE0D2', borderRadius: 12, padding: 12,
  },
  recommendedRowSelected: { borderColor: ORANGE },
  sparkle: { fontSize: 20, marginRight: 10 },
  recommendedTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  recommendedSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  disabledButton: { opacity: 0.5 },

  expandedCard: { maxWidth: 480, maxHeight: '85%' },
  expandedButtonRow: { flexDirection: 'row', marginTop: 14 },

  fullBox: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginTop: 8 },
  fullBoxRow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', marginTop: 8, minHeight: 260 },
  fullSidebar: { width: '35%', backgroundColor: '#1a1a2e', padding: 12 },
  fullMain: { flex: 1, padding: 14 },
  fullAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  fullAvatarText: { color: '#fff', fontWeight: '700' },
  fullSidebarText: { color: '#f5cba7', fontSize: 11, marginTop: 3 },
  fullName: { fontSize: 20, fontWeight: '700', color: '#111827' },
  fullTitle: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  fullContact: { fontSize: 11, color: '#6B7280', marginTop: 4 },
  fullSectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  fullEntryTitle: { fontSize: 12.5, fontWeight: '700', color: '#111827' },
  fullEntryMeta: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  chip: { backgroundColor: '#f1f5f9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 6 },
  chipText: { fontSize: 11, color: '#334155' },
});
