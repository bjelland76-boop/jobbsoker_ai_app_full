import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import { apiFetch, API, useApp } from '../context/AppContext';

export const PRIVACY_URL = 'https://aerlig.app/personvern';
export const DOC_TYPES = ['Fagbrev', 'Kursbevis', 'Karakterutskrift', 'Attest', 'Annet'];

// Language serialization: {name, level} <-> "Norsk — Morsmål" strings
export function normalizeLangEntry(l) {
  if (typeof l === 'string') {
    const parts = l.split(' — ');
    return { name: parts[0]?.trim() || '', level: parts[1]?.trim() || '' };
  }
  return { name: String(l?.name || '').trim(), level: String(l?.level || '').trim() };
}

export function serializeLangList(list) {
  return (list || []).map((l) => (l.level ? `${l.name} — ${l.level}` : l.name)).filter(Boolean);
}

// CV gaps serialization: [{from, to, description}] <-> multi-line text
export function parseCvGapsText(text) {
  if (!text?.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((g) => ({ from: String(g.from || ''), to: String(g.to || ''), description: String(g.description || '') }));
  } catch {}
  return text.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^(\d{4})(?:[–\-](\d{4}))?\s*[:：]\s*(.+)$/);
    return m ? { from: m[1], to: m[2] || '', description: m[3].trim() } : { from: '', to: '', description: line.trim() };
  });
}

export function serializeCvGaps(list) {
  return (list || []).map((g) => {
    const period = g.from ? (g.to ? `${g.from}–${g.to}` : g.from) : '';
    const desc = g.description || '';
    return period ? `${period}: ${desc}` : desc;
  }).filter(Boolean).join('\n');
}

