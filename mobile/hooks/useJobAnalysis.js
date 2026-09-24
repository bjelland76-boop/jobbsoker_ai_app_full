import { useState, useEffect, useRef } from 'react';
import { Alert, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch, API, useApp } from '../context/AppContext';

// Isolert Fase 6-leveranse (frist-varsling): husk per jobb-ID at brukeren
// allerede har svart på deadline-pop-up-en, slik at den ikke spør på nytt
// hver gang samme jobb re-analyseres/gjenåpnes. Rent klient-lokalt -- ingen
// backend/DB-endring (det er en Jobbkalender (B)-oppgave).
const DEADLINE_PROMPT_ANSWERED_KEY = 'deadlinePromptAnswered';

async function hasAnsweredDeadlinePrompt(jobId) {
  try {
    const raw = await AsyncStorage.getItem(DEADLINE_PROMPT_ANSWERED_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) && ids.includes(jobId);
  } catch (e) {
    return false;
  }
}

async function markDeadlinePromptAnswered(jobId) {
  try {
    const raw = await AsyncStorage.getItem(DEADLINE_PROMPT_ANSWERED_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(ids) ? ids : [];
    if (!next.includes(jobId)) next.push(jobId);
    await AsyncStorage.setItem(DEADLINE_PROMPT_ANSWERED_KEY, JSON.stringify(next));
  } catch (e) {
    // Best-effort -- worst case the prompt reappears once more later.
  }
}

export default function useJobAnalysis({
  profileId,
  profileEmail,
  profilePhotoData,
  includePhotoInPdf,
  includePhotoDefault,
  setIncludePhotoInPdf,
  isProfileTooEmpty,
  flushAutoSave,
  saveProfile,
} = {}) {
  const { authTokenState, openAuthScreen, logEvent, errText, uiLanguage, activeTab, setActiveTab, showPaymentModal, t } = useApp();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [jobUrl, setJobUrl] = useState('');
  // Alternative to jobUrl for job ads with no stable URL (pasted text).
  const [jobText, setJobText] = useState('');
  const [jobInputMode, setJobInputMode] = useState('url'); // 'url' | 'text'
  const [analysis, setAnalysis] = useState(null);
  // Isolert Fase 6-leveranse: pop-up state for DeadlineReminderModal,
  // shown right after a fresh analysis (see analyzeJob() below).
  const [deadlinePrompt, setDeadlinePrompt] = useState({
    visible: false, jobId: null, jobTitle: '', company: '', deadline: null,
  });
  // Drives AnalysisScreen's render order: true right after a fresh analysis
  // (or opening the latest one from HomeScreen's "Siste analyse" card) so
  // the result appears before the history list, without scrolling. False
  // when the user explicitly asked to browse history (HomeScreen's
  // "Analyserte jobber" stat, or opening an item directly from the list on
  // AnalysisScreen itself) -- see setJustAnalyzed usages below.
  const [justAnalyzed, setJustAnalyzed] = useState(false);
  const [tailoredCvJobTitle, setTailoredCvJobTitle] = useState('');
  const [cvTemplate, setCvTemplate] = useState('profesjonell');
  const [cvLanguage, setCvLanguage] = useState('no');
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [profileUpdatedSinceAnalysis, setProfileUpdatedSinceAnalysis] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobAnalyses, setJobAnalyses] = useState([]);
  const [jobAnalysesLoading, setJobAnalysesLoading] = useState(false);
  const [cvAnalysis, setCvAnalysis] = useState(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [appSortOrder, setAppSortOrder] = useState('newest');
  const [applicationStyle, setApplicationStyle] = useState('vanlig');
  const [applicationEmail, setApplicationEmail] = useState('');
  const [applicationPackageByLang, setApplicationPackageByLang] = useState({ no: null, en: null, vi: null });
  // Computed: always reflects the package for the currently selected language.
  // Switching cvLanguage automatically swaps displayed content + pdfUrl.
  const applicationPackage = applicationPackageByLang[cvLanguage] ?? null;
  function setApplicationPackage(pkg, langKey) {
    setApplicationPackageByLang(prev => ({ ...prev, [langKey || cvLanguage]: pkg }));
  }
  const [sending, setSending] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [streamingProgress, setStreamingProgress] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationBanner, setGenerationBanner] = useState('');
  const generationLockRef = useRef(false);

  // "Rediger CV" — editing the already-generated cv/coverLetter text and
  // regenerating the PDF from the edited wording (no AI call).
  const [isEditingText, setIsEditingText] = useState(false);
  const [savingEditedText, setSavingEditedText] = useState(false);

  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [statsMe, setStatsMe] = useState(null);

  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Reset on logout
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (authTokenState !== null) return;
    setJobUrl('');
    setJobText('');
    setJobInputMode('url');
    setAnalysis(null);
    setJobAnalyses([]);
    setCvAnalysis(null);
    setApplicationStyle('vanlig');
    setApplicationEmail('');
    setApplicationPackageByLang({ no: null, en: null });
    setGenerationBanner('');
    setStreamingProgress('');
    setIsGenerating(false);
    generationLockRef.current = false;
    setApplications([]);
    setStatsMe(null);
    setDocuments([]);
  }, [authTokenState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill application email from profile when not manually set
  useEffect(() => {
    if (!applicationEmail && profileEmail) {
      setApplicationEmail(profileEmail);
    }
  }, [profileEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Network error helper
  // ---------------------------------------------------------------------------
  function showAssistantError(e, { retry = null } = {}) {
    const msg = String(e?.message || e || '');
    const lower = msg.toLowerCase();

    const isNetworkish = (
      lower.includes('network request failed')
      || lower.includes('failed to fetch')
      || lower.includes('timeout')
      || lower.includes('timed out')
      || lower.includes('nettverksfeil')
      || lower.includes('kunne ikke nå')
      || lower.includes('could not reach')
      || lower.includes('abort')
    );

    if (isNetworkish) {
      Alert.alert(
        t('errors.network_title'),
        t('errors.network_body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          retry ? { text: t('errors.retry'), onPress: retry } : { text: t('errors.ok') },
        ].filter(Boolean)
      );
      return;
    }

    Alert.alert(t('errors.generic_title'), t('errors.generic_body'));
  }

  // ---------------------------------------------------------------------------
  // Job analyses
  // ---------------------------------------------------------------------------
  async function loadJobAnalyses({ silent = true } = {}) {
    if (!profileId) return;

    setJobAnalysesLoading(true);
    try {
      const data = await apiFetch(`/job-analyses?profile_id=${profileId}`);
      setJobAnalyses(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[Assistant] loadJobAnalyses failed', e);
      if (!silent && activeTab === 'analysis') {
        showAssistantError(e, { retry: () => loadJobAnalyses({ silent: false }) });
      }
    }
    setJobAnalysesLoading(false);
  }

  async function toggleFavoriteAnalysis(jobId) {
    if (!profileId) return;
    setJobAnalyses((prev) =>
      prev.map((it) =>
        it?.job?.id === jobId ? { ...it, is_favorite: !it.is_favorite } : it
      )
    );
    try {
      await apiFetch(`/job-analyses/${jobId}/favorite/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (e) {
      setJobAnalyses((prev) =>
        prev.map((it) =>
          it?.job?.id === jobId ? { ...it, is_favorite: !it.is_favorite } : it
        )
      );
      console.error('[Assistant] toggleFavoriteAnalysis failed', e);
    }
  }

  async function hideJobAnalysis(jobId) {
    if (!profileId) return;

    try {
      await apiFetch(`/job-analyses/${jobId}/hide/${profileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      setJobAnalyses((prev) => prev.filter((it) => it?.job?.id !== jobId));
    } catch (e) {
      console.error('[Assistant] hideJobAnalysis failed', e);
      if (activeTab === 'analysis') {
        showAssistantError(e, { retry: () => hideJobAnalysis(jobId) });
      } else {
        Alert.alert(t('common.error'), errText(e));
      }
    }
  }

  async function openSavedAnalysis(jobId, url, { markFresh = false } = {}) {
    if (!profileId) return;

    setLoading(true);
    setApplicationPackageByLang({ no: null, en: null });
    setTailoredCvJobTitle('');
    setGenerationBanner('');
    try {
      const data = await apiFetch(`/job-analyses/${jobId}?profile_id=${profileId}`);
      setAnalysis(data);
      // markFresh: true only when called from HomeScreen's "Siste analyse"
      // card (the user wants the result, not the list). Explicitly set
      // (not left untouched) so a stale true from an earlier fresh analysis
      // can't leak into "open this specific item from the history list".
      setJustAnalyzed(markFresh);
      if (data?.cv_mal) setCvTemplate(data.cv_mal);
      if (url) setJobUrl(url);
      setActiveTab('analysis');
    } catch (e) {
      console.error('[Assistant] openSavedAnalysis failed', e);
      if (activeTab === 'analysis') {
        showAssistantError(e, { retry: () => openSavedAnalysis(jobId, url) });
      } else {
        Alert.alert(t('common.error'), errText(e));
      }
    }
    setLoading(false);
  }

  async function moveAnalysisToApplications(jobId) {
    if (!profileId) {
      // Alert.alert's buttons array is a no-op in this app's web build (see
      // analyzeJob()'s identical dead-end fixed earlier this week) --
      // window.confirm() is the pattern already used for real
      // confirm-with-action dialogs elsewhere (AppContext.js's
      // deleteAccount()).
      const title = t('errors.profile_missing_title');
      const body = t('errors.profile_missing_body');
      if (window.confirm(`${title}\n\n${body}`)) {
        setActiveTab('profile');
      }
      return;
    }

    try {
      await apiFetch(`/applications/${jobId}/progress/${profileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      window.alert(`${t('applications.added_title')}\n\n${t('applications.added_body')}`);
      setActiveTab('applications');
    } catch (e) {
      console.error('[Assistant] moveAnalysisToApplications failed', e);
      if (activeTab === 'analysis') {
        showAssistantError(e, { retry: () => moveAnalysisToApplications(jobId) });
      } else {
        Alert.alert(t('common.error'), errText(e));
      }
    }
  }

  // Reset photo toggle each time user enters analysis tab
  useEffect(() => {
    if (activeTab !== 'analysis') return;
    if (!profileId) return;

    if (profilePhotoData) {
      setIncludePhotoInPdf?.(!!includePhotoDefault);
    }

    loadJobAnalyses({ silent: true });
  }, [activeTab, profileId, profilePhotoData, includePhotoDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the interview job picker's list fresh too
  useEffect(() => {
    if (activeTab !== 'interview') return;
    if (!profileId) return;
    loadJobAnalyses({ silent: true });
  }, [activeTab, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Analyze job
  // ---------------------------------------------------------------------------
  async function analyzeJob() {
    const hasJobInput = jobInputMode === 'text' ? !!jobText.trim() : !!jobUrl.trim();
    if (!hasJobInput) {
      Alert.alert(t('errors.missing_url_title'), t('errors.missing_url_body'));
      return;
    }

    // A brand-new anonymous user has no profile row yet -- rather than
    // dead-ending here (the old behaviour, see git history), silently
    // create an empty one so a first-time visitor can reach an analysis
    // without a manual "save profile" detour. The isProfileTooEmpty()
    // check right below still gates on having *real* CV content (name
    // alone isn't enough for a useful analysis anyway), so this only
    // removes the redundant technical step, not the legitimate one.
    let currentProfileId = profileId;
    if (!currentProfileId) {
      currentProfileId = await saveProfile?.({ silent: true });
      if (!currentProfileId) {
        // saveProfile already surfaced its own error alert on failure.
        return;
      }
    }

    if (isProfileTooEmpty?.()) {
      const title = t('errors.complete_profile_title');
      const body = t('errors.complete_profile_body_analysis');
      if (window.confirm(`${title}\n\n${body}`)) {
        setActiveTab('profile');
      }
      return;
    }

    await flushAutoSave?.();

    setApplicationPackageByLang({ no: null, en: null });
    setGenerationBanner('');
    setTailoredCvJobTitle('');

    setLoading(true);
    logEvent('analyze_job_started');
    try {
      const data = await apiFetch('/analyze-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: currentProfileId,
          ...(jobInputMode === 'text' ? { job_text: jobText } : { url: jobUrl }),
          application_style: applicationStyle,
          language: uiLanguage,
        }),
      });

      setAnalysis(data);
      setJustAnalyzed(true);
      if (data?.cv_mal) setCvTemplate(data.cv_mal);
      // Fase 1 auto-language-detection: replaces the old manual 🇳🇴/🇬🇧
      // pick as the default -- cvLanguage now follows the job ad's own
      // detected language unless the user explicitly overrides it via the
      // discreet "Endre språk" control in AnalysisScreen.
      if (data?.detected_ad_language === 'en' || data?.detected_ad_language === 'no') {
        setCvLanguage(data.detected_ad_language);
      }
      // Fase 2 auto-style-recommendation: replaces the old manual
      // kort/vanlig/profesjonell pick as the default -- applicationStyle now
      // follows the AI's own length/tone recommendation for this job type
      // unless the user explicitly overrides it via the discreet "Endre"
      // control in AnalysisScreen.
      if (['kort', 'vanlig', 'profesjonell'].includes(data?.recommended_application_style)) {
        setApplicationStyle(data.recommended_application_style);
      }
      // Fase 6 (isolert deadline-varsling): pop-up rett etter analysen --
      // forhåndsutfylt hvis AI-en fant en frist i annonseteksten, ellers en
      // enkel fallback der brukeren kan legge inn en dato selv. Spør bare
      // én gang per jobb (AsyncStorage-markering), ikke hver gang samme
      // jobb re-analyseres/gjenåpnes.
      if (data?.job_id != null) {
        hasAnsweredDeadlinePrompt(data.job_id).then((answered) => {
          if (answered) return;
          setDeadlinePrompt({
            visible: true,
            jobId: data.job_id,
            jobTitle: data.job_title || '',
            company: data.company || '',
            deadline: data.application_deadline || null,
          });
        });
      }
      setProfileUpdatedSinceAnalysis(false);
      logEvent('analyze_job_completed');
      setActiveTab('analysis');
      loadJobAnalyses({ silent: true });
    } catch (e) {
      console.error('[Assistant] analyzeJob failed', e);
      logEvent('analyze_job_failed');
      if (e?.code === 'free_limit_reached') {
        showPaymentModal(e?.data?.limit_type || 'analyse');
      } else {
        Alert.alert(t('common.error'), errText(e));
      }
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Send application (email)
  // ---------------------------------------------------------------------------
  // Fase 4: sends the ALREADY generated cover letter + CV for the currently
  // selected language via email -- no new AI generation, no re-analysis.
  // Previously this re-ran the entire analysis+generation pipeline from
  // scratch on every send (via /analyze-url-and-send), which could email a
  // subtly different text than whatever the user had just reviewed on
  // screen (AI generation isn't perfectly deterministic). Only meaningful
  // once something has actually been generated -- same precondition as
  // regeneratePdfWithTemplate() below.
  async function sendApplication() {
    // The three checks below all used to show a dead Alert.alert(title,
    // body, buttons) -- its buttons array is a no-op in this app's web
    // build (same root cause fixed in analyzeJob()/analyzeCv() earlier
    // this week), so the "Logg inn"/"Gå til Profil" callbacks could never
    // fire. window.confirm() is the pattern already used for real
    // confirm-with-action dialogs elsewhere (AppContext.js's
    // deleteAccount(), and generatePdf()'s regenerate-CV confirm below).
    if (!authTokenState) {
      const title = t('errors.login_required_title');
      const body = t('errors.login_required_body_send');
      if (window.confirm(`${title}\n\n${body}`)) {
        openAuthScreen?.();
      }
      return;
    }
    if (!profileId) {
      if (window.confirm(`${t('common.error')}\n\n${t('errors.save_profile_before_sending')}`)) {
        setActiveTab('profile');
      }
      return;
    }
    if (isProfileTooEmpty?.()) {
      const title = t('errors.complete_profile_title');
      const body = t('errors.complete_profile_body_application');
      if (window.confirm(`${title}\n\n${body}`)) {
        setActiveTab('profile');
      }
      return;
    }
    if (!applicationEmail || !applicationEmail.trim()) {
      setGenerationBanner(t('errors.enter_email_to_send'));
      return;
    }
    if (!analysis?.job_id || !applicationPackage) {
      setGenerationBanner(t('errors.generate_cv_first'));
      return;
    }
    if (sending) return;

    setSending(true);
    setGenerationBanner('');

    try {
      await apiFetch(
        `/job-analyses/${analysis.job_id}/send-application?profile_id=${profileId}&language=${cvLanguage}&to_email=${encodeURIComponent(applicationEmail)}`,
        { method: 'POST' },
      );
      logEvent('application_sent');
      Alert.alert('OK', t('errors.application_sent', { email: applicationEmail }));
    } catch (e) {
      console.error('[Assistant] sendApplication failed', e);
      setGenerationBanner(t('errors.could_not_send'));
    } finally {
      setSending(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Generate PDF
  // ---------------------------------------------------------------------------
  async function generatePdf(template = '', languageOverride = null) {
    // languageOverride: used instead of cvLanguage state when the caller
    // (CvTemplatePickerModal) just changed the language in this same
    // synchronous handler -- setCvLanguage is async/batched, so cvLanguage
    // here would otherwise still read the value from BEFORE that change.
    const lang = languageOverride || cvLanguage;
    // See sendApplication()'s identical checks above for why these use
    // window.confirm() rather than Alert.alert's no-op buttons array.
    if (!profileId) {
      if (window.confirm(`${t('common.error')}\n\n${t('errors.save_profile_first')}`)) {
        setActiveTab('profile');
      }
      return;
    }
    if (isProfileTooEmpty?.()) {
      const title = t('errors.complete_profile_title');
      const body = t('errors.complete_profile_body_cv');
      if (window.confirm(`${title}\n\n${body}`)) {
        setActiveTab('profile');
      }
      return;
    }

    if (jobInputMode === 'text' ? !jobText.trim() : !jobUrl.trim()) {
      Alert.alert(t('common.error'), t('errors.paste_job_ad_first'));
      return;
    }

    if (generationLockRef.current || isGenerating) return;

    // Confirm before overwriting an existing CV in the selected language
    if (analysis?.job_id) {
      const alreadyExists = analysis?.[`has_tailored_cv_${lang}`];
      if (alreadyExists) {
        // Keyed by cvLanguage code, not uiLanguage -- the label names says
        // which language the ALREADY-GENERATED CV/application is in.
        const langLabel = t(`common.language_${lang}`) || lang;
        const title = t('errors.regenerate_cv_title');
        const body = t('errors.regenerate_cv_body', { language: langLabel });

        let confirmed;
        if (Platform.OS === 'web') {
          confirmed = window.confirm(`${title}\n\n${body}`);
        } else {
          confirmed = await new Promise(resolve => {
            Alert.alert(
              title,
              body,
              [
                { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('errors.generate_new'), onPress: () => resolve(true) },
              ]
            );
          });
        }
        if (!confirmed) return;
      }
    }

    await flushAutoSave?.();
    generationLockRef.current = true;
    setIsGenerating(true);
    logEvent('generate_cv_started', { language: lang, template: cvTemplate });
    logEvent({
      vi: 'cv_language_vietnamese',
      en: 'cv_language_english',
      sv: 'cv_language_swedish',
      da: 'cv_language_danish',
    }[lang] || 'cv_language_norwegian');
    logEvent('cv_template_' + cvTemplate);

    const prevPackage = applicationPackage;
    const failMsg = t('errors.generation_failed');
    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;

    setGeneratingPdf(true);
    setGenerationBanner('');
    setStreamingProgress('');
    setApplicationPackage(null);
    setTailoredCvJobTitle('');

    try {
      let pkg;
      if (analysis?.job_id) {
        const templateParam = template ? `&template=${encodeURIComponent(template)}` : '';
        const streamUrl = `${API}/job-analyses/${analysis.job_id}/stream-documents?profile_id=${profileId}&application_style=${encodeURIComponent(applicationStyle)}&include_photo=${includePhoto}&language=${lang}${templateParam}`;
        const resp = await fetch(streamUrl, {
          method: 'POST',
          // Anonymous (authTokenState falsy): omit the header entirely --
          // sending "Bearer null" here would make the backend treat it as
          // an invalid token (401) rather than as an anonymous request.
          headers: authTokenState ? { Authorization: `Bearer ${authTokenState}` } : {},
        });
        if (!resp.ok) {
          let errData = null;
          try { errData = await resp.json(); } catch (_) { /* ignore */ }
          const err = new Error((errData && (errData.message || errData.error)) || `HTTP ${resp.status}`);
          err.status = resp.status;
          err.code = (errData && errData.error) || null;
          err.data = errData;
          throw err;
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let accumulated = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const ev = JSON.parse(raw);
              if (ev.t === 'c') {
                accumulated += ev.v;
                setStreamingProgress(accumulated.slice(-120).replace(/\n/g, ' '));
              } else if (ev.t === 'd') {
                pkg = { cv: ev.cv, coverLetter: ev.coverLetter, pdfUrl: ev.pdfUrl, cvMal: ev.cvMal };
              } else if (ev.t === 'e') {
                throw new Error(ev.msg || 'Generering feilet');
              }
            } catch (parseErr) { /* ignore malformed SSE lines */ }
          }
        }
        setStreamingProgress('');
      } else {
        pkg = await apiFetch('/analyze-url-and-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile_id: profileId,
            ...(jobInputMode === 'text' ? { job_text: jobText } : { url: jobUrl }),
            application_style: applicationStyle,
            include_photo: includePhoto,
            language: lang,
            ...(template ? { template } : {}),
          }),
        });
      }

      const isValidPackage = pkg && typeof pkg.cv === 'string' && typeof pkg.coverLetter === 'string';

      if (isValidPackage) {
        const safePkg = {
          cv: pkg.cv,
          coverLetter: pkg.coverLetter,
          pdfUrl: (typeof pkg.pdfUrl === 'string') ? pkg.pdfUrl : '',
        };

        if ((safePkg.cv || '').trim().length > 0 || (safePkg.coverLetter || '').trim().length > 0) {
          // Key the cache by `lang` (the language actually just generated),
          // not the possibly-stale cvLanguage state -- otherwise a correctly
          // Vietnamese-generated result could get filed under the "no" slot
          // and never show up once cvLanguage catches up to 'vi' on re-render.
          setApplicationPackage(safePkg, lang);
          logEvent('generate_cv_completed');
          if (analysis?.job_id) {
            setTailoredCvJobTitle(analysis?.job_title || 'denne stillingen');
            if (pkg.cvMal) setCvTemplate(pkg.cvMal);
            // Update local analysis flags so badges reflect the new language immediately
            const flagKey = `has_tailored_cv_${lang}`;
            setAnalysis(prev => prev ? { ...prev, [flagKey]: true } : prev);
          }

          if (safePkg.pdfUrl && safePkg.pdfUrl.trim()) {
            await loadDocuments();
            if (analysis?.job_id) {
              Alert.alert('OK', 'PDF er generert. Bytt mal under, eller åpne under Dokumenter.');
            } else {
              setActiveTab('documents');
              Alert.alert('OK', 'PDF er generert. Se under Dokumenter.');
            }
          }

          return;
        }
      }

      if (prevPackage) setApplicationPackage(prevPackage);
      setGenerationBanner(failMsg);
    } catch (e) {
      console.error('[Assistant] generatePdf failed', e);
      if (e?.code === 'free_limit_reached') {
        showPaymentModal(e?.data?.limit_type || 'cv');
      } else {
        if (prevPackage) setApplicationPackage(prevPackage);
        setGenerationBanner(failMsg);
      }
    } finally {
      setGeneratingPdf(false);
      setIsGenerating(false);
      generationLockRef.current = false;
    }
  }

  async function regeneratePdfWithTemplate(newTemplate) {
    if (!analysis?.job_id || !applicationPackage) return;
    if (generationLockRef.current || isGenerating) return;

    generationLockRef.current = true;
    setIsGenerating(true);
    const prevTemplate = cvTemplate;
    setCvTemplate(newTemplate);

    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;
    try {
      const pkg = await apiFetch(
        `/job-analyses/${analysis.job_id}/generate-tailored-cv?profile_id=${profileId}&template=${encodeURIComponent(newTemplate)}&application_style=${encodeURIComponent(applicationStyle)}&include_photo=${includePhoto}&language=${cvLanguage}`,
        { method: 'POST' },
      );
      if (pkg && typeof pkg.cv === 'string') {
        setApplicationPackage({
          cv: pkg.cv || applicationPackage.cv,
          coverLetter: pkg.coverLetter || applicationPackage.coverLetter,
          pdfUrl: typeof pkg.pdfUrl === 'string' ? pkg.pdfUrl : '',
        });
        if (pkg.cvMal) setCvTemplate(pkg.cvMal);
      }
    } catch (e) {
      console.error('[Assistant] regeneratePdfWithTemplate failed', e);
      setCvTemplate(prevTemplate);
      setGenerationBanner(t('errors.could_not_switch_template'));
    } finally {
      setIsGenerating(false);
      generationLockRef.current = false;
    }
  }

  // Save user-edited cv/coverLetter text and regenerate the PDF from it,
  // without a new AI call (backend skips generation when `edited` is sent).
  async function saveEditedTexts(editedCv, editedLetter) {
    if (!analysis?.job_id || !applicationPackage) return;
    if (generationLockRef.current || isGenerating) return;

    generationLockRef.current = true;
    setSavingEditedText(true);
    setIsGenerating(true);

    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;
    try {
      const pkg = await apiFetch(
        `/job-analyses/${analysis.job_id}/generate-tailored-cv?profile_id=${profileId}&application_style=${encodeURIComponent(applicationStyle)}&include_photo=${includePhoto}&language=${cvLanguage}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cv: editedCv, coverLetter: editedLetter }),
        },
      );
      if (pkg && typeof pkg.cv === 'string') {
        setApplicationPackage({
          cv: pkg.cv || applicationPackage.cv,
          coverLetter: pkg.coverLetter || applicationPackage.coverLetter,
          pdfUrl: typeof pkg.pdfUrl === 'string' ? pkg.pdfUrl : '',
        });
        setIsEditingText(false);
      }
    } catch (e) {
      console.error('[Assistant] saveEditedTexts failed', e);
      setGenerationBanner(t('errors.could_not_save_changes'));
    } finally {
      setSavingEditedText(false);
      setIsGenerating(false);
      generationLockRef.current = false;
    }
  }

  // ---------------------------------------------------------------------------
  // CV template picker (popup shown before generation)
  // ---------------------------------------------------------------------------
  // Fase 4: this used to also gate "Send søknad" (via a 'send'/'pdf' kind
  // distinction) -- sending is no longer a generation path at all (see
  // sendApplication() above), so the picker now only ever leads to
  // generatePdf().
  function openTemplatePicker() {
    setTemplatePickerVisible(true);
  }

  function closeTemplatePicker() {
    setTemplatePickerVisible(false);
  }

  // Isolert Fase 6-leveranse: kalles av DeadlineReminderModal uansett om
  // brukeren faktisk satte en påminnelse eller trykket "Nei takk" -- i
  // begge tilfeller har de "svart", så pop-up-en skal ikke dukke opp igjen
  // for akkurat denne jobben.
  function dismissDeadlinePrompt() {
    const { jobId } = deadlinePrompt;
    setDeadlinePrompt({ visible: false, jobId: null, jobTitle: '', company: '', deadline: null });
    if (jobId != null) markDeadlinePromptAnswered(jobId);
  }

  function confirmTemplateAndGenerate(template, languageOverride) {
    setTemplatePickerVisible(false);
    generatePdf(template, languageOverride);
  }

  // ---------------------------------------------------------------------------
  // Applications / progress
  // ---------------------------------------------------------------------------
  async function loadApplications() {
    if (!profileId) return;

    setApplicationsLoading(true);
    try {
      const items = await apiFetch(`/applications?profile_id=${profileId}`);
      setApplications(Array.isArray(items) ? items : []);

      const st = await apiFetch(`/stats/me?profile_id=${profileId}`);
      setStatsMe(st);
    } catch (e) {
      if (__DEV__) console.log('Kunne ikke laste søknader:', e);
    }
    setApplicationsLoading(false);
  }

  async function updateApplicationProgress(jobId, patch) {
    if (!profileId) return;

    try {
      const updated = await apiFetch(`/applications/${jobId}/progress/${profileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      setApplications((prev) => prev.map((it) => (it?.job?.id === jobId ? updated : it)));

      const st = await apiFetch(`/stats/me?profile_id=${profileId}`);
      setStatsMe(st);
    } catch (e) {
      Alert.alert(t('common.error'), String(e));
    }
  }

  useEffect(() => {
    if (activeTab !== 'applications') return;
    if (!profileId) return;
    loadApplications();
  }, [activeTab, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Generated documents
  // ---------------------------------------------------------------------------
  async function loadDocuments() {
    if (!profileId) return;

    setDocumentsLoading(true);
    try {
      const items = await apiFetch(`/generated-applications?profile_id=${profileId}`);
      setDocuments(Array.isArray(items) ? items : []);
    } catch (e) {
      if (__DEV__) console.log('Kunne ikke laste dokumenter:', e);
      setDocuments([]);
    }
    setDocumentsLoading(false);
  }

  async function openDocument(urlPath) {
    const baseUrl = API + urlPath;
    const authedUrl = authTokenState
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(authTokenState)}`
      : baseUrl;

    try {
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-undef
        window.open(authedUrl, '_blank');
        return;
      }

      try {
        await Linking.openURL(authedUrl);
      } catch (e) {
        Alert.alert('Åpne PDF', authedUrl);
      }
    } catch (e) {
      Alert.alert(t('common.error'), String(e));
    }
  }

  useEffect(() => {
    if (activeTab !== 'documents') return;
    if (!profileId) return;
    loadDocuments();
  }, [activeTab, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // CV analysis
  // ---------------------------------------------------------------------------
  async function analyzeCv() {
    // See analyzeJob()'s identical !profileId branch for why a missing
    // profile is auto-created silently instead of dead-ending here.
    let currentProfileId = profileId;
    if (!currentProfileId) {
      currentProfileId = await saveProfile?.({ silent: true });
      if (!currentProfileId) {
        // saveProfile already surfaced its own error alert on failure.
        return;
      }
    }

    await flushAutoSave?.();
    setCvLoading(true);
    try {
      const data = await apiFetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: currentProfileId, language: uiLanguage }),
      });

      setCvAnalysis(data);
      setActiveTab('cv');
    } catch (e) {
      if (e?.code === 'free_limit_reached') {
        showPaymentModal(e?.data?.limit_type || 'cv_analyse');
      } else {
        Alert.alert(t('common.error'), errText(e));
      }
    }
    setCvLoading(false);
  }

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------
  return {
    // Analysis state
    jobUrl, setJobUrl,
    jobText, setJobText,
    jobInputMode, setJobInputMode,
    analysis, setAnalysis,
    deadlinePrompt, dismissDeadlinePrompt,
    justAnalyzed, setJustAnalyzed,
    tailoredCvJobTitle, setTailoredCvJobTitle,
    cvTemplate, setCvTemplate,
    cvLanguage, setCvLanguage,
    templatePickerVisible,
    profileUpdatedSinceAnalysis, setProfileUpdatedSinceAnalysis,
    loading,
    jobAnalyses, setJobAnalyses,
    jobAnalysesLoading,
    cvAnalysis, setCvAnalysis,
    cvLoading,

    // Application generation
    appSortOrder, setAppSortOrder,
    applicationStyle, setApplicationStyle,
    applicationEmail, setApplicationEmail,
    applicationPackage, applicationPackageByLang, setApplicationPackage,
    sending,
    generatingPdf,
    streamingProgress,
    isGenerating,
    generationBanner, setGenerationBanner,
    generationLockRef,
    isEditingText, setIsEditingText,
    savingEditedText,

    // Applications / documents
    applications, setApplications,
    applicationsLoading,
    statsMe, setStatsMe,
    documents,
    documentsLoading,

    // Functions
    loadJobAnalyses,
    toggleFavoriteAnalysis,
    hideJobAnalysis,
    openSavedAnalysis,
    moveAnalysisToApplications,
    analyzeJob,
    sendApplication,
    generatePdf,
    regeneratePdfWithTemplate,
    saveEditedTexts,
    openTemplatePicker,
    closeTemplatePicker,
    confirmTemplateAndGenerate,
    loadApplications,
    updateApplicationProgress,
    loadDocuments,
    openDocument,
    analyzeCv,
  };
}
