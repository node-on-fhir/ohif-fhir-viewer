import React, { useMemo, useState, useEffect } from 'react';
import { useSystem, hotkeys as hotkeysModule } from '@ohif/core';
import {
  UserPreferencesModal,
  FooterAction,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
} from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import i18n from '@ohif/i18n';
import { getFhirConfig, updateFhirConfig, registerSmartClient } from '../FhirDataSource';
import { buildRegistrationBody } from '../FhirDataSource/smartAuth';
import { getEnvSmartClientId, getEnvFhirServerUrl } from '../envConfig';
import RegistrationBodyEditor from './RegistrationBodyEditor';
import './smartPreferences.css';

const { availableLanguages, defaultLanguage, currentLanguage: currentLanguageFn } = i18n;

const SMART_STORAGE_KEY = 'fhir_smart_config';
const DEFAULT_FHIR_BASE_URL = 'http://localhost:3100/baseR4';

interface HotkeyDefinition {
  keys: string;
  label: string;
}

interface HotkeyDefinitions {
  [key: string]: HotkeyDefinition;
}

function loadSmartConfig() {
  try {
    const raw = localStorage.getItem(SMART_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    // ignore parse errors
  }
  return {};
}

function saveSmartConfig(config: Record<string, string>) {
  localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify(config));
}

