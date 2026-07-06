import { useState, useCallback, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ModelConfig } from '@/services/configService';

// Mirrors the Rust `ChatMessage` struct
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface UseMeetingChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  modelConfig: ModelConfig | null;
  setModelConfig: Dispatch<SetStateAction<ModelConfig | null>>;
  refreshModelConfig: () => Promise<ModelConfig | null>;
  sendMessage: (text: string, dateRangeDays?: number) => Promise<void>;
  clearHistory: () => void;
}

const PROVIDERS_REQUIRING_API_KEY = new Set([
  'claude',
  'groq',
  'openai',
  'openrouter',
  'nvidia-inference',
]);

/**
 * Hook that manages the chat-with-meetings session state and communicates with
 * the Rust `api_chat_with_meetings` Tauri command.
 *
 * History is kept in-memory only; it resets when the app restarts but persists
 * for the lifetime of the session.
 */
export function useMeetingChat(): UseMeetingChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);

  const refreshModelConfig = useCallback(async () => {
    try {
      const config = await invoke<ModelConfig | null>('api_get_model_config');
      setModelConfig(config);
      return config;
    } catch (err) {
      console.error('Failed to load chatbot model config:', err);
      setModelConfig(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshModelConfig();
  }, [refreshModelConfig]);

  const sendMessage = useCallback(
    async (text: string, dateRangeDays?: number) => {
      if (!text.trim() || isLoading) return;

      // Append user turn immediately so the UI feels responsive
      const userMessage: ChatMessage = { role: 'user', content: text.trim() };
      setMessages(prev => [...prev, userMessage]);

      const currentConfig = modelConfig ?? await refreshModelConfig();
      if (!currentConfig) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: '⚠️ No model selected. Pick an AI model in the chat header or Settings to continue.',
          },
        ]);
        return;
      }

      if (
        PROVIDERS_REQUIRING_API_KEY.has(currentConfig.provider) &&
        !currentConfig.hasApiKey
      ) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `⚠️ ${currentConfig.provider} requires an API key. Add one in Settings before using this model for chat.`,
          },
        ]);
        return;
      }

      setIsLoading(true);

      try {
        // Pass the full history (before appending the new user message)
        // so the backend can reconstruct multi-turn context.
        const response = await invoke<string>('api_chat_with_meetings', {
          message: text.trim(),
          history: messages, // messages before the current user turn
          dateRangeDays: dateRangeDays ?? null,
        });

        const assistantResponse = response.trim();
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: assistantResponse || '⚠️ The LLM returned an empty response.',
          },
        ]);
      } catch (err) {
        const errorText =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
            ? err
            : 'Something went wrong. Please try again.';

        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `⚠️ ${errorText}`,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, modelConfig, refreshModelConfig],
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isLoading, modelConfig, setModelConfig, refreshModelConfig, sendMessage, clearHistory };
}
