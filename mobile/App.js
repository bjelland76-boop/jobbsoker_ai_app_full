import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Animated,
  StyleSheet,
  Alert,
  Image,
  Platform,
  NativeModules,
  Linking,
  Switch,
} from 'react-native';

function guessDevHost() {
  // In Expo/React Native dev, this usually contains something like:
  //   http://192.168.1.50:19000/index.bundle?platform=...
  // but it can also be exp:// or exps:// depending on connection mode.
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (!scriptURL || typeof scriptURL !== 'string') return null;

  try {
    // URL is available in modern RN runtimes; fallback to regex if not.
    // eslint-disable-next-line no-undef
    const u = new URL(scriptURL);
    return u?.hostname || null;
  } catch (e) {
    const m = scriptURL.match(/^[a-zA-Z]+:\/\/([^:\/]+)(?::\d+)?\//);
    return m ? m[1] : null;
  }
}

const DEV_HOST = guessDevHost();

const API =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web'
    ? 'http://localhost:8000'
    : DEV_HOST
      ? `http://${DEV_HOST}:8000`
      : 'http://localhost:8000');

console.log('API base URL:', API);

let AUTH_TOKEN = null;
let UNAUTHORIZED_HANDLER = null;

function setAuthToken(token) {
  AUTH_TOKEN = token;
}

function setUnauthorizedHandler(fn) {
  UNAUTHORIZED_HANDLER = fn;
}

async function apiFetch(path, options) {
  const opts = options ? { ...options } : {};
  const headers = { ...(opts.headers || {}) };
  if (AUTH_TOKEN) {
    headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  }
  opts.headers = headers;

  const r = await fetch(API + path, opts);

  let data = null;
  try {
    data = await r.json();
  } catch (e) {
    // ignore JSON parse errors
  }

  if (r.status === 401) {
    const msg = (data && (data.detail || data.error)) || 'Sesjonen er utløpt. Logg inn på nytt.';
    try {
      if (UNAUTHORIZED_HANDLER) {
        await UNAUTHORIZED_HANDLER();
      }
    } catch (e) {
      // ignore
    }
    throw new Error(msg);
  }

  if (!r.ok) {
    const msg = (data && (data.detail || data.error)) || r.statusText || 'Ukjent feil';
    throw new Error(msg);
  }

  return data;
}

// TODO: Replace with your own published privacy policy URL before Google Play release.
const PRIVACY_URL = 'https://example.com/personvern';

const THEME = {
  // Dark / purple palette
  colors: {
    background: '#0b0b12',
    surface: '#121225',
    surfaceAlt: '#171733',
    text: '#f8fafc',
    muted: '#a1a1aa',
    border: '#24244a',

    primary: '#8b5cf6',
    primarySoft: '#22163f',

    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
  },
  radius: {
    card: 16,
    control: 12,
    pill: 999,
  },
};

const I18N = {
  no: {
    appName: 'Ærlig JobbCoach',
    hi: 'Hei',
    loading: 'Laster...',

    // Auth
    loginTitle: 'Logg inn',
    registerTitle: 'Lag konto',
    authSubtitle: 'Demo-innlogging med e-post og passord.',
    appLanguage: 'Språk i appen',
    norwegian: 'Norsk',
    english: 'Engelsk',
    name: 'Navn',
    email: 'E-post',
    password: 'Passord (minst 6 tegn)',
    working: 'Jobber...',
    createAccount: 'Opprett konto',
    noAccount: 'Ingen konto? Lag ny',
    haveAccount: 'Har du konto? Logg inn',

    // Tabs
    tabHome: 'Hjem',
    tabAnalyze: 'Analyser',
    tabApplications: 'Søknader',
    tabProfile: 'Profil',

    // Home
    quickActions: 'Hurtigvalg',
    welcomeQuestion: 'Klar for neste karrieresteg?',
    welcomeBody: 'Få hjelp med CV, stillingsanalyse, søknader og intervjuforberedelser — samlet på ett sted.',
    interviewPractice: 'Intervju-øving',
    interviewPracticeSubtitle: 'Øv på vanlige intervjuspørsmål.',

    // GDPR
    privacyLink: 'GDPR / personvern',
    privacyRead: 'Les GDPR/personvern',

    // Interview
    interviewTitle: 'Intervju-øving',
    interviewSubtitle: 'Øv på vanlige intervjuspørsmål. Skriv stikkord og øv høyt.',
    yourNotes: 'Dine stikkord/svar',
    next: 'Neste',
    previous: 'Forrige',
  },
  en: {
    appName: 'Honest JobCoach',
    hi: 'Hi',
    loading: 'Loading...',

    // Auth
    loginTitle: 'Log in',
    registerTitle: 'Create account',
    authSubtitle: 'Demo login with email and password.',
    appLanguage: 'App language',
    norwegian: 'Norwegian',
    english: 'English',
    name: 'Name',
    email: 'Email',
    password: 'Password (min 6 chars)',
    working: 'Working...',
    createAccount: 'Create account',
    noAccount: "Don't have an account? Sign up",
    haveAccount: 'Already have an account? Log in',

    // Tabs
    tabHome: 'Home',
    tabAnalyze: 'Analyze',
    tabApplications: 'Applications',
    tabProfile: 'Profile',

    // Home
    quickActions: 'Quick actions',
    welcomeQuestion: 'Ready for your next career step?',
    welcomeBody: 'Get help with your CV, job analysis, applications, and interview prep — all in one place.',
    interviewPractice: 'Interview practice',
    interviewPracticeSubtitle: 'Practice common interview questions.',

    // GDPR
    privacyLink: 'GDPR / privacy',
    privacyRead: 'Read GDPR/privacy',

    // Interview
    interviewTitle: 'Interview practice',
    interviewSubtitle: 'Practice common interview questions. Write bullet points and practice out loud.',
    yourNotes: 'Your notes/answer',
    next: 'Next',
    previous: 'Previous',
  },
};

const INTERVIEW_QUESTIONS = {
  no: [
    'Fortell litt om deg selv.',
    'Hvorfor søker du denne jobben?',
    'Hva er dine største styrker?',
    'Hva vil du si er dine utviklingsområder?',
    'Fortell om en gang du løste et vanskelig problem.',
    'Hvordan håndterer du stress og høyt tempo?',
    'Hvordan liker du å jobbe i team?',
    'Hva motiverer deg i hverdagen?',
    'Hvor ser du deg selv om 2–3 år?',
    'Har du noen spørsmål til oss?',
  ],
  en: [
    'Tell me about yourself.',
    'Why do you want this job?',
    'What are your biggest strengths?',
    'What would you like to improve?',
    'Tell me about a time you solved a difficult problem.',
    'How do you handle stress and high workload?',
    'How do you like working in a team?',
    'What motivates you day to day?',
    'Where do you see yourself in 2–3 years?',
    'Do you have any questions for us?',
  ],
};

// Career tips shown on the Home screen.
// We keep them locally and rotate them every few hours.
const TIP_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours

const CAREER_TIPS = {
  no: [
    'Skriv søknaden for arbeidsgiveren, ikke for deg selv. Vis hva du kan bidra med.',
    'Bruk tall når du kan: «behandlet 40–60 henvendelser per dag» slår «jobbet i kundeservice».',
    'Start CV-punkter med verb: «Planla», «koordinerte», «leverte», «forbedret».',
    'Skreddersy overskriften i CV-en til rollen du søker, ikke bare «CV».',
    'Bytt ut generelle ord («ansvarsfull») med konkrete eksempler og resultater.',
    'Hold deg til 3–6 punkt per jobb: velg det som er mest relevant for stillingen.',
    'Legg inn søkeord fra annonsen i CV-en (på en naturlig måte).',
    'Skriv kort om «hull i CV» før arbeidsgiver spør – 1–2 linjer er nok.',
    'Har du lite erfaring? Fremhev ansvar i skole/prosjekt/frivillig arbeid og overførbare ferdigheter.',
    'Kutt fyllord. Kortere setninger gjør teksten mer profesjonell.',
    'Sørg for at e-post og telefon er synlig og riktig (test å ringe deg selv).',
    'Be en venn lese søknaden: én runde med korrektur løfter helhetsinntrykket mye.',
  ],
  en: [
    'Write for the employer, not for yourself. Show what you can contribute.',
    'Use numbers when possible: “handled 40–60 requests/day” beats “customer service experience”.',
    'Start CV bullets with action verbs: “Built”, “Improved”, “Delivered”, “Coordinated”.',
    'Tailor your CV headline to the role you apply for, not just “Resume”.',
    'Replace generic words (“hard-working”) with concrete examples and outcomes.',
    'Keep 3–6 bullets per job and focus on what’s most relevant to the position.',
    'Add keywords from the job ad to your CV (naturally).',
    'Explain employment gaps briefly before you’re asked — 1–2 lines is enough.',
    'New to the field? Highlight transferable skills from school/projects/volunteering.',
    'Cut filler words. Shorter sentences read more professional.',
    'Make sure your email and phone are correct and easy to find.',
    'Ask someone to proofread — one quick review improves the overall impression a lot.',
  ],
};