// Accepts optional { onProfileSaved } callback for cross-hook notifications
export default function useProfile({ onProfileSaved } = {}) {
  const { authTokenState, logEvent, errText, t, setShowOnboarding } = useApp();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [profileId, setProfileId] = useState(null);
  const [name, setName] = useState('Ærlig JobbCoach');
  const [profileEmail, setProfileEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [postalPlace, setPostalPlace] = useState('');
  const [profilePhotoData, setProfilePhotoData] = useState('');
  const [includePhotoDefault, setIncludePhotoDefault] = useState(true);
  const [includePhotoInPdf, setIncludePhotoInPdf] = useState(true);
  const [skills, setSkills] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [consentAnalytics, setConsentAnalytics] = useState(false);
  const [languagesList, setLanguagesList] = useState([]);
  const [customLanguageInput, setCustomLanguageInput] = useState('');
  const [cvGapsList, setCvGapsList] = useState([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle');
  const autoSaveTimerRef = useRef(null);
  const profileLoadedRef = useRef(false);
  const profileCompletedLoggedRef = useRef(false);

  const [showLanguageList, setShowLanguageList] = useState(false);
  const [showSchoolListIndex, setShowSchoolListIndex] = useState(-1);
  const [schoolFilter, setSchoolFilter] = useState('');
  const [schoolKindFilter, setSchoolKindFilter] = useState('all');
  const [schoolResults, setSchoolResults] = useState([]);
  const [schoolResultsLoading, setSchoolResultsLoading] = useState(false);

  const [experienceEntries, setExperienceEntries] = useState([]);
  const [educationEntries, setEducationEntries] = useState([]);
  const [referenceEntries, setReferenceEntries] = useState([]);

  // CV import
  const [cvImportModalVisible, setCvImportModalVisible] = useState(false);
  const [cvImportLoading, setCvImportLoading] = useState(false);
  const [cvImportPreview, setCvImportPreview] = useState(null);

  // Edit state
  const [editExperience, setEditExperience] = useState(false);
  const [editEducation, setEditEducation] = useState(false);
  const [editingExperienceIndex, setEditingExperienceIndex] = useState(-1);
  const [editingEducationIndex, setEditingEducationIndex] = useState(-1);
  const [expandPersonCard, setExpandPersonCard] = useState(false);
  const [expandExpCard, setExpandExpCard] = useState(false);
  const [expandEduCard, setExpandEduCard] = useState(false);
  const [expandLangCard, setExpandLangCard] = useState(false);
  const [expandGapsCard, setExpandGapsCard] = useState(false);
  const [expandRefCard, setExpandRefCard] = useState(false);
  const [expandDocsCard, setExpandDocsCard] = useState(false);
  const [expandSkillsCard, setExpandSkillsCard] = useState(false);
  const [editingLanguageIndex, setEditingLanguageIndex] = useState(-1);
  const [editingGapIndex, setEditingGapIndex] = useState(-1);
  const [editingReferenceIndex, setEditingReferenceIndex] = useState(-1);

  // Documents
  const [profileDocsList, setProfileDocsList] = useState([]);
  const [docsUploading, setDocsUploading] = useState(false);
  const [showDocTypeModal, setShowDocTypeModal] = useState(false);
  const [pendingDocFile, setPendingDocFile] = useState(null);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const skillsItems = String(skills || '').split(/[\n,]+/).map((s) => String(s || '').trim()).filter(Boolean);

  function setSkillsItems(nextItems) {
    const arr = Array.isArray(nextItems) ? nextItems : [];
    setSkills(arr.map((s) => String(s || '').trim()).filter(Boolean).join(', '));
  }

  let profileStrength = 0;
  if (name && name.trim() && name.trim() !== 'Ærlig JobbCoach') profileStrength += 10;
  if (profileEmail) profileStrength += 10;
  if (phone) profileStrength += 10;
  if (address) profileStrength += 10;
  if (profilePhotoData) profileStrength += 10;
  if (experienceEntries.length > 0) profileStrength += 20;
  if (educationEntries.length > 0) profileStrength += 15;
  if (skillsItems.length >= 3) profileStrength += 15;

  // Cartoon-style "teacher" avatar
  const profilePhoto = {
    uri: 'https://api.dicebear.com/9.x/adventurer/png?seed=Teacher&backgroundColor=b6e3f4&size=256',
  };

  // ---------------------------------------------------------------------------
  // Reset on logout
  // ---------------------------------------------------------------------------
  function resetProfile() {
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
    setCvGapsList([]);
    setProfileDocsList([]);
    setExperienceEntries([]);
    setEducationEntries([]);
    setReferenceEntries([]);
    setEditExperience(false);
    setEditEducation(false);
    setEditingExperienceIndex(-1);
    setEditingEducationIndex(-1);
    profileLoadedRef.current = false;
    profileCompletedLoggedRef.current = false;
  }

  useEffect(() => {
    if (authTokenState !== null) return;
    resetProfile();
  }, [authTokenState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Load profile on login
  // ---------------------------------------------------------------------------
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
          if (!profile.has_seen_onboarding) setShowOnboarding(true);
          setLanguagesList((Array.isArray(profile.languages) ? profile.languages : (profile.languages ? [profile.languages] : [])).map(normalizeLangEntry));
          setCvGapsList(parseCvGapsText(profile.cv_gaps || ''));

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
              return { school: e, degree: '', from: '', to: '', status: 'fullfort' };
            }
            const obj = (e && typeof e === 'object') ? e : {};
            return {
              school: obj.school || '',
              degree: obj.degree || '',
              from: obj.from || '',
              to: obj.to || '',
              status: obj.status || 'fullfort',
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
          setTimeout(() => { profileLoadedRef.current = true; }, 0);
        }
      } catch (e) {
        if (__DEV__) console.log('Kunne ikke laste profil:', e);
      }
    }

    if (!authTokenState) return;
    profileLoadedRef.current = false;
    loadProfile();
  }, [authTokenState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Profile documents
  // ---------------------------------------------------------------------------
  async function loadProfileDocuments() {
    try {
      const items = await apiFetch('/profile/documents');
      setProfileDocsList(Array.isArray(items) ? items : []);
    } catch (e) {
      if (__DEV__) console.log('Kunne ikke laste dokumenter:', e);
    }
  }

  useEffect(() => {
    if (!authTokenState) return;
    loadProfileDocuments();
  }, [authTokenState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Onboarding
  // ---------------------------------------------------------------------------
  async function dismissOnboarding() {
    setShowOnboarding(false);
    if (profileId) {
      try { await apiFetch(`/profiles/${profileId}/onboarding`, { method: 'PATCH' }); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // School search
  // ---------------------------------------------------------------------------
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
        setSchoolResults([]);
      }
      setSchoolResultsLoading(false);
    }, 250);

    return () => clearTimeout(timeout);
  }, [schoolFilter, schoolKindFilter, showSchoolListIndex]);

  useEffect(() => {
    if (!expandExpCard && editingExperienceIndex >= 0) {
      setEditingExperienceIndex(-1);
    }
  }, [expandExpCard, editingExperienceIndex]);

  useEffect(() => {
    if (!expandEduCard) {
      if (showSchoolListIndex >= 0) {
        setShowSchoolListIndex(-1);
        setSchoolFilter('');
      }
      if (editingEducationIndex >= 0) {
        setEditingEducationIndex(-1);
      }
    }
  }, [expandEduCard, showSchoolListIndex, editingEducationIndex]);

  useEffect(() => {
    if (showSchoolListIndex >= 0 && showSchoolListIndex !== editingEducationIndex) {
      setShowSchoolListIndex(-1);
      setSchoolFilter('');
    }
  }, [showSchoolListIndex, editingEducationIndex]);

  // ---------------------------------------------------------------------------
  // CV import
  // ---------------------------------------------------------------------------
  async function _sendCvBlob(blob, fileName, mimeType) {
    setCvImportLoading(true);
    setCvImportModalVisible(false);
    try {
      const formData = new FormData();
      formData.append('file', blob, fileName || 'cv');
      const result = await apiFetch('/profile/import-cv', { method: 'POST', body: formData });
      setCvImportPreview(result);
    } catch (e) {
      Alert.alert('Feil', 'Kunne ikke lese CV-en: ' + (e.message || 'Ukjent feil'));
    } finally {
      setCvImportLoading(false);
    }
  }

  async function _sendCvFile({ uri, name: fileName, mimeType, nativeFile }) {
    if (Platform.OS === 'web' && nativeFile) {
      await _sendCvBlob(nativeFile, fileName, mimeType);
      return;
    }
    if (Platform.OS === 'web') {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      await _sendCvBlob(blob, fileName, mimeType);
      return;
    }
    setCvImportLoading(true);
    setCvImportModalVisible(false);
    try {
      const formData = new FormData();
      formData.append('file', { uri, name: fileName || 'cv', type: mimeType || 'application/octet-stream' });
      const result = await apiFetch('/profile/import-cv', { method: 'POST', body: formData });
      setCvImportPreview(result);
    } catch (e) {
      Alert.alert('Feil', 'Kunne ikke lese CV-en: ' + (e.message || 'Ukjent feil'));
    } finally {
      setCvImportLoading(false);
    }
  }

  async function importCvFromFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      await _sendCvFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, nativeFile: asset.file });
    } catch (e) {
      Alert.alert('Feil', 'Kunne ikke velge fil: ' + (e.message || 'Ukjent feil'));
    }
  }

  async function importCvFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Tillatelse mangler', 'Kameratilgang er nødvendig for å ta bilde av CV-en.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    await _sendCvFile({ uri: asset.uri, name: 'cv.jpg', mimeType: 'image/jpeg' });
  }

  async function importCvFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Tillatelse mangler', 'Galleritilgang er nødvendig for å velge bilde av CV-en.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    await _sendCvFile({ uri: asset.uri, name: `cv.${ext}`, mimeType });
  }

  function applyCvImport(preview) {
    logEvent('cv_imported');
    if (preview.name && !name) setName(preview.name);
    if (preview.email && !profileEmail) setProfileEmail(preview.email);
    if (preview.phone && !phone) setPhone(preview.phone);
    if (preview.address && !address) setAddress(preview.address);

    if (Array.isArray(preview.skills) && preview.skills.length > 0 && !skills) {
      setSkills(preview.skills.join(', '));
    }

    if (Array.isArray(preview.languages) && preview.languages.length > 0 && languagesList.length === 0) {
      setLanguagesList(preview.languages.map(normalizeLangEntry));
    }

    if (Array.isArray(preview.experience) && preview.experience.length > 0 && experienceEntries.length === 0) {
      setExperienceEntries(preview.experience.map((e) => ({
        title: e.title || '',
        company: e.company || '',
        from: e.from || '',
        to: e.to || '',
        current: !!e.current,
      })));
    }

    if (Array.isArray(preview.education) && preview.education.length > 0 && educationEntries.length === 0) {
      setEducationEntries(preview.education.map((e) => ({
        school: e.school || '',
        degree: e.degree || '',
        from: e.from || '',
        to: e.to || '',
        status: e.status || 'fullfort',
      })));
    }

    setCvImportPreview(null);
  }

  // ---------------------------------------------------------------------------
  // Save profile
  // ---------------------------------------------------------------------------
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
      languages: override.languages ?? serializeLangList(languagesList),
      references: override.references ?? referenceEntries,
      cv_gaps: override.cv_gaps ?? serializeCvGaps(cvGapsList),
    };

    try {
      const method = profileId ? 'PUT' : 'POST';
      const data = await apiFetch(profileId ? `/profiles/${profileId}` : '/profiles', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setProfileId(data.id);
      if (onProfileSaved) onProfileSaved();
      if (!silent) {
        Alert.alert('Profil lagret', 'Din profil er lagret til backend.');
      }
    } catch (e) {
      Alert.alert('Feil', errText(e));
    }

    setSavingProfile(false);
  }

  async function saveProfileAuto() {
    if (!profileId || !name?.trim()) return;
    setAutoSaveStatus('saving');
    try {
      const data = await apiFetch(`/profiles/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email: profileEmail, phone, address,
          postal_code: postalCode, postal_place: postalPlace,
          photo_data: profilePhotoData, include_photo_default: includePhotoDefault,
          consent_analytics: consentAnalytics,
          experience: experienceEntries, education: educationEntries,
          skills, languages: serializeLangList(languagesList),
          references: referenceEntries, cv_gaps: serializeCvGaps(cvGapsList),
        }),
      });
      setProfileId(data.id);
      if (onProfileSaved) onProfileSaved();
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus((s) => s === 'saved' ? 'idle' : s), 2000);
    } catch {
      setAutoSaveStatus('error');
    }
  }

  async function flushAutoSave() {
    if (!autoSaveTimerRef.current) return;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    await saveProfileAuto();
  }

  // Autosave: debounce 2s after any profile field changes
  useEffect(() => {
    if (!profileLoadedRef.current || !profileId) return;
    setAutoSaveStatus('pending');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      saveProfileAuto();
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [
    name, profileEmail, phone, address, postalCode, postalPlace,
    skills, cvGapsList,
    experienceEntries, educationEntries, referenceEntries, languagesList,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Profile strength event
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!authTokenState) return;
    if (profileStrength >= 100 && !profileCompletedLoggedRef.current) {
      profileCompletedLoggedRef.current = true;
      logEvent('profile_completed');
    }
  }, [name, profileEmail, phone, address, profilePhotoData, experienceEntries, educationEntries, skills, authTokenState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Analytics consent prompt
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function ensureConsentPrompt() {
      if (!profileId) return;

      try {
        const prompted = await AsyncStorage.getItem('analyticsConsentPrompted');

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
                  await require('react-native').Linking.openURL(PRIVACY_URL);
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
  }, [profileId, consentAnalytics]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Document upload
  // ---------------------------------------------------------------------------
  async function pickAndUploadDocument(documentType) {
    setShowDocTypeModal(false);
    if (!pendingDocFile) return;
    const file = pendingDocFile;
    setPendingDocFile(null);
    setDocsUploading(true);
    try {
      const formData = new FormData();
      const uri = file.assets ? file.assets[0].uri : file.uri;
      const fileName = file.assets ? (file.assets[0].name || 'dokument') : (file.name || 'dokument');
      const mimeType = file.assets ? (file.assets[0].mimeType || 'application/octet-stream') : (file.mimeType || 'application/octet-stream');
      formData.append('file', { uri, name: fileName, type: mimeType });
      formData.append('document_type', documentType);

      const resp = await fetch(`${API}/profile/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authTokenState}` },
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Opplasting feilet');
      }
      await loadProfileDocuments();
      logEvent('document_uploaded', { type: documentType });
    } catch (e) {
      Alert.alert('Feil', e.message || 'Kunne ikke laste opp dokumentet');
    }
    setDocsUploading(false);
  }

  async function deleteProfileDocument(docId) {
    const doDelete = async () => {
      try {
        await apiFetch(`/profile/documents/${docId}`, { method: 'DELETE' });
        setProfileDocsList((prev) => prev.filter((d) => d.id !== docId));
      } catch (e) {
        Alert.alert('Feil', 'Kunne ikke slette dokumentet');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Slette dette dokumentet?')) await doDelete();
      return;
    }
    Alert.alert('Slette dokument', 'Er du sikker?', [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Slett', style: 'destructive', onPress: doDelete },
    ]);
  }

  async function openDocumentPicker() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      setPendingDocFile(result);
      setShowDocTypeModal(true);
    } catch (e) {
      Alert.alert('Feil', 'Kunne ikke åpne filvelger');
    }
  }

  // ---------------------------------------------------------------------------
  // Profile photo
  // ---------------------------------------------------------------------------
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

      if (profileId) {
        saveProfile({ silent: true, override: { photo_data: dataUri } });
      }
    } catch (e) {
      Alert.alert('Feil', String(e));
    }
  }

  // ---------------------------------------------------------------------------
  // isProfileTooEmpty (used by InterviewScreen gate)
  // ---------------------------------------------------------------------------
  function isProfileTooEmpty() {
    const hasExperience = Array.isArray(experienceEntries) && experienceEntries.length > 0;
    const hasEducation = Array.isArray(educationEntries) && educationEntries.length > 0;
    const hasSkills = (skills || '').trim().length > 10;
    return !hasExperience && !hasEducation && !hasSkills;
  }

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------
  return {
    // Identity
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

    // Skills
    skills, setSkills,
    skillInput, setSkillInput,
    skillsItems, setSkillsItems,

    // Consent
    consentAnalytics, setConsentAnalytics,

    // Languages
    languagesList, setLanguagesList,
    customLanguageInput, setCustomLanguageInput,

    // Gaps
    cvGapsList, setCvGapsList,

    // Save state
    savingProfile,
    autoSaveStatus,

    // UI toggles
    showLanguageList, setShowLanguageList,
    showSchoolListIndex, setShowSchoolListIndex,
    schoolFilter, setSchoolFilter,
    schoolKindFilter, setSchoolKindFilter,
    schoolResults,
    schoolResultsLoading,

    // Experience / Education / References
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

    // Expand cards
    expandPersonCard, setExpandPersonCard,
    expandExpCard, setExpandExpCard,
    expandEduCard, setExpandEduCard,
    expandLangCard, setExpandLangCard,
    expandGapsCard, setExpandGapsCard,
    expandRefCard, setExpandRefCard,
    expandDocsCard, setExpandDocsCard,
    expandSkillsCard, setExpandSkillsCard,

    // CV import
    cvImportModalVisible, setCvImportModalVisible,
    cvImportLoading,
    cvImportPreview, setCvImportPreview,

    // Documents
    profileDocsList, setProfileDocsList,
    docsUploading,
    showDocTypeModal, setShowDocTypeModal,
    pendingDocFile, setPendingDocFile,
    DOC_TYPES,

    // Functions
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
  };
}
