import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Animated,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
  Platform,
  Linking,
  Switch,
} from 'react-native';

import { THEME } from './styles/theme';
import { styles } from './styles/styles';
import { INTERVIEW_QUESTIONS, CAREER_TIPS } from './constants/content';
import { schoolOptions, languageOptions } from './constants/options';
import InterviewScreen from './screens/InterviewScreen';
import { AppProvider, useApp, apiFetch, API } from './context/AppContext';
import useProfile, { PRIVACY_URL } from './hooks/useProfile';
import useJobAnalysis from './hooks/useJobAnalysis';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import DocumentsScreen from './screens/DocumentsScreen';
import NewJobScreen from './screens/NewJobScreen';
import CvAnalysisScreen from './screens/CvAnalysisScreen';
import SettingsScreen from './screens/SettingsScreen';
import AnalysisScreen from './screens/AnalysisScreen';

const TIP_REFRESH_MS = 4 * 60 * 60 * 1000; // Rotate career tip every 4 hours


function AppContent() {
  // Ref bridge: lets useProfile.onProfileSaved read latest analysis/jobUrl
  // without a circular hook dependency
  const profileSavedCbRef = useRef(null);

  const {
    authReady, authTokenState, userId,
    authEmail, setAuthEmail,
    authCode, setAuthCode,
    codeSent, setCodeSent,
    resendCooldown, setResendCooldown,
    authLoading,
    uiLanguage, setUiLanguage,
    activeTab, setActiveTab,
    showOnboarding, setShowOnboarding,
    showFaq, setShowFaq,
    faqOpenIndex, setFaqOpenIndex,
    doAuth, logout, deleteAccount,
    logEvent, errText,
    setAndPersistUiLanguage, t,
  } = useApp();

  const {
    profileId, setProfileId,
    name, setName,
    profileEmail, setProfileEmail,
    phone, setPhone,
    address, setAddress,
    postalCode, setPostalCode,
    postalPlace, setPostalPlace,
    profilePhotoData, setProfilePhotoData,
    includePhotoDefault, setIncludePhotoDefault,
    includePhotoInPdf, setIncludePhotoInPdf,
    profilePhoto,
    profileStrength,
    skills, setSkills,
    skillInput, setSkillInput,
    skillsItems, setSkillsItems,
    consentAnalytics, setConsentAnalytics,
    languagesList, setLanguagesList,
    customLanguageInput, setCustomLanguageInput,
    cvGapsList, setCvGapsList,
    savingProfile,
    autoSaveStatus,
    showLanguageList, setShowLanguageList,
    showSchoolListIndex, setShowSchoolListIndex,
    schoolFilter, setSchoolFilter,
    schoolKindFilter, setSchoolKindFilter,
    schoolResults,
    schoolResultsLoading,
    experienceEntries, setExperienceEntries,
    educationEntries, setEducationEntries,
    referenceEntries, setReferenceEntries,
    editExperience, setEditExperience,
    editEducation, setEditEducation,
    editingExperienceIndex, setEditingExperienceIndex,
    editingEducationIndex, setEditingEducationIndex,
    editingLanguageIndex, setEditingLanguageIndex,
    editingGapIndex, setEditingGapIndex,
    editingReferenceIndex, setEditingReferenceIndex,
    expandPersonCard, setExpandPersonCard,
    expandExpCard, setExpandExpCard,
    expandEduCard, setExpandEduCard,
    expandLangCard, setExpandLangCard,
    expandGapsCard, setExpandGapsCard,
    expandRefCard, setExpandRefCard,
    expandDocsCard, setExpandDocsCard,
    expandSkillsCard, setExpandSkillsCard,
    cvImportModalVisible, setCvImportModalVisible,
    cvImportLoading,
    cvImportPreview, setCvImportPreview,
    profileDocsList, setProfileDocsList,
    docsUploading,
    showDocTypeModal, setShowDocTypeModal,
    pendingDocFile, setPendingDocFile,
    DOC_TYPES,
    loadProfileDocuments,
    dismissOnboarding,
    importCvFromFile,
    importCvFromCamera,
    importCvFromGallery,
    applyCvImport,
    saveProfile,
    flushAutoSave,
    pickAndUploadDocument,
    deleteProfileDocument,
    openDocumentPicker,
    pickProfilePhoto,
    isProfileTooEmpty,
    resetProfile,
  } = useProfile({
    onProfileSaved: () => { if (profileSavedCbRef.current) profileSavedCbRef.current(); },
  });

  const {
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
    appSortOrder, setAppSortOrder,
    applicationStyle, setApplicationStyle,
    applicationEmail, setApplicationEmail,
    applicationPackage, setApplicationPackage,
    sending,
    generatingPdf,
    streamingProgress,
    isGenerating,
    generationBanner, setGenerationBanner,
    generationLockRef,
    applications, setApplications,
    applicationsLoading,
    statsMe, setStatsMe,
    documents,
    documentsLoading,
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
  } = useJobAnalysis({
    profileId,
    profileEmail,
    profilePhotoData,
    includePhotoInPdf,
    includePhotoDefault,
    setIncludePhotoInPdf,
    isProfileTooEmpty,
    flushAutoSave,
  });

  // Keep profileSavedCbRef in sync with current analysis/jobUrl values
  profileSavedCbRef.current = () => {
    if (analysis && jobUrl) setProfileUpdatedSinceAnalysis(true);
  };

  // Reset interview state on logout (profile/analysis reset in their own hooks)
  useEffect(() => {
    if (authTokenState !== null) return;
    setInterviewIndex(0);
    setInterviewNotes({});
    setInterviewMessages([]);
    setInterviewDraft('');
    setInterviewLoading(false);
    setInterviewError('');
    setInterviewStarted(false);
  }, [authTokenState]); // eslint-disable-line react-hooks/exhaustive-deps




  const [notificationEmail, setNotificationEmail] = useState('');
  const [autoEmail, setAutoEmail] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [adminStats, setAdminStats] = useState(null);
  const [adminStatsLoading, setAdminStatsLoading] = useState(false);

  const [interviewIndex, setInterviewIndex] = useState(0);
  const [interviewNotes, setInterviewNotes] = useState({});

  // AI-intervju v2 (ekte samtale)
  const [interviewMessages, setInterviewMessages] = useState([]);
  const [interviewDraft, setInterviewDraft] = useState('');
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewError, setInterviewError] = useState('');
  const [interviewStarted, setInterviewStarted] = useState(false);

  const mascotAnim = useRef(new Animated.Value(0)).current;

  // Pre-fill application email from profile when not manually set

  async function refreshCareerTip({ force = false } = {}) {
    const tips = CAREER_TIPS.no;
    const now = Date.now();
    const kAt = 'careerTip:lastAt:no';
    const kText = 'careerTip:lastText:no';

    try {
      const lastAt = parseInt((await AsyncStorage.getItem(kAt)) || '0', 10) || 0;
      const lastText = (await AsyncStorage.getItem(kText)) || '';

      if (!force && lastText && (now - lastAt) < TIP_REFRESH_MS) {
        setTipText(lastText);
        return;
      }

      let next = tips[Math.floor(Math.random() * tips.length)] || tips[0] || '';
      if (tips.length > 1 && lastText) {
        let tries = 0;
        while (next === lastText && tries < 10) {
          next = tips[Math.floor(Math.random() * tips.length)] || tips[0] || '';
          tries += 1;
        }
      }

      if (next) {
        setTipText(next);
        await AsyncStorage.setItem(kText, next);
        await AsyncStorage.setItem(kAt, String(now));
      }
    } catch (e) {
      // Fallback: keep an always-present tip.
      setTipText((tips && tips[0]) ? tips[0] : 'Skriv søknaden for arbeidsgiveren, ikke for deg selv.');
    }
  }



  useEffect(() => {
    if (activeTab !== 'home') return;

    mascotAnim.setValue(0);

    // Rotate the career tip occasionally (persisted). This runs when you enter Home.
    refreshCareerTip();

    const mascotLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(mascotAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(mascotAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
      { resetBeforeIteration: true }
    );

    mascotLoop.start();

    return () => {
      mascotLoop.stop();
    };
  }, [activeTab, mascotAnim]);

  useEffect(() => {
    if (activeTab !== 'home') return;
    refreshCareerTip({ force: true });
  }, [uiLanguage]);

  // Load dashboard stats silently when home tab is shown
  useEffect(() => {
    if (activeTab !== 'home') return;
    if (!profileId) return;
    loadJobAnalyses({ silent: true });
    loadApplications();
  }, [activeTab, profileId]);












  // Når brukeren ikke redigerer utdanning, skjul evt. åpen skole-dropdown.

  // Hvis brukeren bytter hvilken utdanning som redigeres, lukk skole-dropdown.










  // Autosave: debounce 2s after any profile field changes

  // Flush pending autosave when navigating away from profile

  // Pre-fill application email from profile when not manually set




















  async function loadSettings() {
    setSettingsLoading(true);
    try {
      const s = await apiFetch('/settings');
      setNotificationEmail(s?.notification_email || '');
      setAutoEmail(s?.auto_email !== false);
    } catch (e) {
      if (__DEV__) console.log('Kunne ikke laste settings:', e);
    }
    setSettingsLoading(false);
  }

  async function saveSettings() {
    setSettingsSaving(true);
    try {
      const saved = await apiFetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_email: notificationEmail, auto_email: autoEmail }),
      });

      setNotificationEmail(saved?.notification_email || '');
      setAutoEmail(saved?.auto_email !== false);

      Alert.alert('Lagret', 'E-postinnstillinger er lagret.');
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
    setSettingsSaving(false);
  }

  useEffect(() => {
    if (activeTab !== 'settings') return;
    loadSettings();
  }, [activeTab]);

  const actionButtons = [
    {
      key: 'cv',
      title: 'Analyser CV',
      subtitle: 'Se hvilke jobber du bør søke på og få konkrete råd.',
      tint: THEME.colors.primarySoft,
      icon: '📄',
      onPress: () => setActiveTab('cv'),
    },
    {
      key: 'new',
      title: 'Analyser annonse',
      subtitle: 'Se match mot en jobbannonse.',
      tint: THEME.colors.primarySoft,
      icon: '🎯',
      onPress: () => setActiveTab('new'),
    },
    {
      key: 'applications',
      title: 'Søknadsstatus',
      subtitle: 'Hold oversikt og se om appen virker.',
      tint: THEME.colors.primarySoft,
      icon: '📬',
      onPress: () => setActiveTab('applications'),
    },
    {
      key: 'interview',
      title: t('interviewPractice'),
      subtitle: t('interviewPracticeSubtitle'),
      tint: THEME.colors.primarySoft,
      icon: '🎤',
      onPress: () => setActiveTab('interview'),
    },
  ];

  const progressItems = [
    { title: 'Fullfør profil', value: '90%', percent: 90, status: 'Sterk profil gir mer sjanse', tab: 'profile' },
    { title: 'Analyser CV', value: '—', percent: 60, status: 'Få konkrete råd og søkeord', tab: 'cv' },
    { title: 'Analyser annonse', value: '—', percent: 60, status: 'Lim inn URL for ærlig vurdering', tab: 'new' },
    { title: 'Søknadsstatus', value: '—', percent: 35, status: 'Oppdater status på søknader', tab: 'applications' },
  ];

  const FAQ_ITEMS = [
    {
      q: 'Hvordan kommer jeg i gang?',
      a: 'Start med å fylle ut profilen din — jo mer informasjon du legger inn, jo bedre blir CV og søknad. Deretter limer du inn en FINN.no-lenke på hjemskjermen og trykker \'Analyser jobb\'.',
    },
    {
      q: 'Hva er match-score?',
      a: 'Match-scoren viser hvor godt profilen din matcher kravene i jobbannonsen. Under 40% er svak match, 40–70% er god match, over 70% er sterk match.',
    },
    {
      q: 'Hvordan genererer jeg CV og søknad?',
      a: 'Analyser en jobb først, åpne analysen og trykk \'Generer CV og søknad\'. Appen lager dokumenter tilpasset nettopp denne stillingen basert på profilen din.',
    },
    {
      q: 'Hva er forskjellen på PDF og e-post?',
      a: 'Når du trykker \'Generer CV og søknad\' får du en PDF som inneholder både søknadstekst og CV samlet i ett dokument — praktisk for digital innsending. Vil du ha søknadsteksten og CV-en som separate dokumenter, bruker du \'Send til e-post\' — da mottar du søknadsbrevet og CV-en som to separate filer i innboksen din.',
    },
    {
      q: 'Kan jeg få CV-en på engelsk?',
      a: 'Ja — når du genererer CV velger du norsk eller engelsk. Søknadsbrevet følger samme språkvalg.',
    },
    {
      q: 'Hvordan fungerer intervjutreningen?',
      a: 'Åpne en jobbanalyse og trykk \'Intervju-øving\' der — intervjuet er tilpasset nettopp den stillingen du har analysert. Du får spørsmål én om gangen og kan svare ved å skrive eller snakke ved å trykke på mikrofon-knappen.',
    },
    {
      q: 'Hva lagres i appen?',
      a: 'Profilen din, CV-dokumenter, jobbanalyser og søknader lagres trygt og er tilgjengelige til du sletter kontoen. Se personvernerklæringen for detaljer.',
    },
    {
      q: 'Hvordan legger jeg til erfaring og utdanning?',
      a: 'Gå til Profil og trykk på \'Erfaring\' eller \'Utdanning\'-kortet for å ekspandere det. Trykk \'+ Legg til\' for å registrere en ny oppføring.',
    },
  ];


  const renderFaq = () => (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.50)', zIndex: 999,
      justifyContent: 'center', alignItems: 'center', padding: 20,
    }}>
      <View style={{
        backgroundColor: '#FFFFFF', borderRadius: 16,
        width: '100%', maxWidth: 460, maxHeight: '88%',
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 14,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 20, paddingVertical: 16,
          borderBottomWidth: 1, borderBottomColor: '#F0EDE8',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: '#FEF0EB', borderWidth: 1.5, borderColor: '#E8501A',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: '#E8501A', fontSize: 13, fontWeight: '700' }}>?</Text>
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1A1A2E' }}>Hjelp & FAQ</Text>
          </View>
          <TouchableOpacity
            onPress={() => { setShowFaq(false); setFaqOpenIndex(-1); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ fontSize: 18, color: '#9CA3AF', fontWeight: '400' }}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Scrollable FAQ list */}
        <ScrollView style={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {FAQ_ITEMS.map((item, i) => (
            <TouchableOpacity
              key={i}
              activeOpacity={0.7}
              onPress={() => setFaqOpenIndex(faqOpenIndex === i ? -1 : i)}
              style={{
                backgroundColor: '#FAFAF9',
                borderRadius: 10,
                borderWidth: 1,
                borderColor: '#EEEBE5',
                padding: 14,
                marginBottom: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: '#1A1A2E', lineHeight: 20 }}>
                  {item.q}
                </Text>
                <Text style={{ color: '#E8501A', fontSize: 12, marginTop: 3, fontWeight: '600' }}>
                  {faqOpenIndex === i ? '▲' : '▼'}
                </Text>
              </View>
              {faqOpenIndex === i && (
                <Text style={{ fontSize: 13, color: '#6B7280', lineHeight: 20.8, marginTop: 10, fontWeight: '400' }}>
                  {item.a}
                </Text>
              )}
            </TouchableOpacity>
          ))}
          <View style={{ height: 8 }} />
        </ScrollView>
      </View>
    </View>
  );

  const renderOnboarding = () => (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 999,
      justifyContent: 'center', alignItems: 'center', padding: 20,
    }}>
      <View style={{
        backgroundColor: '#F7F5F0', borderRadius: 16, padding: 28,
        width: '100%', maxWidth: 420,
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, elevation: 12,
      }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#0f172a', textAlign: 'center', marginBottom: 6 }}>
          Velkommen til Ærlig!
        </Text>
        <Text style={{ fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
          Din ærlige jobbcoach — her er hvordan du kommer i gang
        </Text>

        {[
          { icon: '🔗', text: 'Lim inn en jobbannonse-URL og få en ærlig match-score' },
          { icon: '📄', text: 'Generer CV og søknad tilpasset nettopp denne stillingen' },
          { icon: '🎙️', text: 'Øv på intervju før den virkelige samtalen' },
        ].map((step, i) => (
          <View key={i} style={{
            flexDirection: 'row', alignItems: 'flex-start', gap: 14,
            backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
            shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
          }}>
            <Text style={{ fontSize: 26 }}>{step.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: '#334155', lineHeight: 19 }}>{step.text}</Text>
            </View>
          </View>
        ))}

        <TouchableOpacity
          onPress={dismissOnboarding}
          style={{
            backgroundColor: '#E8501A', borderRadius: 10, paddingVertical: 14,
            alignItems: 'center', marginTop: 14,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Kom i gang</Text>
        </TouchableOpacity>
      </View>
    </View>
  );










  const renderInterview = () => (
    <InterviewScreen
      uiLanguage={uiLanguage}
      t={t}
      analysis={analysis}
      apiFetch={apiFetch}
      logEvent={logEvent}
      setActiveTab={setActiveTab}
      interviewMessages={interviewMessages}
      setInterviewMessages={setInterviewMessages}
      interviewDraft={interviewDraft}
      setInterviewDraft={setInterviewDraft}
      interviewLoading={interviewLoading}
      setInterviewLoading={setInterviewLoading}
      interviewError={interviewError}
      setInterviewError={setInterviewError}
      interviewStarted={interviewStarted}
      setInterviewStarted={setInterviewStarted}
      profileTooEmpty={isProfileTooEmpty()}
      styles={styles}
    />
  );







  const renderProfile = () => {
    const _initials = (name || '').trim().split(/\s+/).slice(0, 2).map((w) => (w[0] || '').toUpperCase()).join('');
    const _skillsList = skills ? skills.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let _strength = 0;
    if (name && name.trim() && name.trim() !== 'Ærlig JobbCoach') _strength += 10;
    if (profileEmail) _strength += 10;
    if (phone) _strength += 10;
    if (address) _strength += 10;
    if (profilePhotoData) _strength += 10;
    if (experienceEntries.length > 0) _strength += 20;
    if (educationEntries.length > 0) _strength += 15;
    if (_skillsList.length >= 3) _strength += 15;
    const _city = postalPlace || address || '—';
    const _visibleSkills = _skillsList.slice(0, 6);
    const _extraSkills = _skillsList.length - _visibleSkills.length;

    return (
    <View style={[styles.aerligHomeWrap, { backgroundColor: '#F7F5F0' }]}>
      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>Profil</Text>
        <Text style={styles.aerligPageSubtitle}>Personopplysninger, erfaring og referanser.</Text>

        {/* CV Import */}
        <TouchableOpacity
          style={[styles.aerligSecondaryButton, { marginBottom: 16, marginTop: 4 }]}
          onPress={() => setCvImportModalVisible(true)}
          disabled={cvImportLoading}
        >
          {cvImportLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={THEME.colors.primary} />
              <Text style={styles.aerligSecondaryButtonText}>Leser CV-en din...</Text>
            </View>
          ) : (
            <Text style={styles.aerligSecondaryButtonText}>Importer CV</Text>
          )}
        </TouchableOpacity>

        {/* Import source picker modal */}
        {cvImportModalVisible && <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setCvImportModalVisible(false)}
        >
          <View style={styles.cvModalOverlay}>
            <View style={styles.cvModalCard}>
              <Text style={styles.cvModalTitle}>Importer CV</Text>
              <Text style={styles.cvModalSubtitle}>Velg kilde</Text>
              <TouchableOpacity style={styles.aerligSecondaryButton} onPress={importCvFromFile}>
                <Text style={styles.aerligSecondaryButtonText}>Velg fil (PDF eller .docx)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 10 }]} onPress={importCvFromCamera}>
                <Text style={styles.aerligSecondaryButtonText}>Ta bilde av CV (kamera)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 10 }]} onPress={importCvFromGallery}>
                <Text style={styles.aerligSecondaryButtonText}>Velg bilde fra galleri</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.aerligDangerButton, { marginTop: 16 }]}
                onPress={() => setCvImportModalVisible(false)}
              >
                <Text style={styles.aerligDangerButtonText}>Avbryt</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>}

        {/* CV import preview/confirm modal */}
        {cvImportPreview && (
          <Modal
            visible={!!cvImportPreview}
            transparent
            animationType="slide"
            onRequestClose={() => setCvImportPreview(null)}
          >
            <View style={styles.cvModalOverlay}>
              <View style={[styles.cvModalCard, { maxHeight: '80%' }]}>
                <ScrollView>
                  <Text style={styles.cvModalTitle}>Hva vi fant i CV-en</Text>

                  {[
                    ['Navn', cvImportPreview.name],
                    ['E-post', cvImportPreview.email],
                    ['Telefon', cvImportPreview.phone],
                    ['Adresse', cvImportPreview.address],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <View key={label} style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>{label}</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{value}</Text>
                    </View>
                  ))}

                  {Array.isArray(cvImportPreview.experience) && cvImportPreview.experience.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Erfaring ({cvImportPreview.experience.length} oppføringer)</Text>
                      {cvImportPreview.experience.map((e, i) => (
                        <View key={i} style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 8, marginTop: 4 }}>
                          <Text style={{ fontWeight: '600', fontSize: 13, color: '#111827' }}>{e.title || '—'}</Text>
                          <Text style={{ fontSize: 13, color: '#6B7280' }}>{e.company || ''}{e.from ? ` · ${e.from}–${e.current ? 'nå' : (e.to || '?')}` : ''}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {Array.isArray(cvImportPreview.education) && cvImportPreview.education.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Utdanning ({cvImportPreview.education.length} oppføringer)</Text>
                      {cvImportPreview.education.map((e, i) => (
                        <View key={i} style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 8, marginTop: 4 }}>
                          <Text style={{ fontWeight: '600', fontSize: 13, color: '#111827' }}>{e.degree || '—'}</Text>
                          <Text style={{ fontSize: 13, color: '#6B7280' }}>{e.school || ''}{e.from ? ` · ${e.from}–${e.to || '?'}` : ''}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {Array.isArray(cvImportPreview.skills) && cvImportPreview.skills.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Ferdigheter</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{cvImportPreview.skills.join(', ')}</Text>
                    </View>
                  )}

                  {Array.isArray(cvImportPreview.languages) && cvImportPreview.languages.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Språk</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{cvImportPreview.languages.join(', ')}</Text>
                    </View>
                  )}

                  <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 8 }]}>
                    Felter som allerede er fylt ut i profilen din vil ikke bli overskrevet.
                  </Text>
                </ScrollView>
                <TouchableOpacity
                  style={[styles.aerligPrimaryButton, { marginTop: 16 }]}
                  onPress={() => applyCvImport(cvImportPreview)}
                >
                  <Text style={styles.aerligPrimaryButtonText}>Importer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.aerligDangerButton, { marginTop: 10 }]}
                  onPress={() => setCvImportPreview(null)}
                >
                  <Text style={styles.aerligDangerButtonText}>Avbryt</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* Variant C: profile summary header */}
        <View style={styles.profileSummaryHeader}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{_initials || '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileSummaryName}>{name || 'Navn'}</Text>
            <Text style={styles.profileSummaryStrengthLabel}>Profilstyrke: {_strength}%</Text>
            <View style={styles.profileStrengthTrack}>
              <View style={[styles.profileStrengthFill, { width: `${_strength}%` }]} />
            </View>
          </View>
        </View>

        {/* 2-col row: phone + location */}
        <View style={styles.profileCardRow}>
          <View style={styles.profileSummaryCard}>
            <Text style={styles.profileCardIcon}>📱</Text>
            <Text style={styles.profileCardLabel}>Telefon</Text>
            <Text style={styles.profileCardValue} numberOfLines={1}>{phone || '—'}</Text>
          </View>
          <View style={styles.profileSummaryCard}>
            <Text style={styles.profileCardIcon}>📍</Text>
            <Text style={styles.profileCardLabel}>Sted</Text>
            <Text style={styles.profileCardValue} numberOfLines={1}>{_city}</Text>
          </View>
        </View>

        {/* Personopplysninger accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandPersonCard((v) => !v)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>👤</Text>
              <View>
                <Text style={styles.profileCardLabel}>Personopplysninger</Text>
                <Text style={styles.profileCardValue} numberOfLines={1}>{name || 'Ikke utfylt'}</Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandPersonCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandPersonCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Navn</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={name} onChangeText={setName} placeholder="Navn" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>E-post</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={profileEmail} onChangeText={setProfileEmail} placeholder="E-post" autoCapitalize="none" keyboardType="email-address" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Telefon</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={phone} onChangeText={setPhone} placeholder="Telefon" keyboardType="phone-pad" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Adresse</Text>
              <TextInput
                style={[styles.input, styles.aerligInput]}
                value={address}
                onChangeText={setAddress}
                placeholder="Gateadresse"
                autoCapitalize="words"
              />

              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.aerligInput, styles.inlineInput]}
                  value={postalCode}
                  onChangeText={setPostalCode}
                  placeholder="Postnr"
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.aerligInput, styles.inlineInput, { marginRight: 0 }]}
                  value={postalPlace}
                  onChangeText={setPostalPlace}
                  placeholder="Poststed"
                  autoCapitalize="words"
                />
              </View>

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Profilbilde (valgfritt)</Text>
              {profilePhotoData ? (
                <View style={{ alignItems: 'center', marginBottom: 10 }}>
                  <Image
                    source={{ uri: profilePhotoData }}
                    style={{ width: 110, height: 110, borderRadius: 16, marginBottom: 10 }}
                  />
                  <TouchableOpacity
                    style={[styles.aerligSecondaryButton, { marginTop: 0, paddingVertical: 12, width: '100%' }]}
                    onPress={() => {
                      setProfilePhotoData('');
                      if (profileId) saveProfile({ silent: true, override: { photo_data: '' } });
                    }}
                  >
                    <Text style={styles.aerligSecondaryButtonText}>Fjern bilde</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 0, paddingVertical: 12 }]} onPress={pickProfilePhoto}>
                <Text style={styles.aerligSecondaryButtonText}>{profilePhotoData ? 'Bytt bilde' : 'Velg bilde'}</Text>
              </TouchableOpacity>
              <Text style={[styles.helpText, styles.aerligHelpText]}>Du kan velge om bildet skal være med i hver PDF når du lager søknad.</Text>
              {profilePhotoData ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.inputLabel, styles.aerligLabel]}>Bilde i PDF som standard</Text>
                  <Text style={[styles.helpText, styles.aerligHelpText]}>Dette blir standardvalget hver gang du lager ny søknad/PDF (kan overstyres per søknad).</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.messageText, styles.aerligMessageText]}>{includePhotoDefault ? 'På' : 'Av'}</Text>
                    <Switch
                      value={includePhotoDefault}
                      onValueChange={(v) => {
                        setIncludePhotoDefault(!!v);
                        setIncludePhotoInPdf(!!v);
                        if (profileId) saveProfile({ silent: true, override: { include_photo_default: !!v } });
                      }}
                    />
                  </View>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.aerligPrimaryButton, { marginTop: 16 }]}
                onPress={() => { setExpandPersonCard(false); saveProfile(); }}
              >
                <Text style={styles.aerligPrimaryButtonText}>Lagre</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Experience accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandExpCard((v) => {
              const next = !v;
              if (!next) setEditingExperienceIndex(-1);
              return next;
            })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>💼</Text>
              <View>
                <Text style={styles.profileCardLabel}>Erfaring</Text>
                <Text style={styles.profileCardValue}>
                  {experienceEntries.length > 0 ? `${experienceEntries.length} stilling${experienceEntries.length === 1 ? '' : 'er'}` : 'Ingen lagt til'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandExpCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandExpCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              {experienceEntries.map((entry, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{entry.title || 'Stillingstittel'}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{entry.company || 'Arbeidsgiver'}</Text>
                    </View>
                    <Text style={styles.aerligEntryYears} numberOfLines={1}>
                      {`${(entry.from || '—').trim() || '—'}–${entry.current ? 'nå' : (((entry.to || '—').trim()) || '—')}`}
                    </Text>
                  </View>

                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingExperienceIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingExperienceIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setExperienceEntries((prev) => (prev || []).filter((_, i) => i !== index));
                        setEditingExperienceIndex((cur) => {
                          if (cur === index) return -1;
                          if (cur > index) return cur - 1;
                          return cur;
                        });
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>

                  {editingExperienceIndex === index ? (
                    <>
                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 8 }]}
                          value={entry.title}
                          placeholder="Stillingstittel"
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].title = value;
                            setExperienceEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 0 }]}
                          value={entry.company}
                          placeholder="Arbeidsgiver"
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].company = value;
                            setExperienceEntries(items);
                          }}
                        />
                      </View>

                      <View style={[styles.aerligEntryEditRow, { alignItems: 'center', marginBottom: 8 }]}>
                        <TouchableOpacity
                          style={[styles.checkbox, styles.aerligCheckbox, { marginLeft: 0 }, entry.current && styles.aerligCheckboxOn]}
                          onPress={() => {
                            const items = [...experienceEntries];
                            const next = !items[index].current;
                            items[index].current = next;
                            if (next) items[index].to = '';
                            setExperienceEntries(items);
                          }}
                        >
                          <Text style={[styles.checkboxText, styles.aerligCheckboxText, entry.current && styles.aerligCheckboxTextOn]}>{entry.current ? '✓' : ''}</Text>
                        </TouchableOpacity>
                        <Text style={styles.aerligInlineNote}>Jobber her fremdeles</Text>
                      </View>

                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                          value={entry.from || ''}
                          placeholder="Fra (år/mnd)"
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].from = value;
                            setExperienceEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0 }, entry.current && { opacity: 0.6 }]}
                          value={entry.current ? 'Nå' : (entry.to || '')}
                          placeholder={entry.current ? 'Nå' : 'Til (år/mnd)'}
                          editable={!entry.current}
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].to = value;
                            setExperienceEntries(items);
                          }}
                        />
                      </View>
                    </>
                  ) : null}
                </View>
              ))}

              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...(experienceEntries || []), { title: '', company: '', from: '', to: '', current: false }];
                  setExperienceEntries(next);
                  setEditingExperienceIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til erfaring</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Education accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandEduCard((v) => {
              const next = !v;
              if (!next) {
                setEditingEducationIndex(-1);
                setShowSchoolListIndex(-1);
                setSchoolFilter('');
              }
              return next;
            })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>🎓</Text>
              <View>
                <Text style={styles.profileCardLabel}>Utdanning</Text>
                <Text style={styles.profileCardValue}>
                  {educationEntries.length > 0 ? `${educationEntries.length} grad${educationEntries.length === 1 ? '' : 'er'}` : 'Ingen lagt til'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandEduCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandEduCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              {educationEntries.map((entry, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{entry.school || 'Skole'}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{entry.degree || 'Studie/program'}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.aerligEntryYears} numberOfLines={1}>
                        {entry.status === 'pagaende'
                          ? `${(entry.from || '—').trim() || '—'}–pågår`
                          : `${(entry.from || '—').trim() || '—'}–${((entry.to || '—').trim()) || '—'}`}
                      </Text>
                      {entry.status === 'pagaende'
                        ? <Text style={{ fontSize: 10, color: '#E8501A', fontWeight: '600', marginTop: 1 }}>Pågående</Text>
                        : <Text style={{ fontSize: 10, color: '#16a34a', fontWeight: '600', marginTop: 1 }}>Fullført</Text>
                      }
                    </View>
                  </View>

                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => {
                        setEditingEducationIndex((cur) => (cur === index ? -1 : index));
                        setShowSchoolListIndex(-1);
                        setSchoolFilter('');
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingEducationIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setEducationEntries((prev) => (prev || []).filter((_, i) => i !== index));
                        setEditingEducationIndex((cur) => {
                          if (cur === index) return -1;
                          if (cur > index) return cur - 1;
                          return cur;
                        });
                        setShowSchoolListIndex((cur) => {
                          if (cur === index) return -1;
                          if (cur > index) return cur - 1;
                          return cur;
                        });
                        if (showSchoolListIndex === index) setSchoolFilter('');
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>

                  {editingEducationIndex === index ? (
                    <>
                      <View style={styles.aerligEntryEditRow}>
                        <TouchableOpacity
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 8 }]}
                          onPress={() => {
                            setShowSchoolListIndex(index);
                            setSchoolFilter('');
                            setSchoolKindFilter('all');
                            setSchoolResults([]);
                          }}
                        >
                          <Text style={entry.school ? styles.aerligInputText : styles.aerligPlaceholderText}>
                            {entry.school || 'Velg skole'}
                          </Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 0 }]}
                          value={entry.degree}
                          placeholder="Grad / studieretning"
                          onChangeText={(value) => {
                            const items = [...educationEntries];
                            items[index].degree = value;
                            setEducationEntries(items);
                          }}
                        />
                      </View>

                      {showSchoolListIndex === index && (
                        <View style={[styles.dropdownList, styles.aerligDropdownList]}>
                          <TextInput
                            style={[styles.input, styles.aerligInput, { margin: 8 }]}
                            placeholder="Søk: videregående, universitet eller nettskole..."
                            value={schoolFilter}
                            onChangeText={setSchoolFilter}
                            autoCapitalize="words"
                          />
                          <View style={[styles.filterChipRow, styles.aerligFilterChipRow]}>
                            {[
                              { key: 'all', label: 'Alle' },
                              { key: 'vgs', label: 'VGS' },
                              { key: 'universitet', label: 'Uni/høyskole' },
                              { key: 'nettskole', label: 'Nettskole' },
                            ].map((item) => {
                              const active = schoolKindFilter === item.key;
                              return (
                                <TouchableOpacity
                                  key={item.key}
                                  style={[styles.filterChip, styles.aerligFilterChip, active && styles.aerligFilterChipActive]}
                                  onPress={() => setSchoolKindFilter(item.key)}
                                >
                                  <Text style={[styles.filterChipText, styles.aerligFilterChipText, active && styles.aerligFilterChipTextActive]}>{item.label}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          {schoolFilter.trim().length < 2 ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>Skriv minst 2 bokstaver for forslag.</Text>
                          ) : null}
                          {schoolResultsLoading ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>Laster skoler...</Text>
                          ) : null}
                          {!schoolResultsLoading && schoolFilter.trim().length >= 2 && (
                            (schoolResults.length === 0 &&
                              schoolOptions.filter((s) => s.toLowerCase().includes(schoolFilter.toLowerCase())).length === 0)
                          ) ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>Ingen treff.</Text>
                          ) : null}
                          {(schoolFilter.trim().length >= 2
                            ? (schoolResults.length > 0
                                ? schoolResults
                                : schoolOptions
                                    .filter((s) => s.toLowerCase().includes(schoolFilter.toLowerCase()))
                                    .map((name) => ({ name, kind: 'lokal', kommune: null })))
                            : [])
                            .map((option) => (
                              <TouchableOpacity
                                key={option.name}
                                style={styles.dropdownItem}
                                onPress={() => {
                                  const items = [...educationEntries];
                                  items[index].school = option.name;
                                  setEducationEntries(items);
                                  setShowSchoolListIndex(-1);
                                  setSchoolFilter('');
                                }}
                              >
                                <Text style={[styles.dropdownItemText, styles.aerligDropdownItemText]}>{option.name}</Text>
                                {option.kind || option.kommune ? (
                                  <Text style={[styles.dropdownItemSub, styles.aerligDropdownItemSub]}>
                                    {[option.kind, option.kommune].filter(Boolean).join(' • ')}
                                  </Text>
                                ) : null}
                              </TouchableOpacity>
                            ))}
                        </View>
                      )}

                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                          value={entry.from}
                          placeholder="Fra (år/mnd)"
                          onChangeText={(value) => {
                            const items = [...educationEntries];
                            items[index].from = value;
                            setEducationEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0 }]}
                          value={entry.to}
                          placeholder="Til (år/mnd)"
                          editable={entry.status !== 'pagaende'}
                          onChangeText={(value) => {
                            const items = [...educationEntries];
                            items[index].to = value;
                            setEducationEntries(items);
                          }}
                        />
                      </View>

                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        {[
                          { key: 'fullfort', label: 'Fullført', activeColor: '#16a34a' },
                          { key: 'pagaende', label: 'Pågående', activeColor: '#E8501A' },
                        ].map(({ key, label, activeColor }) => {
                          const isActive = entry.status === key;
                          return (
                            <TouchableOpacity
                              key={key}
                              style={[styles.filterChip, styles.aerligFilterChip, isActive && { backgroundColor: activeColor, borderColor: activeColor }]}
                              onPress={() => {
                                const items = [...educationEntries];
                                items[index] = { ...items[index], status: key };
                                setEducationEntries(items);
                              }}
                            >
                              <Text style={[styles.filterChipText, styles.aerligFilterChipText, isActive && { color: '#FFFFFF' }]}>{label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  ) : null}
                </View>
              ))}

              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...(educationEntries || []), { school: '', degree: '', from: '', to: '', status: 'fullfort' }];
                  setEducationEntries(next);
                  setEditingEducationIndex(next.length - 1);
                  setShowSchoolListIndex(-1);
                  setSchoolFilter('');
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til utdanning</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Skills card with inline edit */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 20 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: _skillsList.length > 0 ? 8 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>⚡</Text>
              <Text style={[styles.profileCardLabel, { marginBottom: 0 }]}>Ferdigheter</Text>
            </View>
            <TouchableOpacity onPress={() => setExpandSkillsCard((v) => !v)}>
              <Text style={{ fontSize: 12, color: '#E8501A', fontWeight: '500' }}>{expandSkillsCard ? 'Lukk' : 'Rediger'}</Text>
            </TouchableOpacity>
          </View>
          {_skillsList.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: expandSkillsCard ? 12 : 0 }}>
              {_visibleSkills.map((s, i) => (
                <View key={i} style={styles.profileSkillChip}>
                  <Text style={styles.profileSkillChipText}>{s}</Text>
                </View>
              ))}
              {_extraSkills > 0 && (
                <View style={[styles.profileSkillChip, styles.profileSkillChipExtra]}>
                  <Text style={[styles.profileSkillChipText, { color: '#6B7280' }]}>+{_extraSkills} til</Text>
                </View>
              )}
            </View>
          )}
          {expandSkillsCard && (
            <View>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {skillsItems.map((item, i) => (
                  <TouchableOpacity
                    key={`${item}-${i}`}
                    style={[styles.profileSkillChip, { flexDirection: 'row', alignItems: 'center' }]}
                    onPress={() => setSkillsItems(skillsItems.filter((_, idx) => idx !== i))}
                  >
                    <Text style={styles.profileSkillChipText}>{item} ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.input, styles.aerligInput, { flex: 1, marginBottom: 0 }]}
                  value={skillInput}
                  onChangeText={setSkillInput}
                  placeholder="Ny ferdighet"
                  autoCapitalize="sentences"
                />
                <TouchableOpacity
                  style={[styles.aerligSecondaryButton, { marginTop: 0, paddingHorizontal: 16 }]}
                  onPress={() => {
                    const v = String(skillInput || '').trim();
                    if (!v) return;
                    const exists = skillsItems.some((it) => String(it).toLowerCase() === v.toLowerCase());
                    if (!exists) setSkillsItems([...skillsItems, v]);
                    setSkillInput('');
                  }}
                >
                  <Text style={styles.aerligSecondaryButtonText}>Legg til</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Språk accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandLangCard((v) => { const n = !v; if (!n) setEditingLanguageIndex(-1); return n; })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>🗣️</Text>
              <View>
                <Text style={styles.profileCardLabel}>Språk</Text>
                <Text style={styles.profileCardValue}>
                  {languagesList.length > 0 ? `${languagesList.length} språk` : 'Ikke utfylt'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandLangCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandLangCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              {languagesList.map((lang, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{lang.name || 'Språk'}</Text>
                      {lang.level ? <Text style={styles.aerligEntrySub} numberOfLines={1}>{lang.level}</Text> : null}
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingLanguageIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingLanguageIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setLanguagesList((prev) => prev.filter((_, i) => i !== index));
                        setEditingLanguageIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                  {editingLanguageIndex === index && (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={lang.name}
                        placeholder="Språk (f.eks. Norsk)"
                        autoCapitalize="words"
                        onChangeText={(v) => {
                          const items = [...languagesList];
                          items[index] = { ...items[index], name: v };
                          setLanguagesList(items);
                        }}
                      />
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {['Nybegynner', 'Grunnleggende', 'Godt', 'Flytende', 'Morsmål'].map((lvl) => (
                          <TouchableOpacity
                            key={lvl}
                            style={[styles.filterChip, styles.aerligFilterChip, lang.level === lvl && styles.aerligFilterChipActive]}
                            onPress={() => {
                              const items = [...languagesList];
                              items[index] = { ...items[index], level: lang.level === lvl ? '' : lvl };
                              setLanguagesList(items);
                            }}
                          >
                            <Text style={[styles.filterChipText, styles.aerligFilterChipText, lang.level === lvl && styles.aerligFilterChipTextActive]}>{lvl}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...languagesList, { name: '', level: '' }];
                  setLanguagesList(next);
                  setEditingLanguageIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til språk</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Hull i CV accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandGapsCard((v) => { const n = !v; if (!n) setEditingGapIndex(-1); return n; })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>📅</Text>
              <View>
                <Text style={styles.profileCardLabel}>Hull i CV</Text>
                <Text style={styles.profileCardValue}>
                  {cvGapsList.length > 0 ? `${cvGapsList.length} periode${cvGapsList.length === 1 ? '' : 'r'}` : 'Ingen registrert'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandGapsCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandGapsCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 8 }} />
              <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 12 }]}>
                Hull i CV brukes til å forklare perioder uten arbeidserfaring i søknaden din.
              </Text>
              {cvGapsList.map((gap, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>
                        {gap.from ? (gap.to ? `${gap.from}–${gap.to}` : gap.from) : 'Periode'}
                      </Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={2}>{gap.description || 'Forklaring'}</Text>
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingGapIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingGapIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setCvGapsList((prev) => prev.filter((_, i) => i !== index));
                        setEditingGapIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                  {editingGapIndex === index && (
                    <View style={styles.aerligEntryEditRow}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                        value={gap.from}
                        placeholder="Fra (år)"
                        keyboardType="numeric"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], from: v }; setCvGapsList(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                        value={gap.to}
                        placeholder="Til (år)"
                        keyboardType="numeric"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], to: v }; setCvGapsList(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0, flex: 2 }]}
                        value={gap.description}
                        placeholder="Forklaring"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], description: v }; setCvGapsList(items); }}
                      />
                    </View>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...cvGapsList, { from: '', to: '', description: '' }];
                  setCvGapsList(next);
                  setEditingGapIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til periode</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Referanser accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandRefCard((v) => { const n = !v; if (!n) setEditingReferenceIndex(-1); return n; })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>👥</Text>
              <View>
                <Text style={styles.profileCardLabel}>Referanser</Text>
                <Text style={styles.profileCardValue}>
                  {referenceEntries.length > 0 ? `${referenceEntries.length} referanse${referenceEntries.length === 1 ? '' : 'r'}` : 'Ikke utfylt'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandRefCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandRefCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 8 }} />
              <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 12 }]}>
                Referanser kan inkluderes automatisk i søknaden din.
              </Text>
              {referenceEntries.map((ref, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{ref.name || 'Navn'}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{ref.relation || ref.title || ''}</Text>
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingReferenceIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingReferenceIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setReferenceEntries((prev) => prev.filter((_, i) => i !== index));
                        setEditingReferenceIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                  {editingReferenceIndex === index && (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.name}
                        placeholder="Navn"
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], name: v }; setReferenceEntries(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.relation || ''}
                        placeholder="Stilling / tittel (f.eks. Leder i X)"
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], relation: v }; setReferenceEntries(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.contact || ''}
                        placeholder="Telefon eller e-post"
                        autoCapitalize="none"
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], contact: v }; setReferenceEntries(items); }}
                      />
                    </View>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...(referenceEntries || []), { name: '', relation: '', contact: '' }];
                  setReferenceEntries(next);
                  setEditingReferenceIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til referanse</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Dokumenter accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandDocsCard((v) => !v)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>📄</Text>
              <View>
                <Text style={styles.profileCardLabel}>Dokumenter</Text>
                <Text style={styles.profileCardValue}>
                  {profileDocsList.length > 0 ? `${profileDocsList.length} dokument${profileDocsList.length === 1 ? '' : 'er'}` : 'Ingen opplastet'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandDocsCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandDocsCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 8 }} />
              <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 12 }]}>
                Last opp fagbrev, kursbevis, karakterutskrifter og lignende. Teksten brukes automatisk når AI-en lager søknadsbrev og CV.
              </Text>
              {profileDocsList.map((doc) => (
                <View key={doc.id} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{doc.filename}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{doc.document_type}</Text>
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => deleteProfileDocument(doc.id)}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton, docsUploading && { opacity: 0.5 }]}
                onPress={openDocumentPicker}
                disabled={docsUploading}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>
                  {docsUploading ? 'Laster opp...' : '+ Last opp dokument'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {showDocTypeModal && (
          <Modal visible transparent animationType="fade" onRequestClose={() => { setShowDocTypeModal(false); setPendingDocFile(null); }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <View style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360 }}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 16 }}>Velg dokumenttype</Text>
                {DOC_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.aerligPrimaryButton, { marginBottom: 10 }]}
                    onPress={() => pickAndUploadDocument(type)}
                  >
                    <Text style={styles.aerligPrimaryButtonText}>{type}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.aerligSecondaryButton}
                  onPress={() => { setShowDocTypeModal(false); setPendingDocFile(null); }}
                >
                  <Text style={styles.aerligSecondaryButtonText}>Avbryt</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Anonym statistikk</Text>
          <Text style={[styles.helpText, styles.aerligHelpText]}>Hjelper oss å se om appen faktisk øker sjansen for intervju og jobb. Vi bruker kun status (søkt/intervju/fikk jobb), ikke navn eller kontaktinfo.</Text>
          <TouchableOpacity
            style={{ marginBottom: 10 }}
            onPress={async () => {
              try {
                await Linking.openURL(PRIVACY_URL);
              } catch (e) {
                Alert.alert('Lenke', PRIVACY_URL);
              }
            }}
          >
            <Text style={styles.aerligLinkText}>{t('privacyLink')}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.messageText, styles.aerligMessageText]}>{consentAnalytics ? 'På' : 'Av'}</Text>
            <Switch
              value={consentAnalytics}
              onValueChange={async (v) => {
                setConsentAnalytics(v);
                try {
                  await AsyncStorage.setItem('analyticsConsentPrompted', 'yes');
                } catch (e) {
                  // ignore
                }
                if (profileId) {
                  saveProfile({ silent: true, override: { consent_analytics: v } });
                }
              }}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={() => setActiveTab('documents')}>
          <Text style={styles.aerligSecondaryButtonText}>Dokumenter</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={() => setActiveTab('settings')}>
          <Text style={styles.aerligSecondaryButtonText}>E-postinnstillinger</Text>
        </TouchableOpacity>

        {/* Autosave status */}
        <View style={styles.autoSaveBar}>
          {autoSaveStatus === 'pending' && (
            <Text style={styles.autoSaveText}>Venter på lagring...</Text>
          )}
          {autoSaveStatus === 'saving' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator size="small" color={THEME.colors.primary} />
              <Text style={styles.autoSaveText}>Lagrer...</Text>
            </View>
          )}
          {autoSaveStatus === 'saved' && (
            <Text style={[styles.autoSaveText, { color: '#16a34a' }]}>Lagret ✓</Text>
          )}
          {autoSaveStatus === 'error' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[styles.autoSaveText, { color: '#dc2626' }]}>Kunne ikke lagre</Text>
              <TouchableOpacity onPress={saveProfileAuto}>
                <Text style={[styles.autoSaveText, { color: THEME.colors.primary, fontWeight: '600' }]}>Prøv igjen</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ marginTop: 32, gap: 12 }}>
          <TouchableOpacity
            style={[styles.aerligPrimaryButton, { width: '100%' }]}
            onPress={saveProfile}
          >
            <Text style={styles.aerligPrimaryButtonText}>{savingProfile ? 'Lagrer...' : 'Lagre nå'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              width: '100%',
              minHeight: 50,
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#FFFFFF',
              borderWidth: 1.5,
              borderColor: '#E8501A',
            }}
            onPress={logout}
          >
            <Text style={{ color: '#E8501A', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 }}>Logg ut</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ alignItems: 'center', paddingVertical: 12 }}
            onPress={deleteAccount}
          >
            <Text style={{ color: '#999999', fontSize: 13 }}>Slett konto og data</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
  };

  if (!authReady) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.pageCard}>
            <Text style={styles.pageTitle}>{t('loading')}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!authTokenState) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#F7F5F0' }]}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <AuthScreen />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {showFaq && renderFaq()}
      {showOnboarding && renderOnboarding()}
      {activeTab === 'interview' ? (
        renderInterview()
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {activeTab === 'home' && <HomeScreen
            profileId={profileId} name={name} profileEmail={profileEmail}
            skills={skills} phone={phone} experienceEntries={experienceEntries}
            jobAnalyses={jobAnalyses} analysis={analysis}
            applications={applications} statsMe={statsMe}
            openSavedAnalysis={openSavedAnalysis}
            tipText={tipText}
            adminStats={adminStats} adminStatsLoading={adminStatsLoading}
            setAdminStats={setAdminStats} setAdminStatsLoading={setAdminStatsLoading}
          />}
          {activeTab === 'cv' && <CvAnalysisScreen
            cvAnalysis={cvAnalysis} cvLoading={cvLoading} analyzeCv={analyzeCv}
          />}
          {activeTab === 'analysis' && <AnalysisScreen
            analysis={analysis} jobUrl={jobUrl} setJobUrl={setJobUrl}
            loading={loading} analyzeJob={analyzeJob}
            jobAnalyses={jobAnalyses} jobAnalysesLoading={jobAnalysesLoading}
            loadJobAnalyses={loadJobAnalyses}
            profileUpdatedSinceAnalysis={profileUpdatedSinceAnalysis}
            applicationStyle={applicationStyle} setApplicationStyle={setApplicationStyle}
            applicationEmail={applicationEmail} setApplicationEmail={setApplicationEmail}
            includePhotoInPdf={includePhotoInPdf} setIncludePhotoInPdf={setIncludePhotoInPdf}
            cvLanguage={cvLanguage} setCvLanguage={setCvLanguage}
            generationBanner={generationBanner} isGenerating={isGenerating}
            sending={sending} sendApplication={sendApplication}
            generatingPdf={generatingPdf} generatePdf={generatePdf}
            streamingProgress={streamingProgress}
            applicationPackage={applicationPackage}
            tailoredCvJobTitle={tailoredCvJobTitle} cvTemplate={cvTemplate}
            toggleFavoriteAnalysis={toggleFavoriteAnalysis}
            hideJobAnalysis={hideJobAnalysis}
            openSavedAnalysis={openSavedAnalysis}
            moveAnalysisToApplications={moveAnalysisToApplications}
            regeneratePdfWithTemplate={regeneratePdfWithTemplate}
            openDocument={openDocument}
            profilePhotoData={profilePhotoData}
          />}
          {activeTab === 'new' && <NewJobScreen
            jobUrl={jobUrl} setJobUrl={setJobUrl}
            loading={loading} analyzeJob={analyzeJob}
          />}
          {activeTab === 'applications' && <ApplicationsScreen
            applications={applications} applicationsLoading={applicationsLoading}
            appSortOrder={appSortOrder} setAppSortOrder={setAppSortOrder}
            statsMe={statsMe} consentAnalytics={consentAnalytics}
            updateApplicationProgress={updateApplicationProgress}
            loadApplications={loadApplications}
          />}
          {activeTab === 'documents' && <DocumentsScreen
            applicationPackage={applicationPackage} documents={documents}
            documentsLoading={documentsLoading}
            openDocument={openDocument} loadDocuments={loadDocuments}
          />}
          {activeTab === 'settings' && <SettingsScreen
            notificationEmail={notificationEmail} setNotificationEmail={setNotificationEmail}
            autoEmail={autoEmail} setAutoEmail={setAutoEmail}
            settingsLoading={settingsLoading} settingsSaving={settingsSaving}
            saveSettings={saveSettings}
          />}
          {activeTab === 'profile' && renderProfile()}
        </ScrollView>
      )}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.bottomButton} onPress={() => setActiveTab('home')}>
          <Text style={[styles.bottomIcon, activeTab === 'home' && styles.bottomIconActive]}>🏠</Text>
          <Text style={[styles.bottomLabel, activeTab === 'home' && styles.bottomLabelActive]}>{t('tabHome')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomButton} onPress={() => setActiveTab('profile')}>
          <Text style={[styles.bottomIcon, activeTab === 'profile' && styles.bottomIconActive]}>👤</Text>
          <Text style={[styles.bottomLabel, activeTab === 'profile' && styles.bottomLabelActive]}>{t('tabProfile')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
