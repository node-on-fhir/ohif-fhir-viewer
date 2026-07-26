import React, { useState, useEffect, useCallback } from 'react';
import { useSystem } from '@ohif/core';
import { Button, Input, Label, PanelSection } from '@ohif/ui-next';
import { updateFhirConfig, getFhirConfig } from '../FhirDataSource';
import { subscribeToQueryLog, clearQueryLog, fetchImagingStudies, fetchImagingStudyById, fetchDocumentReferences, fetchDicomFile } from '../FhirDataSource/fhirClient';
import { getStoredToken, clearToken, clearAuthState } from '../FhirDataSource/smartAuth';
import './fhircast/fhircast.css';

function FhirConfigPanel() {
  const { servicesManager, commandsManager, extensionManager } = useSystem();
  const config = getFhirConfig();
  const [fhirBaseUrl, setFhirBaseUrl] = useState(config.fhirBaseUrl || 'http://localhost:3000/baseR4');
  const [patientId, setPatientId] = useState(config.patientId || '');
  const [authToken, setAuthToken] = useState(config.authToken || '');
  const [queryLog, setQueryLog] = useState([]);
  const [fetchStatuses, setFetchStatuses] = useState<Record<string, string>>({});
  const [measurementCount, setMeasurementCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  const storedToken = getStoredToken();
  const isOAuthAuthenticated = config.smartAuthenticated || !!storedToken;

  const urlParams = config.urlParams || {};
  const hasLaunchParams = config.iss || config.launch || Object.keys(urlParams).length > 0;

  const imagingStudyId = urlParams.imagingStudy || '';
  const gridfsFileId = urlParams.gridfsFileId || '';
  const fhirServerRoot = config.fhirServerRoot || '';

  const fetchUrls = [];
  if (patientId) {
    fetchUrls.push({
      key: 'imagingStudyByPatient',
      label: 'ImagingStudy (by patient)',
      url: `${fhirBaseUrl}/ImagingStudy?patient=${patientId}`,
    });
  }
  if (imagingStudyId) {
    fetchUrls.push({
      key: 'imagingStudyById',
      label: 'ImagingStudy (by ID)',
      url: `${fhirBaseUrl}/ImagingStudy/${imagingStudyId}`,
    });
  }
  if (patientId && imagingStudyId) {
    fetchUrls.push({
      key: 'documentReference',
      label: 'DocumentReference',
      url: `${fhirBaseUrl}/DocumentReference?patient=${patientId}&type=http://loinc.org|18748-4&related=ImagingStudy/${imagingStudyId}`,
    });
  }
  if (gridfsFileId && fhirServerRoot) {
    fetchUrls.push({
      key: 'dicomFile',
      label: 'DICOM File',
      url: `${fhirServerRoot}/api/dicom/files/${gridfsFileId}`,
    });
  }

  const handleReauthenticate = useCallback(() => {
    clearToken();
    clearAuthState();
    updateFhirConfig({ authToken: '', smartAuthenticated: false });
    window.location.reload();
  }, []);

  const getTokenExpiry = () => {
    if (!storedToken || !storedToken.expires_in || !storedToken._savedAt) return null;
    const expiresAt = new Date(storedToken._savedAt + storedToken.expires_in * 1000);
    return expiresAt;
  };

  useEffect(() => {
    const unsubscribe = subscribeToQueryLog(log => {
      setQueryLog([...log]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const { measurementService } = servicesManager.services;
    const updateCount = () => {
      setMeasurementCount(measurementService.getMeasurements().length);
    };
    updateCount();

    const events = [
      measurementService.EVENTS.MEASUREMENT_ADDED,
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      measurementService.EVENTS.MEASUREMENT_REMOVED,
      measurementService.EVENTS.MEASUREMENTS_CLEARED,
    ];
    const subs = events.map(event =>
      measurementService.subscribe(event, updateCount)
    );

    return () => {
      subs.forEach(sub => sub.unsubscribe());
    };
  }, [servicesManager]);

  const handleSaveMeasurements = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const { measurementService } = servicesManager.services;
      const measurementData = measurementService.getMeasurements();
      const dataSource = extensionManager.getActiveDataSource()[0];

      await commandsManager.runCommand(
        'storeMeasurements',
        {
          measurementData,
          dataSource,
          additionalFindingTypes: ['ArrowAnnotate'],
          options: {
            SeriesDescription: 'FHIR Imaging Measurement Report',
          },
        },
        'CORNERSTONE_STRUCTURED_REPORT'
      );
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err.message);
    }
  }, [servicesManager, extensionManager, commandsManager]);

  const handleApply = useCallback(() => {
    updateFhirConfig({
      fhirBaseUrl,
      patientId,
      authToken,
    });

    // Reload to trigger data source re-initialization with new config
    window.location.reload();
  }, [fhirBaseUrl, patientId, authToken]);

  const handleFetchData = useCallback(async () => {
    if (fetchUrls.length === 0) {
      return;
    }

    // Save config before fetching
    updateFhirConfig({ fhirBaseUrl, patientId, authToken });

    const initialStatuses: Record<string, string> = {};
    fetchUrls.forEach(f => { initialStatuses[f.key] = 'Fetching...'; });
    setFetchStatuses(initialStatuses);

    const opts = { authToken: authToken || undefined };

    const promises = fetchUrls.map(async (f) => {
      try {
        let result: string;
        if (f.key === 'imagingStudyByPatient') {
          const bundle = await fetchImagingStudies(fhirBaseUrl, patientId, opts);
          const count = bundle.entry ? bundle.entry.length : 0;
          result = `Found ${count} ImagingStud${count === 1 ? 'y' : 'ies'}.`;
        } else if (f.key === 'imagingStudyById') {
          const resource = await fetchImagingStudyById(fhirBaseUrl, imagingStudyId, opts);
          const seriesCount = resource.series ? resource.series.length : 0;
          result = `Found ImagingStudy with ${seriesCount} series.`;
        } else if (f.key === 'documentReference') {
          const bundle = await fetchDocumentReferences(fhirBaseUrl, { patientId, imagingStudyId }, opts);
          const count = bundle.entry ? bundle.entry.length : 0;
          result = `Found ${count} DocumentReference${count === 1 ? '' : 's'}.`;
        } else if (f.key === 'dicomFile') {
          const arrayBuffer = await fetchDicomFile(fhirServerRoot, `/api/dicom/files/${gridfsFileId}`, opts);
          const sizeKB = Math.round(arrayBuffer.byteLength / 1024);
          result = `Received ${sizeKB} KB.`;
        } else {
          result = 'Done.';
        }
        setFetchStatuses(prev => ({ ...prev, [f.key]: result }));
      } catch (error) {
        setFetchStatuses(prev => ({ ...prev, [f.key]: `Error: ${error.message}` }));
      }
    });

    await Promise.allSettled(promises);
  }, [fhirBaseUrl, patientId, authToken, fetchUrls, imagingStudyId, gridfsFileId, fhirServerRoot]);

  const handleCopyUrl = useCallback((url) => {
    navigator.clipboard.writeText(url).catch(() => {
      console.warn('[FHIR] Could not copy to clipboard');
    });
  }, []);

  const getStatusColor = (status) => {
    if (status === 'pending') return 'text-yellow-400';
    if (status === 'error' || (typeof status === 'number' && status >= 400)) return 'text-red-400';
    if (typeof status === 'number' && status >= 200 && status < 300) return 'text-green-400';
    return 'text-muted-foreground';
  };

  return (
    <div className="flex select-none flex-col">
      {hasLaunchParams && (
        <PanelSection defaultOpen={false}>
          <PanelSection.Header>SMART Launch</PanelSection.Header>
          <PanelSection.Content className="bg-muted space-y-2 px-4 pt-2 pb-4">
            {Object.entries(urlParams).map(([key, value]) => (
              <div key={key} className="flex flex-col space-y-0.5">
                <span className="text-muted-foreground text-xs font-medium uppercase">{key}</span>
                <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-white break-all">
                  {value}
                </span>
              </div>
            ))}
            {Object.keys(urlParams).length === 0 && config.iss && (
              <>
                <div className="flex flex-col space-y-0.5">
                  <span className="text-muted-foreground text-xs font-medium uppercase">iss</span>
                  <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-white break-all">{config.iss}</span>
                </div>
                {config.launch && (
                  <div className="flex flex-col space-y-0.5">
                    <span className="text-muted-foreground text-xs font-medium uppercase">launch</span>
                    <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-white break-all">{config.launch}</span>
                  </div>
                )}
              </>
            )}
          </PanelSection.Content>
        </PanelSection>
      )}

      {isOAuthAuthenticated && (
        <PanelSection defaultOpen={false}>
          <PanelSection.Header>SMART Auth</PanelSection.Header>
          <PanelSection.Content className="bg-muted space-y-2 px-4 pt-2 pb-4">
            <div className="flex items-center space-x-2">
              <span className="fhircast-dot--open inline-block h-2 w-2 rounded-full" />
              <span className="fhircast-text-success text-xs font-medium">Authenticated</span>
            </div>

            {storedToken?.scope && (
              <div className="flex flex-col space-y-0.5">
                <span className="text-muted-foreground text-xs font-medium uppercase">Scopes</span>
                <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-white break-all">
                  {storedToken.scope}
                </span>
              </div>
            )}

            {getTokenExpiry() && (
              <div className="flex flex-col space-y-0.5">
                <span className="text-muted-foreground text-xs font-medium uppercase">Expires</span>
                <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-white">
                  {getTokenExpiry().toLocaleTimeString()}
                </span>
              </div>
            )}

            {storedToken?.patient && (
              <div className="flex flex-col space-y-0.5">
                <span className="text-muted-foreground text-xs font-medium uppercase">Patient (from token)</span>
                <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-white break-all">
                  {storedToken.patient}
                </span>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={handleReauthenticate}
            >
              Re-authenticate
            </Button>
          </PanelSection.Content>
        </PanelSection>
      )}

      <PanelSection defaultOpen={false}>
        <PanelSection.Header>FHIR Connection</PanelSection.Header>
        <PanelSection.Content className="bg-muted space-y-3 px-4 pt-2 pb-4">
          <div className="flex flex-col space-y-1">
            <Label className="text-sm">FHIR Server URL</Label>
            <Input
              className="h-8"
              value={fhirBaseUrl}
              onChange={e => setFhirBaseUrl(e.target.value)}
              placeholder="http://localhost:3000/baseR4"
            />
          </div>

          <div className="flex flex-col space-y-1">
            <Label className="text-sm">Patient ID</Label>
            <Input
              className="h-8"
              value={patientId}
              onChange={e => setPatientId(e.target.value)}
              placeholder="Enter patient ID"
            />
          </div>

          <div className="flex flex-col space-y-1">
            <Label className="text-sm">
              Auth Token
              {isOAuthAuthenticated && (
                <span className="ml-2 text-xs text-green-400">(OAuth)</span>
              )}
            </Label>
            <Input
              className="h-8"
              type="password"
              value={authToken}
              onChange={e => setAuthToken(e.target.value)}
              placeholder="Bearer token (optional)"
              readOnly={isOAuthAuthenticated}
            />
          </div>

          <Button
            variant="default"
            size="sm"
            className="mt-2 w-full"
            onClick={handleApply}
          >
            Apply Settings
          </Button>
        </PanelSection.Content>
      </PanelSection>

      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Fetch Data</PanelSection.Header>
        <PanelSection.Content className="bg-muted space-y-2 px-4 pt-2 pb-4">
          {fetchUrls.length > 0 ? (
            fetchUrls.map(f => (
              <div key={f.key} className="space-y-1">
                <span className="text-muted-foreground text-xs font-medium">{f.label}</span>
                <div className="rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white break-all">
                  GET {f.url}
                </div>
                {fetchStatuses[f.key] && (
                  <p className={`text-xs ${fetchStatuses[f.key].startsWith('Error') ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {fetchStatuses[f.key]}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-xs">
              Enter a Patient ID or launch with params to see request URLs.
            </p>
          )}

          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={handleFetchData}
            disabled={fetchUrls.length === 0}
          >
            Fetch Data
          </Button>
        </PanelSection.Content>
      </PanelSection>

      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Measurements</PanelSection.Header>
        <PanelSection.Content className="bg-muted space-y-2 px-4 pt-2 pb-4">
          <p className="text-muted-foreground text-xs">
            {measurementCount} measurement{measurementCount !== 1 ? 's' : ''} on viewport
          </p>
          {saveStatus === 'saved' && (
            <p className="text-xs text-green-400">Saved to FHIR server.</p>
          )}
          {saveStatus === 'error' && (
            <p className="text-xs text-red-400">Error: {saveError}</p>
          )}
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={handleSaveMeasurements}
            disabled={measurementCount === 0 || saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save to FHIR'}
          </Button>
        </PanelSection.Content>
      </PanelSection>

      <PanelSection defaultOpen={true}>
        <PanelSection.Header>
          <div className="flex w-full items-center justify-between">
            <span>Query Log</span>
            {queryLog.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-xs"
                onClick={e => {
                  e.stopPropagation();
                  clearQueryLog();
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </PanelSection.Header>
        <PanelSection.Content className="bg-muted max-h-80 overflow-y-auto px-4 pt-2 pb-4">
          {queryLog.length === 0 ? (
            <p className="text-muted-foreground text-xs">No queries yet. Apply settings to begin.</p>
          ) : (
            <div className="space-y-2">
              {queryLog.map((entry, i) => (
                <div
                  key={i}
                  className="border-input cursor-pointer rounded border p-2 text-xs hover:bg-black/10"
                  onClick={() => handleCopyUrl(entry.url)}
                  title="Click to copy URL"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold">{entry.method}</span>
                    <span className={getStatusColor(entry.status)}>
                      {entry.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 truncate font-mono">
                    {entry.url}
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </div>
                  {entry.error && (
                    <div className="mt-1 text-red-400">
                      {entry.error.substring(0, 100)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </PanelSection.Content>
      </PanelSection>
    </div>
  );
}

export default FhirConfigPanel;
