import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
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
  StyleSheet,
  Alert,
  Image,
  Platform,
  NativeModules,
  Linking,
  Switch,
} from 'react-native';

import { THEME } from './styles/theme';
import { I18N } from './i18n/no';
import { INTERVIEW_QUESTIONS, CAREER_TIPS } from './constants/content';
import { schoolOptions, languageOptions } from './constants/options';
import InterviewScreen from './screens/InterviewScreen';

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

function validateApiBaseUrl(rawApiBaseUrl, { envProvided = false } = {}) {
  const api = (rawApiBaseUrl || '').trim();
  // __DEV__ is a React Native global (true in development, false in release builds)
  // eslint-disable-next-line no-undef
  const isDev = (typeof __DEV__ !== 'undefined') ? __DEV__ : true;

  function fail(msg) {
    const full = `[API] ${msg}`;
    console.error(full);
    throw new Error(full);
  }

  if (!api) {
    if (!isDev) {
      fail('Missing API base URL. Set EXPO_PUBLIC_API_URL to a public https://... backend URL for release builds.');
    }
    return api;
  }

  let hostname = '';
  try {
    // eslint-disable-next-line no-undef
    const u = new URL(api);
    hostname = String(u?.hostname || '');
  } catch (e) {
    if (!isDev) {
      fail(`Invalid API base URL: "${api}". It must be an absolute http(s) URL, e.g. https://your-backend.example.com`);
    }
    console.warn('[API] Could not parse API base URL (dev):', api);
    return api;
  }

  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isLan192 = /^192\.168\.(\d{1,3})\.(\d{1,3})$/.test(hostname);

  // In release builds we require an explicit env URL to avoid accidentally shipping
  // a fallback like http://localhost:8000.
  if (!isDev && !envProvided) {
    fail('EXPO_PUBLIC_API_URL is required in release builds. Refusing to use an auto-guessed localhost/LAN URL.');
  }

  // Explicitly block localhost / 127.0.0.1 in release.
  if (!isDev && isLocalhost) {
    fail(`Release build is configured with a local API URL (${api}). Use a public https://... backend URL instead.`);
  }

  // Development allowances (explicitly permitted by task): localhost/127 and 192.168.x.x
  if (isDev && (isLocalhost || isLan192)) {
    return api;
  }

  return api;
}

const ENV_API = (process.env.EXPO_PUBLIC_API_URL || '').trim();
const AUTO_API = (Platform.OS === 'web'
  ? 'http://localhost:8000'
  : DEV_HOST
    ? `http://${DEV_HOST}:8000`
    : 'http://localhost:8000');

const API = validateApiBaseUrl(ENV_API || AUTO_API, { envProvided: !!ENV_API });

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

// TODO: Må være publisert og korrekt før Google Play intern testing.
const PRIVACY_URL = 'https://frankbjelland.no/personvern-aerlig-jobbcoach';

