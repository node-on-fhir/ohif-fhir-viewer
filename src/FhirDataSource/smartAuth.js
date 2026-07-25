import { addLogEntry } from './fhirClient';

const SESSION_KEY = 'fhir_smart_auth_state';
const TOKEN_KEY = 'fhir_smart_token';

// --- SMART Configuration Discovery ---

export async function fetchSmartConfiguration(issUrl) {
  // Strip any trailing slash so a slash-terminated iss (e.g. http://host/fhir/R4/) doesn't produce
  // a double slash. Medplum routes `/fhir/R4//.well-known/...` through the authenticated FHIR router
  // (→ 401) instead of serving the public discovery document at `/fhir/R4/.well-known/...`.
  const base = issUrl.replace(/\/+$/, '');
  const url = `${base}/.well-known/smart-configuration`;
  const entry = {
    timestamp: new Date().toISOString(),
    method: 'GET',
    url,
    status: 'pending',
    error: null,
  };
  addLogEntry(entry);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    entry.status = response.status;

    if (!response.ok) {
      const text = await response.text();
      entry.error = text;
      throw new Error(`SMART discovery failed: ${response.status} ${text}`);
    }

    const config = await response.json();
    return {
      authorization_endpoint: config.authorization_endpoint,
      token_endpoint: config.token_endpoint,
    };
  } catch (error) {
    if (entry.status === 'pending') {
      entry.status = 'error';
    }
    entry.error = entry.error || error.message;
    throw error;
  }
}

// --- PKCE ---

export async function generatePKCE() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = base64UrlEncode(array);

  const encoded = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));

  return { codeVerifier, codeChallenge };
}

function base64UrlEncode(buffer) {
  let str = '';
  for (const byte of buffer) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- Authorization URL ---

export function buildAuthorizationUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  scope,
  state,
  codeChallenge,
  iss,
  launch,
}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    aud: iss,
  });
  if (launch) {
    params.set('launch', launch);
  }
  return `${authorizationEndpoint}?${params.toString()}`;
}

// --- Token Exchange ---

export async function exchangeCodeForToken({
  tokenEndpoint,
  code,
  clientId,
  redirectUri,
  codeVerifier,
}) {
  const entry = {
    timestamp: new Date().toISOString(),
    method: 'POST',
    url: tokenEndpoint,
    status: 'pending',
    error: null,
  };
  addLogEntry(entry);

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    entry.status = response.status;

    if (!response.ok) {
      const text = await response.text();
      entry.error = text;
      throw new Error(`Token exchange failed: ${response.status} ${text}`);
    }

    const tokenResponse = await response.json();
    return tokenResponse;
  } catch (error) {
    if (entry.status === 'pending') {
      entry.status = 'error';
    }
    entry.error = entry.error || error.message;
    throw error;
  }
}

// --- Auth State (sessionStorage) ---

export function saveAuthState(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function loadAuthState() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearAuthState() {
  sessionStorage.removeItem(SESSION_KEY);
}

// --- Token Storage ---

export function saveToken(tokenResponse) {
  const data = {
    ...tokenResponse,
    _savedAt: Date.now(),
  };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(data));
}

export function getStoredToken() {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    // Check expiry: expires_in is seconds from _savedAt
    if (data.expires_in && data._savedAt) {
      const expiresAt = data._savedAt + data.expires_in * 1000;
      if (Date.now() >= expiresAt) {
        clearToken();
        return null;
      }
    }
    return data;
  } catch {
    return null;
  }
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

// --- Dynamic Client Registration ---

export function buildRegistrationBody({ clientName, redirectUris, scope }) {
  return {
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope,
    token_endpoint_auth_method: 'client_secret_basic',
  };
}

// `body` (optional) is sent verbatim when provided — the preferences modal
// passes the user-edited request body; otherwise it is built from the fields.
export async function registerSmartClient({ fhirServerRoot, clientName, redirectUris, scope, body }) {
  const url = `${fhirServerRoot}/oauth/registration`;
  const entry = {
    timestamp: new Date().toISOString(),
    method: 'POST',
    url,
    status: 'pending',
    error: null,
  };
  addLogEntry(entry);

  try {
    if (!body) {
      body = buildRegistrationBody({ clientName, redirectUris, scope });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    entry.status = response.status;

    if (!response.ok) {
      const text = await response.text();
      entry.error = text;
      throw new Error(`Client registration failed: ${response.status} ${text}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    if (entry.status === 'pending') {
      entry.status = 'error';
    }
    entry.error = entry.error || error.message;
    throw error;
  }
}
