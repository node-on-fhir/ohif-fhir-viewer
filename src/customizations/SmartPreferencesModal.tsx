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

function AutogenChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="smart-autogen-chip"
    >
      Autogenerate
    </button>
  );
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

  // Initialize SMART fields from current config + localStorage overrides
  const fhirConfig = getFhirConfig();
  const savedSmart = loadSmartConfig();

  const [state, setState] = useState({
    hotkeyDefinitions: initialHotkeyDefinitions,
    languageValue: currentLanguage.value,
    smartClientId: savedSmart.smartClientId || fhirConfig.smartClientId || '',
    smartClientName: savedSmart.smartClientName || 'OHIF Viewer',
    smartScope: savedSmart.smartScope || fhirConfig.smartScope || 'launch openid fhirUser patient/*.read',
    fhirBaseUrl: savedSmart.fhirBaseUrl || '',
  });

  const [regStatus, setRegStatus] = useState<'idle' | 'registering' | 'success' | 'error'>('idle');
  const [regError, setRegError] = useState('');

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

  const onRegisterHandler = async () => {
    setRegStatus('registering');
    setRegError('');

    try {
      const result = await registerSmartClient({
        fhirServerRoot: fhirServerRootForReg,
        clientName: state.smartClientName,
        redirectUris: [redirectUri],
        scope: state.smartScope,
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
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
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
              <Label htmlFor="smart-client-id" className="text-sm">
                Client ID
              </Label>
              <div className="smart-autogen-wrap">
                <Input
                  id="smart-client-id"
                  value={state.smartClientId}
                  onChange={e => setState(s => ({ ...s, smartClientId: e.target.value }))}
                  placeholder="e.g. kvGGaJjJyBjKRiNXw"
                  className="smart-autogen-input"
                />
                <AutogenChip
                  onClick={() => setState(s => ({ ...s, smartClientId: crypto.randomUUID() }))}
                />
              </div>
              {!state.smartClientId && (
                <p className="text-muted-foreground text-xs">
                  No client ID configured. Use Register to obtain one.
                </p>
              )}
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
              <Label htmlFor="smart-fhir-url" className="text-sm">
                FHIR Server URL
              </Label>
              <div className="smart-autogen-wrap">
                <Input
                  id="smart-fhir-url"
                  value={state.fhirBaseUrl}
                  onChange={e => setState(s => ({ ...s, fhirBaseUrl: e.target.value }))}
                  placeholder={DEFAULT_FHIR_BASE_URL}
                  className="smart-autogen-input"
                />
                <AutogenChip
                  onClick={() => setState(s => ({ ...s, fhirBaseUrl: DEFAULT_FHIR_BASE_URL }))}
                />
              </div>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                disabled={regStatus === 'registering' || !state.smartClientName.trim() || !registrationUrl}
                onClick={onRegisterHandler}
              >
                {regStatus === 'registering' ? 'Registering...' : 'Register'}
              </Button>
            </div>
          </div>
          {registrationUrl && (
            <p className="text-muted-foreground mt-2 text-xs">
              Registration endpoint: {registrationUrl}
            </p>
          )}
          {!state.fhirBaseUrl && (
            <p className="text-muted-foreground mt-2 text-xs">
              Enter a FHIR Server URL to enable registration.
            </p>
          )}
          {regStatus === 'success' && (
            <p className="mt-2 text-xs text-green-400">
              Registration successful — Client ID has been filled in.
            </p>
          )}
          {regStatus === 'error' && (
            <p className="mt-2 text-xs text-red-400">
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
