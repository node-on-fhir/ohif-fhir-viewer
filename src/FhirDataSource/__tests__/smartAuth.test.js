import { createHash } from 'crypto';
import {
  fetchSmartConfiguration,
  generatePKCE,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  buildRegistrationBody,
  registerSmartClient,
  saveAuthState,
  loadAuthState,
  clearAuthState,
  saveToken,
  getStoredToken,
  clearToken,
} from '../smartAuth';

function base64UrlOf(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

beforeEach(() => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
});

describe('generatePKCE', () => {
  it('produces a base64url verifier and a matching S256 challenge', async () => {
    const { codeVerifier, codeChallenge } = await generatePKCE();

    // 32 random bytes → 43 base64url chars, unpadded
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const expected = base64UrlOf(createHash('sha256').update(codeVerifier).digest());
    expect(codeChallenge).toBe(expected);
  });

  it('produces a different verifier on every call', async () => {
    const a = await generatePKCE();
    const b = await generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('buildAuthorizationUrl', () => {
  const params = {
    authorizationEndpoint: 'https://auth.example.com/authorize',
    clientId: 'my-client',
    redirectUri: 'http://localhost:3000/fhir-viewer',
    scope: 'launch openid fhirUser',
    state: 'abc123',
    codeChallenge: 'challenge-value',
    iss: 'https://fhir.example.com/baseR4',
  };

  it('builds a standards-compliant authorization URL', () => {
    const url = new URL(buildAuthorizationUrl({ ...params, launch: 'launch-token' }));

    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('my-client');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/fhir-viewer');
    expect(url.searchParams.get('scope')).toBe('launch openid fhirUser');
    expect(url.searchParams.get('state')).toBe('abc123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('aud')).toBe('https://fhir.example.com/baseR4');
    expect(url.searchParams.get('launch')).toBe('launch-token');
  });

  it('omits the launch param when not provided', () => {
    const url = new URL(buildAuthorizationUrl(params));
    expect(url.searchParams.has('launch')).toBe(false);
  });
});

describe('fetchSmartConfiguration', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('strips trailing slashes from iss before hitting .well-known', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        authorization_endpoint: 'https://x/auth',
        token_endpoint: 'https://x/token',
        extra_field: 'dropped',
      }),
    });

    const config = await fetchSmartConfiguration('https://x/fhir/R4//');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://x/fhir/R4/.well-known/smart-configuration',
      expect.anything()
    );
    expect(config).toEqual({
      authorization_endpoint: 'https://x/auth',
      token_endpoint: 'https://x/token',
    });
  });

  it('throws with status details when discovery fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(fetchSmartConfiguration('https://x/fhir/R4')).rejects.toThrow(
      /SMART discovery failed: 401/
    );
  });
});

describe('exchangeCodeForToken', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('posts a form-encoded authorization_code grant', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok', patient: 'pat-1' }),
    });

    const result = await exchangeCodeForToken({
      tokenEndpoint: 'https://x/token',
      code: 'the-code',
      clientId: 'my-client',
      redirectUri: 'http://localhost:3000/fhir-viewer',
      codeVerifier: 'verifier',
    });

    expect(result).toEqual({ access_token: 'tok', patient: 'pat-1' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://x/token');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(opts.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_id')).toBe('my-client');
    expect(body.get('code_verifier')).toBe('verifier');
  });

  it('throws with status details when the exchange fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(
      exchangeCodeForToken({
        tokenEndpoint: 'https://x/token',
        code: 'bad',
        clientId: 'c',
        redirectUri: 'r',
        codeVerifier: 'v',
      })
    ).rejects.toThrow(/Token exchange failed: 400/);
  });
});

describe('buildRegistrationBody', () => {
  it('builds a standard dynamic-client-registration body', () => {
    expect(
      buildRegistrationBody({
        clientName: 'OHIF Viewer',
        redirectUris: ['http://localhost:3000/fhir-viewer'],
        scope: 'launch openid',
      })
    ).toEqual({
      client_name: 'OHIF Viewer',
      redirect_uris: ['http://localhost:3000/fhir-viewer'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: 'launch openid',
      token_endpoint_auth_method: 'client_secret_basic',
    });
  });
});

describe('registerSmartClient', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('posts the field-derived body by default', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ client_id: 'new-id' }),
    });

    const result = await registerSmartClient({
      fhirServerRoot: 'https://x',
      clientName: 'OHIF Viewer',
      redirectUris: ['http://r'],
      scope: 'launch',
    });

    expect(result).toEqual({ client_id: 'new-id' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://x/oauth/registration');
    expect(JSON.parse(opts.body)).toEqual(
      buildRegistrationBody({ clientName: 'OHIF Viewer', redirectUris: ['http://r'], scope: 'launch' })
    );
  });

  it('sends a user-supplied body verbatim when provided', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ client_id: 'new-id' }),
    });

    const custom = { client_name: 'Edited', custom_field: true };
    await registerSmartClient({
      fhirServerRoot: 'https://x',
      clientName: 'ignored',
      redirectUris: ['http://r'],
      scope: 'ignored',
      body: custom,
    });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(custom);
  });

  it('throws with status details when registration fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_client_metadata',
    });

    await expect(
      registerSmartClient({ fhirServerRoot: 'https://x', clientName: 'c', redirectUris: [], scope: 's' })
    ).rejects.toThrow(/Client registration failed: 400/);
  });
});

describe('auth state persistence', () => {
  it('round-trips auth state through sessionStorage', () => {
    const state = { state: 's1', codeVerifier: 'v', iss: 'https://x', clientId: 'c' };
    saveAuthState(state);
    expect(loadAuthState()).toEqual(state);

    clearAuthState();
    expect(loadAuthState()).toBeNull();
  });

  it('returns null for corrupt stored auth state', () => {
    sessionStorage.setItem('fhir_smart_auth_state', '{not json');
    expect(loadAuthState()).toBeNull();
  });
});

describe('token storage', () => {
  it('round-trips a token and stamps _savedAt', () => {
    saveToken({ access_token: 'tok', 'hub.url': 'https://hub' });
    const stored = getStoredToken();
    expect(stored.access_token).toBe('tok');
    expect(stored['hub.url']).toBe('https://hub');
    expect(typeof stored._savedAt).toBe('number');
  });

  it('expires tokens based on expires_in and clears them', () => {
    saveToken({ access_token: 'tok', expires_in: 3600 });
    // Rewrite _savedAt to two hours ago to simulate expiry
    const raw = JSON.parse(sessionStorage.getItem('fhir_smart_token'));
    raw._savedAt = Date.now() - 2 * 3600 * 1000;
    sessionStorage.setItem('fhir_smart_token', JSON.stringify(raw));

    expect(getStoredToken()).toBeNull();
    expect(sessionStorage.getItem('fhir_smart_token')).toBeNull();
  });

  it('keeps tokens that have not yet expired', () => {
    saveToken({ access_token: 'tok', expires_in: 3600 });
    expect(getStoredToken()).not.toBeNull();
  });

  it('returns null for corrupt stored tokens', () => {
    sessionStorage.setItem('fhir_smart_token', '{not json');
    expect(getStoredToken()).toBeNull();
  });

  it('clearToken removes the stored token', () => {
    saveToken({ access_token: 'tok' });
    clearToken();
    expect(getStoredToken()).toBeNull();
  });
});