export default function App() {
  function errText(e) {
    return (e && e.message) ? String(e.message) : String(e);
  }

  const [authReady, setAuthReady] = useState(false);
  const [authTokenState, setAuthTokenState] = useState(null);
  const [uiLanguage, setUiLanguage] = useState('no'); // no | en
  const [authEmail, setAuthEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [authLoading, setAuthLoading] = useState(false);
  const [userId, setUserId] = useState(null);

  const [activeTab, setActiveTab] = useState('home');
  const [jobUrl, setJobUrl] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [jobAnalyses, setJobAnalyses] = useState([]);
  const [jobAnalysesLoading, setJobAnalysesLoading] = useState(false);
  const [cvAnalysis, setCvAnalysis] = useState(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [applicationStyle, setApplicationStyle] = useState('vanlig'); // kort | vanlig | profesjonell
  const [applicationEmail, setApplicationEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [includePhotoDefault, setIncludePhotoDefault] = useState(true);
  const [includePhotoInPdf, setIncludePhotoInPdf] = useState(true);
  const [profileId, setProfileId] = useState(null);
  const [name, setName] = useState('Ærlig JobbCoach');
  const [profileEmail, setProfileEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [postalPlace, setPostalPlace] = useState('');
  const [profilePhotoData, setProfilePhotoData] = useState('');
  const [skills, setSkills] = useState('');
  const [consentAnalytics, setConsentAnalytics] = useState(false);
  const [languagesList, setLanguagesList] = useState([]);
  const [customLanguageInput, setCustomLanguageInput] = useState('');
  const [cvGaps, setCvGaps] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [showLanguageList, setShowLanguageList] = useState(false);
  const [showSchoolListIndex, setShowSchoolListIndex] = useState(-1);
  const [schoolFilter, setSchoolFilter] = useState('');
  const [schoolKindFilter, setSchoolKindFilter] = useState('all'); // all | vgs | universitet | nettskole
  const [schoolResults, setSchoolResults] = useState([]);
  const [schoolResultsLoading, setSchoolResultsLoading] = useState(false);
  const [tipText, setTipText] = useState('');
  const [experienceEntries, setExperienceEntries] = useState([]);
  const [educationEntries, setEducationEntries] = useState([]);
  const [referenceEntries, setReferenceEntries] = useState([]);

  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [statsMe, setStatsMe] = useState(null);

  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  const [notificationEmail, setNotificationEmail] = useState('');
  const [autoEmail, setAutoEmail] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [interviewIndex, setInterviewIndex] = useState(0);
  const [interviewNotes, setInterviewNotes] = useState({});

  const mascotAnim = useRef(new Animated.Value(0)).current;

  // Cartoon-style "teacher" avatar (generated). If you want a different look,
  // change the seed (e.g. seed=Kari or seed=Per).
  const profilePhoto = {
    uri: 'https://api.dicebear.com/9.x/adventurer/png?seed=Teacher&backgroundColor=b6e3f4&size=256',
  };

  const schoolOptions = [
    'Universitetet i Oslo',
    'NTNU',
    'Universitetet i Bergen',
    'Universitetet i Tromsø',
    'Universitetet i Agder',
    'Universitetet i Stavanger',
    'Universitetet i Sørøst-Norge',
    'NMBU',
    'OsloMet – storbyuniversitetet',
    'Nord universitet',
    'Høgskulen på Vestlandet',
    'Høgskolen i Innlandet',
    'Høgskolen i Østfold',
    'Høgskolen i Molde',
    'Høgskolen i Volda',
    'BI Norwegian Business School',
    'Høyskolen Kristiania',
    'NLA Høgskolen',
    'MF vitenskapelig høyskole',
    'Westerdals Oslo ACT',
    'Norges idrettshøgskole',
    'Kunsthøgskolen i Oslo',
    'Arkitektur- og designhøgskolen i Oslo',
    'Fagskole - Teknikk og industriell produksjon',
    'Fagskole - Helse og oppvekst',
    'Fagskole - IT og digitalisering',
    'Ullern videregående skole',
    'Elvebakken videregående skole',
    'Nydalen videregående skole',
    'Frogner videregående skole',
    'Bygdøy videregående skole',
    'Bjørkelangen videregående skole',
    'Bergen katedralskole',
    'Strinda videregående skole',
    'Åsane videregående skole',
    'Drammen videregående skole',
    'Kirkeparken videregående skole',
    'St. Olav videregående skole',
    'Lillestrøm videregående skole',
    'Skedsmo videregående skole',
    'Romerike videregående skole',
    'Annen skole',
  ];

  const languageOptions = [
    'Norsk',
    'Engelsk',
    'Svensk',
    'Dansk',
    'Finsk',
    'Islandsk',
    'Tysk',
    'Nederlandsk',
    'Fransk',
    'Spansk',
    'Italiensk',
    'Portugisisk',
    'Russisk',
    'Ukrainsk',
    'Rumensk',
    'Bulgarsk',
    'Gresk',
    'Tsjekkisk',
    'Ungarsk',
    'Kinesisk',
    'Japansk',
    'Koreansk',
    'Arabisk',
    'Hebraisk',
    'Hindi',
    'Punjabi',
    'Urdu',
    'Tyrkisk',
    'Persisk (Farsi)',
    'Thai',
    'Vietnamesisk',
    'Polsk',
  ];


  const strings = I18N[uiLanguage] || I18N.no;
  const t = (key) => strings[key] ?? I18N.no[key] ?? String(key);

  async function refreshCareerTip({ force = false } = {}) {
    const tips = CAREER_TIPS[uiLanguage] || CAREER_TIPS.no;
    const now = Date.now();
    const kAt = `careerTip:lastAt:${uiLanguage}`;
    const kText = `careerTip:lastText:${uiLanguage}`;

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

  async function setAndPersistUiLanguage(nextLang) {
    const v = nextLang === 'en' ? 'en' : 'no';
    setUiLanguage(v);
    try {
      await AsyncStorage.setItem('uiLanguage', v);
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      try {
        await AsyncStorage.removeItem('authToken');
      } catch (e) {
        // ignore
      }
      setAuthToken(null);
      setAuthTokenState(null);
      resetUserState();
    });

    async function initAuth() {
      try {
        const lang = await AsyncStorage.getItem('uiLanguage');
        if (lang) {
          setUiLanguage(lang === 'en' ? 'en' : 'no');
        }

        const t = await AsyncStorage.getItem('authToken');
        if (t) {
          setAuthToken(t);
          setAuthTokenState(t);
        }
      } catch (e) {
        // ignore
      }
      setAuthReady(true);
    }

    initAuth();

    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    async function loadMe() {
      try {
        const me = await apiFetch('/auth/me');
        setUserId(me?.id ?? null);
      } catch (e) {
        // 401 is handled centrally (auto logout)
        setUserId(null);
      }
    }

    if (!authTokenState) {
      setUserId(null);
      return;
    }

    loadMe();
  }, [authTokenState]);

  useEffect(() => {
    if (!resendCooldown) return;
    const t = setTimeout(() => setResendCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

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

  async function doAuth() {
    if (!authEmail) {
      Alert.alert('Feil', 'Skriv inn e-post');
      return;
    }

    setAuthLoading(true);
    try {
      if (!codeSent) {
        // Step 1: request a one-time code
        await apiFetch('/auth/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail }),
        });

        setCodeSent(true);
        setAuthCode('');
        setResendCooldown(30);
        Alert.alert('Kode sendt', 'Sjekk e-posten din for en engangskode.');
      } else {
        // Step 2: verify the code and receive a token
        if (!authCode || String(authCode).trim().length < 4) {
          Alert.alert('Feil', 'Skriv inn engangskoden');
          return;
        }

        const res = await apiFetch('/auth/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail, code: String(authCode).trim() }),
        });

        const token = res?.access_token;
        if (!token) throw new Error('Mangler token fra server');

        setAuthToken(token);
        setAuthTokenState(token);
        await AsyncStorage.setItem('authToken', token);

        setCodeSent(false);
        setResendCooldown(0);
        setAuthCode('');
        setActiveTab('home');
      }
    } catch (e) {
      Alert.alert('Feil', errText(e));
    }
    setAuthLoading(false);
  }

  function resetUserState() {
    setUserId(null);
    setActiveTab('home');

    // Auth UI state
    setAuthEmail('');
    setAuthCode('');
    setCodeSent(false);
    setResendCooldown(0);

    // Profile
    setProfileId(null);
    setName('Ærlig JobbCoach');
    setProfileEmail('');
    setPhone('');
    setAddress('');
    setPostalCode('');
    setPostalPlace('');
    setProfilePhotoData('');
    setIncludePhotoDefault(true);
    setIncludePhotoInPdf(true);
    setSkills('');
    setConsentAnalytics(false);
    setLanguagesList([]);
    setCvGaps('');
    setExperienceEntries([]);
    setEducationEntries([]);
    setReferenceEntries([]);

    // Analysis / URL
    setJobUrl('');
    setAnalysis(null);
    setJobAnalyses([]);
    setCvAnalysis(null);
    setApplicationStyle('vanlig');
    setApplicationEmail('');

    // Lists
    setApplications([]);
    setStatsMe(null);
    setDocuments([]);
  }

  async function logout() {
    try {
      await AsyncStorage.removeItem('authToken');
    } catch (e) {
      // ignore
    }
    setAuthToken(null);
    setAuthTokenState(null);
    resetUserState();
  }

  async function deleteAccount() {
    Alert.alert(
      'Slett konto og data',
      'Dette sletter kontoen din og all lagret data (profil, analyser, dokumenter og statistikk). Dette kan ikke angres.',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Slett',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch('/me', { method: 'DELETE' });
              Alert.alert('Slettet', 'Kontoen og alle data er slettet.');
              await logout();
            } catch (e) {
              Alert.alert('Feil', errText(e));
            }
          },
        },
      ]
    );
  }

  const renderAuth = () => (
    <View style={styles.pageCard}>
      <Text style={styles.pageTitle}>{t('loginTitle')}</Text>
      <Text style={styles.pageSubtitle}>Logg inn med engangskode på e-post. Ingen passord.</Text>

      <Text style={styles.inputLabel}>{t('appLanguage')}</Text>
      <View style={styles.filterChipRow}>
        {[{ key: 'no', label: t('norwegian') }, { key: 'en', label: t('english') }].map((opt) => {
          const active = uiLanguage === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setAndPersistUiLanguage(opt.key)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        style={styles.input}
        placeholder={t('email')}
        value={authEmail}
        onChangeText={(v) => {
          setAuthEmail(v);
          // If the email changes after we've sent a code, reset the flow.
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
        <TextInput
          style={styles.input}
          placeholder="Engangskode (6 siffer)"
          value={authCode}
          onChangeText={setAuthCode}
          autoCapitalize="none"
          keyboardType="numeric"
        />
      ) : null}

      <TouchableOpacity style={styles.primaryButton} onPress={doAuth}>
        <Text style={styles.primaryButtonText}>
          {authLoading
            ? t('working')
            : (codeSent ? 'Logg inn' : 'Send engangskode')}
        </Text>
      </TouchableOpacity>

      {codeSent ? (
        <TouchableOpacity
          style={[styles.secondaryButton, resendCooldown ? { opacity: 0.6 } : null]}
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
              Alert.alert('Feil', errText(e));
            }
            setAuthLoading(false);
          }}
        >
          <Text style={styles.secondaryButtonText}>
            {resendCooldown ? `Send ny kode (${resendCooldown}s)` : 'Send ny kode'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await apiFetch('/profiles');
        if (Array.isArray(data) && data.length > 0) {
          const profile = data[0];
          setProfileId(profile.id);
          setName(profile.name || 'Ærlig JobbCoach');
          setProfileEmail(profile.email || '');
          setPhone(profile.phone || '');
          setAddress(profile.address || '');
          setPostalCode(profile.postal_code || '');
          setPostalPlace(profile.postal_place || '');
          setProfilePhotoData(profile.photo_data || '');
          const defInc = (profile.include_photo_default !== false);
          setIncludePhotoDefault(defInc);
          setIncludePhotoInPdf(defInc);
          setSkills(profile.skills || '');
          setConsentAnalytics(!!profile.consent_analytics);
          setLanguagesList(Array.isArray(profile.languages) ? profile.languages : (profile.languages ? [profile.languages] : []));
          setCvGaps(profile.cv_gaps || '');

          const experienceRaw = Array.isArray(profile.experience)
            ? profile.experience
            : (profile.experience
                ? [{ company: '', title: String(profile.experience), from: '', to: '', current: false }]
                : []);

          const educationRaw = Array.isArray(profile.education)
            ? profile.education
            : (profile.education
                ? [{ school: String(profile.education), degree: '', from: '', to: '' }]
                : []);

          const experience = experienceRaw.map((e) => {
            if (typeof e === 'string') {
              return { title: e, company: '', from: '', to: '', current: false };
            }
            const obj = (e && typeof e === 'object') ? e : {};
            return {
              title: obj.title || '',
              company: obj.company || '',
              from: obj.from || '',
              to: obj.to || '',
              current: !!obj.current,
            };
          });

          const education = educationRaw.map((e) => {
            if (typeof e === 'string') {
              return { school: e, degree: '', from: '', to: '' };
            }
            const obj = (e && typeof e === 'object') ? e : {};
            return {
              school: obj.school || '',
              degree: obj.degree || '',
              from: obj.from || '',
              to: obj.to || '',
            };
          });

          setExperienceEntries(experience);
          setEducationEntries(education);

          const referencesRaw = Array.isArray(profile.references)
            ? profile.references
            : (profile.references
                ? [{ name: String(profile.references), relation: '', contact: '' }]
                : []);

          const references = referencesRaw.map((r) => {
            if (typeof r === 'string') {
              return { name: r, relation: '', contact: '' };
            }
            const obj = (r && typeof r === 'object') ? r : {};
            return {
              name: obj.name || '',
              relation: obj.relation || obj.title || '',
              contact: obj.contact || obj.phone || obj.email || '',
            };
          });

          setReferenceEntries(references);
        }
      } catch (e) {
        console.log('Kunne ikke laste profil:', e);
      }
    }

    if (!authTokenState) return;
    loadProfile();
  }, [authTokenState]);

  useEffect(() => {
    if (showSchoolListIndex < 0) return;

    const trimmed = (schoolFilter || '').trim();
    if (trimmed.length < 2) {
      setSchoolResults([]);
      setSchoolResultsLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setSchoolResultsLoading(true);
      try {
        const q = encodeURIComponent(trimmed);
        const data = await apiFetch(`/education-options?q=${q}&kind=${schoolKindFilter}&limit=120`);
        if (Array.isArray(data)) {
          setSchoolResults(data);
        } else {
          setSchoolResults([]);
        }
      } catch (e) {
        // Backend kan være nede / utilgjengelig (da bruker vi lokal fallback-liste)
        setSchoolResults([]);
      }
      setSchoolResultsLoading(false);
    }, 250);

    return () => clearTimeout(timeout);
  }, [schoolFilter, schoolKindFilter, showSchoolListIndex]);

  async function saveProfile({ silent = false, override = {} } = {}) {
    if (!name) {
      Alert.alert('Feil', 'Navn må være utfylt');
      return;
    }

    setSavingProfile(true);
      const payload = {
      name: override.name ?? name,
      email: override.email ?? profileEmail,
      phone: override.phone ?? phone,
      address: override.address ?? address,
      postal_code: override.postal_code ?? postalCode,
      postal_place: override.postal_place ?? postalPlace,
      photo_data: override.photo_data ?? profilePhotoData,
      include_photo_default: override.include_photo_default ?? includePhotoDefault,
      consent_analytics: override.consent_analytics ?? consentAnalytics,
      experience: override.experience ?? experienceEntries,
      education: override.education ?? educationEntries,
      skills: override.skills ?? skills,
      languages: override.languages ?? languagesList,
      references: override.references ?? referenceEntries,
      cv_gaps: override.cv_gaps ?? cvGaps,
    };

    try {
      const method = profileId ? 'PUT' : 'POST';
      const data = await apiFetch(profileId ? `/profiles/${profileId}` : '/profiles', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setProfileId(data.id);
      if (!silent) {
        Alert.alert('Profil lagret', 'Din profil er lagret til backend.');
      }
    } catch (e) {
      Alert.alert('Feil', errText(e));
    }

    setSavingProfile(false);
  }

  useEffect(() => {
    let mounted = true;

    async function ensureConsentPrompt() {
      if (!profileId) return;

      try {
        // Backend is the source of truth. AsyncStorage is only used to ensure
        // we don't keep re-prompting.
        const prompted = await AsyncStorage.getItem('analyticsConsentPrompted');

        // Legacy migration: previous versions stored the decision locally.
        const legacy = await AsyncStorage.getItem('analyticsConsent');
        if (!prompted && (legacy === 'yes' || legacy === 'no')) {
          const v = legacy === 'yes';
          if (!mounted) return;
          setConsentAnalytics(v);
          await AsyncStorage.setItem('analyticsConsentPrompted', 'yes');
          await AsyncStorage.removeItem('analyticsConsent');
          await saveProfile({ silent: true, override: { consent_analytics: v } });
          return;
        }

        if (prompted) return;

        // If the profile already has consent enabled, consider it prompted.
        if (consentAnalytics) {
          await AsyncStorage.setItem('analyticsConsentPrompted', 'yes');
          return;
        }

        Alert.alert(
          'Anonym statistikk',
          'Vil du tillate at appen samler inn anonym statistikk (kun status på søknader/intervju/tilbud) for å se om appen virker?\n\nDu kan endre dette når som helst i Profil.',
          [
            {
              text: t('privacyRead'),
              onPress: async () => {
                try {
                  await Linking.openURL(PRIVACY_URL);
                } catch (e) {
                  Alert.alert('Lenke', PRIVACY_URL);
                }
              },
            },
            {
              text: 'Nei',
              style: 'cancel',
              onPress: async () => {
                const v = false;
                if (!mounted) return;
                setConsentAnalytics(v);
                await AsyncStorage.setItem('analyticsConsentPrompted', 'yes');
                await saveProfile({ silent: true, override: { consent_analytics: v } });
              },
                },
            {
              text: 'Ja',
              onPress: async () => {
                const v = true;
                if (!mounted) return;
                setConsentAnalytics(v);
                await AsyncStorage.setItem('analyticsConsentPrompted', 'yes');
                await saveProfile({ silent: true, override: { consent_analytics: v } });
              },
            },
          ]
        );
      } catch (e) {
        // ignore
      }
    }

    ensureConsentPrompt();

    return () => {
      mounted = false;
    };
  }, [profileId, consentAnalytics]);

  async function loadJobAnalyses() {
    if (!profileId) return;

    setJobAnalysesLoading(true);
    try {
      const data = await apiFetch(`/job-analyses?profile_id=${profileId}`);
      setJobAnalyses(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log('Kunne ikke laste analyser:', e);
    }
    setJobAnalysesLoading(false);
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
      Alert.alert('Feil', String(e));
    }
  }

  async function openSavedAnalysis(jobId, url) {
    if (!profileId) return;

    setLoading(true);
    try {
      const data = await apiFetch(`/job-analyses/${jobId}?profile_id=${profileId}`);
      setAnalysis(data);
      if (url) setJobUrl(url);
      setActiveTab('analysis');
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
    setLoading(false);
  }

  async function moveAnalysisToApplications(jobId) {
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen først');
      return;
    }

    try {
      // Reuse backend progress endpoint; empty payload creates the row if it doesn't exist.
      await apiFetch(`/applications/${jobId}/progress/${profileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      Alert.alert('Lagt til', 'Jobben er lagt til under Søknader.');
      setActiveTab('applications');
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
  }

  useEffect(() => {
    if (activeTab !== 'analysis') return;
    if (!profileId) return;

    // Reset to profile default each time you enter analysis (per-application override).
    if (profilePhotoData) {
      setIncludePhotoInPdf(!!includePhotoDefault);
    }

    loadJobAnalyses();
  }, [activeTab, profileId, profilePhotoData, includePhotoDefault]);

  async function analyzeJob() {
    if (!jobUrl) {
      Alert.alert('Feil', 'Lim inn jobbannonse');
      return;
    }

    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen før analyse');
      return;
    }

    setLoading(true);
    try {
      const data = await apiFetch('/analyze-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, url: jobUrl, application_style: applicationStyle }),
      });

      setAnalysis(data);
      setActiveTab('analysis');
      loadJobAnalyses();
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
    setLoading(false);
  }

  async function sendApplication() {
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen før sending');
      return;
    }
    if (!jobUrl || !applicationEmail) {
      Alert.alert('Feil', 'Mangler jobbannonse eller e-post');
      return;
    }

    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;

    setSending(true);
    try {
      const result = await apiFetch('/analyze-url-and-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, url: jobUrl, to_email: applicationEmail, application_style: applicationStyle, include_photo: includePhoto }),
      });

      if (result?.sent === false) {
        Alert.alert('Advarsel', 'Analysen ble lagret, men e-post ble ikke sendt (SMTP er ikke konfigurert).');
      } else {
        Alert.alert('Sendt', 'Søknad og CV er sendt på e-post.');
      }
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
    setSending(false);
  }

  async function generatePdf() {
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen først');
      return;
    }

    const jobId = analysis?.job_id;
    if (!jobId) {
      Alert.alert('Feil', 'Mangler job_id. Kjør analyse på nytt.');
      return;
    }

    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;

    setGeneratingPdf(true);
    try {
      const created = await apiFetch(`/job-analyses/${jobId}/generate-pdf?profile_id=${profileId}&include_photo=${includePhoto ? 1 : 0}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      // Make it show up immediately even if refresh fails on some devices.
      if (created?.id) {
        setDocuments((prev) => {
          const next = [created, ...(prev || [])];
          const seen = new Set();
          return next.filter((d) => {
            const k = String(d?.id ?? '');
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        });
      }

      await loadDocuments();
      setActiveTab('documents');
      Alert.alert('OK', 'PDF er generert. Se under Dokumenter.');
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
    setGeneratingPdf(false);
  }

  async function loadApplications() {
    if (!profileId) return;

    setApplicationsLoading(true);
    try {
      const items = await apiFetch(`/applications?profile_id=${profileId}`);
      setApplications(Array.isArray(items) ? items : []);

      const st = await apiFetch(`/stats/me?profile_id=${profileId}`);
      setStatsMe(st);
    } catch (e) {
      console.log('Kunne ikke laste søknader:', e);
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
  }, [activeTab, profileId]);

  async function loadDocuments() {
    if (!profileId) return;

    setDocumentsLoading(true);
    try {
      const items = await apiFetch(`/generated-applications?profile_id=${profileId}`);
      setDocuments(Array.isArray(items) ? items : []);
    } catch (e) {
      console.log('Kunne ikke laste dokumenter:', e);
      setDocuments([]);
    }
    setDocumentsLoading(false);
  }

  async function openDocument(urlPath) {
    const baseUrl = API + urlPath;
    const authedUrl = AUTH_TOKEN
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(AUTH_TOKEN)}`
      : baseUrl;

    try {
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-undef
        window.open(authedUrl, '_blank');
        return;
      }

      // canOpenURL() can return false for regular http(s) links on some devices,
      // so we attempt to open anyway and fall back to showing the URL.
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
  }, [activeTab, profileId]);

  async function loadSettings() {
    setSettingsLoading(true);
    try {
      const s = await apiFetch('/settings');
      setNotificationEmail(s?.notification_email || '');
      setAutoEmail(s?.auto_email !== false);
    } catch (e) {
      console.log('Kunne ikke laste settings:', e);
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

  const renderHome = () => {
    const ripple = Platform.OS === 'android'
      ? { android_ripple: { color: 'rgba(139, 92, 246, 0.18)' } }
      : {};

    const firstName = (name || '').trim().split(' ')[0] || '';

    const mascotBob = mascotAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -4],
    });

    const mascotHeadTilt = mascotAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['-2deg', '2deg'],
    });

    const mascotArmRotate = mascotAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['-28deg', '34deg'],
    });

    const mascotBlink = mascotAnim.interpolate({
      inputRange: [0, 0.44, 0.5, 0.56, 1],
      outputRange: [1, 1, 0.12, 1, 1],
    });

    const mascotShadowScale = mascotAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.86],
    });

    const mascotShadowOpacity = mascotAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.28, 0.16],
    });

    return (
      <>
        <View style={styles.homeTopBar}>
          <View style={styles.homeTopBarLeft}>
            <View style={styles.homeBrandRow}>
              <Text style={styles.homeBrandName}>{t('appName')}</Text>
              {(jobAnalyses.length > 0) ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationCount}>{jobAnalyses.length}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.homeGreeting}>{t('hi')}, {firstName}.</Text>
            <Text style={styles.homeTagline}>{t('welcomeQuestion')}</Text>
            <Text style={styles.homeSub}>{t('welcomeBody')}</Text>
          </View>

          <Pressable
            {...ripple}
            style={styles.homeMascotButton}
            onPress={() => setActiveTab('interview')}
          >
            <View style={styles.mascotStage}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.mascotShadow,
                  {
                    opacity: mascotShadowOpacity,
                    transform: [{ scale: mascotShadowScale }],
                  },
                ]}
              />

              <Animated.View style={[styles.mascotWrap, { transform: [{ translateY: mascotBob }] }]}>
                <Animated.View style={[styles.mascotHead, { transform: [{ rotate: mascotHeadTilt }] }]}>
                  <View style={styles.mascotHair} />
                </Animated.View>

                <View style={styles.mascotNeck} />
                <View style={styles.mascotBody} />

                <Animated.View style={[styles.mascotArmWave, { transform: [{ rotate: mascotArmRotate }] }]} />
                <View style={styles.mascotHand} />
                <View style={styles.mascotArmStatic} />

                <View style={styles.mascotEyesRow}>
                  <Animated.View style={[styles.mascotEye, { transform: [{ scaleY: mascotBlink }] }]} />
                  <Animated.View style={[styles.mascotEye, { transform: [{ scaleY: mascotBlink }] }]} />
                </View>

                <View style={styles.mascotMouth} />
              </Animated.View>
            </View>
          </Pressable>
        </View>

        <View style={styles.pageCard}>
          <Text style={styles.sectionTitle}>Start her</Text>
          <Text style={[styles.helpText, { marginBottom: 10 }]}>Kjør en rask analyse eller oppdater status på søknadene dine.</Text>

          <TouchableOpacity style={[styles.primaryButton, { marginTop: 0 }]} onPress={() => setActiveTab('new')}>
            <Text style={styles.primaryButtonText}>Ny annonse-analyse</Text>
          </TouchableOpacity>

          <View style={styles.homePrimaryRow}>
            <TouchableOpacity style={[styles.secondaryButton, { flex: 1, marginTop: 10, marginRight: 8 }]} onPress={() => setActiveTab('cv')}>
              <Text style={styles.secondaryButtonText}>Analyser CV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryButton, { flex: 1, marginTop: 10 }]} onPress={() => setActiveTab('applications')}>
              <Text style={styles.secondaryButtonText}>Søknadsstatus</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t('quickActions')}</Text>
        <View style={styles.actionList}>
          {actionButtons.map((item) => (
            <Pressable
              key={item.key}
              {...ripple}
              style={styles.actionRow}
              onPress={item.onPress}
            >
              <View style={styles.actionRowLeft}>
                <View style={[styles.actionIconPill, { backgroundColor: item.tint }]}>
                  <Text style={styles.actionIcon}>{item.icon}</Text>
                </View>
                <View style={styles.actionRowText}>
                  <Text style={styles.actionRowTitle}>{item.title}</Text>
                  <Text style={styles.actionRowSubtitle}>{item.subtitle}</Text>
                </View>
              </View>
              <Text style={styles.actionChevron}>›</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Progressoverblikk</Text>
        <View style={styles.progressList}>
          {progressItems.map((item) => (
            <Pressable
              key={item.title}
              {...ripple}
              style={styles.progressRow}
              onPress={() => setActiveTab(item.tab)}
            >
              <View style={styles.progressHeader}>
                <Text style={styles.progressCardTitle}>{item.title}</Text>
                <Text style={styles.progressCardPercent}>{item.value}</Text>
              </View>
              <View style={styles.progressOuter}>
                <View style={[styles.progressInner, { width: `${item.percent}%` }]} />
              </View>
              <Text style={styles.progressStatus}>{item.status}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>Dagens karrieretips</Text>
          <Text style={styles.tipText}>{tipText}</Text>
          <Pressable {...ripple} style={styles.tipLink} onPress={() => setActiveTab('applications')}>
            <Text style={styles.tipLinkText}>Se søknadsstatus</Text>
          </Pressable>
        </View>
      </>
    );
  };

  async function analyzeCv() {
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen før CV-analyse');
      return;
    }

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
      Alert.alert('Feil', String(e));
    }
    setCvLoading(false);
  }

  const renderCv = () => (
    <View style={styles.pageCard}>
      <Text style={styles.pageTitle}>Analyser CV / profil</Text>
      <Text style={styles.pageSubtitle}>Få forslag til relevante jobber og råd basert på utdanning og erfaring.</Text>

      <TouchableOpacity style={styles.primaryButton} onPress={analyzeCv}>
        <Text style={styles.primaryButtonText}>{cvLoading ? 'Analyserer...' : 'Analyser profilen min'}</Text>
      </TouchableOpacity>

      {cvAnalysis ? (
        <View style={styles.analysisCard}>
          {cvAnalysis.summary ? (
            <>
              <Text style={styles.analysisSubheading}>Oppsummering</Text>
              <Text style={styles.analysisList}>{cvAnalysis.summary}</Text>
            </>
          ) : null}

          {cvAnalysis.education_fit ? (
            <>
              <Text style={styles.analysisSubheading}>Hva du er kvalifisert til</Text>
              <Text style={styles.analysisList}>{cvAnalysis.education_fit}</Text>
            </>
          ) : null}

          {cvAnalysis.suggested_roles?.length > 0 ? (
            <>
              <Text style={styles.analysisSubheading}>Jobbtyper du kan søke på</Text>
              {cvAnalysis.suggested_roles.map((item, idx) => (
                <Text key={idx} style={styles.analysisList}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.strengths?.length > 0 ? (
            <>
              <Text style={styles.analysisSubheading}>Styrker</Text>
              {cvAnalysis.strengths.map((item, idx) => (
                <Text key={idx} style={styles.analysisList}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.gaps?.length > 0 ? (
            <>
              <Text style={styles.analysisSubheading}>Mulige hull / svakheter</Text>
              {cvAnalysis.gaps.map((item, idx) => (
                <Text key={idx} style={styles.analysisList}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.improvement_tips?.length > 0 ? (
            <>
              <Text style={styles.analysisSubheading}>Konkrete råd</Text>
              {cvAnalysis.improvement_tips.map((item, idx) => (
                <Text key={idx} style={styles.analysisList}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.search_keywords?.length > 0 ? (
            <>
              <Text style={styles.analysisSubheading}>Søkeord</Text>
              <Text style={styles.analysisList}>{cvAnalysis.search_keywords.join(', ')}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const renderAnalysis = () => (
    <View style={styles.pageCard}>
      <Text style={styles.pageTitle}>Analyser jobbannonse</Text>
      <Text style={styles.pageSubtitle}>Lim inn en jobbannonse for rask match og forbedringstips.</Text>
      <TextInput
        style={styles.input}
        placeholder="Lim inn jobbannonse-URL"
        value={jobUrl}
        onChangeText={setJobUrl}
        autoCapitalize="none"
      />
      <TouchableOpacity style={styles.primaryButton} onPress={analyzeJob}>
        <Text style={styles.primaryButtonText}>{loading ? 'Analyserer...' : 'Analyser jobb'}</Text>
      </TouchableOpacity>

      <View style={{ marginTop: 10 }}>
        <Text style={styles.sectionTitle}>Tidligere analyser</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={loadJobAnalyses}>
          <Text style={styles.secondaryButtonText}>{jobAnalysesLoading ? 'Laster...' : 'Oppdater liste'}</Text>
        </TouchableOpacity>

        {jobAnalysesLoading ? (
          <Text style={[styles.helpText, { marginTop: 8 }]}>Laster analyser...</Text>
        ) : null}

        {!jobAnalysesLoading && jobAnalyses.length === 0 ? (
          <Text style={[styles.helpText, { marginTop: 8 }]}>Ingen analyser ennå. Analyser en jobb-URL for å få den inn her.</Text>
        ) : null}

        {jobAnalyses.map((item) => (
          <View key={item.job.id} style={styles.messageCard}>
            <Text style={styles.messageTitle}>{item.job.title}</Text>
            <Text style={styles.messageText}>{item.job.company || 'Ukjent bedrift'}</Text>
            <Text style={[styles.helpText, { marginTop: 6 }]}>Matchscore: {Math.round(item.match_score || item.job.match_score || 0)}%</Text>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 10, paddingVertical: 12 }]}
              onPress={() => openSavedAnalysis(item.job.id, item?.job?.url)}
            >
              <Text style={styles.secondaryButtonText}>Åpne analyse</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 10, paddingVertical: 12 }]}
              onPress={() => moveAnalysisToApplications(item.job.id)}
            >
              <Text style={styles.secondaryButtonText}>Legg til i Søknader</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.removeButton, { marginTop: 10 }]}
              onPress={() => hideJobAnalysis(item.job.id)}
            >
              <Text style={styles.removeButtonText}>Fjern fra listen</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {analysis && (
        <View style={styles.analysisCard}>
          <Text style={styles.analysisHeading}>Analyse</Text>
          <View style={styles.analysisRow}>
            <Text style={styles.analysisLabel}>Matchscore</Text>
            <Text style={styles.analysisValue}>{analysis.match_score ?? 0}%</Text>
          </View>
          <View style={styles.analysisRow}>
            <Text style={styles.analysisLabel}>Søkeanbefaling</Text>
            <Text style={styles.analysisValue}>{analysis.should_apply ? 'JA' : 'NEI'}</Text>
          </View>

          {analysis.recommended_application_style ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.analysisSubheading}>Anbefalt søknadslengde</Text>
              <Text style={styles.analysisList}>
                {analysis.recommended_application_style === 'kort'
                  ? 'Kort (1 avsnitt)'
                  : analysis.recommended_application_style === 'profesjonell'
                    ? 'Profesjonell (4–6 avsnitt)'
                    : 'Vanlig (2–3 avsnitt)'}
              </Text>
              {analysis.recommended_style_reason ? (
                <Text style={styles.analysisList}>{analysis.recommended_style_reason}</Text>
              ) : null}
              <TouchableOpacity
                style={[styles.secondaryButton, { marginTop: 8, paddingVertical: 12 }]}
                onPress={() => setApplicationStyle(analysis.recommended_application_style)}
              >
                <Text style={styles.secondaryButtonText}>Bruk anbefalt</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {analysis.honest_assessment ? (
            <>
              <Text style={styles.analysisSubheading}>Ærlig vurdering</Text>
              <Text style={styles.analysisList}>{analysis.honest_assessment}</Text>
            </>
          ) : null}
          {analysis.missing_requirements?.length > 0 && (
            <>
              <Text style={styles.analysisSubheading}>Mangler</Text>
              {analysis.missing_requirements.map((item, index) => (
                <Text key={index} style={styles.analysisList}>• {item}</Text>
              ))}
            </>
          )}
          {analysis.improvement_tips?.length > 0 && (
            <>
              <Text style={styles.analysisSubheading}>Forbedringstips</Text>
              {analysis.improvement_tips.map((item, index) => (
                <Text key={index} style={styles.analysisList}>• {item}</Text>
              ))}
            </>
          )}
          <Text style={[styles.inputLabel, { marginTop: 18 }]}>Velg søknadslengde</Text>
          <View style={styles.filterChipRow}>
            {[
              { key: 'kort', label: 'Kort (1 avsnitt)' },
              { key: 'vanlig', label: 'Vanlig (2–3 avsnitt)' },
              { key: 'profesjonell', label: 'Profesjonell (4–6 avsnitt)' },
            ].map((opt) => {
              const active = applicationStyle === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setApplicationStyle(opt.key)}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.inputLabel, { marginTop: 6 }]}>Send til e-post</Text>
          <TextInput
            style={styles.input}
            placeholder="Din e-postadresse"
            value={applicationEmail}
            onChangeText={setApplicationEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          {profilePhotoData ? (
            <View style={styles.profileField}>
              <Text style={styles.inputLabel}>Bilde i PDF</Text>
              <Text style={styles.helpText}>Du kan velge om profilbildet skal være med i denne søknaden/PDF-en (standard kan settes i Profil).</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.messageText}>{includePhotoInPdf ? 'På' : 'Av'}</Text>
                <Switch value={includePhotoInPdf} onValueChange={setIncludePhotoInPdf} />
              </View>
            </View>
          ) : null}

          <TouchableOpacity style={styles.secondaryButton} onPress={sendApplication}>
            <Text style={styles.secondaryButtonText}>{sending ? 'Sender...' : 'Send søknad (e-post)'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={generatePdf}>
            <Text style={styles.secondaryButtonText}>{generatingPdf ? 'Genererer...' : 'Generer PDF (uten e-post)'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderNew = () => (
    <View style={styles.pageCard}>
      <Text style={styles.pageTitle}>Ny søknad</Text>
      <Text style={styles.pageSubtitle}>Start ny jobbprosjekt med en annonse-URL.</Text>
      <TextInput
        style={styles.input}
        placeholder="Lim inn jobbannonse-URL"
        value={jobUrl}
        onChangeText={setJobUrl}
        autoCapitalize="none"
      />
      <TouchableOpacity style={styles.primaryButton} onPress={analyzeJob}>
        <Text style={styles.primaryButtonText}>{loading ? 'Analyserer...' : 'Start analyse'}</Text>
      </TouchableOpacity>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryName}>Hva skjer nå?</Text>
        <Text style={styles.summaryText}>Du får oversikt over krav, match og hva du bør fremheve i søknaden.</Text>
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
      <View style={styles.pageCard}>
        <Text style={styles.pageTitle}>Søknader</Text>
        <Text style={styles.pageSubtitle}>Én linje per jobb. Huk av status etter hvert.</Text>

        {!consentAnalytics ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryName}>Anonym statistikk: AV</Text>
            <Text style={styles.summaryText}>Hvis du skrur på anonym statistikk i Profil, kan resultatene dine inngå i samlet statistikk.</Text>
          </View>
        ) : null}

        {statsMe ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryName}>Din statistikk</Text>
            <Text style={styles.summaryText}>Totalt: {statsMe.total} • Sendt: {statsMe.applied} • Intervju: {statsMe.interviewed} • Fikk jobb: {statsMe.got_job}</Text>
            <Text style={styles.summaryText}>Intervju-rate: {Math.round((statsMe.interview_rate || 0) * 100)}% • Jobb-rate: {Math.round((statsMe.hire_rate || 0) * 100)}%</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.secondaryButton} onPress={loadApplications}>
          <Text style={styles.secondaryButtonText}>{applicationsLoading ? 'Laster...' : 'Oppdater liste'}</Text>
        </TouchableOpacity>

        {applicationsLoading ? (
          <Text style={[styles.helpText, { marginTop: 12 }]}>Laster søknader...</Text>
        ) : null}

        {!applicationsLoading && applications.length === 0 ? (
          <Text style={[styles.helpText, { marginTop: 12 }]}>Ingen søknader ennå. Tips: bruk "Legg til i Søknader" fra en analyse.</Text>
        ) : null}

        {applications.length > 0 ? (
          <View style={styles.tableCard}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.tableJobHeader]}>Jobb</Text>
              <Text style={styles.tableHeaderCell}>Søkt</Text>
              <Text style={styles.tableHeaderCell}>Intervju</Text>
              <Text style={styles.tableHeaderCell}>Jobb</Text>
            </View>

            {applications.map((item) => (
              <View key={item.job.id} style={styles.tableRow}>
                <View style={styles.tableJobCell}>
                  <Text style={styles.tableJobTitle} numberOfLines={1}>{item.job.title}</Text>
                  <Text style={styles.tableJobCompany} numberOfLines={1}>{item.job.company || 'Ukjent bedrift'}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.checkbox, item.applied && styles.checkboxOn]}
                  onPress={() => toggle(item, 'applied')}
                >
                  <Text style={[styles.checkboxText, item.applied && styles.checkboxTextOn]}>{item.applied ? '✓' : ''}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.checkbox, item.interviewed && styles.checkboxOn]}
                  onPress={() => toggle(item, 'interviewed')}
                >
                  <Text style={[styles.checkboxText, item.interviewed && styles.checkboxTextOn]}>{item.interviewed ? '✓' : ''}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.checkbox, item.got_job && styles.checkboxOn]}
                  onPress={() => toggle(item, 'got_job')}
                >
                  <Text style={[styles.checkboxText, item.got_job && styles.checkboxTextOn]}>{item.got_job ? '✓' : ''}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderDocuments = () => (
    <View style={styles.pageCard}>
      <Text style={styles.pageTitle}>Dokumenter</Text>
      <Text style={styles.pageSubtitle}>Her finner du genererte PDF-er (søknad + CV i samme fil).</Text>

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

  const renderInterview = () => {
    const qList = INTERVIEW_QUESTIONS[uiLanguage] || INTERVIEW_QUESTIONS.no;
    const q = qList[interviewIndex % qList.length];
    const notes = interviewNotes[String(interviewIndex)] || '';

    return (
      <View style={styles.pageCard}>
        <Text style={styles.pageTitle}>{t('interviewTitle')}</Text>
        <Text style={styles.pageSubtitle}>{t('interviewSubtitle')}</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryName}>Spørsmål {interviewIndex + 1} / {qList.length}</Text>
          <Text style={styles.summaryText}>{q}</Text>
        </View>

        <Text style={styles.inputLabel}>{t('yourNotes')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={notes}
          onChangeText={(v) => setInterviewNotes((prev) => ({ ...(prev || {}), [String(interviewIndex)]: v }))}
          placeholder={t('yourNotes')}
          multiline
        />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <TouchableOpacity
            style={[styles.secondaryButton, { flex: 1, marginTop: 0, marginRight: 6 }]}
            onPress={() => setInterviewIndex((i) => (i <= 0 ? 0 : i - 1))}
          >
            <Text style={styles.secondaryButtonText}>{t('previous')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, { flex: 1, marginTop: 0, marginLeft: 6 }]}
            onPress={() => setInterviewIndex((i) => (i >= qList.length - 1 ? 0 : i + 1))}
          >
            <Text style={styles.primaryButtonText}>{t('next')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.secondaryButton, { marginTop: 12 }]}
          onPress={() => setActiveTab('home')}
        >
          <Text style={styles.secondaryButtonText}>Tilbake</Text>
        </TouchableOpacity>
      </View>
    );
  };

  async function pickProfilePhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm?.granted) {
        Alert.alert('Tillatelse', 'Du må gi tilgang til bildebiblioteket for å velge bilde.');
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        base64: true,
      });

      if (res.canceled) return;
      const asset = (res.assets && res.assets[0]) ? res.assets[0] : null;
      if (!asset || !asset.base64) {
        Alert.alert('Feil', 'Kunne ikke lese bilde (mangler base64).');
        return;
      }

      const mime = asset.mimeType || 'image/jpeg';
      const dataUri = `data:${mime};base64,${asset.base64}`;
      setProfilePhotoData(dataUri);

      // Auto-save to backend so generated PDFs can include the photo immediately.
      if (profileId) {
        saveProfile({ silent: true, override: { photo_data: dataUri } });
      }
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
  }

  const renderProfile = () => (
    <View style={styles.pageCard}>
      <Text style={styles.pageTitle}>Profil</Text>
      <Text style={styles.pageSubtitle}>Personopplysninger, erfaring og referanser.</Text>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Navn</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Navn" />
      </View>

      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Profilbilde (valgfritt)</Text>
        {profilePhotoData ? (
          <View style={{ alignItems: 'center', marginBottom: 10 }}>
            <Image
              source={{ uri: profilePhotoData }}
              style={{ width: 110, height: 110, borderRadius: 16, marginBottom: 10 }}
            />
            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 0, paddingVertical: 12, width: '100%' }]}
              onPress={() => {
                setProfilePhotoData('');
                if (profileId) {
                  saveProfile({ silent: true, override: { photo_data: '' } });
                }
              }}
            >
              <Text style={styles.secondaryButtonText}>Fjern bilde</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity style={[styles.secondaryButton, { marginTop: 0, paddingVertical: 12 }]} onPress={pickProfilePhoto}>
          <Text style={styles.secondaryButtonText}>{profilePhotoData ? 'Bytt bilde' : 'Velg bilde'}</Text>
        </TouchableOpacity>

        <Text style={styles.helpText}>Du kan velge om bildet skal være med i hver PDF når du lager søknad.</Text>

        {profilePhotoData ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.inputLabel}>Bilde i PDF som standard</Text>
            <Text style={styles.helpText}>Dette blir standardvalget hver gang du lager ny søknad/PDF (kan overstyres per søknad).</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.messageText}>{includePhotoDefault ? 'På' : 'Av'}</Text>
              <Switch
                value={includePhotoDefault}
                onValueChange={(v) => {
                  setIncludePhotoDefault(!!v);
                  setIncludePhotoInPdf(!!v);
                  if (profileId) {
                    saveProfile({ silent: true, override: { include_photo_default: !!v } });
                  }
                }}
              />
            </View>
          </View>
        ) : null}
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>E-post</Text>
        <TextInput style={styles.input} value={profileEmail} onChangeText={setProfileEmail} placeholder="E-post" autoCapitalize="none" keyboardType="email-address" />
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Telefon</Text>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Telefon" keyboardType="phone-pad" />
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Adresse</Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="Gateadresse"
          autoCapitalize="words"
        />
      </View>

      <View style={styles.inlineRow}>
        <TextInput
          style={[styles.input, styles.inlineInput]}
          value={postalCode}
          onChangeText={setPostalCode}
          placeholder="Postnr"
          keyboardType="numeric"
        />
        <TextInput
          style={[styles.input, styles.inlineInput, { marginRight: 0 }]}
          value={postalPlace}
          onChangeText={setPostalPlace}
          placeholder="Poststed"
          autoCapitalize="words"
        />
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Erfaring</Text>
        {experienceEntries.map((entry, index) => (
          <View key={index} style={styles.listItem}>
            <TextInput
              style={styles.input}
              value={entry.title}
              placeholder="Stillingstittel"
              onChangeText={(value) => {
                const items = [...experienceEntries];
                items[index].title = value;
                setExperienceEntries(items);
              }}
            />
            <TextInput
              style={styles.input}
              value={entry.company}
              placeholder="Arbeidsgiver"
              onChangeText={(value) => {
                const items = [...experienceEntries];
                items[index].company = value;
                setExperienceEntries(items);
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <TouchableOpacity
                style={[styles.checkbox, { marginLeft: 0 }, entry.current && styles.checkboxOn]}
                onPress={() => {
                  const items = [...experienceEntries];
                  const next = !items[index].current;
                  items[index].current = next;
                  if (next) {
                    items[index].to = '';
                  }
                  setExperienceEntries(items);
                }}
              >
                <Text style={[styles.checkboxText, entry.current && styles.checkboxTextOn]}>{entry.current ? '✓' : ''}</Text>
              </TouchableOpacity>
              <Text style={{ marginLeft: 10, color: THEME.colors.muted, fontSize: 13, fontWeight: '700' }}>
                Jobber her fremdeles
              </Text>
            </View>

            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={entry.from || ''}
                placeholder="Fra (år/mnd)"
                onChangeText={(value) => {
                  const items = [...experienceEntries];
                  items[index].from = value;
                  setExperienceEntries(items);
                }}
              />
              <TextInput
                style={[styles.input, styles.inlineInput, { marginRight: 0 }, entry.current && { opacity: 0.6 }]}
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
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => {
                const items = experienceEntries.filter((_, i) => i !== index);
                setExperienceEntries(items);
              }}
            >
              <Text style={styles.removeButtonText}>Fjern</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          style={styles.smallButton}
          onPress={() => setExperienceEntries([...experienceEntries, { title: '', company: '', from: '', to: '', current: false }])}
        >
          <Text style={styles.smallButtonText}>Legg til erfaring</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Utdanning</Text>
        {educationEntries.map((entry, index) => (
          <View key={index} style={styles.listItem}>
            <TouchableOpacity
              style={styles.input}
              onPress={() => {
                setShowSchoolListIndex(index);
                setSchoolFilter('');
                setSchoolKindFilter('all');
                setSchoolResults([]);
              }}
            >
              <Text style={entry.school ? styles.inputText : styles.placeholderText}>
                {entry.school || 'Velg skole'}
              </Text>
            </TouchableOpacity>
            {showSchoolListIndex === index && (
              <View style={styles.dropdownList}>
                <TextInput
                  style={[styles.input, { margin: 8 }]}
                  placeholder="Søk: videregående, universitet eller nettskole..."
                  value={schoolFilter}
                  onChangeText={setSchoolFilter}
                  autoCapitalize="words"
                />

                <View style={styles.filterChipRow}>
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
                        style={[styles.filterChip, active && styles.filterChipActive]}
                        onPress={() => setSchoolKindFilter(item.key)}
                      >
                        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{item.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {schoolFilter.trim().length < 2 ? (
                  <Text style={[styles.helpText, { marginLeft: 12, marginBottom: 8 }]}>Skriv minst 2 bokstaver for forslag.</Text>
                ) : null}

                {schoolResultsLoading ? (
                  <Text style={[styles.helpText, { marginLeft: 12, marginBottom: 8 }]}>Laster skoler...</Text>
                ) : null}

                {!schoolResultsLoading && schoolFilter.trim().length >= 2 && (
                  (schoolResults.length === 0 &&
                    schoolOptions.filter((s) => s.toLowerCase().includes(schoolFilter.toLowerCase())).length === 0)
                ) ? (
                  <Text style={[styles.helpText, { marginLeft: 12, marginBottom: 8 }]}>Ingen treff.</Text>
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
                      <Text style={styles.dropdownItemText}>{option.name}</Text>
                      {option.kind || option.kommune ? (
                        <Text style={styles.dropdownItemSub}>
                          {[option.kind, option.kommune].filter(Boolean).join(' • ')}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
              </View>
            )}
            <TextInput
              style={styles.input}
              value={entry.degree}
              placeholder="Grad / studieretning"
              onChangeText={(value) => {
                const items = [...educationEntries];
                items[index].degree = value;
                setEducationEntries(items);
              }}
            />
            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={entry.from}
                placeholder="Fra (år/mnd)"
                onChangeText={(value) => {
                  const items = [...educationEntries];
                  items[index].from = value;
                  setEducationEntries(items);
                }}
              />
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={entry.to}
                placeholder="Til (år/mnd)"
                onChangeText={(value) => {
                  const items = [...educationEntries];
                  items[index].to = value;
                  setEducationEntries(items);
                }}
              />
            </View>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => {
                const items = educationEntries.filter((_, i) => i !== index);
                setEducationEntries(items);
              }}
            >
              <Text style={styles.removeButtonText}>Fjern</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.smallButton} onPress={() => setEducationEntries([...educationEntries, { school: '', degree: '', from: '', to: '' }])}>
          <Text style={styles.smallButtonText}>Legg til utdanning</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Ferdigheter</Text>
        <TextInput style={styles.input} value={skills} onChangeText={setSkills} placeholder="Stikkord som AI bruker i søknaden" autoCapitalize="none" />
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Språk</Text>
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {languagesList.map((lang, i) => (
              <TouchableOpacity key={i} style={[styles.smallButton, { marginRight: 8, marginBottom: 8 }]} onPress={() => setLanguagesList(languagesList.filter((l) => l !== lang))}>
                <Text style={styles.smallButtonText}>{lang} ✕</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <TouchableOpacity style={styles.input} onPress={() => setShowLanguageList(!showLanguageList)}>
          <Text style={styles.placeholderText}>Legg til språk</Text>
        </TouchableOpacity>
        {showLanguageList && (
          <View style={styles.dropdownList}>
            <TextInput
              style={[styles.input, { margin: 8 }]}
              placeholder="Legg til eget språk (skriv og trykk 'Legg til')"
              value={customLanguageInput}
              onChangeText={setCustomLanguageInput}
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[styles.smallButton, { marginHorizontal: 8, marginTop: 0, marginBottom: 8 }]}
              onPress={() => {
                const v = (customLanguageInput || '').trim();
                if (!v) return;
                if (!languagesList.includes(v)) {
                  setLanguagesList([...languagesList, v]);
                }
                setCustomLanguageInput('');
                setShowLanguageList(false);
              }}
            >
              <Text style={styles.smallButtonText}>Legg til</Text>
            </TouchableOpacity>

            {languageOptions.map((lang) => (
              <TouchableOpacity
                key={lang}
                style={styles.dropdownItem}
                onPress={() => {
                  if (!languagesList.includes(lang)) setLanguagesList([...languagesList, lang]);
                  setCustomLanguageInput('');
                  setShowLanguageList(false);
                }}
              >
                <Text style={styles.dropdownItemText}>{lang}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Hull i CV</Text>
        <Text style={styles.helpText}>Skriv kort om pauser eller hull i arbeids- eller utdanningshistorikken.</Text>
        <TextInput style={[styles.input, styles.textArea]} value={cvGaps} onChangeText={setCvGaps} placeholder="Hull i CV" multiline />
      </View>
      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Referanser</Text>
        <Text style={styles.helpText}>Legg inn referanser du kan oppgi ved behov (navn, relasjon og kontaktinfo).</Text>

        {referenceEntries.map((ref, index) => (
          <View key={index} style={styles.listItem}>
            <TextInput
              style={styles.input}
              value={ref.name}
              placeholder="Navn"
              onChangeText={(value) => {
                const items = [...referenceEntries];
                items[index].name = value;
                setReferenceEntries(items);
              }}
            />
            <TextInput
              style={styles.input}
              value={ref.relation}
              placeholder="Relasjon (f.eks. Leder i X / Kollega)"
              onChangeText={(value) => {
                const items = [...referenceEntries];
                items[index].relation = value;
                setReferenceEntries(items);
              }}
            />
            <TextInput
              style={styles.input}
              value={ref.contact}
              placeholder="Kontakt (telefon eller e-post)"
              onChangeText={(value) => {
                const items = [...referenceEntries];
                items[index].contact = value;
                setReferenceEntries(items);
              }}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => {
                const items = referenceEntries.filter((_, i) => i !== index);
                setReferenceEntries(items);
              }}
            >
              <Text style={styles.removeButtonText}>Fjern</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={styles.smallButton}
          onPress={() => setReferenceEntries([...(referenceEntries || []), { name: '', relation: '', contact: '' }])}
        >
          <Text style={styles.smallButtonText}>Legg til referanse</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Anonym statistikk</Text>
        <Text style={styles.helpText}>Hjelper oss å se om appen faktisk øker sjansen for intervju og jobb. Vi bruker kun status (søkt/intervju/fikk jobb), ikke navn eller kontaktinfo.</Text>
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
          <Text style={{ color: THEME.colors.primary, fontWeight: '700' }}>{t('privacyLink')}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.messageText}>{consentAnalytics ? 'På' : 'Av'}</Text>
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
      <TouchableOpacity style={styles.secondaryButton} onPress={() => setActiveTab('documents')}> 
        <Text style={styles.secondaryButtonText}>Dokumenter</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => setActiveTab('settings')}> 
        <Text style={styles.secondaryButtonText}>E-postinnstillinger</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.primaryButton} onPress={saveProfile}>
        <Text style={styles.primaryButtonText}>{savingProfile ? 'Lagrer...' : 'Lagre profil'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, { borderColor: THEME.colors.danger }]}
        onPress={deleteAccount}
      >
        <Text style={[styles.secondaryButtonText, { color: THEME.colors.danger }]}>Slett konto og data</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, { borderColor: THEME.colors.danger }]}
        onPress={logout}
      >
        <Text style={[styles.secondaryButtonText, { color: THEME.colors.danger }]}>Logg ut</Text>
      </TouchableOpacity>
    </View>
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
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {renderAuth()}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'home' && renderHome()}
        {activeTab === 'cv' && renderCv()}
        {activeTab === 'analysis' && renderAnalysis()}
        {activeTab === 'new' && renderNew()}
        {activeTab === 'applications' && renderApplications()}
        {activeTab === 'documents' && renderDocuments()}
        {activeTab === 'settings' && renderSettings()}
        {activeTab === 'interview' && renderInterview()}
        {activeTab === 'profile' && renderProfile()}
      </ScrollView>
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.bottomButton} onPress={() => setActiveTab('home')}>
          <Text style={[styles.bottomIcon, activeTab === 'home' && styles.bottomIconActive]}>🏠</Text>
          <Text style={[styles.bottomLabel, activeTab === 'home' && styles.bottomLabelActive]}>{t('tabHome')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomButton} onPress={() => setActiveTab('analysis')}>
          <Text style={[styles.bottomIcon, activeTab === 'analysis' && styles.bottomIconActive]}>🔍</Text>
          <Text style={[styles.bottomLabel, activeTab === 'analysis' && styles.bottomLabelActive]}>{t('tabAnalyze')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fabButton} onPress={() => setActiveTab('new')}>
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomButton} onPress={() => setActiveTab('applications')}>
          <Text style={[styles.bottomIcon, activeTab === 'applications' && styles.bottomIconActive]}>📬</Text>
          <Text style={[styles.bottomLabel, activeTab === 'applications' && styles.bottomLabelActive]}>{t('tabApplications')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomButton} onPress={() => setActiveTab('profile')}>
          <Text style={[styles.bottomIcon, activeTab === 'profile' && styles.bottomIconActive]}>👤</Text>
          <Text style={[styles.bottomLabel, activeTab === 'profile' && styles.bottomLabelActive]}>{t('tabProfile')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
  },
  heroHeader: {
    // (ikke i bruk på Home lenger – beholdes for enkel rollback)
    backgroundColor: '#0f2147',
    borderRadius: 28,
    padding: 22,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroTextWrapper: {
    flex: 1,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  brandName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#dbeafe',
  },
  notificationBadge: {
    marginLeft: 10,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2dd4bf',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationCount: {
    color: THEME.colors.text,
    fontWeight: '800',
    fontSize: 12,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#cbd5e1',
    lineHeight: 22,
    marginBottom: 18,
    maxWidth: '90%',
  },
  progressSection: {
    marginTop: 8,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  progressLabel: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  progressPercent: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '700',
  },
  progressBar: {
    width: '100%',
    height: 10,
    borderRadius: 24,
    backgroundColor: '#152848',
  },
  progressFill: {
    width: '68%',
    height: '100%',
    borderRadius: 24,
    backgroundColor: '#34d399',
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 24,
    marginLeft: 16,
  },
  mainCard: {
    backgroundColor: THEME.colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,

    // Material-ish card elevation
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
    color: THEME.colors.text,
  },
  cardText: {
    fontSize: 15,
    color: THEME.colors.muted,
    lineHeight: 22,
    marginBottom: 18,
  },
  cardButton: {
    backgroundColor: THEME.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: 14,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  actionItem: {
    width: '48%',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,

    // Material-ish elevation (subtle)
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: 6,
  },
  actionSubtitle: {
    fontSize: 13,
    color: THEME.colors.muted,
    lineHeight: 20,
  },
  progressCard: {
    backgroundColor: THEME.colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,

    // Material-ish card elevation
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  progressCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.text,
  },
  progressCardPercent: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.success,
  },
  progressOuter: {
    width: '100%',
    height: 10,
    borderRadius: 12,
    backgroundColor: THEME.colors.border,
  },
  progressInner: {
    height: '100%',
    borderRadius: 12,
    backgroundColor: THEME.colors.primary,
  },
  progressStatus: {
    marginTop: 10,
    color: THEME.colors.muted,
    fontSize: 13,
  },
  tipCard: {
    backgroundColor: THEME.colors.primarySoft,
    borderRadius: THEME.radius.card,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: 10,
  },
  tipText: {
    fontSize: 14,
    color: THEME.colors.muted,
    lineHeight: 20,
  },
  tipLink: {
    marginTop: 14,
  },
  tipLinkText: {
    color: THEME.colors.primary,
    fontWeight: '800',
  },
  pageCard: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radius.card,
    padding: 20,
    marginBottom: 16,

    // Material-ish card elevation
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: THEME.colors.text,
    marginBottom: 10,
  },
  pageSubtitle: {
    fontSize: 15,
    color: THEME.colors.muted,
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: THEME.colors.muted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: THEME.colors.surfaceAlt,
    borderRadius: THEME.radius.control,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    fontSize: 15,
    color: THEME.colors.text,
    marginBottom: 14,
  },
  inputText: {
    color: THEME.colors.text,
    fontSize: 15,
  },
  placeholderText: {
    color: '#71717a',
    fontSize: 15,
  },
  helpText: {
    color: THEME.colors.muted,
    fontSize: 13,
    marginBottom: 8,
  },
  listItem: {
    backgroundColor: THEME.colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  inlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  inlineInput: {
    flex: 1,
    marginRight: 8,
  },
  removeButton: {
    backgroundColor: THEME.colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: THEME.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    borderWidth: 1,
    borderColor: THEME.colors.danger,
  },
  removeButtonText: {
    color: THEME.colors.danger,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  smallButton: {
    backgroundColor: THEME.colors.surfaceAlt,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: THEME.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  smallButtonText: {
    color: THEME.colors.primary,
    fontWeight: '700',
    letterSpacing: 0.25,
  },
  dropdownList: {
    backgroundColor: THEME.colors.surface,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  dropdownItemText: {
    color: THEME.colors.text,
    fontSize: 15,
  },
  dropdownItemSub: {
    marginTop: 2,
    color: THEME.colors.muted,
    fontSize: 12,
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  filterChip: {
    backgroundColor: THEME.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: THEME.radius.pill,
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  filterChipText: {
    color: THEME.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: THEME.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: THEME.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    backgroundColor: THEME.colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: THEME.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: THEME.colors.primary,

    // Outlined buttons usually have no elevation
    elevation: 0,
  },
  secondaryButtonText: {
    color: THEME.colors.primary,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  analysisCard: {
    backgroundColor: THEME.colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  analysisHeading: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
    color: THEME.colors.text,
  },
  analysisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  analysisLabel: {
    fontSize: 14,
    color: THEME.colors.muted,
  },
  analysisValue: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  analysisSubheading: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
    color: THEME.colors.text,
  },
  analysisList: {
    fontSize: 14,
    color: THEME.colors.muted,
    marginBottom: 6,
    lineHeight: 20,
  },
  summaryCard: {
    backgroundColor: THEME.colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    marginBottom: 16,

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  summaryName: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: 6,
  },
  summaryText: {
    fontSize: 14,
    color: THEME.colors.muted,
    lineHeight: 20,
  },
  messageCard: {
    backgroundColor: THEME.colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  messageTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    color: THEME.colors.text,
  },
  messageText: {
    fontSize: 14,
    color: THEME.colors.muted,
    lineHeight: 20,
  },

  tableCard: {
    marginTop: 14,
    backgroundColor: THEME.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    overflow: 'hidden',

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: THEME.colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  tableHeaderCell: {
    width: 56,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.muted,
  },
  tableJobHeader: {
    flex: 1,
    width: 'auto',
    textAlign: 'left',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  tableJobCell: {
    flex: 1,
    paddingRight: 10,
  },
  tableJobTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  tableJobCompany: {
    marginTop: 2,
    fontSize: 12,
    color: THEME.colors.muted,
  },
  checkbox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  checkboxOn: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  checkboxText: {
    fontSize: 16,
    fontWeight: '900',
    color: THEME.colors.text,
  },
  checkboxTextOn: {
    color: '#ffffff',
  },

  profileField: {
    marginBottom: 16,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
    paddingHorizontal: 16,
    backgroundColor: THEME.colors.surface,
    borderTopColor: THEME.colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  bottomButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 58,
  },
  bottomIcon: {
    fontSize: 20,
    color: '#a1a1aa',
  },

  // Home (new)
  homeTopBar: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radius.card,
    padding: 18,
    marginBottom: 16,
    minHeight: 134,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    // Material-ish elevation
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  homeTopBarLeft: {
    flex: 1,
    paddingRight: 10,
  },
  homeBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  homeBrandName: {
    fontSize: 14,
    fontWeight: '800',
    color: THEME.colors.muted,
  },
  homeGreeting: {
    fontSize: 22,
    fontWeight: '900',
    color: THEME.colors.text,
    marginBottom: 6,
  },
  homeTagline: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: 8,
  },
  homeSub: {
    color: THEME.colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  homeMascotButton: {
    width: 86,
    height: 86,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: THEME.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascotStage: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascotShadow: {
    position: 'absolute',
    bottom: 16,
    width: 44,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#000',
  },
  mascotWrap: {
    width: 86,
    height: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascotHead: {
    position: 'absolute',
    top: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f1c27d',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    overflow: 'hidden',
  },
  mascotHair: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
    backgroundColor: '#1f1b2e',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  mascotNeck: {
    position: 'absolute',
    top: 56,
    width: 14,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#e0ac69',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  mascotBody: {
    position: 'absolute',
    top: 62,
    width: 54,
    height: 28,
    borderRadius: 16,
    backgroundColor: THEME.colors.primarySoft,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  mascotArmWave: {
    position: 'absolute',
    right: 8,
    top: 66,
    width: 26,
    height: 8,
    borderRadius: 8,
    backgroundColor: '#f1c27d',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  mascotArmStatic: {
    position: 'absolute',
    left: 10,
    top: 70,
    width: 22,
    height: 8,
    borderRadius: 8,
    backgroundColor: '#f1c27d',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    opacity: 0.85,
  },
  mascotHand: {
    position: 'absolute',
    right: 4,
    top: 63,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f1c27d',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  mascotEyesRow: {
    position: 'absolute',
    top: 34,
    flexDirection: 'row',
  },
  mascotEye: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.colors.background,
    marginRight: 10,
  },
  mascotMouth: {
    position: 'absolute',
    top: 46,
    width: 14,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.colors.border,
  },
  homePrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionList: {
    marginBottom: 18,
  },
  actionRow: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radius.card,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    marginBottom: 10,

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    // Material-ish elevation (subtle)
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  actionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 10,
  },
  actionIconPill: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionRowText: {
    flex: 1,
  },
  actionRowTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: 2,
  },
  actionRowSubtitle: {
    color: THEME.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  actionChevron: {
    color: '#a1a1aa',
    fontSize: 22,
    fontWeight: '900',
    marginLeft: 8,
  },
  progressList: {
    marginBottom: 12,
  },
  progressRow: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    marginBottom: 10,

    // Material-ish elevation (subtle)
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  bottomIconActive: {
    color: THEME.colors.primary,
  },
  bottomLabel: {
    fontSize: 11,
    color: '#a1a1aa',
    marginTop: 4,
  },
  bottomLabelActive: {
    color: THEME.colors.primary,
  },
  fabButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabIcon: {
    color: '#ffffff',
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '700',
  },
});
