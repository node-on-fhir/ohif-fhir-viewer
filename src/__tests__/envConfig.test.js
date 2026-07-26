const VARS = [
  ['SMART_CLIENT_ID', 'getEnvSmartClientId', 'vuoMzuq3z39xTj4Qt'],
  ['SMART_FHIR_SERVER_URL', 'getEnvFhirServerUrl', 'http://localhost:3100/baseR4'],
];

describe.each(VARS)('%s via %s', (envVar, getterName, sampleValue) => {
  const original = process.env[envVar];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[envVar];
    } else {
      process.env[envVar] = original;
    }
    jest.resetModules();
  });

  test('returns the value when set', () => {
    process.env[envVar] = sampleValue;
    const getter = require('../envConfig')[getterName];
    expect(getter()).toBe(sampleValue);
  });

  test('returns empty string when unset', () => {
    delete process.env[envVar];
    const getter = require('../envConfig')[getterName];
    expect(getter()).toBe('');
  });

  test('returns empty string when empty', () => {
    process.env[envVar] = '';
    const getter = require('../envConfig')[getterName];
    expect(getter()).toBe('');
  });
});
