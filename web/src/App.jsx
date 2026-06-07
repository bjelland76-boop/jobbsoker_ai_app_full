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
  const [authStep, setAuthStep] = useState('email'); // email | login | register
  const [signupName, setSignupName] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
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

  function resetAuthFlow({ keepEmail = true } = {}) {
    setAuthError('');
    setAuthNotice('');
    setCodeSent(false);
    setCode('');
    setSignupName('');
    setAuthStep('email');
    if (!keepEmail) setEmail('');
  }

  async function startAuth(nextStep) {
    // Keep existing OTP flow. We simply let the user choose
    // «Logg inn» vs «Opprett konto» without requiring any extra backend endpoint.
    setAuthStep(nextStep);
    await requestCode();
  }

  async function requestCode() {
    const e = (email || '').trim().toLowerCase();
    if (!e || !e.includes('@')) {
      setAuthError('Skriv inn en gyldig e-post');
      return;
    }

    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');

    try {
      await apiFetch('/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e }),
      });
      setCodeSent(true);
      setCode('');
      setAuthNotice('Kode sendt. Sjekk e-posten din.');
    } catch (err) {
      setAuthError(errText(err));
    } finally {
      setAuthLoading(false);
    }
  }

  async function verifyCode() {
    const e = (email || '').trim().toLowerCase();
    const c = String(code || '').trim();

    if (!e || !c) {
      setAuthError('Mangler e-post eller kode');
      return;
    }

    if (authStep === 'register' && !(signupName || '').trim()) {
      setAuthError('Skriv inn navn');
      return;
    }

    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');

    try {
      const payload = { email: e, code: c };
      if (authStep === 'register') payload.name = (signupName || '').trim();

      const res = await apiFetch('/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const t = res?.access_token;
      if (!t) throw new Error('Mangler token fra server');
      setToken(t);
    } catch (err) {
      setAuthError(errText(err));
    } finally {
      setAuthLoading(false);
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
        <div className="authShell">
          <div className={`authCard ${authLoading ? 'isLoading' : ''}`}>
            <div className="authHeader">
              <div className="authKicker">Ærlig JobbCoach</div>
              <h1 className="authTitle">Kom i gang</h1>
              <div className="authSubtitle">Logg inn med engangskode på e-post. Ingen passord.</div>
            </div>

            {authStep === 'email' ? (
              <div className="authBody">
                <label className="field">
                  <div className="label">E-post</div>
                  <input
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setAuthError('');
                      setAuthNotice('');
                    }}
                    placeholder="navn@firma.no"
                    autoComplete="email"
                  />
                </label>

                {authError ? <div className="alert error">{authError}</div> : null}
                {authNotice ? <div className="alert notice">{authNotice}</div> : null}

                <div className="row" style={{ gap: 10 }}>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => startAuth('login')}
                    disabled={authLoading}
                    aria-busy={authLoading}
                    style={{ flex: 1 }}
                  >
                    <span className="btnContent">
                      <span>{authLoading ? 'Sender…' : 'Send engangskode'}</span>
                      {authLoading ? <span className="spinner" aria-hidden="true" /> : null}
                    </span>
                  </button>

                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => startAuth('register')}
                    disabled={authLoading}
                    style={{ flex: 1 }}
                  >
                    Opprett konto
                  </button>
                </div>

                <div className="finePrint">Trykk «Send engangskode» for å logge inn. Har du ikke konto, trykk «Opprett konto» (da legger du inn navn).</div>
              </div>
            ) : (
              <div className="authBody">
                <div className="emailPillRow">
                  <div className="emailPill">{(email || '').trim().toLowerCase()}</div>
                  <button
                    type="button"
                    className="btn link"
                    onClick={() => resetAuthFlow({ keepEmail: true })}
                    disabled={authLoading}
                  >
                    Endre
                  </button>
                </div>

                <div className="stepTitle">
                  {authStep === 'login' ? 'Logg inn' : 'Opprett konto'}
                </div>

                {authStep === 'register' ? (
                  <>
                    <div className="callout">
                      Opprett konto: Skriv inn navn, og bekreft engangskoden du får på e-post.
                    </div>
                    <label className="field">
                      <div className="label">Navn</div>
                      <input
                        value={signupName}
                        onChange={(e) => setSignupName(e.target.value)}
                        placeholder="Ditt navn"
                        autoComplete="name"
                      />
                    </label>
                  </>
                ) : null}

                {!codeSent ? (
                  <button
                    className="btn primary"
                    type="button"
                    onClick={requestCode}
                    disabled={authLoading}
                    aria-busy={authLoading}
                  >
                    <span className="btnContent">
                      <span>{authLoading ? 'Sender…' : 'Send engangskode'}</span>
                      {authLoading ? <span className="spinner" aria-hidden="true" /> : null}
                    </span>
                  </button>
                ) : (
                  <>
                    <label className="field">
                      <div className="label">Engangskode</div>
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="6 siffer"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                      />
                    </label>

                    <button
                      className="btn primary"
                      type="button"
                      onClick={verifyCode}
                      disabled={authLoading}
                      aria-busy={authLoading}
                    >
                      <span className="btnContent">
                        <span>{authLoading ? 'Verifiserer…' : (authStep === 'login' ? 'Logg inn' : 'Opprett konto')}</span>
                        {authLoading ? <span className="spinner" aria-hidden="true" /> : null}
                      </span>
                    </button>

                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => requestCode()}
                        disabled={authLoading}
                      >
                        Send ny kode
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => { setCodeSent(false); setCode(''); setAuthError(''); setAuthNotice(''); }}
                        disabled={authLoading}
                      >
                        Tilbake
                      </button>
                    </div>
                  </>
                )}

                {authError ? <div className="alert error" style={{ marginTop: 12 }}>{authError}</div> : null}
                {authNotice ? <div className="alert notice" style={{ marginTop: 12 }}>{authNotice}</div> : null}
              </div>
            )}
          </div>
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
              {analysis.interview_probability !== undefined && analysis.interview_probability !== null ? (
                <div className="small">Intervju-sjanse: {Math.round(analysis.interview_probability || 0)}%</div>
              ) : null}
              {analysis.seniority_match !== undefined && analysis.seniority_match !== null ? (
                <div className="small">Senioritet-match: {Math.round(analysis.seniority_match || 0)}%</div>
              ) : null}

              {analysis.top_reason ? (
                <p style={{ whiteSpace: 'pre-wrap' }}><strong>Toppgrunn:</strong> {analysis.top_reason}</p>
              ) : null}
              {analysis.main_risk ? (
                <p style={{ whiteSpace: 'pre-wrap' }}><strong>Hovedrisiko:</strong> {analysis.main_risk}</p>
              ) : null}

              {analysis?.recruiter_explanation?.why_score?.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div className="small"><strong>Hvorfor denne scoren</strong></div>
                  <ul>
                    {analysis.recruiter_explanation.why_score.map((x, i) => (
                      <li key={i} className="small">{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {analysis?.recruiter_explanation?.score_risks?.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div className="small"><strong>Risikoer</strong></div>
                  <ul>
                    {analysis.recruiter_explanation.score_risks.map((x, i) => (
                      <li key={i} className="small">{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {Array.isArray(analysis.recommended_cv_changes) && analysis.recommended_cv_changes.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div className="small"><strong>Anbefalte CV-endringer</strong></div>
                  <ul>
                    {analysis.recommended_cv_changes.map((x, i) => (
                      <li key={i} className="small">{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

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
