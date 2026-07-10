'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { ModelConfig } from '@/services/configService';

type Provider = ModelConfig['provider'];

interface ChatModelPickerProps {
  modelConfig: ModelConfig | null;
  onSaved: (config: ModelConfig) => void;
  onCancel: () => void;
}

const PROVIDERS: Array<{ value: Provider; label: string }> = [
  { value: 'builtin-ai', label: 'Built-in AI' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'claude', label: 'Claude' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'groq', label: 'Groq' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'nvidia-inference', label: 'NVIDIA inference (NVIDIA employees only)' },
  { value: 'custom-openai', label: 'Custom OpenAI' },
];

const STATIC_MODELS: Partial<Record<Provider, string[]>> = {
  claude: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  groq: ['llama-3.3-70b-versatile'],
  'nvidia-inference': [
    'meta/llama-3.1-405b-instruct',
    'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct',
  ],
};

const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  'builtin-ai': 'gemma3:1b',
  ollama: 'llama3.2:latest',
  claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-5-mini',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'openai/gpt-4o-mini',
  'nvidia-inference': 'meta/llama-3.1-70b-instruct',
  'custom-openai': '',
};

const PROVIDERS_REQUIRING_KEY = new Set<Provider>([
  'claude',
  'openai',
  'groq',
  'openrouter',
  'nvidia-inference',
]);

function providerLabel(provider: Provider) {
  return PROVIDERS.find(p => p.value === provider)?.label ?? provider;
}

export function ChatModelPicker({ modelConfig, onSaved, onCancel }: ChatModelPickerProps) {
  const [provider, setProvider] = useState<Provider>(modelConfig?.provider ?? 'builtin-ai');
  const [model, setModel] = useState(modelConfig?.model ?? 'gemma3:1b');
  const [modelsByProvider, setModelsByProvider] = useState<Partial<Record<Provider, string[]>>>({});
  const [hasApiKey, setHasApiKey] = useState(modelConfig?.hasApiKey ?? provider === 'builtin-ai');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!modelConfig) return;
    setProvider(modelConfig.provider);
    setModel(modelConfig.model);
    setHasApiKey(modelConfig.hasApiKey ?? modelConfig.provider === 'builtin-ai');
  }, [modelConfig]);

  const modelOptions = useMemo(() => {
    return modelsByProvider[provider] ?? STATIC_MODELS[provider] ?? [];
  }, [modelsByProvider, provider]);

  const loadModels = useCallback(async (nextProvider: Provider) => {
    setError(null);

    if (STATIC_MODELS[nextProvider] || nextProvider === 'custom-openai') {
      return;
    }

    setIsLoadingModels(true);
    try {
      if (nextProvider === 'ollama') {
        const endpoint = modelConfig?.ollamaEndpoint ?? null;
        const data = (await invoke('get_ollama_models', { endpoint })) as Array<{ name: string }>;
        setModelsByProvider(prev => ({ ...prev, ollama: data.map(item => item.name) }));
      } else if (nextProvider === 'builtin-ai') {
        const data = (await invoke('builtin_ai_list_models')) as Array<{ name: string }>;
        setModelsByProvider(prev => ({ ...prev, 'builtin-ai': data.map(item => item.name) }));
      } else if (nextProvider === 'openrouter') {
        const data = (await invoke('get_openrouter_models')) as Array<{ id: string }>;
        setModelsByProvider(prev => ({ ...prev, openrouter: data.map(item => item.id) }));
      }
    } catch (err) {
      console.error('Failed to load models for chat picker:', err);
      setError(`Could not load ${providerLabel(nextProvider)} models.`);
    } finally {
      setIsLoadingModels(false);
    }
  }, [modelConfig?.ollamaEndpoint]);

  useEffect(() => {
    loadModels(provider);
  }, [loadModels, provider]);

  useEffect(() => {
    if (provider === 'custom-openai') return;
    if (modelOptions.length > 0 && !modelOptions.includes(model)) {
      setModel(modelOptions[0]);
    }
  }, [model, modelOptions, provider]);

  const handleProviderChange = async (nextProvider: Provider) => {
    setProvider(nextProvider);
    setModel(DEFAULT_MODEL_BY_PROVIDER[nextProvider]);
    setHasApiKey(nextProvider === 'builtin-ai' || nextProvider === 'ollama');

    if (PROVIDERS_REQUIRING_KEY.has(nextProvider)) {
      try {
        setHasApiKey(await invoke<boolean>('api_has_key', { provider: nextProvider }));
      } catch (err) {
        console.error('Failed to check provider API key:', err);
        setHasApiKey(false);
      }
    }
  };

  const handleSave = async () => {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      setError('Choose or enter a model before saving.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const savedConfig: ModelConfig = {
        provider,
        model: trimmedModel,
        whisperModel: modelConfig?.whisperModel ?? 'large-v3',
        apiKey: null,
        hasApiKey,
        ollamaEndpoint: modelConfig?.ollamaEndpoint ?? null,
      };

      await invoke('api_save_model_config', {
        provider: savedConfig.provider,
        model: savedConfig.model,
        whisperModel: savedConfig.whisperModel,
        apiKey: null,
        ollamaEndpoint: savedConfig.ollamaEndpoint,
      });

      await emit('model-config-updated', savedConfig);
      onSaved(savedConfig);
    } catch (err) {
      console.error('Failed to save chat model config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save model.');
    } finally {
      setIsSaving(false);
    }
  };

  const requiresMissingKey = PROVIDERS_REQUIRING_KEY.has(provider) && !hasApiKey;

  return (
    <div className="border-b border-white/10 bg-zinc-900/80 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300">AI model for chat and cleanup</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <select
          value={provider}
          onChange={event => handleProviderChange(event.target.value as Provider)}
          className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500/60"
        >
          {PROVIDERS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        {provider === 'custom-openai' || modelOptions.length === 0 ? (
          <input
            value={model}
            onChange={event => setModel(event.target.value)}
            placeholder={isLoadingModels ? 'Loading models...' : 'Enter model name'}
            disabled={isLoadingModels}
            className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/60 disabled:opacity-50"
          />
        ) : (
          <select
            value={model}
            onChange={event => setModel(event.target.value)}
            disabled={isLoadingModels}
            className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500/60 disabled:opacity-50"
          >
            {modelOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        )}
      </div>

      {requiresMissingKey && (
        <p className="mt-2 text-[11px] text-amber-300">
          {providerLabel(provider)} requires an API key. Add it in Settings before chatting with this provider.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isLoadingModels || !model.trim()}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