function SmartPreferencesModal({ hide }: { hide: () => void }) {
  const { hotkeysManager } = useSystem();
  const { t, i18n: i18nextInstance } = useTranslation('UserPreferencesModal');

  const { hotkeyDefinitions = {}, hotkeyDefaults = {} } = hotkeysManager;

  const fallbackHotkeyDefinitions = useMemo(
    () =>
      hotkeysManager.getValidHotkeyDefinitions(
        hotkeysModule.defaults.hotkeyBindings
      ) as HotkeyDefinitions,
    [hotkeysManager]
  );

  useEffect(() => {
    if (!Object.keys(hotkeyDefaults).length) {
      hotkeysManager.setDefaultHotKeys(hotkeysModule.defaults.hotkeyBindings);
    }

    if (!Object.keys(hotkeyDefinitions).length) {
      hotkeysManager.setHotkeys(fallbackHotkeyDefinitions);
    }
  }, [hotkeysManager, hotkeyDefaults, hotkeyDefinitions, fallbackHotkeyDefinitions]);

  const resolvedHotkeyDefaults = Object.keys(hotkeyDefaults).length
    ? (hotkeyDefaults as HotkeyDefinitions)
    : fallbackHotkeyDefinitions;

  const initialHotkeyDefinitions = Object.keys(hotkeyDefinitions).length
    ? (hotkeyDefinitions as HotkeyDefinitions)
    : resolvedHotkeyDefaults;

  const currentLanguage = currentLanguageFn();

  // Initialize SMART fields from current config + localStorage overrides.
  // Env vars (inlined at build time — see src/envConfig.js) win over both and
  // lock their fields, since editing them here could not change the bundle.
  const fhirConfig = getFhirConfig();
  const savedSmart = loadSmartConfig();
  const envClientId = getEnvSmartClientId();
  const envFhirServerUrl = getEnvFhirServerUrl();

  const [state, setState] = useState({
    hotkeyDefinitions: initialHotkeyDefinitions,
    languageValue: currentLanguage.value,
    smartClientId: envClientId || savedSmart.smartClientId || fhirConfig.smartClientId || '',
    smartClientName: savedSmart.smartClientName || 'OHIF Viewer',
    smartScope: savedSmart.smartScope || fhirConfig.smartScope || 'launch openid fhirUser patient/*.read',
    fhirBaseUrl: envFhirServerUrl || savedSmart.fhirBaseUrl || DEFAULT_FHIR_BASE_URL,
  });

  const [regStatus, setRegStatus] = useState<'idle' | 'registering' | 'success' | 'error'>('idle');
  const [regError, setRegError] = useState('');
  const [showBodyEditor, setShowBodyEditor] = useState(false);
  // null = follow the form fields; a string = user-edited body that wins
  const [bodyOverride, setBodyOverride] = useState<string | null>(null);

  const redirectUri = typeof window !== 'undefined'
    ? window.location.origin + '/fhir-viewer'
    : '';

  const onLanguageChangeHandler = (value: string) => {
    setState(s => ({ ...s, languageValue: value }));
  };

  const onHotkeyChangeHandler = (id: string, newKeys: string) => {
    setState(s => ({
      ...s,
      hotkeyDefinitions: {
        ...s.hotkeyDefinitions,
        [id]: {
          ...s.hotkeyDefinitions[id],
          keys: newKeys,
        },
      },
    }));
  };

  const onResetHandler = () => {
    setState(s => ({
      ...s,
      languageValue: defaultLanguage.value,
      hotkeyDefinitions: resolvedHotkeyDefaults,
    }));

    hotkeysManager.restoreDefaultBindings();
  };

  // Derive the registration endpoint from the FHIR Server URL. The browser
  // calls the FHIR server directly at its absolute origin (no proxy), so the
  // server must allow the OHIF origin via CORS.
  const { registrationUrl, fhirServerRootForReg } = useMemo(() => {
    if (!state.fhirBaseUrl) return { registrationUrl: '', fhirServerRootForReg: '' };
    try {
      const parsed = new URL(state.fhirBaseUrl);
      return {
        registrationUrl: parsed.origin + '/oauth/registration',
        fhirServerRootForReg: parsed.origin,
      };
    } catch {
      return { registrationUrl: '', fhirServerRootForReg: '' };
    }
  }, [state.fhirBaseUrl]);

  const defaultBodyJson = useMemo(
    () =>
      JSON.stringify(
        buildRegistrationBody({
          clientName: state.smartClientName,
          redirectUris: [redirectUri],
          scope: state.smartScope,
        }),
        null,
        2
      ),
    [state.smartClientName, state.smartScope, redirectUri]
  );

  const effectiveBody = bodyOverride ?? defaultBodyJson;

  const bodyIsValid = useMemo(() => {
    try {
      JSON.parse(effectiveBody);
      return true;
    } catch {
      return false;
    }
  }, [effectiveBody]);

  const onRegisterHandler = async () => {
    setRegStatus('registering');
    setRegError('');

    try {
      const result = await registerSmartClient({
        fhirServerRoot: fhirServerRootForReg,
        clientName: state.smartClientName,
        redirectUris: [redirectUri],
        scope: state.smartScope,
        body: bodyOverride !== null ? JSON.parse(bodyOverride) : undefined,
      });

      // Auto-fill client_id from the response
      if (result.client_id) {
        setState(s => ({ ...s, smartClientId: result.client_id }));
      }

      setRegStatus('success');
    } catch (error) {
      setRegStatus('error');
      setRegError(error.message || String(error));
    }
  };

  const displayNames = useMemo(() => {
    if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') {
      return null;
    }

    const locales = [state.languageValue, currentLanguage.value, i18nextInstance.language, 'en'];
    const uniqueLocales = Array.from(new Set(locales.filter(Boolean)));

    try {
      return new Intl.DisplayNames(uniqueLocales, { type: 'language', fallback: 'none' });
    } catch (error) {
      console.warn('Intl.DisplayNames not supported for locales', uniqueLocales, error);
    }

    return null;
  }, [state.languageValue, currentLanguage.value, i18nextInstance.language]);

  const getLanguageLabel = React.useCallback(
    (languageValue: string, fallbackLabel: string) => {
      const translationKey = `LanguageName.${languageValue}`;
      if (i18nextInstance.exists(translationKey, { ns: 'UserPreferencesModal' })) {
        return t(translationKey);
      }

      if (displayNames) {
        try {
          const localized = displayNames.of(languageValue);
          if (localized && localized.toLowerCase() !== languageValue.toLowerCase()) {
            return localized.charAt(0).toUpperCase() + localized.slice(1);
          }
        } catch (error) {
          console.debug(`Unable to resolve display name for ${languageValue}`, error);
        }
      }

      return fallbackLabel;
    },
    [displayNames, i18nextInstance, t]
  );

  const onSaveHandler = () => {
    // Save SMART config to localStorage and update runtime config
    const smartConfig = {
      smartClientId: state.smartClientId,
      smartClientName: state.smartClientName,
      smartScope: state.smartScope,
      fhirBaseUrl: state.fhirBaseUrl,
    };
    saveSmartConfig(smartConfig);
    updateFhirConfig(smartConfig);

    // Save language/hotkey changes (same as default modal)
    if (state.languageValue !== currentLanguage.value) {
      i18n.changeLanguage(state.languageValue);
      window.location.reload();
      return;
    }
    hotkeysManager.setHotkeys(state.hotkeyDefinitions);
    hotkeysModule.stopRecord();
    hotkeysModule.unpause();
    hide();
  };

  return (
    <UserPreferencesModal>
      <UserPreferencesModal.Body>
        {/* Language Section */}
        <div className="mb-3 flex items-center space-x-14">
          <UserPreferencesModal.SubHeading>{t('Language')}</UserPreferencesModal.SubHeading>
          <Select
            defaultValue={state.languageValue}
            onValueChange={onLanguageChangeHandler}
          >
            <SelectTrigger
              className="w-60"
              aria-label="Language"
            >
              <SelectValue placeholder={t('Select language')} />
            </SelectTrigger>
            <SelectContent>
              {availableLanguages.map(lang => (
                <SelectItem
                  key={lang.value}
                  value={lang.value}
                >
                  {getLanguageLabel(lang.value, lang.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* SMART on FHIR Section */}
        <div className="mb-4">
          <UserPreferencesModal.SubHeading>SMART on FHIR</UserPreferencesModal.SubHeading>
          <div className="smart-reg-grid">
            {/* Row 1: FHIR Server URL + actions */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smart-fhir-url" className="text-sm">
                FHIR Server URL
              </Label>
              <Input
                id="smart-fhir-url"
                value={state.fhirBaseUrl}
                onChange={e => setState(s => ({ ...s, fhirBaseUrl: e.target.value }))}
                placeholder={DEFAULT_FHIR_BASE_URL}
                disabled={!!envFhirServerUrl}
              />
              {envFhirServerUrl && (
                <p className="text-muted-foreground text-xs">
                  Set by the SMART_FHIR_SERVER_URL environment variable.
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => setShowBodyEditor(v => !v)}
            >
              {showBodyEditor ? 'Hide Request Body' : 'Edit Request Body'}
            </Button>
            <Button
              variant="outline"
              disabled={
                !!envClientId ||
                regStatus === 'registering' ||
                !state.smartClientName.trim() ||
                !registrationUrl ||
                !bodyIsValid
              }
              onClick={onRegisterHandler}
            >
              {regStatus === 'registering' ? 'Registering...' : 'Register'}
            </Button>
            {/* Hint line under the URL input — full-width row so the action
                buttons above stay bottom-aligned with the input itself */}
            {(!state.fhirBaseUrl || registrationUrl) && (
              <p className="text-muted-foreground smart-span-all -mt-2 text-xs">
                {!state.fhirBaseUrl
                  ? 'Enter a FHIR Server URL to enable registration.'
                  : `Registration endpoint: ${registrationUrl}`}
              </p>
            )}
            {/* Collapsible: client metadata + request body — everything that
                feeds the Register request lives behind Edit Request Body */}
            {showBodyEditor && (
              <>
                <div className="smart-meta-grid smart-span-all">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="smart-client-name" className="text-sm">
                      Client Name
                    </Label>
                    <Input
                      id="smart-client-name"
                      value={state.smartClientName}
                      onChange={e => setState(s => ({ ...s, smartClientName: e.target.value }))}
                      placeholder="e.g. OHIF Viewer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="smart-redirect" className="text-sm">
                      Redirect URI
                    </Label>
                    <Input
                      id="smart-redirect"
                      value={redirectUri}
                      readOnly
                      className="text-muted-foreground cursor-default"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="smart-scope" className="text-sm">
                      Scopes
                    </Label>
                    <Input
                      id="smart-scope"
                      value={state.smartScope}
                      readOnly
                      className="text-muted-foreground cursor-default"
                    />
                  </div>
                </div>
                <div className="smart-span-all">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Registration Request Body</Label>
                    <div className="flex items-center gap-3">
                      {!bodyIsValid && (
                        <span className="text-muted-foreground text-xs">
                          Request body is not valid JSON — Register is disabled
                        </span>
                      )}
                      {bodyOverride !== null && (
                        <button
                          type="button"
                          className="smart-body-reset"
                          onClick={() => setBodyOverride(null)}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="smart-body-editor">
                    <RegistrationBodyEditor
                      value={effectiveBody}
                      onChange={setBodyOverride}
                    />
                  </div>
                </div>
              </>
            )}
            {/* ...Client ID — its output, assigned by the server's response.
                First grid column only, so it matches the URL input's width. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smart-client-id" className="text-sm">
                Client ID
              </Label>
              <Input
                id="smart-client-id"
                value={state.smartClientId}
                onChange={e => setState(s => ({ ...s, smartClientId: e.target.value }))}
                placeholder="e.g. kvGGaJjJyBjKRiNXw"
                disabled={!!envClientId}
              />
              {envClientId ? (
                <p className="text-muted-foreground text-xs">
                  Set by the SMART_CLIENT_ID environment variable. Registration
                  is disabled while it is set.
                </p>
              ) : (
                !state.smartClientId && (
                  <p className="text-muted-foreground text-xs">
                    No client ID configured. Use Register to obtain one.
                  </p>
                )
              )}
            </div>
          </div>
          {regStatus === 'success' && (
            <>
              <p className="mt-2 text-xs text-green-500">
                Registration successful — Client ID has been filled in.
              </p>
              {state.smartClientId && (
                <div className="mt-2 rounded border border-white/10 bg-black/30 px-2 py-1.5">
                  <p className="text-muted-foreground m-0 text-xs">
                    To persist these settings across rebuilds, stop the dev
                    server and restart it with the environment variables set:
                  </p>
                  <pre className="m-0 mt-1 whitespace-pre-wrap break-words font-mono text-xs text-white">
                    {`SMART_CLIENT_ID=${state.smartClientId} SMART_FHIR_SERVER_URL=${state.fhirBaseUrl} pnpm dev`}
                  </pre>
                  <p className="text-muted-foreground m-0 mt-1 text-xs">
                    or add the following to{' '}
                    <span className="font-mono">platform/app/.env</span> and
                    restart:
                  </p>
                  <pre className="m-0 mt-1 whitespace-pre-wrap break-words font-mono text-xs text-white">
                    {`SMART_CLIENT_ID=${state.smartClientId}\nSMART_FHIR_SERVER_URL=${state.fhirBaseUrl}`}
                  </pre>
                  <p className="text-muted-foreground m-0 mt-1 text-xs">
                    Env values take priority and lock these fields.
                  </p>
                </div>
              )}
            </>
          )}
          {regStatus === 'error' && (
            <p className="text-muted-foreground mt-2 text-xs">
              Registration failed: {regError}
            </p>
          )}
        </div>

        <UserPreferencesModal.SubHeading>{t('Hotkeys')}</UserPreferencesModal.SubHeading>
        <UserPreferencesModal.HotkeysGrid>
          {Object.entries(state.hotkeyDefinitions).map(([id, definition]) => (
            <UserPreferencesModal.Hotkey
              key={id}
              label={t(definition.label)}
              value={definition.keys}
              onChange={newKeys => onHotkeyChangeHandler(id, newKeys)}
              placeholder={definition.keys}
              hotkeys={hotkeysModule}
            />
          ))}
        </UserPreferencesModal.HotkeysGrid>
      </UserPreferencesModal.Body>
      <FooterAction>
        <FooterAction.Left>
          <FooterAction.Auxiliary onClick={onResetHandler}>
            {t('Reset to defaults')}
          </FooterAction.Auxiliary>
        </FooterAction.Left>
        <FooterAction.Right>
          <FooterAction.Secondary
            onClick={() => {
              hotkeysModule.stopRecord();
              hotkeysModule.unpause();
              hide();
            }}
          >
            {t('Cancel')}
          </FooterAction.Secondary>
          <FooterAction.Primary onClick={onSaveHandler}>
            {t('Save')}
          </FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </UserPreferencesModal>
  );
}

export default SmartPreferencesModal;