// Career tips shown on the Home screen.
// We keep them locally and rotate them every few hours.
const TIP_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  const [appSortOrder, setAppSortOrder] = useState('newest');
  const [applicationStyle, setApplicationStyle] = useState('vanlig'); // kort | vanlig | profesjonell
  const [applicationEmail, setApplicationEmail] = useState('');
  // Unified output from backend generator (used by both "Send email" and "Generate PDF").
  // Strict contract: { cv, coverLetter, pdfUrl }
  const [applicationPackage, setApplicationPackage] = useState(null);
  const [sending, setSending] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  // Request locking: only allow one active generation request at a time.
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationBanner, setGenerationBanner] = useState('');
  const generationLockRef = useRef(false);
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
  const [skillInput, setSkillInput] = useState('');
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

  // Profil v2: visning og redigering separat (erfaring/utdanning)
  const [editExperience, setEditExperience] = useState(false);
  const [editEducation, setEditEducation] = useState(false);
  const [editingExperienceIndex, setEditingExperienceIndex] = useState(-1);
  const [editingEducationIndex, setEditingEducationIndex] = useState(-1);

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

  // AI-intervju v2 (ekte samtale)
  const [interviewMessages, setInterviewMessages] = useState([]);
  const [interviewDraft, setInterviewDraft] = useState('');
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewError, setInterviewError] = useState('');
  const [interviewStarted, setInterviewStarted] = useState(false);

  const mascotAnim = useRef(new Animated.Value(0)).current;

  // Cartoon-style "teacher" avatar (generated). If you want a different look,
  // change the seed (e.g. seed=Kari or seed=Per).
  const profilePhoto = {
    uri: 'https://api.dicebear.com/9.x/adventurer/png?seed=Teacher&backgroundColor=b6e3f4&size=256',
  };

  const strings = I18N[uiLanguage] || I18N.no;
  const t = (key) => strings[key] ?? I18N.no[key] ?? String(key);

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
    setSkillInput('');
    setConsentAnalytics(false);
    setLanguagesList([]);
    setCvGaps('');
    setExperienceEntries([]);
    setEducationEntries([]);
    setReferenceEntries([]);
    setEditExperience(false);
    setEditEducation(false);
    setEditingExperienceIndex(-1);
    setEditingEducationIndex(-1);

    // Analysis / URL
    setJobUrl('');
    setAnalysis(null);
    setJobAnalyses([]);
    setCvAnalysis(null);
    setApplicationStyle('vanlig');
    setApplicationEmail('');
    setApplicationPackage(null);
    setGenerationBanner('');
    setIsGenerating(false);
    generationLockRef.current = false;

    // Interview
    setInterviewIndex(0);
    setInterviewNotes({});
    setInterviewMessages([]);
    setInterviewDraft('');
    setInterviewLoading(false);
    setInterviewError('');
    setInterviewStarted(false);

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
                Alert.alert('Feil', errText(e));
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

  useEffect(() => {
    if (!editExperience && editingExperienceIndex >= 0) {
      setEditingExperienceIndex(-1);
    }
  }, [editExperience, editingExperienceIndex]);

  // Når brukeren ikke redigerer utdanning, skjul evt. åpen skole-dropdown.
  useEffect(() => {
    if (!editEducation) {
      if (showSchoolListIndex >= 0) {
        setShowSchoolListIndex(-1);
        setSchoolFilter('');
      }
      if (editingEducationIndex >= 0) {
        setEditingEducationIndex(-1);
      }
    }
  }, [editEducation, showSchoolListIndex, editingEducationIndex]);

  // Hvis brukeren bytter hvilken utdanning som redigeres, lukk skole-dropdown.
  useEffect(() => {
    if (showSchoolListIndex >= 0 && showSchoolListIndex !== editingEducationIndex) {
      setShowSchoolListIndex(-1);
      setSchoolFilter('');
    }
  }, [showSchoolListIndex, editingEducationIndex]);

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
    // Optimistic update
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
      // Revert on error
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
    try {
      const data = await apiFetch(`/job-analyses/${jobId}?profile_id=${profileId}`);
      setAnalysis(data);
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
      // Reuse backend progress endpoint; empty payload creates the row if it doesn't exist.
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

  useEffect(() => {
    if (activeTab !== 'analysis') return;
    if (!profileId) return;

    // Reset to profile default each time you enter analysis (per-application override).
    if (profilePhotoData) {
      setIncludePhotoInPdf(!!includePhotoDefault);
    }

    // Silent load: don't show alerts on automatic refresh.
    loadJobAnalyses({ silent: true });
  }, [activeTab, profileId, profilePhotoData, includePhotoDefault]);

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

    // New analysis => clear any previously generated package view.
    setApplicationPackage(null);
    setGenerationBanner('');

    setLoading(true);
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
      // If triggered from "Ny søknad" we still want to show the analysis screen.
      setActiveTab('analysis');
      // Refresh the history list (best-effort).
      loadJobAnalyses({ silent: true });
    } catch (e) {
      console.error('[Assistant] analyzeJob failed', e);
      Alert.alert('Feil', errText(e));
    } finally {
      setLoading(false);
    }
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

    if (generationLockRef.current || isGenerating) return;
    generationLockRef.current = true;
    setIsGenerating(true);

    const prevPackage = applicationPackage;
    const failMsg = (uiLanguage === 'en')
      ? 'Generation failed, try again'
      : 'Generering feilet, prøv igjen';

    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;

    setSending(true);
    setGenerationBanner('');
    // Only clear UI AFTER request is confirmed started.
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
        }),
      });

      const isValidPackage = (
        pkg
        && typeof pkg.cv === 'string'
        && typeof pkg.coverLetter === 'string'
      );

      if (isValidPackage) {
        const safePkg = {
          cv: pkg.cv,
          coverLetter: pkg.coverLetter,
          pdfUrl: (typeof pkg.pdfUrl === 'string') ? pkg.pdfUrl : '',
        };

        const hasAnyText = (
          (safePkg.cv || '').trim().length > 0
          || (safePkg.coverLetter || '').trim().length > 0
        );

        if (hasAnyText) {
          setApplicationPackage(safePkg);
          Alert.alert('OK', 'Søknad + CV er generert. Sjekk e-post hvis utsending er konfigurert.');
          return;
        }
      }

      // Invalid/incomplete => keep previous state and show non-blocking banner.
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

  async function generatePdf() {
    if (!profileId) {
      Alert.alert('Feil', 'Lagre profilen først');
      return;
    }

    if (!jobUrl) {
      Alert.alert('Feil', 'Lim inn jobbannonse først.');
      return;
    }

    if (generationLockRef.current || isGenerating) return;
    generationLockRef.current = true;
    setIsGenerating(true);

    const prevPackage = applicationPackage;
    const failMsg = (uiLanguage === 'en')
      ? 'Generation failed, try again'
      : 'Generering feilet, prøv igjen';

    const includePhoto = !!profilePhotoData && !!includePhotoInPdf;

    setGeneratingPdf(true);
    setGenerationBanner('');
    // Only clear UI AFTER request is confirmed started.
    setApplicationPackage(null);

    try {
      // Use the same unified backend generator as the "Send email" flow.
      const pkg = await apiFetch('/analyze-url-and-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profileId,
          url: jobUrl,
          application_style: applicationStyle,
          include_photo: includePhoto,
        }),
      });

      const isValidPackage = (
        pkg
        && typeof pkg.cv === 'string'
        && typeof pkg.coverLetter === 'string'
      );

      if (isValidPackage) {
        const safePkg = {
          cv: pkg.cv,
          coverLetter: pkg.coverLetter,
          pdfUrl: (typeof pkg.pdfUrl === 'string') ? pkg.pdfUrl : '',
        };

        const hasAnyText = (
          (safePkg.cv || '').trim().length > 0
          || (safePkg.coverLetter || '').trim().length > 0
        );

        if (hasAnyText) {
          setApplicationPackage(safePkg);

          // Only navigate/open documents when a PDF was actually created.
          if (safePkg.pdfUrl && safePkg.pdfUrl.trim()) {
            await loadDocuments();
            setActiveTab('documents');
            Alert.alert('OK', 'PDF er generert. Se under Dokumenter.');
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
            {analysedJobsCount > 0 ? (
              <View style={styles.aerligBadge}>
                <Text style={styles.aerligBadgeText}>{analysedJobsCount}</Text>
              </View>
            ) : null}
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
          <Text style={styles.aerligTipTitle}>Karrieretips</Text>
          <Text style={styles.aerligTipText}>{tipText}</Text>
        </View>
      </View>
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

              {applicationPackage ? (
                <View style={{ marginTop: 12 }}>
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
      styles={styles}
    />
  );

  const skillsItems = String(skills || '')
    .split(/[\n,]+/)
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  function setSkillsItems(nextItems) {
    const arr = Array.isArray(nextItems) ? nextItems : [];
    const normalized = arr.map((s) => String(s || '').trim()).filter(Boolean);
    setSkills(normalized.join(', '));
  }

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
    <View style={styles.aerligHomeWrap}>
      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>Profil</Text>
        <Text style={styles.aerligPageSubtitle}>Personopplysninger, erfaring og referanser.</Text>

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Navn</Text>
          <TextInput style={[styles.input, styles.aerligInput]} value={name} onChangeText={setName} placeholder="Navn" />
        </View>

        <View style={styles.profileField}>
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
                  if (profileId) {
                    saveProfile({ silent: true, override: { photo_data: '' } });
                  }
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
          <Text style={[styles.inputLabel, styles.aerligLabel]}>E-post</Text>
          <TextInput style={[styles.input, styles.aerligInput]} value={profileEmail} onChangeText={setProfileEmail} placeholder="E-post" autoCapitalize="none" keyboardType="email-address" />
        </View>

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Telefon</Text>
          <TextInput style={[styles.input, styles.aerligInput]} value={phone} onChangeText={setPhone} placeholder="Telefon" keyboardType="phone-pad" />
        </View>

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Adresse</Text>
          <TextInput
            style={[styles.input, styles.aerligInput]}
            value={address}
            onChangeText={setAddress}
            placeholder="Gateadresse"
            autoCapitalize="words"
          />
        </View>

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

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Erfaring</Text>

          <TouchableOpacity
            style={[styles.smallButton, styles.aerligSmallButton, { marginTop: 0 }]}
            onPress={() => {
              setEditExperience((v) => {
                const next = !v;
                if (!next) setEditingExperienceIndex(-1);
                return next;
              });
            }}
          >
            <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>Rediger erfaring</Text>
          </TouchableOpacity>

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

              {editExperience ? (
                <View style={styles.aerligRowActions}>
                  <TouchableOpacity
                    style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                    onPress={() => {
                      setEditingExperienceIndex((cur) => (cur === index ? -1 : index));
                    }}
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
              ) : null}

              {editExperience && editingExperienceIndex === index ? (
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
                        if (next) {
                          items[index].to = '';
                        }
                        setExperienceEntries(items);
                      }}
                    >
                      <Text style={[styles.checkboxText, styles.aerligCheckboxText, entry.current && styles.aerligCheckboxTextOn]}>{entry.current ? '✓' : ''}</Text>
                    </TouchableOpacity>
                    <Text style={styles.aerligInlineNote}>
                      Jobber her fremdeles
                    </Text>
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

          {editExperience ? (
            <TouchableOpacity
              style={[styles.smallButton, styles.aerligSmallButton]}
              onPress={() => {
                const next = [...(experienceEntries || []), { title: '', company: '', from: '', to: '', current: false }];
                setExperienceEntries(next);
                setEditingExperienceIndex(next.length - 1);
              }}
            >
              <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>Legg til erfaring</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Utdanning</Text>

          <TouchableOpacity
            style={[styles.smallButton, styles.aerligSmallButton, { marginTop: 0 }]}
            onPress={() => {
              setEditEducation((v) => {
                const next = !v;
                if (!next) {
                  setEditingEducationIndex(-1);
                  setShowSchoolListIndex(-1);
                  setSchoolFilter('');
                }
                return next;
              });
            }}
          >
            <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>Rediger utdanning</Text>
          </TouchableOpacity>

          {educationEntries.map((entry, index) => (
            <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
              <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.aerligEntryTitle} numberOfLines={1}>{entry.school || 'Skole'}</Text>
                  <Text style={styles.aerligEntrySub} numberOfLines={1}>{entry.degree || 'Studie/program'}</Text>
                </View>
                <Text style={styles.aerligEntryYears} numberOfLines={1}>
                  {`${(entry.from || '—').trim() || '—'}–${((entry.to || '—').trim()) || '—'}`}
                </Text>
              </View>

              {editEducation ? (
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
              ) : null}

              {editEducation && editingEducationIndex === index ? (
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
                      onChangeText={(value) => {
                        const items = [...educationEntries];
                        items[index].to = value;
                        setEducationEntries(items);
                      }}
                    />
                  </View>
                </>
              ) : null}
            </View>
          ))}

          {editEducation ? (
            <TouchableOpacity
              style={[styles.smallButton, styles.aerligSmallButton]}
              onPress={() => {
                const next = [...(educationEntries || []), { school: '', degree: '', from: '', to: '' }];
                setEducationEntries(next);
                setEditingEducationIndex(next.length - 1);
                setShowSchoolListIndex(-1);
                setSchoolFilter('');
              }}
            >
              <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>Legg til utdanning</Text>
            </TouchableOpacity>
          ) : null}
        </View>

                <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Ferdigheter og sertifiseringer</Text>

          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {skillsItems.map((item, i) => (
                <TouchableOpacity
                  key={`${item}-${i}`}
                  style={[styles.smallButton, styles.aerligSmallButton, { marginRight: 8, marginBottom: 8 }]}
                  onPress={() => setSkillsItems(skillsItems.filter((_, idx) => idx !== i))}
                >
                  <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>{item} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TextInput
            style={[styles.input, styles.aerligInput]}
            value={skillInput}
            onChangeText={setSkillInput}
            placeholder="Skriv én ferdighet/sertifisering"
            autoCapitalize="sentences"
          />

          <TouchableOpacity
            style={[styles.smallButton, styles.aerligSmallButton, { marginTop: 0 }]}
            onPress={() => {
              const v = String(skillInput || '').trim();
              if (!v) return;

              const exists = skillsItems.some((it) => String(it).toLowerCase() === v.toLowerCase());
              if (!exists) {
                setSkillsItems([...skillsItems, v]);
              }

              setSkillInput('');
            }}
          >
            <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>Legg til</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Språk</Text>
          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {languagesList.map((lang, i) => (
                <TouchableOpacity key={i} style={[styles.smallButton, styles.aerligSmallButton, { marginRight: 8, marginBottom: 8 }]} onPress={() => setLanguagesList(languagesList.filter((l) => l !== lang))}>
                  <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>{lang} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TouchableOpacity style={[styles.input, styles.aerligInput]} onPress={() => setShowLanguageList(!showLanguageList)}>
            <Text style={styles.aerligPlaceholderText}>Legg til språk</Text>
          </TouchableOpacity>
          {showLanguageList && (
            <View style={[styles.dropdownList, styles.aerligDropdownList]}>
              <TextInput
                style={[styles.input, styles.aerligInput, { margin: 8 }]}
                placeholder="Legg til eget språk (skriv og trykk 'Legg til')"
                value={customLanguageInput}
                onChangeText={setCustomLanguageInput}
                autoCapitalize="words"
              />
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton, { marginHorizontal: 8, marginTop: 0, marginBottom: 8 }]}
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
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>Legg til</Text>
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
                  <Text style={[styles.dropdownItemText, styles.aerligDropdownItemText]}>{lang}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Hull i CV</Text>
          <Text style={[styles.helpText, styles.aerligHelpText]}>Skriv kort om pauser eller hull i arbeids- eller utdanningshistorikken.</Text>
          <TextInput style={[styles.input, styles.aerligInput, styles.textArea]} value={cvGaps} onChangeText={setCvGaps} placeholder="Hull i CV" multiline />
        </View>

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Referanser</Text>
          <Text style={[styles.helpText, styles.aerligHelpText]}>Legg inn referanser du kan oppgi ved behov (navn, relasjon og kontaktinfo).</Text>

          {referenceEntries.map((ref, index) => (
            <View key={index} style={styles.aerligCard}>
              <TextInput
                style={[styles.input, styles.aerligInput]}
                value={ref.name}
                placeholder="Navn"
                onChangeText={(value) => {
                  const items = [...referenceEntries];
                  items[index].name = value;
                  setReferenceEntries(items);
                }}
              />
              <TextInput
                style={[styles.input, styles.aerligInput]}
                value={ref.relation}
                placeholder="Relasjon (f.eks. Leder i X / Kollega)"
                onChangeText={(value) => {
                  const items = [...referenceEntries];
                  items[index].relation = value;
                  setReferenceEntries(items);
                }}
              />
              <TextInput
                style={[styles.input, styles.aerligInput]}
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
                style={[styles.removeButton, styles.aerligRemoveButton]}
                onPress={() => {
                  const items = referenceEntries.filter((_, i) => i !== index);
                  setReferenceEntries(items);
                }}
              >
                <Text style={[styles.removeButtonText, styles.aerligRemoveButtonText]}>Fjern</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={[styles.smallButton, styles.aerligSmallButton]}
            onPress={() => setReferenceEntries([...(referenceEntries || []), { name: '', relation: '', contact: '' }])}
          >
            <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>Legg til referanse</Text>
          </TouchableOpacity>
        </View>

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
        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={saveProfile}>
          <Text style={styles.aerligPrimaryButtonText}>{savingProfile ? 'Lagrer...' : 'Lagre profil'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.aerligDangerButton}
          onPress={deleteAccount}
        >
          <Text style={styles.aerligDangerButtonText}>Slett konto og data</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.aerligDangerButton}
          onPress={logout}
        >
          <Text style={styles.aerligDangerButtonText}>Logg ut</Text>
        </TouchableOpacity>
      </View>
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
      <SafeAreaView style={[styles.container, { backgroundColor: '#F7F5F0' }]}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          {renderAuth()}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F5F0',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#555555',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: '#e8e8e8',
    fontSize: 15,
    color: '#1a1a1a',
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
    backgroundColor: '#E8501A',
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#E8501A',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    elevation: 0,
  },
  secondaryButtonText: {
    color: '#1a1a1a',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.1,
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

  // Applications (Ærlig. styling)
  aerligAppsTableCard: {
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(26, 26, 46, 0.12)',
    overflow: 'hidden',
  },
  aerligAppsTableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(26, 26, 46, 0.04)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26, 26, 46, 0.10)',
  },
  aerligAppsTableHeaderCell: {
    width: 56,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
    color: 'rgba(26, 26, 46, 0.58)',
  },
  aerligAppsTableJobHeader: {
    flex: 1,
    width: 'auto',
    textAlign: 'left',
  },
  aerligAppsTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26, 26, 46, 0.10)',
  },
  aerligAppsTableJobCell: {
    flex: 1,
    paddingRight: 10,
  },
  aerligAppsTableJobTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligAppsTableJobCompany: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(26, 26, 46, 0.66)',
  },
  aerligAppsCheckbox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(26, 26, 46, 0.20)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  aerligAppsCheckboxOn: {
    backgroundColor: '#E8622A',
    borderColor: '#E8622A',
  },
  aerligAppsCheckboxText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligAppsCheckboxTextOn: {
    color: '#FFFFFF',
  },

  profileField: {
    marginBottom: 16,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 88,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,

    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',

    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  bottomButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 6,
    borderRadius: 16,
  },
  bottomIcon: {
    fontSize: 20,
    color: '#aaaaaa',
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
    color: '#E8622A',
  },
  bottomLabel: {
    fontSize: 11,
    color: '#aaaaaa',
    marginTop: 4,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  bottomLabelActive: {
    color: '#E8501A',
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

  // Home (Ærlig. minimal dashboard)
  aerligHomeWrap: {
    marginHorizontal: -20,
    marginTop: -20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: '#F7F5F0',
  },
  aerligHeroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  aerligHeroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  aerligLogo: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1A1A2E',
    letterSpacing: 0.2,
  },
  aerligBadge: {
    minWidth: 30,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232, 98, 42, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232, 98, 42, 0.28)',
  },
  aerligBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#E8622A',
  },
  aerligHeroGreeting: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1A1A2E',
    marginBottom: 6,
  },
  aerligHeroSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(26, 26, 46, 0.72)',
    marginBottom: 14,
  },
  aerligPrimaryButton: {
    backgroundColor: '#E8501A',
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E8501A',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  aerligPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  aerligQuickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  aerligQuickButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(26, 26, 46, 0.14)',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aerligQuickButtonText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligSecondaryButton: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
  },
  aerligSecondaryButtonText: {
    color: '#1a1a1a',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  aerligCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  aerligEmptyCard: {
    borderStyle: 'dashed',
  },
  aerligCardEyebrow: {
    fontSize: 12,
    fontWeight: '900',
    color: 'rgba(26, 26, 46, 0.58)',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  aerligCardTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1A1A2E',
    marginBottom: 2,
  },
  aerligCardMeta: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(26, 26, 46, 0.66)',
    marginBottom: 12,
  },
  aerligCardSectionTitle: {
    marginTop: 2,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligCardBody: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(26, 26, 46, 0.76)',
  },
  aerligCardLink: {
    marginTop: 12,
    color: '#E8622A',
    fontSize: 13,
    fontWeight: '900',
  },
  aerligMeterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  aerligMeterLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligMeterValue: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligMeterOuter: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(26, 26, 46, 0.10)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  aerligMeterInner: {
    height: '100%',
    borderRadius: 999,
  },
  aerligMeterGood: {
    backgroundColor: '#16A34A',
  },
  aerligMeterWarn: {
    backgroundColor: '#D97706',
  },
  aerligMeterBad: {
    backgroundColor: '#DC2626',
  },
  aerligMeterStatus: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: 6,
  },
  aerligPill: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 10,
  },
  aerligPillYes: {
    backgroundColor: 'rgba(58, 125, 68, 0.10)',
    borderColor: 'rgba(58, 125, 68, 0.35)',
  },
  aerligPillNo: {
    backgroundColor: 'rgba(232, 98, 42, 0.10)',
    borderColor: 'rgba(232, 98, 42, 0.35)',
  },
  aerligPillText: {
    fontSize: 12,
    fontWeight: '900',
  },
  aerligPillTextYes: {
    color: '#3A7D44',
  },
  aerligPillTextNo: {
    color: '#E8622A',
  },
  aerligGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  aerligMiniCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(26, 26, 46, 0.12)',
    marginBottom: 14,
    minHeight: 116,
  },
  aerligMiniCardFull: {
    width: '100%',
    minHeight: 108,
  },
  aerligMiniLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: 'rgba(26, 26, 46, 0.60)',
  },
  aerligMiniValue: {
    marginTop: 8,
    marginBottom: 6,
    fontSize: 28,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligMiniHint: {
    marginTop: 'auto',
    fontSize: 12,
    fontWeight: '900',
    color: '#E8622A',
  },
  aerligProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aerligProfileValue: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 26,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligProfileHint: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(26, 26, 46, 0.66)',
    marginBottom: 10,
  },
  aerligProfileMeter: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(26, 26, 46, 0.10)',
    overflow: 'hidden',
  },
  aerligProfileMeterFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#1A1A2E',
  },
  aerligTipCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(26, 26, 46, 0.12)',
    marginBottom: 8,
  },
  aerligTipTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1A1A2E',
    marginBottom: 8,
  },
  aerligTipText: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(26, 26, 46, 0.76)',
  },

  // Profile (Ærlig. styling)
  aerligPageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  aerligPageTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  aerligPageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#888888',
    marginBottom: 14,
  },
  aerligLabel: {
    color: 'rgba(26, 26, 46, 0.66)',
    fontWeight: '900',
  },
  aerligHelpText: {
    color: 'rgba(26, 26, 46, 0.70)',
  },
  aerligMessageText: {
    color: 'rgba(26, 26, 46, 0.76)',
    fontWeight: '800',
  },
  aerligInput: {
    backgroundColor: '#FAFAFA',
    borderColor: '#e8e8e8',
    borderRadius: 10,
    color: '#1a1a1a',
  },
  aerligInputText: {
    color: '#1A1A2E',
    fontSize: 15,
    fontWeight: '800',
  },
  aerligPlaceholderText: {
    color: 'rgba(26, 26, 46, 0.50)',
    fontSize: 15,
    fontWeight: '800',
  },
  aerligSmallButton: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(26, 26, 46, 0.16)',
    borderRadius: 16,
    marginBottom: 12,
  },
  aerligSmallButtonText: {
    color: '#1A1A2E',
    fontWeight: '900',
  },
  aerligRemoveButton: {
    borderRadius: 16,
  },
  aerligRemoveButtonText: {
    fontWeight: '900',
  },
  aerligDropdownList: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(26, 26, 46, 0.12)',
    borderRadius: 18,
  },
  aerligDropdownItemText: {
    color: '#1A1A2E',
    fontWeight: '800',
  },
  aerligDropdownItemSub: {
    color: 'rgba(26, 26, 46, 0.60)',
  },
  aerligFilterChipRow: {
    paddingHorizontal: 0,
  },
  aerligFilterChip: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(26, 26, 46, 0.16)',
  },
  aerligFilterChipActive: {
    backgroundColor: '#1A1A2E',
    borderColor: '#1A1A2E',
  },
  aerligFilterChipText: {
    color: '#1A1A2E',
    fontWeight: '900',
  },
  aerligFilterChipTextActive: {
    color: '#FFFFFF',
  },
  aerligCheckbox: {
    borderColor: 'rgba(26, 26, 46, 0.20)',
    backgroundColor: '#FFFFFF',
  },
  aerligCheckboxOn: {
    backgroundColor: '#1A1A2E',
    borderColor: '#1A1A2E',
  },
  aerligCheckboxText: {
    color: '#1A1A2E',
  },
  aerligCheckboxTextOn: {
    color: '#FFFFFF',
  },
  aerligInlineNote: {
    marginLeft: 10,
    color: 'rgba(26, 26, 46, 0.70)',
    fontSize: 13,
    fontWeight: '800',
  },
  aerligLinkText: {
    color: '#E8622A',
    fontWeight: '900',
  },
  aerligDangerButton: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.55)',
  },
  aerligDangerButtonText: {
    color: THEME.colors.danger,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  // Analysis accents
  aerligAccentNavy: {
    borderLeftWidth: 4,
    borderLeftColor: '#1A1A2E',
    paddingLeft: 12,
  },
  aerligAccentOrange: {
    borderLeftWidth: 4,
    borderLeftColor: '#E8622A',
    paddingLeft: 12,
  },
  aerligAccentGreen: {
    borderLeftWidth: 4,
    borderLeftColor: '#3A7D44',
    paddingLeft: 12,
  },

  // Interview (Ærlig. chat-style)
  aerligChatBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(26, 26, 46, 0.12)',
    marginBottom: 14,
  },
  aerligChatBubbleAi: {
    borderLeftWidth: 4,
    borderLeftColor: '#1A1A2E',
    paddingLeft: 12,
  },
  aerligChatBubbleUser: {
    borderLeftWidth: 4,
    borderLeftColor: '#E8622A',
    paddingLeft: 12,
  },
  aerligChatMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  aerligChatMetaRight: {
    fontSize: 12,
    fontWeight: '900',
    color: 'rgba(26, 26, 46, 0.60)',
  },
  aerligChatTag: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  aerligChatTagAi: {
    backgroundColor: 'rgba(26, 26, 46, 0.08)',
    borderColor: 'rgba(26, 26, 46, 0.18)',
  },
  aerligChatTagUser: {
    backgroundColor: 'rgba(232, 98, 42, 0.10)',
    borderColor: 'rgba(232, 98, 42, 0.22)',
  },
  aerligChatTagText: {
    fontSize: 12,
    fontWeight: '900',
  },
  aerligChatTagTextAi: {
    color: '#1A1A2E',
  },
  aerligChatTagTextUser: {
    color: '#E8622A',
  },
  aerligChatText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#1A1A2E',
    fontWeight: '800',
  },
  aerligChatInput: {
    marginBottom: 0,
    marginTop: 0,
  },
  aerligChatControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },

  // Back button (simple navigation cleanup)
  aerligBackButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  aerligBackButtonText: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '500',
  },

  // Profile list compaction (experience / education)
  aerligEntryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  aerligEntryTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#1A1A2E',
  },
  aerligEntrySub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(26, 26, 46, 0.66)',
  },
  aerligEntryYears: {
    fontSize: 12,
    fontWeight: '900',
    color: 'rgba(26, 26, 46, 0.60)',
  },
  aerligEntryEditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  aerligInputCompact: {
    paddingVertical: 10,
    marginBottom: 10,
  },
  aerligListRow: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    paddingVertical: 10,
    paddingHorizontal: 0,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26, 26, 46, 0.10)',
  },
  aerligListRowHeader: {
    marginBottom: 6,
  },
  aerligListRowRemoveButton: {
    marginTop: 2,
    minHeight: 40,
    paddingVertical: 8,
    borderRadius: 14,
  },
  aerligListRowRemoveButtonText: {
    fontSize: 13,
  },
  aerligRowActions: {
    flexDirection: 'row',
    marginTop: 4,
    marginBottom: 6,
  },
  aerligRowActionChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 0,
  },
  aerligRowActionChipDanger: {
    borderColor: 'rgba(239, 68, 68, 0.55)',
  },
  aerligRowActionTextDanger: {
    color: THEME.colors.danger,
  },
});
