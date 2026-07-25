import { getPanelIdFromSearch } from '../panelFromUrl';

describe('getPanelIdFromSearch', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps panel=fhir-connection to the FHIR config panel', () => {
    expect(getPanelIdFromSearch('?panel=fhir-connection')).toBe(
      '@ohif/fhir-viewer.panelModule.fhirConfig'
    );
  });

  it('maps panel=fhircast to the FHIRcast panel', () => {
    expect(getPanelIdFromSearch('?panel=fhircast')).toBe(
      '@ohif/fhir-viewer.panelModule.fhirCast'
    );
  });

  it('maps panel=measurements to the cornerstone measurements panel', () => {
    expect(getPanelIdFromSearch('?panel=measurements')).toBe(
      '@ohif/extension-cornerstone.panelModule.panelMeasurement'
    );
  });

  it('matches panel values case-insensitively', () => {
    expect(getPanelIdFromSearch('?panel=FHIRcast')).toBe(
      '@ohif/fhir-viewer.panelModule.fhirCast'
    );
  });

  it('resolves the panel param among other query params', () => {
    expect(getPanelIdFromSearch('?patient=pat-42&panel=fhircast&iss=https://x')).toBe(
      '@ohif/fhir-viewer.panelModule.fhirCast'
    );
  });

  it('returns null when no panel param is present', () => {
    expect(getPanelIdFromSearch('')).toBeNull();
    expect(getPanelIdFromSearch('?patient=pat-42')).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns for an unknown panel value', () => {
    expect(getPanelIdFromSearch('?panel=bogus')).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('bogus'));
  });
});
