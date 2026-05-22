import React, { useEffect, useMemo, useState } from 'react';
import './styles.css';
import { apiFetch, getApiBase, setAuthToken } from './api.js';

function errText(e) {
  return (e && e.message) ? String(e.message) : String(e);
}

function buildAuthedPdfUrl(path, token) {
  const base = getApiBase();
  const url = `${base}${path}`;
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export default function App() {
  const [tab, setTab] = useState('auth');

  // Auth
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [token, setToken] = useState('');

  // Profile
  const [profileId, setProfileId] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [postalPlace, setPostalPlace] = useState('');
  const [skills, setSkills] = useState('');
  const [languages, setLanguages] = useState('Norsk\nEngelsk');

  // Analysis
  const [jobUrl, setJobUrl] = useState('');
  const [applicationStyle, setApplicationStyle] = useState('vanlig');
  const [analysis, setAnalysis] = useState(null);

  const [documents, setDocuments] = useState([]);

  const isAuthed = !!token;

  useEffect(() => {
    if (!token) return;
    setAuthToken(token);
    setTab('profile');
  }, [token]);

  async function requestCode() {
    if (!email || !email.includes('@')) {
      alert('Skriv inn e-post');
      return;
    }
    try {
      await apiFetch('/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setCodeSent(true);
      setCode('');
      alert('Kode sendt. Sjekk e-posten din.');
    } catch (e) {
      alert(errText(e));
    }
  }

  async function verifyCode() {
    if (!email || !code) {
      alert('Mangler e-post eller kode');
      return;
    }
    try {
      const res = await apiFetch('/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: String(code).trim() }),
      });

      const t = res?.access_token;
      if (!t) throw new Error('Mangler token fra server');
      setToken(t);
    } catch (e) {
      alert(errText(e));
    }
  }

  async function loadProfile() {
    try {
      const profiles = await apiFetch('/profiles');
      if (Array.isArray(profiles) && profiles.length > 0) {
        const p = profiles[0];
        setProfileId(p.id);
        setName(p.name || '');
        setPhone(p.phone || '');
        setAddress(p.address || '');
        setPostalCode(p.postal_code || '');
        setPostalPlace(p.postal_place || '');
        setSkills(p.skills || '');
        const langs = Array.isArray(p.languages) ? p.languages : [];
        setLanguages(langs.join('\n'));
      }
    } catch (e) {
      alert(errText(e));
    }
  }

  async function saveProfile() {
    if (!name) {
      alert('Navn må være utfylt');
      return;
    }

    const payload = {
      name,
      email,
      phone,
      address,
      postal_code: postalCode,
      postal_place: postalPlace,
      photo_data: '',
      include_photo_default: true,
      consent_analytics: false,
      target_role: '',
      experience: [],
      education: [],
      skills,
      languages: (languages || '').split('\n').map((s) => s.trim()).filter(Boolean),
      references: [],
      cv_gaps: '',
      cv_text: '',
      tone: 'normal',
    };

    try {
      const method = profileId ? 'PUT' : 'POST';
      const path = profileId ? `/profiles/${profileId}` : '/profiles';
      const saved = await apiFetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setProfileId(saved?.id ?? profileId);
      alert('Profil lagret');
    } catch (e) {
      alert(errText(e));
    }
  }

  async function doAnalyze() {
    if (!profileId) {
      alert('Lagre profil først');
      return;
    }
    if (!jobUrl) {
      alert('Lim inn jobbannonse-URL');
      return;
    }

    try {
      const data = await apiFetch('/analyze-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, url: jobUrl, application_style: applicationStyle }),
      });
      setAnalysis(data);
      setTab('analysis');
    } catch (e) {
      alert(errText(e));
    }
  }

  async function loadDocuments() {
    if (!profileId) return;
    try {
      const items = await apiFetch(`/generated-applications?profile_id=${profileId}`);
      setDocuments(Array.isArray(items) ? items : []);
      setTab('documents');
    } catch (e) {
      alert(errText(e));
    }
  }

  async function generatePdfFromLatestAnalysis() {
    if (!profileId) {
      alert('Lagre profil først');
      return;
    }
    const jobId = analysis?.job_id;
    if (!jobId) {
      alert('Mangler job_id. Kjør analyse på nytt.');
      return;
    }

    try {
      await apiFetch(`/job-analyses/${jobId}/generate-pdf?profile_id=${profileId}&include_photo=0`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      await loadDocuments();
      alert('PDF generert. Se under Dokumenter.');
    } catch (e) {
      alert(errText(e));
    }
  }

  const tabs = useMemo(() => {
    const base = [
      { key: 'auth', label: 'Innlogging' },
    ];

    if (!isAuthed) return base;

    return [
      ...base,
      { key: 'profile', label: 'Profil' },
      { key: 'new', label: 'Ny analyse' },
      { key: 'analysis', label: 'Analyse' },
      { key: 'documents', label: 'Dokumenter' },
    ];
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;
    loadProfile();
  }, [isAuthed]);

  return (
    <div className="container">
      <div className="card">
        <h2>Ærlig JobbCoach (web)</h2>
        <div className="small">API: {getApiBase()}</div>
      </div>

      <div className="card">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'auth' && (
        <div className="card">
          <h3>Logg inn (engangskode)</h3>
          <div className="row">
            <div style={{ flex: 1, minWidth: 280 }}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-post" />
            </div>
          </div>

          {!codeSent ? (
            <button type="button" onClick={requestCode}>Send kode</button>
          ) : (
            <>
              <div style={{ height: 10 }} />
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Kode (6 siffer)" />
              <div className="row">
                <button type="button" onClick={verifyCode}>Verifiser</button>
                <button className="secondary" type="button" onClick={() => { setCodeSent(false); setCode(''); }}>Tilbake</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'profile' && isAuthed && (
        <div className="card">
          <h3>Profil</h3>
          <div className="row">
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="small">Navn</div>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="small">Telefon</div>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 2, minWidth: 260 }}>
              <div className="small">Adresse</div>
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div className="small">Postnr</div>
              <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="small">Poststed</div>
              <input value={postalPlace} onChange={(e) => setPostalPlace(e.target.value)} />
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="small">Ferdigheter</div>
              <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Kundeservice, lager, ..." />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="small">Språk (én per linje)</div>
              <textarea value={languages} onChange={(e) => setLanguages(e.target.value)} />
            </div>
          </div>

          <div className="row">
            <button type="button" onClick={saveProfile}>Lagre profil</button>
            <button className="secondary" type="button" onClick={loadProfile}>Last inn på nytt</button>
          </div>
        </div>
      )}

      {tab === 'new' && isAuthed && (
        <div className="card">
          <h3>Ny annonse-analyse</h3>
          <div className="small">Lim inn URL til annonse</div>
          <input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://..." />

          <div className="small">Søknadslengde</div>
          <select value={applicationStyle} onChange={(e) => setApplicationStyle(e.target.value)}>
            <option value="kort">Kort</option>
            <option value="vanlig">Vanlig</option>
            <option value="profesjonell">Profesjonell</option>
          </select>

          <button type="button" onClick={doAnalyze}>Analyser</button>
        </div>
      )}

      {tab === 'analysis' && isAuthed && (
        <div className="card">
          <h3>Analyse</h3>
          {!analysis ? (
            <div className="small">Ingen analyse enda. Gå til «Ny analyse».</div>
          ) : (
            <>
              <div className="small">Matchscore: {Math.round(analysis.match_score || 0)}%</div>
              {analysis.honest_assessment ? (
                <p style={{ whiteSpace: 'pre-wrap' }}>{analysis.honest_assessment}</p>
              ) : null}

              <div className="row">
                <button type="button" onClick={generatePdfFromLatestAnalysis}>Generer PDF</button>
                <button className="secondary" type="button" onClick={loadDocuments}>Dokumenter</button>
                <button className="secondary" type="button" onClick={() => setTab('new')}>Ny analyse</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'documents' && isAuthed && (
        <div className="card">
          <h3>Dokumenter</h3>
          <button type="button" onClick={loadDocuments}>Oppdater</button>

          <div style={{ height: 10 }} />
          {documents.length === 0 ? (
            <div className="small">Ingen dokumenter enda. Generer PDF fra mobilappen / eller via analyseflyt.</div>
          ) : (
            documents.map((d) => (
              <div key={d.id} className="card" style={{ background: '#171733' }}>
                <div style={{ fontWeight: 800 }}>{d?.job?.title || 'Søknad'}</div>
                <div className="small">{d?.job?.company || ''}</div>
                <div style={{ height: 8 }} />
                <a
                  className="link"
                  href={buildAuthedPdfUrl(d.cover_pdf_url, token)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Åpne PDF
                </a>
              </div>
            ))
          )}
        </div>
      )}

      <div className="card">
        <div className="small">
          Tips: Sett <code>VITE_API_URL</code> ved build, f.eks. <code>https://din-backend</code>.
        </div>
      </div>
    </div>
  );
}
