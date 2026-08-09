import React from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, Pressable,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function InterviewJobPickerScreen({
  jobAnalyses, jobAnalysesLoading, loadJobAnalyses,
  interviewSessions, onStartNew, onResume, onEndAndRestart,
}) {
  const { setActiveTab, t } = useApp();

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.aerligHomeWrap}>
        <Pressable
          android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
          style={styles.aerligBackButton}
          onPress={() => setActiveTab('home')}
        >
          <Text style={styles.aerligBackButtonText}>{t('common.back')}</Text>
        </Pressable>

        <View style={styles.aerligPageCard}>
          <Text style={styles.aerligPageTitle}>{t('interview.pick_job_title')}</Text>
          <Text style={styles.aerligPageSubtitle}>{t('interview.pick_job_subtitle')}</Text>

          <TouchableOpacity style={styles.aerligSecondaryButton} onPress={() => loadJobAnalyses({ silent: false })}>
            <Text style={styles.aerligSecondaryButtonText}>
              {jobAnalysesLoading ? t('analysis.loading') : t('analysis.update_list')}
            </Text>
          </TouchableOpacity>
        </View>

        {!jobAnalysesLoading && jobAnalyses.length === 0 ? (
          <View style={[styles.aerligCard, { alignItems: 'center', paddingVertical: 32 }]}>
            <Text style={{ fontSize: 36, marginBottom: 12 }}>🎤</Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6, textAlign: 'center' }}>
              {t('interview.no_jobs_title')}
            </Text>
            <Text style={{ fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
              {t('interview.no_jobs_body')}
            </Text>
            <TouchableOpacity style={[styles.aerligPrimaryButton, { paddingHorizontal: 24 }]} onPress={() => setActiveTab('new')}>
              <Text style={styles.aerligPrimaryButtonText}>{t('interview.go_to_analyze')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {jobAnalyses.map((item) => {
          const jobId = item.job.id;
          const session = interviewSessions?.[jobId];
          const hasOngoing = !!(session && session.started);
          const matchScore = Math.round(item.match_score || item.job.match_score || 0);

          return (
            <View key={jobId} style={[styles.aerligCard, { paddingVertical: 12 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={[styles.aerligCardTitle, { fontSize: 15 }]} numberOfLines={2}>{item.job.title}</Text>
                  <Text style={[styles.aerligCardMeta, { marginTop: 2, marginBottom: hasOngoing ? 8 : 0 }]}>
                    {item.job.company || t('common.unknown_company')} · {matchScore}%
                  </Text>
                </View>
                {hasOngoing ? (
                  <View style={[styles.aerligPill, styles.aerligPillYes, { marginBottom: 0 }]}>
                    <Text style={[styles.aerligPillText, styles.aerligPillTextYes]}>{t('interview.ongoing_badge')}</Text>
                  </View>
                ) : null}
              </View>

              {hasOngoing ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    style={[styles.aerligPrimaryButton, { flex: 1, marginTop: 0, paddingVertical: 12 }]}
                    onPress={() => onResume(jobId)}
                  >
                    <Text style={styles.aerligPrimaryButtonText}>{t('interview.resume')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.aerligSecondaryButton, { flex: 1, marginTop: 0 }]}
                    onPress={() => onEndAndRestart(jobId)}
                  >
                    <Text style={styles.aerligSecondaryButtonText}>{t('interview.end_and_restart')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.aerligPrimaryButton, { marginTop: 10, paddingVertical: 12 }]}
                  onPress={() => onStartNew(jobId)}
                >
                  <Text style={styles.aerligPrimaryButtonText}>{t('interview.start_new')}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
