import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Mirrors the Rust `ChatMessage` struct
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface UseMeetingChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (text: string, dateRangeDays?: number) => Promise<void>;
  clearHistory: () => void;
}

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

  const sendMessage = useCallback(
    async (text: string, dateRangeDays?: number) => {
      if (!text.trim() || isLoading) return;

      // Append user turn immediately so the UI feels responsive
      const userMessage: ChatMessage = { role: 'user', content: text.trim() };
      setMessages(prev => [...prev, userMessage]);
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
    [messages, isLoading],
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isLoading, sendMessage, clearHistory };
}
