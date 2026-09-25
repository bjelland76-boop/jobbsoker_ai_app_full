import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, Switch,
  Animated, Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';
import { THEME } from '../styles/theme';
import CvTemplatePickerModal from '../components/CvTemplatePickerModal';
import DeadlineReminderModal from '../components/DeadlineReminderModal';

export default function AnalysisScreen({
  // analysis state
  analysis, justAnalyzed, jobUrl, setJobUrl, loading, analyzeJob,
  deadlinePrompt, dismissDeadlinePrompt,
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
  templatePickerVisible, openTemplatePicker, closeTemplatePicker, confirmTemplateAndGenerate,
  isEditingText, setIsEditingText, savingEditedText, saveEditedTexts,
  // profile state
  profilePhotoData,
}) {
  const { setActiveTab, t, uiLanguage } = useApp();

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

  const honestyMeterStyle = matchScore >= 60 ? styles.aerligMeterGood
    : matchScore >= 25 ? styles.aerligMeterWarn
    : styles.aerligMeterBad;
  const honestyMeterColor = matchScore >= 60 ? '#16A34A'
    : matchScore >= 25 ? '#D97706'
    : '#DC2626';
  const honestyMeterLabel = matchScore >= 60 ? t('analysis.honesty_high')
    : matchScore >= 25 ? t('analysis.honesty_medium')
    : t('analysis.honesty_low');

  const strengths = Array.isArray(analysis?.strengths) ? analysis.strengths : [];

  const [draftCv, setDraftCv] = React.useState('');
  const [draftLetter, setDraftLetter] = React.useState('');
  // Fase 1 auto-language-detection: cvLanguage is now set automatically from
  // the detected job-ad language (see analyzeJob() in useJobAnalysis.js).
  // This just toggles visibility of the manual override chips -- collapsed
  // by default so it reads as a correction, not a required step.
  const [showLanguageOverride, setShowLanguageOverride] = React.useState(false);
  // Fase 2 auto-style-recommendation: applicationStyle is now set
  // automatically from the AI's length/tone recommendation (see
  // analyzeJob() in useJobAnalysis.js). Same collapsed-by-default pattern.
  const [showStyleOverride, setShowStyleOverride] = React.useState(false);

  function startEditingText() {
    setDraftCv(applicationPackage?.cv || '');
    setDraftLetter(applicationPackage?.coverLetter || '');
    setIsEditingText(true);
  }

  function cancelEditingText() {
    setIsEditingText(false);
  }

  function confirmSaveEditedText() {
    saveEditedTexts(draftCv, draftLetter);
  }

  // Two top-level sections, order swapped depending on justAnalyzed (see
  // return below): the history list (browsing past analyses) and the
  // result for whichever analysis is currently loaded (fresh or reopened).
  const historySection = (
    <>
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

      {jobAnalyses.map((item, index) => {
        const heartScale = new Animated.Value(1);
        const onHeartPress = () => {
          Animated.sequence([
            Animated.timing(heartScale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
            Animated.timing(heartScale, { toValue: 1, duration: 100, useNativeDriver: true }),
          ]).start();
          toggleFavoriteAnalysis(item.job.id);
        };
        // Backend sorts by updated_at DESC (main.py's list_job_analyses),
        // so index 0 is always the freshest analysis in this list.
        const isFreshest = index === 0;
        return (
          <View key={item.job.id} style={[styles.aerligCard, { paddingVertical: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                {isFreshest ? (
                  <View style={{
                    alignSelf: 'flex-start', backgroundColor: '#FEF0EB', borderWidth: 1, borderColor: '#E8501A',
                    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4,
                  }}>
                    <Text style={{ color: '#E8501A', fontSize: 10, fontWeight: '700' }}>{t('analysis.just_analyzed_badge')}</Text>
                  </View>
                ) : null}
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
    </>
  );

  const resultSection = (
    <>
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
          {uiLanguage === 'so' && !loading ? (
            <View style={{
              backgroundColor: '#FEF9C3',
              borderRadius: 10,
              paddingVertical: 8,
              paddingHorizontal: 12,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 6,
            }}>
              <Text style={{ fontSize: 12 }}>⚠️</Text>
              <Text style={{ flex: 1, fontSize: 12, color: '#57534E', lineHeight: 16 }}>
                {t('analysis.analysis_language_notice')}
              </Text>
            </View>
          ) : null}

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

            {hasMatchScore ? (
              <>
                <View style={styles.aerligMeterRow}>
                  <Text style={styles.aerligMeterLabel}>{t('analysis.honesty_meter')}</Text>
                  <Text style={[styles.aerligMeterValue, { color: honestyMeterColor }]}>{honestyMeterLabel}</Text>
                </View>
                <View style={styles.aerligMeterOuter}>
                  <View
                    style={[
                      styles.aerligMeterInner,
                      honestyMeterStyle,
                      { width: `${Math.max(0, Math.min(100, matchScore))}%` },
                    ]}
                  />
                </View>
              </>
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

            {(() => {
              const STYLE_OPTIONS = [
                { key: 'kort', label: t('analysis.style_short') },
                { key: 'vanlig', label: t('analysis.style_normal') },
                { key: 'profesjonell', label: t('analysis.style_professional') },
              ];
              const currentLabel = STYLE_OPTIONS.find((opt) => opt.key === applicationStyle)?.label
                || t('analysis.style_normal');
              return (
                <View style={{ marginTop: 6, marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 12, color: '#6B7280' }}>
                      {t('analysis.style_detected_prefix')} {currentLabel}
                    </Text>
                    <TouchableOpacity onPress={() => setShowStyleOverride((v) => !v)}>
                      <Text style={{ fontSize: 12, color: THEME.colors.primary, fontWeight: '700' }}>
                        {showStyleOverride ? t('common.cancel') : t('analysis.style_change_link')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {showStyleOverride ? (
                    <View style={[styles.filterChipRow, styles.aerligFilterChipRow, { marginTop: 8 }]}>
                      {STYLE_OPTIONS.map((opt) => {
                        const active = applicationStyle === opt.key;
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[styles.filterChip, styles.aerligFilterChip, active && styles.aerligFilterChipActive]}
                            onPress={() => { setApplicationStyle(opt.key); setShowStyleOverride(false); }}
                          >
                            <Text style={[styles.filterChipText, styles.aerligFilterChipText, active && styles.aerligFilterChipTextActive]}>{opt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })()}

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

            {(cvTemplate === 'vietnamesisk' || cvLanguage === 'vi') ? (
              <View style={{ marginTop: 6, marginBottom: 4 }}>
                <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('analysis.language_label')}</Text>
                <View style={{ backgroundColor: '#fef2f2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 12, color: '#991b1b', fontWeight: '700' }}>🇻🇳 Tiếng Việt</Text>
                </View>
              </View>
            ) : (
              <View style={{ marginTop: 6, marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 12, color: '#6B7280' }}>
                    {t('analysis.language_detected_prefix')} {{
                      no: `🇳🇴 ${t('common.language_no')}`,
                      en: `🇬🇧 ${t('common.language_en')}`,
                      sv: `🇸🇪 ${t('common.language_sv')}`,
                      da: `🇩🇰 ${t('common.language_da')}`,
                    }[cvLanguage] || `🇳🇴 ${t('common.language_no')}`}
                  </Text>
                  <TouchableOpacity onPress={() => setShowLanguageOverride((v) => !v)}>
                    <Text style={{ fontSize: 12, color: THEME.colors.primary, fontWeight: '700' }}>
                      {showLanguageOverride ? t('common.cancel') : t('analysis.language_change_link')}
                    </Text>
                  </TouchableOpacity>
                </View>
                {showLanguageOverride ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    {[
                      { key: 'no', label: '🇳🇴 Norsk' },
                      { key: 'en', label: '🇬🇧 English' },
                      { key: 'sv', label: '🇸🇪 Svenska' },
                      { key: 'da', label: '🇩🇰 Dansk' },
                    ].map(({ key, label }) => {
                      const active = cvLanguage === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => { setCvLanguage(key); setShowLanguageOverride(false); }}
                          style={[styles.filterChip, styles.aerligFilterChip, active && styles.aerligFilterChipActive]}
                        >
                          <Text style={[styles.filterChipText, styles.aerligFilterChipText, active && styles.aerligFilterChipTextActive]}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            )}
            {(analysis?.has_tailored_cv_no || analysis?.has_tailored_cv_en || analysis?.has_tailored_cv_vi || analysis?.has_tailored_cv_sv || analysis?.has_tailored_cv_da) ? (
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
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
                {analysis.has_tailored_cv_vi ? (
                  <View style={{ backgroundColor: '#fef2f2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: '#991b1b', fontWeight: '700' }}>🇻🇳 VI ✓</Text>
                  </View>
                ) : null}
                {analysis.has_tailored_cv_sv ? (
                  <View style={{ backgroundColor: '#e0f2fe', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: '#075985', fontWeight: '700' }}>🇸🇪 SV ✓</Text>
                  </View>
                ) : null}
                {analysis.has_tailored_cv_da ? (
                  <View style={{ backgroundColor: '#fef3c7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: '#92400e', fontWeight: '700' }}>🇩🇰 DA ✓</Text>
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

            {/* Same filled-orange primary style as "Analyser jobb" on the home
                screen (aerligPrimaryButton) -- this is the main action of this
                screen, and it previously read as a low-priority grey/white
                secondary button. aerligQuickButton (the outlined variant used
                by "Analyser CV"/"Intervju-oving") is flex:1 and only works
                inside that three-button row. */}
            <TouchableOpacity
              style={[styles.aerligPrimaryButton, styles.cardElevated, { marginTop: 12 }, isGenerating ? { opacity: 0.6 } : null]}
              onPress={() => openTemplatePicker()}
              disabled={isGenerating}
            >
              <Text style={styles.aerligPrimaryButtonText}>{generatingPdf ? t('analysis.generating') : t('analysis.generate_pdf')}</Text>
            </TouchableOpacity>

            <CvTemplatePickerModal
              visible={templatePickerVisible}
              onClose={closeTemplatePicker}
              onConfirm={confirmTemplateAndGenerate}
              recommendedTemplate={analysis?.cv_mal || cvTemplate}
              cvLanguage={cvLanguage}
              setCvLanguage={setCvLanguage}
            />

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
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {['kreativ', 'profesjonell', 'klassisk', 'moderne', 'skandinavisk'].map((tpl) => {
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

                {/* Fase 4: sending is now a post-generation action, next to the
                    template-switch buttons above -- it emails exactly this
                    already-generated content, not a fresh regeneration. */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('analysis.send_to_email')}</Text>
                  <TextInput
                    style={[styles.input, styles.aerligInput]}
                    placeholder={t('analysis.send_to_email')}
                    value={applicationEmail}
                    onChangeText={setApplicationEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <TouchableOpacity
                    style={[styles.aerligSecondaryButton, { marginTop: 8 }, isGenerating ? { opacity: 0.6 } : null]}
                    onPress={sendApplication}
                    disabled={isGenerating || sending}
                  >
                    <Text style={styles.aerligSecondaryButtonText}>{sending ? t('analysis.sending') : t('analysis.send_application')}</Text>
                  </TouchableOpacity>
                </View>

                {(typeof applicationPackage?.pdfUrl === 'string' && applicationPackage.pdfUrl.trim()) ? (
                  <TouchableOpacity
                    style={[styles.aerligSecondaryButton, { marginTop: 0 }]}
                    onPress={() => openDocument(applicationPackage.pdfUrl)}
                  >
                    <Text style={styles.aerligSecondaryButtonText}>{t('analysis.open_pdf')}</Text>
                  </TouchableOpacity>
                ) : null}

                {(
                  (typeof applicationPackage?.coverLetter === 'string' && applicationPackage.coverLetter.trim())
                  || (typeof applicationPackage?.cv === 'string' && applicationPackage.cv.trim())
                ) ? (
                  <TouchableOpacity
                    style={[styles.aerligSecondaryButton, { marginTop: 10 }]}
                    disabled={isGenerating}
                    onPress={() => (isEditingText ? cancelEditingText() : startEditingText())}
                  >
                    <Text style={styles.aerligSecondaryButtonText}>
                      {isEditingText ? t('common.cancel') : t('common.edit')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {isEditingText ? (
                  <>
                    <Text style={styles.aerligCardSectionTitle}>{t('analysis.section_cover_letter')}</Text>
                    <TextInput
                      style={[styles.input, styles.aerligInput, styles.textArea, { minHeight: 140 }]}
                      value={draftLetter}
                      onChangeText={setDraftLetter}
                      multiline
                    />

                    <Text style={[styles.aerligCardSectionTitle, { marginTop: 12 }]}>{t('analysis.section_cv')}</Text>
                    <TextInput
                      style={[styles.input, styles.aerligInput, styles.textArea, { minHeight: 240 }]}
                      value={draftCv}
                      onChangeText={setDraftCv}
                      multiline
                    />

                    <TouchableOpacity
                      style={[styles.aerligPrimaryButton, { marginTop: 10 }]}
                      disabled={savingEditedText}
                      onPress={confirmSaveEditedText}
                    >
                      <Text style={styles.aerligPrimaryButtonText}>
                        {savingEditedText ? t('common.saving') : t('common.save')}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </>
  );

  return (
    <View style={styles.aerligHomeWrap}>
      <DeadlineReminderModal
        visible={!!deadlinePrompt?.visible}
        jobId={deadlinePrompt?.jobId}
        jobTitle={deadlinePrompt?.jobTitle}
        company={deadlinePrompt?.company}
        deadline={deadlinePrompt?.deadline}
        onClose={dismissDeadlinePrompt}
      />
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

      {justAnalyzed ? (
        // Right after a fresh analysis (or opening the latest one from
        // HomeScreen's "Siste analyse" card), the history list is omitted
        // entirely -- not just pushed below the fold. It only reappears
        // once the user explicitly navigates to it via "Analyserte jobber"
        // (which resets justAnalyzed to false, see HomeScreen.js).
        resultSection
      ) : (
        <>
          {historySection}
          {resultSection}
        </>
      )}
    </View>
  );
}
