import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, Switch,
  Animated, Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';
import { THEME } from '../styles/theme';

export default function AnalysisScreen({
  // analysis state
  analysis, jobUrl, setJobUrl, loading, analyzeJob,
  jobAnalyses, jobAnalysesLoading, loadJobAnalyses,
  profileUpdatedSinceAnalysis,
  applicationStyle, setApplicationStyle,
  applicationEmail, setApplicationEmail,
  includePhotoInPdf, setIncludePhotoInPdf,
  cvLanguage, setCvLanguage,
  generationBanner, isGenerating,
  sending, sendApplication,
  generatingPdf, generatePdf, streamingProgress,
  applicationPackage, tailoredCvJobTitle, cvTemplate,
  toggleFavoriteAnalysis, hideJobAnalysis,
  openSavedAnalysis, moveAnalysisToApplications,
  regeneratePdfWithTemplate, openDocument,
  // profile state
  profilePhotoData,
}) {
  const { setActiveTab, t } = useApp();

  const ripple = Platform.OS === 'android'
    ? { android_ripple: { color: 'rgba(26, 26, 46, 0.10)' } }
    : {};

  const matchScore = (typeof analysis?.match_score === 'number' && !Number.isNaN(analysis.match_score))
    ? Math.max(0, Math.min(100, Math.round(analysis.match_score)))
    : (analysis?.match_score ?? 0);

  const hasMatchScore = (analysis?.match_score != null);

  const analysisMeterStyle = matchScore >= 70 ? styles.aerligMeterGood
    : matchScore >= 40 ? styles.aerligMeterWarn
    : styles.aerligMeterBad;
  const analysisMeterColor = matchScore >= 70 ? '#16A34A'
    : matchScore >= 40 ? '#D97706'
    : '#DC2626';
  const analysisMeterStatus = matchScore >= 70 ? t('home.match_strong')
    : matchScore >= 40 ? t('home.match_ok')
    : t('home.match_weak');

  const strengths = Array.isArray(analysis?.strengths) ? analysis.strengths : [];

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
        <Text style={styles.aerligPageTitle}>{t('analysis.title')}</Text>
        <Text style={styles.aerligPageSubtitle}>{t('analysis.subtitle')}</Text>

        <TextInput
          style={[styles.input, styles.aerligInput]}
          placeholder={t('analysis.url_placeholder')}
          value={jobUrl}
          onChangeText={setJobUrl}
          autoCapitalize="none"
        />

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
          <Text style={styles.aerligPrimaryButtonText}>{loading ? t('analysis.analyzing') : t('analysis.analyze_btn')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.aerligCard}>
        <Text style={styles.aerligCardEyebrow}>{t('analysis.previous_analyses')}</Text>

        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={loadJobAnalyses}>
          <Text style={styles.aerligSecondaryButtonText}>{jobAnalysesLoading ? t('analysis.loading') : t('analysis.update_list')}</Text>
        </TouchableOpacity>

        {jobAnalysesLoading ? (
          <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 8 }]}>{t('analysis.loading_analyses')}</Text>
        ) : null}

        {!jobAnalysesLoading && jobAnalyses.length === 0 ? (
          <View style={[styles.aerligCard, { alignItems: 'center', paddingVertical: 28, marginTop: 8 }]}>
            <Text style={{ fontSize: 36, marginBottom: 12 }}>🔍</Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6, textAlign: 'center' }}>{t('analysis.no_analyses_title')}</Text>
            <Text style={{ fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20 }}>
              {t('analysis.no_analyses_body')}
            </Text>
          </View>
        ) : null}
      </View>

      {jobAnalyses.map((item) => {
        const heartScale = new Animated.Value(1);
        const onHeartPress = () => {
          Animated.sequence([
            Animated.timing(heartScale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
            Animated.timing(heartScale, { toValue: 1, duration: 100, useNativeDriver: true }),
          ]).start();
          toggleFavoriteAnalysis(item.job.id);
        };
        return (
          <View key={item.job.id} style={[styles.aerligCard, { paddingVertical: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[styles.aerligCardTitle, { fontSize: 15 }]} numberOfLines={2}>{item.job.title}</Text>
                <Text style={[styles.aerligCardMeta, { marginTop: 2 }]}>
                  {item.job.company || t('common.unknown_company')} · {Math.round(item.match_score || item.job.match_score || 0)}%
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <TouchableOpacity
                  onPress={onHeartPress}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Animated.Text style={{ fontSize: 20, transform: [{ scale: heartScale }], color: item.is_favorite ? '#E8501A' : '#CCCCCC' }}>
                    {item.is_favorite ? '♥' : '♡'}
                  </Animated.Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => hideJobAnalysis(item.job.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: 'rgba(239,68,68,0.10)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700', lineHeight: 18 }}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity
                style={{
                  flex: 1, paddingVertical: 9, borderRadius: 12,
                  backgroundColor: '#FFFFFF', borderWidth: 1,
                  borderColor: 'rgba(26,26,46,0.22)',
                  alignItems: 'center', justifyContent: 'center',
                }}
                onPress={() => openSavedAnalysis(item.job.id, item?.job?.url)}
              >
                <Text style={[styles.aerligSecondaryButtonText, { fontSize: 13 }]}>{t('analysis.open_analysis')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1, paddingVertical: 9, borderRadius: 12,
                  backgroundColor: '#FFFFFF', borderWidth: 1,
                  borderColor: 'rgba(26,26,46,0.22)',
                  alignItems: 'center', justifyContent: 'center',
                }}
                onPress={() => moveAnalysisToApplications(item.job.id)}
              >
                <Text style={[styles.aerligSecondaryButtonText, { fontSize: 13 }]}>{t('analysis.add_applications')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {profileUpdatedSinceAnalysis && analysis && jobUrl ? (
        <View style={[styles.aerligCard, { borderWidth: 1.5, borderColor: '#E8501A', backgroundColor: '#FFF8F4' }]}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#E8501A', marginBottom: 4 }}>{t('analysis.profile_updated_title')}</Text>
          <Text style={{ fontSize: 13, color: '#334155', lineHeight: 19, marginBottom: 12 }}>
            {t('analysis.profile_updated_body')}
          </Text>
          <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
            <Text style={styles.aerligPrimaryButtonText}>{loading ? t('analysis.analyzing') : t('analysis.reanalyze')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {analysis ? (
        <>
          <View style={[styles.aerligCard, styles.aerligAccentNavy]}>
            <Text style={styles.aerligCardEyebrow}>{t('analysis.section_analysis')}</Text>

            {hasMatchScore ? (
              <>
                <View style={styles.aerligMeterRow}>
                  <Text style={styles.aerligMeterLabel}>{t('analysis.matchmeter')}</Text>
                  <Text style={[styles.aerligMeterValue, { color: analysisMeterColor }]}>{matchScore}%</Text>
                </View>
                <View style={styles.aerligMeterOuter}>
                  <View
                    style={[
                      styles.aerligMeterInner,
                      analysisMeterStyle,
                      { width: `${Math.max(0, Math.min(100, matchScore))}%` },
                    ]}
                  />
                </View>
                <Text style={[styles.aerligMeterStatus, { color: analysisMeterColor }]}>{analysisMeterStatus}</Text>
              </>
            ) : null}

            {(typeof analysis?.should_apply === 'boolean') ? (
              <>
                <View style={styles.aerligMeterRow}>
                  <Text style={styles.aerligMeterLabel}>{t('analysis.honesty_meter')}</Text>
                  <Text style={styles.aerligMeterValue}>{analysis.should_apply ? t('analysis.apply') : t('analysis.wait')}</Text>
                </View>
                <View style={styles.aerligMeterOuter}>
                  <View
                    style={[
                      styles.aerligMeterInner,
                      analysis.should_apply ? styles.aerligMeterGood : styles.aerligMeterWarn,
                      { width: '100%' },
                    ]}
                  />
                </View>
              </>
            ) : null}

            {analysis.recommended_application_style ? (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.aerligCardSectionTitle}>{t('analysis.recommended_length')}</Text>
                <Text style={styles.aerligCardBody}>
                  {analysis.recommended_application_style === 'kort'
                    ? 'Kort (1 avsnitt)'
                    : analysis.recommended_application_style === 'profesjonell'
                      ? 'Profesjonell (4–6 avsnitt)'
                      : 'Vanlig (2–3 avsnitt)'}
                </Text>
                {analysis.recommended_style_reason ? (
                  <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>{analysis.recommended_style_reason}</Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.aerligSecondaryButton, { marginTop: 10, paddingVertical: 12 }]}
                  onPress={() => setApplicationStyle(analysis.recommended_application_style)}
                >
                  <Text style={styles.aerligSecondaryButtonText}>{t('analysis.use_recommended')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {analysis.honest_assessment ? (
            <View style={[styles.aerligCard, styles.aerligAccentOrange]}>
              <Text style={styles.aerligCardEyebrow}>{t('analysis.honest_assessment')}</Text>
              <Text style={styles.aerligCardBody}>{analysis.honest_assessment}</Text>
            </View>
          ) : null}

          {strengths.length > 0 ? (
            <View style={[styles.aerligCard, styles.aerligAccentGreen]}>
              <Text style={styles.aerligCardEyebrow}>{t('analysis.strengths')}</Text>
              {strengths.map((s, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {s}</Text>
              ))}
            </View>
          ) : null}

          {analysis.missing_requirements?.length > 0 ? (
            <View style={[styles.aerligCard, styles.aerligAccentOrange]}>
              <Text style={styles.aerligCardEyebrow}>{t('analysis.weaknesses')}</Text>
              {analysis.missing_requirements.map((item, index) => (
                <Text key={index} style={styles.aerligCardBody}>• {item}</Text>
              ))}
              <TouchableOpacity
                style={[styles.aerligSecondaryButton, { marginTop: 12 }]}
                onPress={() => setActiveTab('profile')}
              >
                <Text style={styles.aerligSecondaryButtonText}>{t('analysis.update_profile')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {analysis.improvement_tips?.length > 0 ? (
            <View style={[styles.aerligCard, styles.aerligAccentGreen]}>
              <Text style={styles.aerligCardEyebrow}>{t('analysis.improvement_tips')}</Text>
              {analysis.improvement_tips.map((item, index) => (
                <Text key={index} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </View>
          ) : null}

          <View style={styles.aerligCard}>
            <Text style={styles.aerligCardEyebrow}>{t('analysis.section_application')}</Text>

            <Text style={[styles.inputLabel, styles.aerligLabel, { marginTop: 6 }]}>{t('analysis.select_length')}</Text>
            <View style={[styles.filterChipRow, styles.aerligFilterChipRow]}>
              {[
                { key: 'kort', label: 'Kort (1 avsnitt)' },
                { key: 'vanlig', label: 'Vanlig (2–3 avsnitt)' },
                { key: 'profesjonell', label: 'Profesjonell (4–6 avsnitt)' },
              ].map((opt) => {
                const active = applicationStyle === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.filterChip, styles.aerligFilterChip, active && styles.aerligFilterChipActive]}
                    onPress={() => setApplicationStyle(opt.key)}
                  >
                    <Text style={[styles.filterChipText, styles.aerligFilterChipText, active && styles.aerligFilterChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.inputLabel, styles.aerligLabel, { marginTop: 6 }]}>{t('analysis.send_to_email')}</Text>
            <TextInput
              style={[styles.input, styles.aerligInput]}
              placeholder={t('analysis.send_to_email')}
              value={applicationEmail}
              onChangeText={setApplicationEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            {profilePhotoData ? (
              <View style={styles.profileField}>
                <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('analysis.photo_in_pdf')}</Text>
                <Text style={[styles.helpText, styles.aerligHelpText]}>{t('analysis.photo_in_pdf_help')}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={[styles.messageText, styles.aerligMessageText]}>{includePhotoInPdf ? t('common.on') : t('common.off')}</Text>
                  <Switch value={includePhotoInPdf} onValueChange={setIncludePhotoInPdf} />
                </View>
              </View>
            ) : null}

            <Text style={[styles.inputLabel, styles.aerligLabel, { marginTop: 6 }]}>{t('analysis.language_label')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              {[{ key: 'no', label: '🇳🇴 Norsk' }, { key: 'en', label: '🇬🇧 English' }].map(({ key, label }) => {
                const active = cvLanguage === key;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setCvLanguage(key)}
                    style={[styles.filterChip, styles.aerligFilterChip, active && styles.aerligFilterChipActive]}
                  >
                    <Text style={[styles.filterChipText, styles.aerligFilterChipText, active && styles.aerligFilterChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {(analysis?.has_tailored_cv_no || analysis?.has_tailored_cv_en) ? (
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                {analysis.has_tailored_cv_no ? (
                  <View style={{ backgroundColor: '#dcfce7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: '#15803d', fontWeight: '700' }}>🇳🇴 NO ✓</Text>
                  </View>
                ) : null}
                {analysis.has_tailored_cv_en ? (
                  <View style={{ backgroundColor: '#dbeafe', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: '#1d4ed8', fontWeight: '700' }}>🇬🇧 EN ✓</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {generationBanner ? (
              <View style={{
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                borderColor: 'rgba(239, 68, 68, 0.35)',
                borderWidth: 1,
                borderRadius: 16,
                paddingVertical: 10,
                paddingHorizontal: 12,
                marginTop: 12,
              }}>
                <Text style={{
                  color: THEME.colors.danger,
                  fontWeight: '900',
                  fontSize: 13,
                  lineHeight: 18,
                }}>{generationBanner}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.aerligSecondaryButton, isGenerating ? { opacity: 0.6 } : null]}
              onPress={sendApplication}
              disabled={isGenerating}
            >
              <Text style={styles.aerligSecondaryButtonText}>{sending ? t('analysis.sending') : t('analysis.send_application')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.aerligSecondaryButton, isGenerating ? { opacity: 0.6 } : null]}
              onPress={generatePdf}
              disabled={isGenerating}
            >
              <Text style={styles.aerligSecondaryButtonText}>{generatingPdf ? t('analysis.generating') : t('analysis.generate_pdf')}</Text>
            </TouchableOpacity>

            {streamingProgress ? (
              <Text style={{ fontSize: 12, color: '#6B7280', fontStyle: 'italic', marginTop: 6, marginBottom: 2 }} numberOfLines={2}>
                ✍️ {streamingProgress}
              </Text>
            ) : null}

            {applicationPackage ? (
              <View style={{ marginTop: 12 }}>
                {tailoredCvJobTitle ? (
                  <View style={{ backgroundColor: '#e8f4e8', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8, alignSelf: 'flex-start' }}>
                    <Text style={{ color: '#2a7a2a', fontSize: 12, fontWeight: '600' }}>Tilpasset: {tailoredCvJobTitle}</Text>
                  </View>
                ) : null}

                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                    {t('analysis.template_label')}: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{cvTemplate.charAt(0).toUpperCase() + cvTemplate.slice(1)}</Text>
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {['kreativ', 'profesjonell', 'klassisk'].map((tpl) => {
                      const active = cvTemplate === tpl;
                      return (
                        <TouchableOpacity
                          key={tpl}
                          onPress={() => !active && regeneratePdfWithTemplate(tpl)}
                          disabled={isGenerating || active}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 6,
                            borderWidth: 1.5,
                            borderColor: active ? '#1e3a8a' : '#cbd5e1',
                            backgroundColor: active ? '#1e3a8a' : '#fff',
                            opacity: isGenerating && !active ? 0.5 : 1,
                          }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: active ? '700' : '400', color: active ? '#fff' : '#334155' }}>
                            {tpl.charAt(0).toUpperCase() + tpl.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {(typeof applicationPackage?.pdfUrl === 'string' && applicationPackage.pdfUrl.trim()) ? (
                  <TouchableOpacity
                    style={[styles.aerligSecondaryButton, { marginTop: 0 }]}
                    onPress={() => openDocument(applicationPackage.pdfUrl)}
                  >
                    <Text style={styles.aerligSecondaryButtonText}>{t('analysis.open_pdf')}</Text>
                  </TouchableOpacity>
                ) : null}

                {(typeof applicationPackage?.coverLetter === 'string' && applicationPackage.coverLetter.trim()) ? (
                  <>
                    <Text style={styles.aerligCardSectionTitle}>{t('analysis.section_cover_letter')}</Text>
                    <Text style={styles.aerligCardBody}>{applicationPackage.coverLetter}</Text>
                  </>
                ) : null}

                {(typeof applicationPackage?.cv === 'string' && applicationPackage.cv.trim()) ? (
                  <>
                    <Text style={styles.aerligCardSectionTitle}>{t('analysis.section_cv')}</Text>
                    <Text style={styles.aerligCardBody}>{applicationPackage.cv}</Text>
                  </>
                ) : null}

                {(
                  (!applicationPackage?.coverLetter || !String(applicationPackage.coverLetter).trim())
                  && (!applicationPackage?.cv || !String(applicationPackage.cv).trim())
                ) ? (
                  <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 6 }]}>{t('analysis.no_text')}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}
