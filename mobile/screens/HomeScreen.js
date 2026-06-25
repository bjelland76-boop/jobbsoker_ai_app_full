import React from 'react';
import {
  View, Text, TouchableOpacity, Pressable, Platform,
} from 'react-native';
import { useApp, apiFetch } from '../context/AppContext';
import { styles } from '../styles/styles';

function AdminStats({ adminStats, adminStatsLoading, setAdminStats, setAdminStatsLoading }) {
  async function loadStats() {
    setAdminStatsLoading(true);
    try {
      const data = await apiFetch('/events/stats');
      setAdminStats(data);
    } catch (e) {
      const { Alert } = require('react-native');
      Alert.alert('Feil', 'Kunne ikke hente statistikk');
    } finally {
      setAdminStatsLoading(false);
    }
  }

  return (
    <View style={[styles.aerligCard, { margin: 16, marginTop: 8, backgroundColor: '#1a1a2e', borderRadius: 16 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Admin — Bruksstatistikk (7 dager)</Text>
        <TouchableOpacity
          onPress={loadStats}
          style={{ backgroundColor: '#E8501A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{adminStatsLoading ? '...' : 'Last inn'}</Text>
        </TouchableOpacity>
      </View>

      {adminStats && (
        <>
          <Text style={{ color: '#F5C4A0', fontSize: 12, fontWeight: '700', marginBottom: 4 }}>TOPP HANDLINGER</Text>
          {adminStats.top_actions.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: '#ccc', fontSize: 12 }}>{row.action}</Text>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{row.count}</Text>
            </View>
          ))}

          <Text style={{ color: '#F5C4A0', fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 4 }}>UNIKE BRUKERE PER DAG</Text>
          {adminStats.daily_users.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: '#ccc', fontSize: 12 }}>{row.day}</Text>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{row.unique_users}</Text>
            </View>
          ))}

          <Text style={{ color: '#F5C4A0', fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 4 }}>CV-MAL</Text>
          {adminStats.templates.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: '#ccc', fontSize: 12 }}>{row.template}</Text>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{row.count}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

