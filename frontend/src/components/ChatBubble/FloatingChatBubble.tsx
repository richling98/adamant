'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Send, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMeetingChat } from './useMeetingChat';
import { ChatModelPicker } from './ChatModelPicker';
import type { ModelConfig } from '@/services/configService';

// Example prompts shown in the empty state
const EXAMPLE_PROMPTS = [
  'Summarize my meetings from the past week',
  'What action items came up across my meetings?',
  'Who did I meet with most recently?',
];

const PROVIDER_LABELS: Record<ModelConfig['provider'], string> = {
  'builtin-ai': 'Built-in AI',
  ollama: 'Ollama',
  claude: 'Claude',
  openai: 'OpenAI',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  'custom-openai': 'Custom OpenAI',
  'nvidia-inference': 'NVIDIA',
};

const PROVIDERS_REQUIRING_KEY = new Set<ModelConfig['provider']>([
  'claude',
  'openai',
  'groq',
  'openrouter',
  'nvidia-inference',
]);

/**
 * FloatingChatBubble — a non-modal customer-service-style chat widget.
 *
 * The 😊 button toggles a compact floating panel that appears directly above
 * the button. Unlike a Sheet/dialog, this renders no overlay so the rest of
 * the app stays fully interactive while chatting.
 *
 * Inject once in layout.tsx inside RecordingPostProcessingProvider.
 */
export function FloatingChatBubble() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isLoading, modelConfig, setModelConfig, sendMessage, clearHistory } = useMeetingChat();

  const modelNeedsKey = modelConfig
    ? PROVIDERS_REQUIRING_KEY.has(modelConfig.provider) && !modelConfig.hasApiKey
    : false;

  const modelBadgeText = modelConfig
    ? `${PROVIDER_LABELS[modelConfig.provider] ?? modelConfig.provider} · ${modelConfig.model}`
    : 'No model selected';

  // Auto-scroll to the bottom whenever messages change or loading state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus the textarea when the panel opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    const handleOpenChat = () => setOpen(true);
    window.addEventListener('open-floating-chat', handleOpenChat);
    return () => window.removeEventListener('open-floating-chat', handleOpenChat);
  }, []);

  // Keep the chat header synced with changes made in Settings.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    listen<ModelConfig>('model-config-updated', event => {
      setModelConfig(event.payload);
    }).then(unlisten => {
      cleanup = unlisten;
    });

    return () => cleanup?.();
  }, [setModelConfig]);

  // Close on click outside the panel (but not on the trigger button itself,
  // which is handled by its own onClick toggle)
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    await sendMessage(text);
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleExampleClick = useCallback(
    async (prompt: string) => {
      if (isLoading) return;
      await sendMessage(prompt);
    },
    [isLoading, sendMessage],
  );

  return (
    <>
      {/* ── Floating chat panel (non-modal, no overlay) ──────────────────── */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Chat with your meetings"
          className="fixed bottom-6 right-6 z-[9998] flex h-[520px] w-96 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
          style={{
            animation: 'chatPopIn 0.18s ease-out',
          }}
        >
          {/* Pop-in animation keyframes (inlined so no globals.css edit needed) */}
          <style>{`
            @keyframes chatPopIn {
              from { opacity: 0; transform: scale(0.92) translateY(8px); transform-origin: bottom right; }
              to   { opacity: 1; transform: scale(1)    translateY(0);   transform-origin: bottom right; }
            }
          `}</style>

          {/* ── Header ────────────────────────────────────────────────────── */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-sm font-semibold text-white">
                Chat with your meetings
              </p>
              <p className="text-xs text-zinc-500">
                Ask anything about your notes
              </p>
              <button
                type="button"
                onClick={() => setShowModelPicker(prev => !prev)}
                className={`mt-2 max-w-full truncate rounded-full border px-2.5 py-1 text-left text-[11px] transition-colors ${
                  !modelConfig || modelNeedsKey
                    ? 'border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15'
                    : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15'
                }`}
                title={modelBadgeText}
              >
                {(!modelConfig || modelNeedsKey) ? '⚠️ ' : ''}{modelBadgeText}
              </button>
            </div>
            <div className="flex items-center gap-1">
              {/* Clear history */}
              <button
                onClick={clearHistory}
                disabled={messages.length === 0}
                aria-label="Clear chat history"
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300 disabled:pointer-events-none disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              {/* Close panel */}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {showModelPicker && (
            <ChatModelPicker
              modelConfig={modelConfig}
              onSaved={(config) => {
                setModelConfig(config);
                setShowModelPicker(false);
              }}
              onCancel={() => setShowModelPicker(false)}
            />
          )}

          {/* ── Message list ──────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              // Empty state
              <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
                <div className="text-4xl">🧙‍♂️</div>
                <div>
                  <p className="text-sm font-medium text-zinc-300">
                    Hi, I&apos;m Sam the Savant. Ask me anything about your meetings.
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    I have context from all of them.
                  </p>
                </div>
                {/* Example prompts */}
                <div className="flex w-full flex-col gap-2">
                  {EXAMPLE_PROMPTS.map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => handleExampleClick(prompt)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-zinc-200"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              // Message bubbles
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'rounded-br-sm bg-emerald-600 text-white'
                          : 'rounded-bl-sm bg-zinc-800 text-zinc-100'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        msg.content
                      ) : (
                        /* Render AI responses as rich markdown */
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            ul: ({ children }) => <ul className="my-1 list-disc pl-4 space-y-0.5">{children}</ul>,
                            ol: ({ children }) => <ol className="my-1 list-decimal pl-4 space-y-0.5">{children}</ol>,
                            li: ({ children }) => <li className="leading-snug">{children}</li>,
                            h1: ({ children }) => <h1 className="font-semibold text-white mt-2 mb-1">{children}</h1>,
                            h2: ({ children }) => <h2 className="font-semibold text-white mt-2 mb-1">{children}</h2>,
                            h3: ({ children }) => <h3 className="font-semibold text-white mt-2 mb-1">{children}</h3>,
                            code: ({ children }) => <code className="rounded bg-zinc-700 px-1 py-0.5 text-xs font-mono">{children}</code>,
                            pre: ({ children }) => <pre className="rounded bg-zinc-700 p-2 text-xs font-mono overflow-x-auto my-1.5">{children}</pre>,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      )}
                    </div>
                  </div>
                ))}

                {/* Loading indicator */}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-3">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                    </div>
                  </div>
                )}

                {/* Invisible anchor for auto-scroll */}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* ── Input area ────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 border-t border-white/10 p-3">
            <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-zinc-900 px-3 py-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder="Ask about your meetings…"
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none disabled:opacity-50"
                style={{ maxHeight: 120 }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
                className="flex-shrink-0 rounded-lg p-1.5 text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:pointer-events-none disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-zinc-600">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      )}

      {/* ── Floating trigger button — hidden while panel is open ────────── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Chat with your meetings"
          className="fixed bottom-6 right-6 z-[9999] flex items-center justify-center rounded-full text-2xl transition-all duration-200 hover:scale-110 active:scale-95 focus:outline-none"
          style={{
            width: 52,
            height: 52,
            background: 'linear-gradient(135deg, #1e1e26 0%, #2d2d3a 50%, #1e1e26 100%)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          🧙‍♂️
        </button>
      )}
    </>
  );
}
