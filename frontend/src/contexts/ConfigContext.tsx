'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode, useRef } from 'react';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import { SelectedDevices } from '@/components/DeviceSelection';
import { configService, ModelConfig } from '@/services/configService';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_THEME, isThemeName, THEME_STORAGE_KEY, type ThemeName } from '@/lib/theme';

export interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

export interface StorageLocations {
  database: string;
  models: string;
  recordings: string;
}

export interface NotificationSettings {
  recording_notifications: boolean;
  time_based_reminders: boolean;
  meeting_reminders: boolean;
  respect_do_not_disturb: boolean;
  notification_sound: boolean;
  system_permission_granted: boolean;
  consent_given: boolean;
  manual_dnd_mode: boolean;
  notification_preferences: {
    show_recording_started: boolean;
    show_recording_stopped: boolean;
    show_recording_paused: boolean;
    show_recording_resumed: boolean;
    show_transcription_complete: boolean;
    show_meeting_reminders: boolean;
    show_system_errors: boolean;
    meeting_reminder_minutes: number[];
  };
}

interface ConfigContextType {
  // Model configuration
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;

  // Transcript model configuration
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps | ((prev: TranscriptModelProps) => TranscriptModelProps)) => void;

  // Device configuration
  selectedDevices: SelectedDevices;
  setSelectedDevices: (devices: SelectedDevices) => void;

  // Language preference
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;

  // UI preferences
  showConfidenceIndicator: boolean;
  toggleConfidenceIndicator: (checked: boolean) => void;
  uiTheme: ThemeName;
  setUiTheme: (theme: ThemeName) => void;

  // Ollama models
  models: OllamaModel[];
  modelOptions: Record<ModelConfig['provider'], string[]>;
  error: string;

  // Summary configuration
  isAutoSummary: boolean;
  toggleIsAutoSummary: (checked: boolean) => void;

  // Preference settings (lazy loaded)
  notificationSettings: NotificationSettings | null;
  storageLocations: StorageLocations | null;
  isLoadingPreferences: boolean;
  loadPreferences: () => Promise<void>;
  updateNotificationSettings: (settings: NotificationSettings) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);