export default function HomeScreen({
  // Profile state
  profileId, name, profileEmail, skills, phone, experienceEntries,
  // Analysis state
  jobAnalyses, analysis, applications, statsMe,
  openSavedAnalysis,
  // Home tab
  tipText,
  // Admin
  adminStats, adminStatsLoading, setAdminStats, setAdminStatsLoading,
}) {
  const { t, logEvent, setActiveTab, setShowFaq } = useApp();

  const ripple = Platform.OS === 'android'
    ? { android_ripple: { color: 'rgba(26, 26, 46, 0.10)' } }
    : {};

  const firstName = (name || '').trim().split(' ')[0] || '';

  const latestFromHistory = (Array.isArray(jobAnalyses) && jobAnalyses.length > 0)
    ? jobAnalyses[0]
    : null;

  const latestJob = latestFromHistory?.job || analysis?.job || null;
  const latestJobId = latestJob?.id || latestFromHistory?.job?.id || null;
  const latestUrl = latestJob?.url || latestFromHistory?.job?.url || null;

  const rawMatch = latestFromHistory?.match_score ?? latestJob?.match_score ?? analysis?.match_score;
  const latestMatch = (typeof rawMatch === 'number' && !Number.isNaN(rawMatch))
    ? Math.max(0, Math.min(100, Math.round(rawMatch)))
    : null;

  const latestShouldApply = (typeof latestFromHistory?.should_apply === 'boolean')
    ? latestFromHistory.should_apply
    : (typeof analysis?.should_apply === 'boolean' ? analysis.should_apply : null);

  const honestText = latestFromHistory?.honest_assessment || analysis?.honest_assessment || '';

  const hasAnyAnalysis = !!latestFromHistory || (!!analysis && (analysis.match_score != null || analysis.honest_assessment));

  const analysedJobsCount = Array.isArray(jobAnalyses) ? jobAnalyses.length : 0;

  const sentApplicationsCount = (statsMe && typeof statsMe.applied === 'number')
    ? statsMe.applied
    : (Array.isArray(applications) && applications.length > 0)
      ? applications.filter((it) => !!it?.applied).length
      : null;

  const profileSignals = [
    !!profileId,
    !!(name && String(name).trim()),
    !!(profileEmail && String(profileEmail).trim()),
    !!(phone && String(phone).trim()),
    ((skills || '').trim().length > 0),
    (Array.isArray(experienceEntries) && experienceEntries.some((e) => (((e?.title || '').trim()) || ((e?.company || '').trim())))),
  ];

  const profilePercent = profileId
    ? Math.round((profileSignals.filter(Boolean).length / profileSignals.length) * 100)
    : 0;

  const profileStatus = !profileId
    ? t('home.profile_not_saved')
    : (profilePercent >= 85 ? t('home.profile_strong') : (profilePercent >= 60 ? t('home.profile_ok') : t('home.profile_needs_more')));

  const matchMeterStyle = latestMatch == null ? styles.aerligMeterWarn
    : latestMatch >= 70 ? styles.aerligMeterGood
    : latestMatch >= 40 ? styles.aerligMeterWarn
    : styles.aerligMeterBad;
  const matchMeterColor = latestMatch == null ? '#D97706'
    : latestMatch >= 70 ? '#16A34A'
    : latestMatch >= 40 ? '#D97706'
    : '#DC2626';
  const matchMeterStatus = latestMatch == null ? ''
    : latestMatch >= 70 ? t('home.match_strong')
    : latestMatch >= 40 ? t('home.match_ok')
    : t('home.match_weak');

  return (
    <View style={styles.aerligHomeWrap}>
      <View style={styles.aerligHeroCard}>
        <View style={styles.aerligHeroHeader}>
          <Text style={styles.aerligLogo}>Ærlig.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {analysedJobsCount > 0 ? (
              <View style={styles.aerligBadge}>
                <Text style={styles.aerligBadgeText}>{analysedJobsCount}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              onPress={() => { setShowFaq(true); logEvent('faq_opened'); }}
              style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E8501A',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#E8501A', fontSize: 13, fontWeight: '700' }}>?</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.aerligHeroGreeting}>
          {t('common.hi')}{firstName ? `, ${firstName}` : ''}.
        </Text>
        <Text style={styles.aerligHeroSubtitle}>
          {t('home.subtitle')}
        </Text>

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={() => setActiveTab('new')}>
          <Text style={styles.aerligPrimaryButtonText}>{t('home.analyze_job')}</Text>
        </TouchableOpacity>

        <View style={styles.aerligQuickRow}>
          <Pressable
            {...ripple}
            style={[styles.aerligQuickButton, { marginRight: 10 }]}
            onPress={() => setActiveTab('cv')}
          >
            <Text style={styles.aerligQuickButtonText}>{t('home.analyze_cv')}</Text>
          </Pressable>
          <Pressable
            {...ripple}
            style={styles.aerligQuickButton}
            onPress={() => setActiveTab('interview')}
          >
            <Text style={styles.aerligQuickButtonText}>{t('home.interview_practice')}</Text>
          </Pressable>
        </View>
      </View>

      {hasAnyAnalysis ? (
        <Pressable
          {...ripple}
          style={styles.aerligCard}
          onPress={() => {
            if (latestJobId) {
              openSavedAnalysis(latestJobId, latestUrl);
            } else {
              setActiveTab('analysis');
            }
          }}
        >
          <Text style={styles.aerligCardEyebrow}>{t('home.latest_analysis')}</Text>
          <Text style={styles.aerligCardTitle} numberOfLines={1}>
            {latestJob?.title || 'Siste analyse'}
          </Text>
          <Text style={styles.aerligCardMeta} numberOfLines={1}>
            {latestJob?.company || t('common.unknown_company')}
          </Text>

          {(latestMatch != null) ? (
            <>
              <View style={styles.aerligMeterRow}>
                <Text style={styles.aerligMeterLabel}>{t('home.matchmeter')}</Text>
                <Text style={[styles.aerligMeterValue, { color: matchMeterColor }]}>{latestMatch}%</Text>
              </View>
              <View style={styles.aerligMeterOuter}>
                <View style={[styles.aerligMeterInner, matchMeterStyle, { width: `${latestMatch}%` }]} />
              </View>
              {matchMeterStatus ? (
                <Text style={[styles.aerligMeterStatus, { color: matchMeterColor }]}>{matchMeterStatus}</Text>
              ) : null}
            </>
          ) : null}

          {(typeof latestShouldApply === 'boolean') ? (
            <View style={[styles.aerligPill, latestShouldApply ? styles.aerligPillYes : styles.aerligPillNo]}>
              <Text style={[styles.aerligPillText, latestShouldApply ? styles.aerligPillTextYes : styles.aerligPillTextNo]}>
                {t('home.recommendation')}: {latestShouldApply ? t('home.recommend_apply') : t('home.recommend_wait')}
              </Text>
            </View>
          ) : null}

          {honestText ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('home.honest_assessment')}</Text>
              <Text style={styles.aerligCardBody} numberOfLines={4}>{honestText}</Text>
            </>
          ) : null}

          <Text style={styles.aerligCardLink}>{t('home.open_analysis')}</Text>
        </Pressable>
      ) : (
        <View style={[styles.aerligCard, styles.aerligEmptyCard, { alignItems: 'center', paddingVertical: 28 }]}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>🔍</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6, textAlign: 'center' }}>{t('home.no_analysis_title')}</Text>
          <Text style={{ fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
            {t('home.no_analysis_body')}
          </Text>
          <TouchableOpacity style={[styles.aerligPrimaryButton, { paddingHorizontal: 24 }]} onPress={() => setActiveTab('new')}>
            <Text style={styles.aerligPrimaryButtonText}>{t('home.analyze_job')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.aerligGrid}>
        <Pressable
          {...ripple}
          style={styles.aerligMiniCard}
          onPress={() => setActiveTab('analysis')}
        >
          <Text style={styles.aerligMiniLabel}>{t('home.analyzed_jobs')}</Text>
          <Text style={styles.aerligMiniValue}>{analysedJobsCount}</Text>
          <Text style={styles.aerligMiniHint}>{t('home.see_history')}</Text>
        </Pressable>

        <Pressable
          {...ripple}
          style={styles.aerligMiniCard}
          onPress={() => setActiveTab('applications')}
        >
          <Text style={styles.aerligMiniLabel}>{t('home.sent_applications')}</Text>
          {(sentApplicationsCount == null || sentApplicationsCount === 0) ? (
            <>
              <Text style={{ fontSize: 22, marginTop: 4, marginBottom: 2 }}>📭</Text>
              <Text style={{ fontSize: 11, color: '#888', lineHeight: 15 }}>{t('home.no_applications_sent')}</Text>
              <Text style={[styles.aerligMiniHint, { color: '#E8501A' }]}>{t('home.update_status')}</Text>
            </>
          ) : (
            <>
              <Text style={styles.aerligMiniValue}>{String(sentApplicationsCount)}</Text>
              <Text style={styles.aerligMiniHint}>{t('home.update_status')}</Text>
            </>
          )}
        </Pressable>

        <Pressable
          {...ripple}
          style={[styles.aerligMiniCard, styles.aerligMiniCardFull]}
          onPress={() => setActiveTab('profile')}
        >
          <Text style={styles.aerligMiniLabel}>{t('home.profile_status')}</Text>
          <Text style={styles.aerligProfileValue}>{profilePercent}%</Text>
          <Text style={styles.aerligProfileHint}>{profileStatus} {t('home.open_profile')}</Text>
          <View style={styles.aerligProfileMeter}>
            <View style={[styles.aerligProfileMeterFill, { width: `${Math.max(0, Math.min(100, profilePercent))}%` }]} />
          </View>
        </Pressable>
      </View>

      <View style={styles.aerligTipCard}>
        <View style={styles.aerligTipLabel}>
          <Text style={{ fontSize: 16 }}>💡</Text>
          <Text style={styles.aerligTipLabelText}>{t('home.career_tip')}</Text>
        </View>
        <Text style={styles.aerligTipText}>{tipText}</Text>
      </View>

      {profileEmail === 'bjelland76@gmail.com' && (
        <AdminStats
          adminStats={adminStats}
          adminStatsLoading={adminStatsLoading}
          setAdminStats={setAdminStats}
          setAdminStatsLoading={setAdminStatsLoading}
        />
      )}
    </View>
  );
}
