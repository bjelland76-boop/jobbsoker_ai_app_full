import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
} from 'react-native';

import { THEME } from './styles/theme';
import { styles } from './styles/styles';
import { INTERVIEW_QUESTIONS, CAREER_TIPS } from './constants/content';
import InterviewScreen from './screens/InterviewScreen';
import { AppProvider, useApp, apiFetch, API } from './context/AppContext';
import useProfile from './hooks/useProfile';
import useJobAnalysis from './hooks/useJobAnalysis';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import DocumentsScreen from './screens/DocumentsScreen';
import NewJobScreen from './screens/NewJobScreen';
import CvAnalysisScreen from './screens/CvAnalysisScreen';
import SettingsScreen from './screens/SettingsScreen';
import AnalysisScreen from './screens/AnalysisScreen';
import ProfileScreen from './screens/ProfileScreen';
import { ProfileContext } from './context/ProfileContext';

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

  const profileHook = useProfile({
    onProfileSaved: () => { if (profileSavedCbRef.current) profileSavedCbRef.current(); },
  });
  const {
    profileId,
    profileEmail,
    profilePhotoData,
    includePhotoInPdf, setIncludePhotoInPdf,
    includePhotoDefault,
    skills,
    name,
    phone,
    consentAnalytics,
    experienceEntries,
    isProfileTooEmpty,
    flushAutoSave,
  } = profileHook;

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
    <ProfileContext.Provider value={profileHook}>
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
          {activeTab === 'profile' && <ProfileScreen />}
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
    </ProfileContext.Provider>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