export function ConfigProvider({ children }: { children: ReactNode }) {
  // Model configuration state
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: 'llama3.2:latest',
    whisperModel: 'large-v3',
    hasApiKey: false,
  });

  // Transcript model configuration state
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
    apiKey: null,
    hasApiKey: true,
  });

  // Ollama models list and error state
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>('');

  // Device configuration state
  const [selectedDevices, setSelectedDevices] = useState<SelectedDevices>({
    micDevice: null,
    systemDevice: null
  });

  // Language preference state
  const [selectedLanguage, setSelectedLanguage] = useState('auto-translate');

  // UI preferences state
  const [showConfidenceIndicator, setShowConfidenceIndicator] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('showConfidenceIndicator');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  const [uiTheme, setUiThemeState] = useState<ThemeName>(() => {
    if (typeof window !== 'undefined') {
      // localStorage is the synchronous fast-path; the async Tauri Store
      // load happens in the effect below and will correct the value if needed.
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeName(saved)) {
        return saved;
      }
    }
    return DEFAULT_THEME;
  });

  // Load persisted theme from Tauri Store on mount — this survives full app
  // restarts even when the webview localStorage partition is reset.
  // Runs once; re-reads localStorage inside the callback to avoid clobbering
  // a theme change that happened between mount and the async Store load.
  useEffect(() => {
    const loadStoredTheme = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const stored = await store.get<string>(THEME_STORAGE_KEY);
        if (!isThemeName(stored)) return;
        // Only override if current localStorage value differs from Store —
        // this way a user change that happened before Store resolved wins.
        try {
          const current = localStorage.getItem(THEME_STORAGE_KEY);
          if (current === stored) return;
        } catch {}
        setUiThemeState(stored);
        try { localStorage.setItem(THEME_STORAGE_KEY, stored); } catch {}
      } catch {
        // Store may not be available (e.g. web-only dev without Tauri)
      }
    };
    loadStoredTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Summary configs
  const [isAutoSummary, setisAutoSummary] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('isAutoSummary');
      return saved !== null ? saved === 'true' : false
    }
    return false;
  });

  // Preference settings state (lazy loaded)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [storageLocations, setStorageLocations] = useState<StorageLocations | null>(null);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const preferencesLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);

  // Format size helper function for Ollama models
  const formatSize = (size: number): string => {
    if (size < 1024) {
      return `${size} B`;
    } else if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    } else if (size < 1024 * 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
  };

  // Load Ollama models on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await fetch('http://localhost:11434/api/tags', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const modelList = data.models.map((model: any) => ({
          name: model.name,
          id: model.model,
          size: formatSize(model.size),
          modified: model.modified_at
        }));
        setModels(modelList);
      } catch (err) {
        // Silently handle Ollama connection errors - it's an optional service
        // If Ollama isn't running, the app still works for notes/transcription
        console.warn('Ollama not available (this is OK if you\'re using a different LLM provider):', err);
        setModels([]); // Clear models list
      }
    };

    loadModels();
  }, []);

  // Auto-select first Ollama model when models load
  useEffect(() => {
    if (models.length > 0 && modelConfig.provider === 'ollama') {
      setModelConfig(prev => ({
        ...prev,
        model: models[0].name
      }));
    }
  }, [models, modelConfig.provider]);

  // Load transcript configuration on mount
  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await configService.getTranscriptConfig();
        if (config) {
          console.debug(
            '[ConfigContext] Loaded saved transcript config: provider=%s model=%s hasKey=%s',
            config.provider,
            config.model,
            Boolean(config.hasApiKey)
          );
          setTranscriptModelConfig({
            provider: config.provider || 'parakeet',
            model: config.model || 'parakeet-tdt-0.6b-v3-int8',
            apiKey: null,
            hasApiKey: Boolean(config.hasApiKey)
          });
        }
      } catch (error) {
        console.error('[ConfigContext] Failed to load transcript config:', error);
      }
    };
    loadTranscriptConfig();
  }, []);

  // Load model configuration on mount
  useEffect(() => {
    const fetchModelConfig = async () => {
      try {
        const data = await configService.getModelConfig();
        if (data && data.provider) {
          // If provider is custom-openai, fetch the additional config
          if (data.provider === 'custom-openai') {
            try {
              const customConfig = await configService.getCustomOpenAIConfig();
              if (customConfig) {
                // Merge custom config fields into modelConfig
                console.debug(
                  '[ConfigContext] Loading custom OpenAI config: endpoint=%s model=%s hasKey=%s',
                  customConfig.endpoint,
                  customConfig.model,
                  Boolean(customConfig.hasApiKey)
                );
                setModelConfig(prev => ({
                  ...prev,
                  provider: data.provider,
                  model: customConfig.model || data.model || prev.model,
                  whisperModel: data.whisperModel || prev.whisperModel,
                  hasApiKey: Boolean(customConfig.hasApiKey),
                  customOpenAIEndpoint: customConfig.endpoint,
                  customOpenAIModel: customConfig.model,
                  customOpenAIApiKey: null,
                  maxTokens: customConfig.maxTokens,
                  temperature: customConfig.temperature,
                  topP: customConfig.topP,
                }));
                return; // Early return
              }
            } catch (err) {
              console.error('[ConfigContext] Failed to fetch custom OpenAI config:', err);
            }
          }

          // For non-custom-openai providers, just set base config
          setModelConfig(prev => ({
            ...prev,
            provider: data.provider,
            model: data.model || prev.model,
            whisperModel: data.whisperModel || prev.whisperModel,
            hasApiKey: Boolean(data.hasApiKey),
          }));
        }
      } catch (error) {
        console.error('Failed to fetch saved model config in ConfigContext:', error);
      }
    };
    fetchModelConfig();
  }, []);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.debug('[ConfigContext] Received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);

  // Load device preferences on mount
  useEffect(() => {
    const loadDevicePreferences = async () => {
      try {
        const prefs = await configService.getRecordingPreferences();
        if (prefs && (prefs.preferred_mic_device || prefs.preferred_system_device)) {
          setSelectedDevices({
            micDevice: prefs.preferred_mic_device,
            systemDevice: prefs.preferred_system_device
          });
          console.debug('Loaded device preferences:', prefs);
        }
      } catch (error) {
        console.debug('No device preferences found or failed to load:', error);
      }
    };
    loadDevicePreferences();
  }, []);

  // Load language preference on mount
  useEffect(() => {
    const loadLanguagePreference = async () => {
      try {
        const language = await configService.getLanguagePreference();
        if (language) {
          setSelectedLanguage(language);
          console.debug('Loaded language preference:', language);
        }
      } catch (error) {
        console.debug('No language preference found or failed to load, using default (auto-translate):', error);
        // Default to 'auto-translate' (Auto Detect with English translation) if no preference is saved
        setSelectedLanguage('auto-translate');
      }
    };
    loadLanguagePreference();
  }, []);

  // Calculate model options based on available models
  const modelOptions: Record<ModelConfig['provider'], string[]> = {
    ollama: models.map(model => model.name),
    claude: ['claude-3-5-sonnet-latest'],
    groq: ['llama-3.3-70b-versatile'],
    openrouter: [],
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    'builtin-ai': [],
    'custom-openai': [],
    'nvidia-inference': [
      'nvidia/nvidia/nemotron-3-super-v3',
      'openai/openai/gpt-5.5',
      'aws/anthropic/bedrock-claude-sonnet-4-6',
      'openai/openai/gpt-5-mini',
      'nvidia/openai/gpt-oss-120b',
      'us/azure/openai/gpt-4.1',
      'nvidia/openai/gpt-oss-20b',
      'us/azure/openai/gpt-5',
    ],
  };

  // Toggle confidence indicator with localStorage persistence
  const toggleConfidenceIndicator = useCallback((checked: boolean) => {
    setShowConfidenceIndicator(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem('showConfidenceIndicator', checked.toString());
    }
    // Trigger a custom event to notify other components
    window.dispatchEvent(new CustomEvent('confidenceIndicatorChanged', { detail: checked }));
  }, []);

  // Keep localStorage in sync immediately for instant UI response and
  // as a synchronous fast-path on next launch; Tauri Store is the durable
  // cross-restart persistence.
  const setUiTheme = useCallback((theme: ThemeName) => {
    setUiThemeState(theme);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
      // Fire-and-forget: persist to Tauri Store so it survives full app restarts
      import('@tauri-apps/plugin-store').then(async ({ Store }) => {
        try {
          const store = await Store.load('preferences.json');
          await store.set(THEME_STORAGE_KEY, theme);
          await store.save();
        } catch {}
      });
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.dataset.theme = uiTheme;
    document.documentElement.dataset.theme = uiTheme;
  }, [uiTheme]);

  const toggleIsAutoSummary = useCallback((checked: boolean) => {
    setisAutoSummary(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem('isAutoSummary', checked.toString());
    }
  }, [])

  // Lazy load preference settings (only loads if not already cached)
  const loadPreferences = useCallback(async () => {
    // If already loaded, don't reload
    if (preferencesLoadedRef.current) {
      return;
    }

    // If currently loading, don't start another load
    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;
    setIsLoadingPreferences(true);
    try {
      // Load notification settings from backend
      let settings: NotificationSettings | null = null;
      try {
        settings = await invoke<NotificationSettings>('get_notification_settings');
        setNotificationSettings(settings);
      } catch (notifError) {
        console.error('[ConfigContext] Failed to load notification settings:', notifError);
        // Use default values if notification settings fail to load
        setNotificationSettings(null);
      }

      // Load storage locations
      const [dbDir, modelsDir, recordingsDir] = await Promise.all([
        invoke<string>('get_database_directory'),
        invoke<string>('whisper_get_models_directory'),
        invoke<string>('get_default_recordings_folder_path')
      ]);

      setStorageLocations({
        database: dbDir,
        models: modelsDir,
        recordings: recordingsDir
      });

      // Mark as loaded
      preferencesLoadedRef.current = true;
    } catch (error) {
      console.error('[ConfigContext] Failed to load preferences:', error);
    } finally {
      isLoadingRef.current = false;
      setIsLoadingPreferences(false);
    }
  }, []);

  // Update notification settings
  const updateNotificationSettings = useCallback(async (settings: NotificationSettings) => {
    try {
      await invoke('set_notification_settings', { settings });
      setNotificationSettings(settings);
    } catch (error) {
      console.error('[ConfigContext] Failed to update notification settings:', error);
      throw error; // Re-throw so component can handle error
    }
  }, []);

  const value: ConfigContextType = useMemo(() => ({
    modelConfig,
    setModelConfig,
    isAutoSummary,
    toggleIsAutoSummary,
    transcriptModelConfig,
    setTranscriptModelConfig,
    selectedDevices,
    setSelectedDevices,
    selectedLanguage,
    setSelectedLanguage,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
    uiTheme,
    setUiTheme,
    models,
    modelOptions,
    error,
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  }), [
    modelConfig,
    isAutoSummary,
    toggleIsAutoSummary,
    transcriptModelConfig,
    selectedDevices,
    selectedLanguage,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
    uiTheme,
    setUiTheme,
    models,
    modelOptions,
    error,
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  ]);

  return (
    <ConfigContext.Provider value={value}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
