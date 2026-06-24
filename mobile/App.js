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





  const renderAuth = () => (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 40,
    }}>
      <View style={{
        width: '100%',
        maxWidth: 380,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 32,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
      }}>
        {/* Icon box */}
        <View style={{
          width: 44, height: 44, borderRadius: 12,
          backgroundColor: '#FEF0EB',
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
        }}>
          <Text style={{ fontSize: 20 }}>💼</Text>
        </View>

        {/* Logo */}
        <Text style={{ fontSize: 28, fontWeight: '600', color: '#1a1a1a', letterSpacing: -0.5 }}>
          Ærlig<Text style={{ color: '#E8501A' }}>.</Text>
        </Text>

        {/* Tagline */}
        <Text style={{ fontSize: 14, color: '#888', marginTop: 4, marginBottom: 28, lineHeight: 20 }}>
          Din ærlige jobbcoach — søknader og intervjutrening som faktisk funker
        </Text>

        {/* E-post label + input */}
        <Text style={{ fontSize: 12, fontWeight: '500', color: '#555', marginBottom: 6 }}>
          {codeSent ? 'E-post' : 'E-post'}
        </Text>
        <TextInput
          style={{
            width: '100%',
            borderWidth: 1.5,
            borderColor: '#e0e0e0',
            borderRadius: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
            fontSize: 14,
            color: '#1a1a1a',
            backgroundColor: '#FAFAFA',
          }}
          placeholder="navn@epost.no"
          value={authEmail}
          onChangeText={(v) => {
            setAuthEmail(v);
            if (codeSent) {
              setCodeSent(false);
              setResendCooldown(0);
              setAuthCode('');
            }
          }}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        {codeSent ? (
          <>
            <Text style={{ fontSize: 12, fontWeight: '500', color: '#555', marginTop: 14, marginBottom: 6 }}>
              Engangskode
            </Text>
            <TextInput
              style={{
                width: '100%',
                borderWidth: 1.5,
                borderColor: '#e0e0e0',
                borderRadius: 8,
                paddingVertical: 10,
                paddingHorizontal: 14,
                fontSize: 14,
                color: '#1a1a1a',
                backgroundColor: '#FAFAFA',
              }}
              placeholder="6-sifret kode"
              value={authCode}
              onChangeText={setAuthCode}
              autoCapitalize="none"
              keyboardType="numeric"
            />
          </>
        ) : null}

        {/* Primary button */}
        <TouchableOpacity
          style={{
            width: '100%',
            backgroundColor: authLoading ? '#f0a080' : '#E8501A',
            borderRadius: 8,
            paddingVertical: 12,
            alignItems: 'center',
            marginTop: 12,
          }}
          onPress={doAuth}
          disabled={!!authLoading}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>
            {authLoading ? 'Sender...' : (codeSent ? 'Logg inn' : 'Send engangskode')}
          </Text>
        </TouchableOpacity>

        {/* Resend */}
        {codeSent ? (
          <TouchableOpacity
            style={{ marginTop: 10, alignItems: 'center', opacity: resendCooldown ? 0.5 : 1 }}
            disabled={!!resendCooldown || !!authLoading}
            onPress={async () => {
              if (!authEmail || resendCooldown) return;
              setAuthLoading(true);
              try {
                await apiFetch('/auth/request-code', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: authEmail }),
                });
                setAuthCode('');
                setResendCooldown(30);
                Alert.alert('Kode sendt', 'Vi har sendt en ny engangskode på e-post.');
              } catch (e) {
                if (e.status === 429) {
                  Alert.alert('For mange forsøk', 'Vent noen minutter og prøv igjen.');
                } else {
                  Alert.alert('Feil', errText(e));
                }
              }
              setAuthLoading(false);
            }}
          >
            <Text style={{ fontSize: 13, color: '#E8501A' }}>
              {resendCooldown ? `Send ny kode (${resendCooldown}s)` : 'Send ny kode'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Footer */}
        <Text style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 20 }}>
          Ingen passord. Ingen stress.
        </Text>
      </View>
    </View>
  );







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

  const renderAdminStats = () => {
    async function loadStats() {
      setAdminStatsLoading(true);
      try {
        const data = await apiFetch('/events/stats');
        setAdminStats(data);
      } catch (e) {
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
  };

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

  const renderHome = () => {
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
      ? 'Ikke lagret'
      : (profilePercent >= 85 ? 'Sterk' : (profilePercent >= 60 ? 'OK' : 'Trenger mer'));

    const matchMeterStyle = latestMatch == null ? styles.aerligMeterWarn
      : latestMatch >= 70 ? styles.aerligMeterGood
      : latestMatch >= 40 ? styles.aerligMeterWarn
      : styles.aerligMeterBad;
    const matchMeterColor = latestMatch == null ? '#D97706'
      : latestMatch >= 70 ? '#16A34A'
      : latestMatch >= 40 ? '#D97706'
      : '#DC2626';
    const matchMeterStatus = latestMatch == null ? ''
      : latestMatch >= 70 ? 'Sterk match — søk denne jobben!'
      : latestMatch >= 40 ? 'God match — søknaden kan fungere'
      : 'Svak match — vurder å styrke profilen';

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
            {t('hi')}{firstName ? `, ${firstName}` : ''}.
          </Text>
          <Text style={styles.aerligHeroSubtitle}>
            Oversikt over analyser og søknader — med ærlige råd.
          </Text>

          <TouchableOpacity style={styles.aerligPrimaryButton} onPress={() => setActiveTab('new')}>
            <Text style={styles.aerligPrimaryButtonText}>Analyser jobb</Text>
          </TouchableOpacity>

          <View style={styles.aerligQuickRow}>
            <Pressable
              {...ripple}
              style={[styles.aerligQuickButton, { marginRight: 10 }]}
              onPress={() => setActiveTab('cv')}
            >
              <Text style={styles.aerligQuickButtonText}>Analyser CV</Text>
            </Pressable>
            <Pressable
              {...ripple}
              style={styles.aerligQuickButton}
              onPress={() => setActiveTab('interview')}
            >
              <Text style={styles.aerligQuickButtonText}>Intervju-øving</Text>
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
            <Text style={styles.aerligCardEyebrow}>Siste analyse</Text>
            <Text style={styles.aerligCardTitle} numberOfLines={1}>
              {latestJob?.title || 'Siste analyse'}
            </Text>
            <Text style={styles.aerligCardMeta} numberOfLines={1}>
              {latestJob?.company || 'Ukjent bedrift'}
            </Text>

            {(latestMatch != null) ? (
              <>
                <View style={styles.aerligMeterRow}>
                  <Text style={styles.aerligMeterLabel}>Matchmeter</Text>
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
                  Anbefaling: {latestShouldApply ? 'SØK' : 'VENT'}
                </Text>
              </View>
            ) : null}

            {honestText ? (
              <>
                <Text style={styles.aerligCardSectionTitle}>Ærlig vurdering</Text>
                <Text style={styles.aerligCardBody} numberOfLines={4}>{honestText}</Text>
              </>
            ) : null}

            <Text style={styles.aerligCardLink}>Åpne analyse ›</Text>
          </Pressable>
        ) : (
          <View style={[styles.aerligCard, styles.aerligEmptyCard, { alignItems: 'center', paddingVertical: 28 }]}>
            <Text style={{ fontSize: 36, marginBottom: 12 }}>🔍</Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6, textAlign: 'center' }}>Ingen analyser ennå</Text>
            <Text style={{ fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
              Lim inn en FINN.no-lenke over for å{'\n'}analysere din første jobb
            </Text>
            <TouchableOpacity style={[styles.aerligPrimaryButton, { paddingHorizontal: 24 }]} onPress={() => setActiveTab('new')}>
              <Text style={styles.aerligPrimaryButtonText}>Analyser jobb</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.aerligGrid}>
          <Pressable
            {...ripple}
            style={styles.aerligMiniCard}
            onPress={() => setActiveTab('analysis')}
          >
            <Text style={styles.aerligMiniLabel}>Analyserte jobber</Text>
            <Text style={styles.aerligMiniValue}>{analysedJobsCount}</Text>
            <Text style={styles.aerligMiniHint}>Se historikk ›</Text>
          </Pressable>

          <Pressable
            {...ripple}
            style={styles.aerligMiniCard}
            onPress={() => setActiveTab('applications')}
          >
            <Text style={styles.aerligMiniLabel}>Sendte søknader</Text>
            {(sentApplicationsCount == null || sentApplicationsCount === 0) ? (
              <>
                <Text style={{ fontSize: 22, marginTop: 4, marginBottom: 2 }}>📭</Text>
                <Text style={{ fontSize: 11, color: '#888', lineHeight: 15 }}>Ingen søknader{'\n'}sendt enda</Text>
                <Text style={[styles.aerligMiniHint, { color: '#E8501A' }]}>Oppdater status ›</Text>
              </>
            ) : (
              <>
                <Text style={styles.aerligMiniValue}>{String(sentApplicationsCount)}</Text>
                <Text style={styles.aerligMiniHint}>Oppdater status ›</Text>
              </>
            )}
          </Pressable>

          <Pressable
            {...ripple}
            style={[styles.aerligMiniCard, styles.aerligMiniCardFull]}
            onPress={() => setActiveTab('profile')}
          >
            <Text style={styles.aerligMiniLabel}>Profilstatus</Text>
            <Text style={styles.aerligProfileValue}>{profilePercent}%</Text>
            <Text style={styles.aerligProfileHint}>{profileStatus} • Åpne profil</Text>
            <View style={styles.aerligProfileMeter}>
              <View style={[styles.aerligProfileMeterFill, { width: `${Math.max(0, Math.min(100, profilePercent))}%` }]} />
            </View>
          </Pressable>
        </View>

        <View style={styles.aerligTipCard}>
          <View style={styles.aerligTipLabel}>
            <Text style={{ fontSize: 16 }}>💡</Text>
            <Text style={styles.aerligTipLabelText}>KARRIERETIPS</Text>
          </View>
          <Text style={styles.aerligTipText}>{tipText}</Text>
        </View>
        {profileEmail === 'bjelland76@gmail.com' && renderAdminStats()}
      </View>
    );
  };


  const renderCv = () => (
    <View style={styles.aerligHomeWrap}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
      </Pressable>

      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>Analyser CV / profil</Text>
        <Text style={styles.aerligPageSubtitle}>Få forslag til relevante jobber og råd basert på utdanning og erfaring.</Text>

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeCv}>
          <Text style={styles.aerligPrimaryButtonText}>{cvLoading ? 'Analyserer...' : 'Analyser profilen min'}</Text>
        </TouchableOpacity>
      </View>

      {cvAnalysis ? (
        <View style={[styles.aerligCard, styles.aerligAccentNavy]}>
          {!cvAnalysis.summary && !cvAnalysis.suggested_roles?.length && !cvAnalysis.strengths?.length ? (
            <Text style={styles.aerligCardBody}>
              Profilen din mangler nok informasjon for en god analyse. Fyll ut CV/erfaring i profilen din først.
            </Text>
          ) : null}
          {cvAnalysis.summary ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Oppsummering</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.summary}</Text>
            </>
          ) : null}

          {cvAnalysis.education_fit ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Hva du er kvalifisert til</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.education_fit}</Text>
            </>
          ) : null}

          {cvAnalysis.suggested_roles?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Jobbtyper du kan søke på</Text>
              {cvAnalysis.suggested_roles.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.strengths?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Styrker</Text>
              {cvAnalysis.strengths.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.gaps?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Mulige hull / svakheter</Text>
              {cvAnalysis.gaps.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.improvement_tips?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Konkrete råd</Text>
              {cvAnalysis.improvement_tips.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.search_keywords?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Søkeord</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.search_keywords.join(', ')}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const renderAnalysis = () => {
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
    const analysisMeterStatus = matchScore >= 70 ? 'Sterk match — søk denne jobben!'
      : matchScore >= 40 ? 'God match — søknaden kan fungere'
      : 'Svak match — vurder å styrke profilen';

    const strengths = Array.isArray(analysis?.strengths) ? analysis.strengths : [];

    return (
      <View style={styles.aerligHomeWrap}>
        <Pressable
          android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
          style={styles.aerligBackButton}
          onPress={() => setActiveTab('home')}
        >
          <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
        </Pressable>
        <View style={styles.aerligPageCard}>
          <Text style={styles.aerligPageTitle}>Analyser jobbannonse</Text>
          <Text style={styles.aerligPageSubtitle}>Lim inn en jobbannonse for rask match og forbedringstips.</Text>

          <TextInput
            style={[styles.input, styles.aerligInput]}
            placeholder="Lim inn jobbannonse-URL"
            value={jobUrl}
            onChangeText={setJobUrl}
            autoCapitalize="none"
          />

          <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
            <Text style={styles.aerligPrimaryButtonText}>{loading ? 'Analyserer...' : 'Analyser jobb'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.aerligCard}>
          <Text style={styles.aerligCardEyebrow}>Tidligere analyser</Text>

          <TouchableOpacity style={styles.aerligSecondaryButton} onPress={loadJobAnalyses}>
            <Text style={styles.aerligSecondaryButtonText}>{jobAnalysesLoading ? 'Laster...' : 'Oppdater liste'}</Text>
          </TouchableOpacity>

          {jobAnalysesLoading ? (
            <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 8 }]}>Laster analyser...</Text>
          ) : null}

          {!jobAnalysesLoading && jobAnalyses.length === 0 ? (
            <View style={[styles.aerligCard, { alignItems: 'center', paddingVertical: 28, marginTop: 8 }]}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>🔍</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6, textAlign: 'center' }}>Ingen analyser ennå</Text>
              <Text style={{ fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20 }}>
                Lim inn en FINN.no-lenke over for å{'\n'}analysere din første jobb
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
                  {item.job.company || 'Ukjent bedrift'} · {Math.round(item.match_score || item.job.match_score || 0)}%
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
                <Text style={[styles.aerligSecondaryButtonText, { fontSize: 13 }]}>Åpne analyse</Text>
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
                <Text style={[styles.aerligSecondaryButtonText, { fontSize: 13 }]}>+ Søknader</Text>
              </TouchableOpacity>
            </View>
          </View>
          );
        })}

        {profileUpdatedSinceAnalysis && analysis && jobUrl ? (
          <View style={[styles.aerligCard, { borderWidth: 1.5, borderColor: '#E8501A', backgroundColor: '#FFF8F4' }]}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#E8501A', marginBottom: 4 }}>Profilen er oppdatert</Text>
            <Text style={{ fontSize: 13, color: '#334155', lineHeight: 19, marginBottom: 12 }}>
              Du har endret profilen din siden siste analyse. Kjør analysen på nytt for å se om matchen er bedre nå.
            </Text>
            <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
              <Text style={styles.aerligPrimaryButtonText}>{loading ? 'Analyserer...' : 'Analyser på nytt'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {analysis ? (
          <>
            <View style={[styles.aerligCard, styles.aerligAccentNavy]}>
              <Text style={styles.aerligCardEyebrow}>Analyse</Text>

              {hasMatchScore ? (
                <>
                  <View style={styles.aerligMeterRow}>
                    <Text style={styles.aerligMeterLabel}>Matchmeter</Text>
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
                    <Text style={styles.aerligMeterLabel}>Ærlighetsmåler</Text>
                    <Text style={styles.aerligMeterValue}>{analysis.should_apply ? 'SØK' : 'VENT'}</Text>
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
                  <Text style={styles.aerligCardSectionTitle}>Anbefalt søknadslengde</Text>
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
                    <Text style={styles.aerligSecondaryButtonText}>Bruk anbefalt</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            {analysis.honest_assessment ? (
              <View style={[styles.aerligCard, styles.aerligAccentOrange]}>
                <Text style={styles.aerligCardEyebrow}>Ærlig vurdering</Text>
                <Text style={styles.aerligCardBody}>{analysis.honest_assessment}</Text>
              </View>
            ) : null}

            {strengths.length > 0 ? (
              <View style={[styles.aerligCard, styles.aerligAccentGreen]}>
                <Text style={styles.aerligCardEyebrow}>Sterke sider</Text>
                {strengths.map((s, idx) => (
                  <Text key={idx} style={styles.aerligCardBody}>• {s}</Text>
                ))}
              </View>
          ) : null}

            {analysis.missing_requirements?.length > 0 ? (
              <View style={[styles.aerligCard, styles.aerligAccentOrange]}>
                <Text style={styles.aerligCardEyebrow}>Svake sider</Text>
                {analysis.missing_requirements.map((item, index) => (
                  <Text key={index} style={styles.aerligCardBody}>• {item}</Text>
                ))}
                <TouchableOpacity
                  style={[styles.aerligSecondaryButton, { marginTop: 12 }]}
                  onPress={() => setActiveTab('profile')}
                >
                  <Text style={styles.aerligSecondaryButtonText}>Oppdater profilen din →</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {analysis.improvement_tips?.length > 0 ? (
              <View style={[styles.aerligCard, styles.aerligAccentGreen]}>
                <Text style={styles.aerligCardEyebrow}>Forbedringstips</Text>
                {analysis.improvement_tips.map((item, index) => (
                  <Text key={index} style={styles.aerligCardBody}>• {item}</Text>
                ))}
              </View>
            ) : null}

            <View style={styles.aerligCard}>
              <Text style={styles.aerligCardEyebrow}>Søknad / PDF</Text>

              <Text style={[styles.inputLabel, styles.aerligLabel, { marginTop: 6 }]}>Velg søknadslengde</Text>
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

              <Text style={[styles.inputLabel, styles.aerligLabel, { marginTop: 6 }]}>Send til e-post</Text>
              <TextInput
                style={[styles.input, styles.aerligInput]}
                placeholder="Din e-postadresse"
                value={applicationEmail}
                onChangeText={setApplicationEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              {profilePhotoData ? (
                <View style={styles.profileField}>
                  <Text style={[styles.inputLabel, styles.aerligLabel]}>Bilde i PDF</Text>
                  <Text style={[styles.helpText, styles.aerligHelpText]}>Du kan velge om profilbildet skal være med i denne søknaden/PDF-en (standard kan settes i Profil).</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.messageText, styles.aerligMessageText]}>{includePhotoInPdf ? 'På' : 'Av'}</Text>
                    <Switch value={includePhotoInPdf} onValueChange={setIncludePhotoInPdf} />
                  </View>
                </View>
              ) : null}

              <Text style={[styles.inputLabel, styles.aerligLabel, { marginTop: 6 }]}>Språk / Language</Text>
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
                <Text style={styles.aerligSecondaryButtonText}>{sending ? 'Sender...' : 'Send søknad (e-post)'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.aerligSecondaryButton, isGenerating ? { opacity: 0.6 } : null]}
                onPress={generatePdf}
                disabled={isGenerating}
              >
                <Text style={styles.aerligSecondaryButtonText}>{generatingPdf ? 'Genererer...' : 'Generer PDF (uten e-post)'}</Text>
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

                  {/* Template picker — shown whenever a PDF has been generated */}
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                      Mal: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{cvTemplate.charAt(0).toUpperCase() + cvTemplate.slice(1)}</Text>
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
                      <Text style={styles.aerligSecondaryButtonText}>Åpne PDF</Text>
                    </TouchableOpacity>
                  ) : null}

                  {(typeof applicationPackage?.coverLetter === 'string' && applicationPackage.coverLetter.trim()) ? (
                    <>
                      <Text style={styles.aerligCardSectionTitle}>Søknad</Text>
                      <Text style={styles.aerligCardBody}>{applicationPackage.coverLetter}</Text>
                    </>
                  ) : null}

                  {(typeof applicationPackage?.cv === 'string' && applicationPackage.cv.trim()) ? (
                    <>
                      <Text style={styles.aerligCardSectionTitle}>CV</Text>
                      <Text style={styles.aerligCardBody}>{applicationPackage.cv}</Text>
                    </>
                  ) : null}

                  {(
                    (!applicationPackage?.coverLetter || !String(applicationPackage.coverLetter).trim())
                    && (!applicationPackage?.cv || !String(applicationPackage.cv).trim())
                  ) ? (
                    <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 6 }]}>Ingen tekst å vise.</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    );
  };


  const renderNew = () => (
    <View style={styles.aerligHomeWrap}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
      </Pressable>
      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>Ny søknad</Text>
        <Text style={styles.aerligPageSubtitle}>Start ny jobbprosjekt med en annonse-URL.</Text>

        <TextInput
          style={[styles.input, styles.aerligInput]}
          placeholder="Lim inn jobbannonse-URL"
          value={jobUrl}
          onChangeText={setJobUrl}
          autoCapitalize="none"
        />

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
          <Text style={styles.aerligPrimaryButtonText}>{loading ? 'Analyserer...' : 'Start analyse'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.aerligCard}>
        <Text style={styles.aerligCardTitle}>Hva skjer nå?</Text>
        <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>Du får oversikt over krav, match og hva du bør fremheve i søknaden.</Text>
      </View>
    </View>
  );

  const renderApplications = () => {
    function toggle(item, field) {
      const applied = !!item.applied;
      const interviewed = !!item.interviewed;
      const gotJob = !!item.got_job;

      let patch = {};

      if (field === 'applied') {
        const next = !applied;
        patch = next
          ? { applied: true }
          : { applied: false, interviewed: false, got_job: false };
      } else if (field === 'interviewed') {
        const next = !interviewed;
        patch = next
          ? { interviewed: true, applied: true }
          : { interviewed: false, got_job: false };
      } else if (field === 'got_job') {
        const next = !gotJob;
        patch = next
          ? { got_job: true }
          : { got_job: false };
      }

      updateApplicationProgress(item.job.id, patch);
    }

    return (
      <View style={styles.aerligHomeWrap}>
        <Pressable
          android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
          style={styles.aerligBackButton}
          onPress={() => setActiveTab('home')}
        >
          <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
        </Pressable>

        <View style={styles.aerligPageCard}>
          <Text style={styles.aerligPageTitle}>Søknader</Text>
          <Text style={styles.aerligPageSubtitle}>Én linje per jobb. Huk av status etter hvert.</Text>

          <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, marginBottom: 4 }}>
            {[
              { key: 'newest', label: 'Nyeste først' },
              { key: 'status', label: 'Status' },
              { key: 'name', label: 'Navn A-Å' },
            ].map(({ key, label }) => (
              <TouchableOpacity key={key} onPress={() => setAppSortOrder(key)}
                style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8,
                  backgroundColor: appSortOrder === key ? 'rgba(232,80,26,0.08)' : 'transparent' }}>
                <Text style={{ fontSize: 13, fontWeight: appSortOrder === key ? '600' : '400',
                  color: appSortOrder === key ? '#E8501A' : '#888888',
                  borderBottomWidth: appSortOrder === key ? 1.5 : 0,
                  borderBottomColor: '#E8501A' }}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.aerligSecondaryButton} onPress={loadApplications}>
            <Text style={styles.aerligSecondaryButtonText}>{applicationsLoading ? 'Laster...' : 'Oppdater liste'}</Text>
          </TouchableOpacity>

          {applicationsLoading ? (
            <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 10, marginBottom: 0 }]}>Laster søknader...</Text>
          ) : null}
        </View>

        {!consentAnalytics ? (
          <View style={[styles.aerligCard, styles.aerligAccentOrange]}>
            <Text style={styles.aerligCardTitle}>Anonym statistikk: AV</Text>
            <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>Hvis du skrur på anonym statistikk i Profil, kan resultatene dine inngå i samlet statistikk.</Text>
          </View>
        ) : null}

        {statsMe ? (
          <View style={styles.aerligCard}>
            <Text style={[styles.aerligCardTitle, { marginBottom: 12 }]}>Din statistikk</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {[
                { icon: '📋', value: statsMe.total, label: 'Totalt' },
                { icon: '📤', value: statsMe.applied, label: 'Sendt' },
                { icon: '💬', value: statsMe.interviewed, label: 'Intervju' },
                { icon: '⭐', value: statsMe.got_job, label: 'Fikk jobb' },
              ].map((item) => (
                <View key={item.label} style={{
                  flex: 1, minWidth: '40%',
                  backgroundColor: '#FFFFFF',
                  borderRadius: 12,
                  padding: 14,
                  shadowColor: '#000',
                  shadowOpacity: 0.06,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 2,
                  alignItems: 'flex-start',
                }}>
                  <Text style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</Text>
                  <Text style={{ fontSize: 24, fontWeight: '600', color: '#1a1a1a', lineHeight: 28 }}>{item.value ?? 0}</Text>
                  <Text style={{ fontSize: 12, color: '#888888', marginTop: 2 }}>{item.label}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 12, color: '#aaaaaa', marginTop: 10 }}>
              Intervju-rate: {Math.round((statsMe.interview_rate || 0) * 100)}% · Jobb-rate: {Math.round((statsMe.hire_rate || 0) * 100)}%
            </Text>
          </View>
        ) : null}

        {!applicationsLoading && applications.length === 0 ? (
          <View style={[styles.aerligCard, { alignItems: 'center', paddingVertical: 32 }]}>
            <Text style={{ fontSize: 36, marginBottom: 12 }}>📋</Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6, textAlign: 'center' }}>Ingen søknader ennå</Text>
            <Text style={{ fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
              Start med å analysere en jobb for å komme i gang
            </Text>
            <TouchableOpacity style={[styles.aerligPrimaryButton, { paddingHorizontal: 24 }]} onPress={() => setActiveTab('new')}>
              <Text style={styles.aerligPrimaryButtonText}>Analyser jobb</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {applications.length > 0 ? (() => {
          const sorted = [...applications].sort((a, b) => {
            if (appSortOrder === 'name') {
              return (a.job.title || '').localeCompare(b.job.title || '', 'no');
            }
            if (appSortOrder === 'status') {
              const rank = (i) => i.got_job ? 3 : i.interviewed ? 2 : i.applied ? 1 : 0;
              return rank(b) - rank(a);
            }
            // newest: by updated_at desc
            return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
          });
          return (
          <View style={styles.aerligAppsTableCard}>
            <View style={styles.aerligAppsTableHeaderRow}>
              <Text style={[styles.aerligAppsTableHeaderCell, styles.aerligAppsTableJobHeader]}>Jobb</Text>
              <Text style={styles.aerligAppsTableHeaderCell}>Søkt</Text>
              <Text style={styles.aerligAppsTableHeaderCell}>Intervju</Text>
              <Text style={styles.aerligAppsTableHeaderCell}>Jobb</Text>
            </View>

            {sorted.map((item) => (
              <View key={item.job.id} style={styles.aerligAppsTableRow}>
                <View style={styles.aerligAppsTableJobCell}>
                  <Text style={styles.aerligAppsTableJobTitle} numberOfLines={1}>{item.job.title}</Text>
                  <Text style={styles.aerligAppsTableJobCompany} numberOfLines={1}>{item.job.company || 'Ukjent bedrift'}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.aerligAppsCheckbox, item.applied && styles.aerligAppsCheckboxOn]}
                  onPress={() => toggle(item, 'applied')}
                >
                  <Text style={[styles.aerligAppsCheckboxText, item.applied && styles.aerligAppsCheckboxTextOn]}>{item.applied ? '✓' : ''}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.aerligAppsCheckbox, item.interviewed && styles.aerligAppsCheckboxOn]}
                  onPress={() => toggle(item, 'interviewed')}
                >
                  <Text style={[styles.aerligAppsCheckboxText, item.interviewed && styles.aerligAppsCheckboxTextOn]}>{item.interviewed ? '✓' : ''}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.aerligAppsCheckbox, item.got_job && styles.aerligAppsCheckboxOn]}
                  onPress={() => toggle(item, 'got_job')}
                >
                  <Text style={[styles.aerligAppsCheckboxText, item.got_job && styles.aerligAppsCheckboxTextOn]}>{item.got_job ? '✓' : ''}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
          );
        })() : null}
      </View>
    );
  };

  const renderDocuments = () => (
    <View style={styles.pageCard}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
      </Pressable>
      <Text style={styles.pageTitle}>Dokumenter</Text>
      <Text style={styles.pageSubtitle}>Her finner du genererte PDF-er (søknad + CV i samme fil).</Text>

      {applicationPackage ? (
        <View style={styles.analysisCard}>
          <Text style={styles.analysisHeading}>Siste genererte pakke</Text>

          {(typeof applicationPackage?.pdfUrl === 'string' && applicationPackage.pdfUrl.trim()) ? (
            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 0 }]}
              onPress={() => openDocument(applicationPackage.pdfUrl)}
            >
              <Text style={styles.secondaryButtonText}>Åpne PDF</Text>
            </TouchableOpacity>
          ) : null}

          {(typeof applicationPackage?.coverLetter === 'string' && applicationPackage.coverLetter.trim()) ? (
            <>
              <Text style={styles.analysisSubheading}>Søknad</Text>
              <Text style={styles.analysisList}>{applicationPackage.coverLetter}</Text>
            </>
          ) : null}

          {(typeof applicationPackage?.cv === 'string' && applicationPackage.cv.trim()) ? (
            <>
              <Text style={styles.analysisSubheading}>CV</Text>
              <Text style={styles.analysisList}>{applicationPackage.cv}</Text>
            </>
          ) : null}

          {(
            (!applicationPackage?.coverLetter || !String(applicationPackage.coverLetter).trim())
            && (!applicationPackage?.cv || !String(applicationPackage.cv).trim())
          ) ? (
            <Text style={styles.helpText}>Ingen tekst å vise.</Text>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity style={styles.secondaryButton} onPress={loadDocuments}>
        <Text style={styles.secondaryButtonText}>{documentsLoading ? 'Laster...' : 'Oppdater'}</Text>
      </TouchableOpacity>

      {!documentsLoading && documents.length === 0 ? (
        <Text style={[styles.helpText, { marginTop: 12 }]}>Ingen dokumenter ennå. Bruk "Send søknad" på Analyse-siden for å generere PDF.</Text>
      ) : null}

      {documents.map((doc) => (
        <View key={doc.id} style={styles.messageCard}>
          <Text style={styles.messageTitle}>{doc?.job?.title || 'Søknad'}</Text>
          <Text style={styles.messageText}>{doc?.job?.company || 'Ukjent bedrift'}</Text>

          <TouchableOpacity
            style={[styles.secondaryButton, { marginTop: 10, paddingVertical: 12 }]}
            onPress={() => openDocument(doc.cover_pdf_url)}
          >
            <Text style={styles.secondaryButtonText}>Åpne PDF (Søknad + CV)</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.secondaryButton, { marginTop: 8 }]}
        onPress={() => setActiveTab('profile')}
      >
        <Text style={styles.secondaryButtonText}>Tilbake til Profil</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSettings = () => (
    <View style={styles.pageCard}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
      </Pressable>
      <Text style={styles.pageTitle}>E-postinnstillinger</Text>
      <Text style={styles.pageSubtitle}>Brukes når du sender søknad/CV på e-post fra en analyse.</Text>

      <Text style={styles.inputLabel}>Varslings-e-post</Text>
      <TextInput
        style={styles.input}
        placeholder="din@epost.no"
        value={notificationEmail}
        onChangeText={setNotificationEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Auto-send (valgfritt)</Text>
        <Text style={styles.helpText}>Denne innstillingen er i praksis ikke brukt i URL-baserte analyser, men kan brukes i fremtidige utvidelser.</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.messageText}>{autoEmail ? 'På' : 'Av'}</Text>
          <Switch value={autoEmail} onValueChange={setAutoEmail} />
        </View>
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={saveSettings}>
        <Text style={styles.primaryButtonText}>{settingsSaving ? 'Lagrer...' : 'Lagre'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, { marginTop: 8 }]}
        onPress={() => setActiveTab('profile')}
      >
        <Text style={styles.secondaryButtonText}>{settingsLoading ? 'Laster...' : 'Tilbake til Profil'}</Text>
      </TouchableOpacity>
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
          {renderAuth()}
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
          {activeTab === 'home' && renderHome()}
          {activeTab === 'cv' && renderCv()}
          {activeTab === 'analysis' && renderAnalysis()}
          {activeTab === 'new' && renderNew()}
          {activeTab === 'applications' && renderApplications()}
          {activeTab === 'documents' && renderDocuments()}
          {activeTab === 'settings' && renderSettings()}
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
