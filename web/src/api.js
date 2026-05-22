const API_BASE = (import.meta.env.VITE_API_URL || '').trim() || 'http://localhost:8000';

let authToken = null;

export function setAuthToken(token) {
  authToken = token;
}

export function getApiBase() {
  return API_BASE;
}

export async function apiFetch(path, options) {
  const opts = options ? { ...options } : {};
  const headers = { ...(opts.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  opts.headers = headers;

  const r = await fetch(`${API_BASE}${path}`, opts);

  let data = null;
  try {
    data = await r.json();
  } catch (e) {
    // ignore
  }

  if (!r.ok) {
    const msg = (data && (data.detail || data.error)) || r.statusText || 'Ukjent feil';
    throw new Error(msg);
  }

  return data;
}
