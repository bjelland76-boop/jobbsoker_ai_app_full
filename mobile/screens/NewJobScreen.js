import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { useProfileContext } from '../context/ProfileContext';
import { styles } from '../styles/styles';

export default function NewJobScreen({
  jobUrl, setJobUrl,
  jobText, setJobText,
  jobInputMode, setJobInputMode,
  loading, analyzeJob,
  profileWallHit,
}) {
  const { setActiveTab, t, logEvent } = useApp();
  const {
    isProfileTooEmpty, profileLoadSettled, importCvFromFile, setCvImportNotice,
    cvImportedForAnalysis, setCvImportedForAnalysis,
  } = useProfileContext() || {};
  // The analysis compares the ad with the user's CV/profile, so with an
  // empty profile it can't run -- say so up front, with the fastest way to
  // fix it, instead of only after "Start analyse" is pressed.
  const showProfileWall = !!profileLoadSettled && !!isProfileTooEmpty?.();

  function importCvForAnalysis() {
    logEvent('profile_wall_import_clicked');
    // Same flow as the home screen's "Last opp CV": the preview/confirm
    // modal lives on ProfileScreen, so navigate there first. After the
    // import is applied, useProfile brings the user back here.
    setCvImportNotice?.(t('profile.import_cv_notice'));
    setActiveTab('profile');
    importCvFromFile?.({ returnToAnalysis: true });
  }

  function fillProfileManually() {
    logEvent('profile_wall_manual_clicked');
    setActiveTab('profile');
  }

  function startAnalysis() {
    setCvImportedForAnalysis?.(false);
    analyzeJob();
  }

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

        {showProfileWall ? (
          <View style={[st.wallCard, profileWallHit && st.wallCardHit]}>
            <Text style={st.wallTitle}>{t('new_job.profile_wall_title')}</Text>
            <Text style={st.wallBody}>{t('new_job.profile_wall_body')}</Text>
            <TouchableOpacity style={[styles.aerligPrimaryButton, st.wallButton]} onPress={importCvForAnalysis}>
              <Text style={styles.aerligPrimaryButtonText}>{t('new_job.profile_wall_import')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={fillProfileManually} style={st.wallLinkWrap}>
              <Text style={st.wallLink}>{t('new_job.profile_wall_manual')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {cvImportedForAnalysis && !showProfileWall ? (
          <View style={st.importedNotice}>
            <Text style={st.importedNoticeText}>{t('new_job.cv_imported_notice')}</Text>
          </View>
        ) : null}

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

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={startAnalysis}>
          <Text style={styles.aerligPrimaryButtonText}>{loading ? t('new_job.analyzing') : t('new_job.start_analysis')}</Text>
        </TouchableOpacity>
        {profileWallHit && showProfileWall ? (
          <Text style={st.wallHitText}>{t('new_job.profile_wall_blocked')}</Text>
        ) : null}
      </View>

      <View style={styles.aerligCard}>
        <Text style={styles.aerligCardTitle}>{t('new_job.what_happens_title')}</Text>
        <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>{t('new_job.what_happens_body')}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wallCard: {
    backgroundColor: '#FEF0EB',
    borderWidth: 1.5,
    borderColor: '#F5C2AE',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    marginBottom: 4,
  },
  wallCardHit: {
    borderColor: '#E8501A',
    borderWidth: 2,
  },
  wallTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  wallBody: { fontSize: 13, color: '#57534E', lineHeight: 18, marginBottom: 10 },
  wallButton: { marginTop: 0 },
  wallLinkWrap: { alignSelf: 'center', paddingVertical: 8 },
  wallLink: { fontSize: 13, color: '#993C1D', textDecorationLine: 'underline' },
  wallHitText: { fontSize: 12, color: '#B42318', textAlign: 'center', marginTop: 8 },
  importedNotice: {
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#A6F4C5',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  importedNoticeText: { fontSize: 13, color: '#05603A' },
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
