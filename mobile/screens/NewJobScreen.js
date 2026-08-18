import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function NewJobScreen({
  jobUrl, setJobUrl,
  jobText, setJobText,
  jobInputMode, setJobInputMode,
  loading, analyzeJob,
}) {
  const { setActiveTab, t } = useApp();

  return (
    <View style={styles.aerligHomeWrap}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>{t('common.back')}</Text>
      </Pressable>
      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>{t('new_job.title')}</Text>
        <Text style={styles.aerligPageSubtitle}>{t('new_job.subtitle')}</Text>

        <View style={st.tabRow}>
          <TouchableOpacity
            style={[st.tabButton, jobInputMode === 'url' && st.tabButtonActive]}
            onPress={() => setJobInputMode('url')}
          >
            <Text style={[st.tabButtonText, jobInputMode === 'url' && st.tabButtonTextActive]}>
              {t('new_job.tab_url')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.tabButton, jobInputMode === 'text' && st.tabButtonActive]}
            onPress={() => setJobInputMode('text')}
          >
            <Text style={[st.tabButtonText, jobInputMode === 'text' && st.tabButtonTextActive]}>
              {t('new_job.tab_text')}
            </Text>
          </TouchableOpacity>
        </View>

        {jobInputMode === 'text' ? (
          <TextInput
            style={[styles.input, styles.aerligInput, styles.textArea, { minHeight: 180 }]}
            placeholder={t('new_job.text_placeholder')}
            value={jobText}
            onChangeText={setJobText}
            multiline
            numberOfLines={8}
          />
        ) : (
          <TextInput
            style={[styles.input, styles.aerligInput]}
            placeholder={t('new_job.url_placeholder')}
            value={jobUrl}
            onChangeText={setJobUrl}
            autoCapitalize="none"
          />
        )}

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
          <Text style={styles.aerligPrimaryButtonText}>{loading ? t('new_job.analyzing') : t('new_job.start_analysis')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.aerligCard}>
        <Text style={styles.aerligCardTitle}>{t('new_job.what_happens_title')}</Text>
        <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>{t('new_job.what_happens_body')}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#F1EFE9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 9,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabButtonTextActive: {
    color: '#1A1A2E',
  },
});
