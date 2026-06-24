import { useState, useEffect, useRef } from 'react';
import { Alert, Platform, Linking } from 'react-native';

import { apiFetch, API, useApp } from '../context/AppContext';

export default function useJobAnalysis({
  profileId,
  profileEmail,
  profilePhotoData,
  includePhotoInPdf,
  includePhotoDefault,
  setIncludePhotoInPdf,
  isProfileTooEmpty,
  flushAutoSave,
} = {}) {
  const { authTokenState, logEvent, errText, uiLanguage, activeTab, setActiveTab } = useApp();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [jobUrl, setJobUrl] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [tailoredCvJobTitle, setTailoredCvJobTitle] = useState('');
  const [cvTemplate, setCvTemplate] = useState('profesjonell');
  const [cvLanguage, setCvLanguage] = useState('no');
  const [profileUpdatedSinceAnalysis, setProfileUpdatedSinceAnalysis] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobAnalyses, setJobAnalyses] = useState([]);
  const [jobAnalysesLoading, setJobAnalysesLoading] = useState(false);
  const [cvAnalysis, setCvAnalysis] = useState(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [appSortOrder, setAppSortOrder] = useState('newest');
  const [applicationStyle, setApplicationStyle] = useState('vanlig');
  const [applicationEmail, setApplicationEmail] = useState('');
  const [applicationPackageByLang, setApplicationPackageByLang] = useState({ no: null, en: null });
  // Computed: always reflects the package for the currently selected language.
  // Switching cvLanguage automatically swaps displayed content + pdfUrl.
  const applicationPackage = applicationPackageByLang[cvLanguage] ?? null;
  function setApplicationPackage(pkg) {
    setApplicationPackageByLang(prev => ({ ...prev, [cvLanguage]: pkg }));
  }
  const [sending, setSending] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [streamingProgress, setStreamingProgress] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationBanner, setGenerationBanner] = useState('');
  const generationLockRef = useRef(false);

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

    const copy = (uiLanguage === 'en')
      ? {
        networkTitle: 'Connection issue',
        networkBody: "I couldn't reach the server right now. Check Wi‑Fi and try again.",
        genericTitle: 'Something went wrong',
        genericBody: 'Please try again in a moment.',
        retry: 'Try again',
        cancel: 'Cancel',
        ok: 'OK',
      }
      : {
        networkTitle: 'Ingen forbindelse',
        networkBody: 'Jeg fikk ikke kontakt med serveren akkurat nå. Sjekk Wi‑Fi og prøv igjen.',
        genericTitle: 'Noe gikk galt',
        genericBody: 'Prøv igjen om litt.',
        retry: 'Prøv igjen',
        cancel: 'Avbryt',
        ok: 'OK',
      };

    if (isNetworkish) {
      Alert.alert(
        copy.networkTitle,
        copy.networkBody,
        [
          { text: copy.cancel, style: 'cancel' },
          retry ? { text: copy.retry, onPress: retry } : { text: copy.ok },
        ].filter(Boolean)
      );
      return;
    }

    Alert.alert(copy.genericTitle, copy.genericBody);
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
        Alert.alert('Feil', errText(e));
      }
    }
  }

  async function openSavedAnalysis(jobId, url) {
    if (!profileId) return;

    setLoading(true);
    setApplicationPackageByLang({ no: null, en: null });
    setTailoredCvJobTitle('');
    setGenerationBanner('');
    try {
      const data = await apiFetch(`/job-analyses/${jobId}?profile_id=${profileId}`);
      setAnalysis(data);
      if (data?.cv_mal) setCvTemplate(data.cv_mal);
      if (url) setJobUrl(url);
      setActiveTab('analysis');
    } catch (e) {
      console.error('[Assistant] openSavedAnalysis failed', e);
      if (activeTab === 'analysis') {
        showAssistantError(e, { retry: () => openSavedAnalysis(jobId, url) });
      } else {
        Alert.alert('Feil', errText(e));
      }
    }
    setLoading(false);
  }

  async function moveAnalysisToApplications(jobId) {
    if (!profileId) {
      Alert.alert(
        (uiLanguage === 'en') ? 'Profile missing' : 'Mangler profil',
        (uiLanguage === 'en') ? 'Please save your profile first.' : 'Lagre profilen først.'
      );
      return;
    }

    try {
      await apiFetch(`/applications/${jobId}/progress/${profileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      Alert.alert(
        (uiLanguage === 'en') ? 'Added' : 'Lagt til',
        (uiLanguage === 'en') ? 'The job is now tracked under Applications.' : 'Jobben er lagt til under Søknader.'
      );
      setActiveTab('applications');
    } catch (e) {
      console.error('[Assistant] moveAnalysisToApplications failed', e);
      if (activeTab === 'analysis') {
        showAssistantError(e, { retry: () => moveAnalysisToApplications(jobId) });
      } else {
        Alert.alert('Feil', errText(e));
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

  // ---------------------------------------------------------------------------
  // Analyze job
  // ---------------------------------------------------------------------------
  async function analyzeJob() {
    const copy = (uiLanguage === 'en')
      ? {
        missingUrlTitle: 'Paste a job URL',
        missingUrlBody: 'Paste a job ad URL so I can analyze it for you.',
        missingProfileTitle: 'Profile missing',
        missingProfileBody: 'Please save your profile before running an analysis.',
      }
      : {
        missingUrlTitle: 'Lim inn jobbannonse',
        missingUrlBody: 'Lim inn en jobbannonse-URL, så analyserer jeg den for deg.',
        missingProfileTitle: 'Mangler profil',
        missingProfileBody: 'Lagre profilen før du kjører analyse.',
      };

    if (!jobUrl) {
      Alert.alert(copy.missingUrlTitle, copy.missingUrlBody);
      return;
    }

    if (!profileId) {
      Alert.alert(copy.missingProfileTitle, copy.missingProfileBody);
      return;
    }

    if (isProfileTooEmpty?.()) {
      Alert.alert(
        uiLanguage === 'en' ? 'Complete your profile' : 'Fyll ut profilen din',
        uiLanguage === 'en'
          ? 'Add work experience or education to get a relevant analysis.'
          : 'Legg til arbeidserfaring eller utdanning for å få en god analyse.',
        [
          { text: uiLanguage === 'en' ? 'Cancel' : 'Avbryt', style: 'cancel' },
          { text: uiLanguage === 'en' ? 'Go to Profile' : 'Gå til Profil', onPress: () => setActiveTab('profile') },
        ]
      );
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
          profile_id: profileId,
          url: jobUrl,
          application_style: applicationStyle,
        }),
      });

      setAnalysis(data);
      if (data?.cv_mal) setCvTemplate(data.cv_mal);
      setProfileUpdatedSinceAnalysis(false);
      logEvent('analyze_job_completed');
      setActiveTab('analysis');
      loadJobAnalyses({ silent: true });
    } catch (e) {
      console.error('[Assistant] analyzeJob failed', e);
      logEvent('analyze_job_failed');
      Alert.alert('Feil', errText(e));
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Send application (email)
  // ---------------------------------------------------------------------------
  async function sendApplication() {
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen før sending');
      return;
    }
    if (isProfileTooEmpty?.()) {
      Alert.alert(
        uiLanguage === 'en' ? 'Complete your profile' : 'Fyll ut profilen din',
        uiLanguage === 'en'
          ? 'Add work experience or education to generate a relevant application.'
          : 'Legg til arbeidserfaring eller utdanning for å generere en god søknad.',
        [
          { text: uiLanguage === 'en' ? 'Cancel' : 'Avbryt', style: 'cancel' },
          { text: uiLanguage === 'en' ? 'Go to Profile' : 'Gå til Profil', onPress: () => setActiveTab('profile') },
        ]
      );
      return;
    }
    if (!applicationEmail || !applicationEmail.trim()) {
      setGenerationBanner('Skriv inn e-postadressen din for å sende søknaden.');
      return;
    }
    if (!jobUrl) {
      setGenerationBanner('Lim inn en jobbannonse-URL først.');
      return;
    }

    if (generationLockRef.current || isGenerating) return;

    await flushAutoSave?.();

    generationLockRef.current = true;
    setIsGenerating(true);

    const prevPackage = applicationPackage;
    const failMsg = (uiLanguage === 'en') ? 'Generation failed, try again' : 'Generering feilet, prøv igjen';
    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;

    setSending(true);
    setGenerationBanner('');
    setApplicationPackage(null);

    try {
      const pkg = await apiFetch('/analyze-url-and-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profileId,
          url: jobUrl,
          to_email: applicationEmail,
          application_style: applicationStyle,
          include_photo: includePhoto,
          language: cvLanguage,
        }),
      });

      const isValidPackage = pkg && typeof pkg.cv === 'string' && typeof pkg.coverLetter === 'string';

      if (isValidPackage) {
        const safePkg = {
          cv: pkg.cv,
          coverLetter: pkg.coverLetter,
          pdfUrl: (typeof pkg.pdfUrl === 'string') ? pkg.pdfUrl : '',
        };

        if ((safePkg.cv || '').trim().length > 0 || (safePkg.coverLetter || '').trim().length > 0) {
          setApplicationPackage(safePkg);
          Alert.alert('OK', 'Søknad + CV er generert. Sjekk e-post hvis utsending er konfigurert.');
          return;
        }
      }

      if (prevPackage) setApplicationPackage(prevPackage);
      setGenerationBanner(failMsg);
    } catch (e) {
      console.error('[Assistant] sendApplication failed', e);
      if (prevPackage) setApplicationPackage(prevPackage);
      setGenerationBanner(failMsg);
    } finally {
      setSending(false);
      setIsGenerating(false);
      generationLockRef.current = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Generate PDF
  // ---------------------------------------------------------------------------
  async function generatePdf() {
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen først');
      return;
    }
    if (isProfileTooEmpty?.()) {
      Alert.alert(
        uiLanguage === 'en' ? 'Complete your profile' : 'Fyll ut profilen din',
        uiLanguage === 'en'
          ? 'Add work experience or education to generate a relevant CV.'
          : 'Legg til arbeidserfaring eller utdanning for å generere en god CV.',
        [
          { text: uiLanguage === 'en' ? 'Cancel' : 'Avbryt', style: 'cancel' },
          { text: uiLanguage === 'en' ? 'Go to Profile' : 'Gå til Profil', onPress: () => setActiveTab('profile') },
        ]
      );
      return;
    }

    if (!jobUrl) {
      Alert.alert('Feil', 'Lim inn jobbannonse først.');
      return;
    }

    if (generationLockRef.current || isGenerating) return;

    // Confirm before overwriting an existing CV in the selected language
    if (analysis?.job_id) {
      const alreadyExists = cvLanguage === 'en'
        ? analysis?.has_tailored_cv_en
        : analysis?.has_tailored_cv_no;
      if (alreadyExists) {
        const langLabel = cvLanguage === 'en'
          ? (uiLanguage === 'en' ? 'English' : 'engelsk')
          : (uiLanguage === 'en' ? 'Norwegian' : 'norsk');
        const confirmed = await new Promise(resolve => {
          Alert.alert(
            uiLanguage === 'en' ? 'Regenerate CV?' : 'Generer ny CV?',
            uiLanguage === 'en'
              ? `You already have a CV in ${langLabel}. Generate a new one? This will replace the existing one.`
              : `Du har allerede en CV på ${langLabel}. Vil du generere en ny? Dette erstatter den eksisterende.`,
            [
              { text: uiLanguage === 'en' ? 'Cancel' : 'Avbryt', style: 'cancel', onPress: () => resolve(false) },
              { text: uiLanguage === 'en' ? 'Generate new' : 'Generer ny', onPress: () => resolve(true) },
            ]
          );
        });
        if (!confirmed) return;
      }
    }

    await flushAutoSave?.();
    generationLockRef.current = true;
    setIsGenerating(true);
    logEvent('generate_cv_started', { language: cvLanguage, template: cvTemplate });
    logEvent(cvLanguage === 'en' ? 'cv_language_english' : 'cv_language_norwegian');
    logEvent('cv_template_' + cvTemplate);

    const prevPackage = applicationPackage;
    const failMsg = (uiLanguage === 'en') ? 'Generation failed, try again' : 'Generering feilet, prøv igjen';
    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;

    setGeneratingPdf(true);
    setGenerationBanner('');
    setStreamingProgress('');
    setApplicationPackage(null);
    setTailoredCvJobTitle('');

    try {
      let pkg;
      if (analysis?.job_id) {
        const streamUrl = `${API}/job-analyses/${analysis.job_id}/stream-documents?profile_id=${profileId}&application_style=${encodeURIComponent(applicationStyle)}&include_photo=${includePhoto}&language=${cvLanguage}`;
        const resp = await fetch(streamUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authTokenState}` },
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
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
            url: jobUrl,
            application_style: applicationStyle,
            include_photo: includePhoto,
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
          setApplicationPackage(safePkg);
          logEvent('generate_cv_completed');
          if (analysis?.job_id) {
            setTailoredCvJobTitle(analysis?.job_title || 'denne stillingen');
            if (pkg.cvMal) setCvTemplate(pkg.cvMal);
            // Update local analysis flags so badges reflect the new language immediately
            const flagKey = cvLanguage === 'en' ? 'has_tailored_cv_en' : 'has_tailored_cv_no';
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
      if (prevPackage) setApplicationPackage(prevPackage);
      setGenerationBanner(failMsg);
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
      setGenerationBanner(uiLanguage === 'en' ? 'Could not switch template, try again.' : 'Kunne ikke bytte mal, prøv igjen.');
    } finally {
      setIsGenerating(false);
      generationLockRef.current = false;
    }
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
      Alert.alert('Feil', String(e));
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
      Alert.alert('Feil', String(e));
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
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen før CV-analyse');
      return;
    }

    await flushAutoSave?.();
    setCvLoading(true);
    try {
      const data = await apiFetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId }),
      });

      setCvAnalysis(data);
      setActiveTab('cv');
    } catch (e) {
      Alert.alert('Feil', errText(e));
    }
    setCvLoading(false);
  }

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------
  return {
    // Analysis state
    jobUrl, setJobUrl,
    analysis, setAnalysis,
    tailoredCvJobTitle, setTailoredCvJobTitle,
    cvTemplate, setCvTemplate,
    cvLanguage, setCvLanguage,
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
    loadApplications,
    updateApplicationProgress,
    loadDocuments,
    openDocument,
    analyzeCv,
  };
}
