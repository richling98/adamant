"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Send, RefreshCw, Loader2, File, Sparkles, BookOpen, Brain } from "lucide-react";
import type { ModelConfig } from "@/services/configService";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  answer: string;
  cited_meeting_ids: string[];
}

interface WikiStatus {
  ready: number;
  stale: number;
  total: number;
}

const PROVIDERS: Array<{ value: ModelConfig["provider"]; label: string }> = [
  { value: "builtin-ai", label: "Built-in AI" },
  { value: "ollama", label: "Ollama" },
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "nvidia-inference", label: "NVIDIA" },
  { value: "custom-openai", label: "Custom OpenAI" },
];

const STATIC_MODELS: Partial<Record<ModelConfig["provider"], string[]>> = {
  claude: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001", "claude-opus-4-5-20251101"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-3.5-turbo"],
  groq: ["llama-3.3-70b-versatile"],
  "nvidia-inference": [
    "meta/llama-3.1-405b-instruct",
    "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-8b-instruct",
  ],
};

const DEFAULT_MODEL_BY_PROVIDER: Record<ModelConfig["provider"], string> = {
  "builtin-ai": "gemma3:1b",
  ollama: "llama3.2:latest",
  claude: "claude-sonnet-4-5-20250929",
  openai: "gpt-5-mini",
  groq: "llama-3.3-70b-versatile",
  openrouter: "openai/gpt-4o-mini",
  "nvidia-inference": "meta/llama-3.1-70b-instruct",
  "custom-openai": "",
};

export default function MemoryPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [wikiStatus, setWikiStatus] = useState<WikiStatus | null>(null);
  const [isRecompiling, setIsRecompiling] = useState(false);
  const [latestCitedIds, setLatestCitedIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<Partial<Record<ModelConfig["provider"], string[]>>>({});
  const [showModelPicker, setShowModelPicker] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await invoke<WikiStatus>("api_get_wiki_status");
      setWikiStatus(status);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusMessage]);

  // Load model config on mount
  useEffect(() => {
    (async () => {
      try {
        const config = await invoke<ModelConfig>("api_get_model_config");
        setModelConfig(config);
      } catch { /* ignore */ }
    })();
  }, []);

  // Listen for chat-status events from the Rust backend
  useEffect(() => {
    const unlisten = listen<string>("chat-status", (event) => {
      setStatusMessage(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Dismiss model picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".model-picker-dropdown") && !target.closest(".model-picker-trigger")) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelPicker]);

  // Load dynamic models when provider changes
  const loadModels = useCallback(async (provider: ModelConfig["provider"]) => {
    if (STATIC_MODELS[provider] || provider === "custom-openai") return;
    try {
      if (provider === "ollama") {
        const data = await invoke<Array<{ name: string }>>("get_ollama_models", { endpoint: null }) as Array<{ name: string }>;
        setModelsByProvider(prev => ({ ...prev, ollama: data.map(item => item.name) }));
      } else if (provider === "builtin-ai") {
        const data = await invoke<Array<{ name: string }>>("builtin_ai_list_models");
        setModelsByProvider(prev => ({ ...prev, "builtin-ai": data.map(item => item.name) }));
      } else if (provider === "openrouter") {
        const data = await invoke<Array<{ id: string }>>("get_openrouter_models");
        setModelsByProvider(prev => ({ ...prev, openrouter: data.map(item => item.id) }));
      }
    } catch (err) {
      console.error("Failed to load models:", err);
    }
  }, []);

  // Load models when picker opens for the current provider
  useEffect(() => {
    if (showModelPicker && modelConfig) {
      loadModels(modelConfig.provider);
    }
  }, [showModelPicker, modelConfig, loadModels]);

  const modelOptions = useMemo(() => {
    if (!modelConfig) return [];
    return modelsByProvider[modelConfig.provider] ?? STATIC_MODELS[modelConfig.provider] ?? [];
  }, [modelsByProvider, modelConfig]);

  const handleProviderChange = async (provider: ModelConfig["provider"]) => {
    const newModel = DEFAULT_MODEL_BY_PROVIDER[provider];
    setModelConfig(prev => prev ? { ...prev, provider, model: newModel } : null);
    await loadModels(provider);
    if (provider !== "custom-openai") {
      try {
        await invoke("api_save_model_config", { provider, model: newModel, whisperModel: modelConfig?.whisperModel ?? "large-v3", apiKey: null, ollamaEndpoint: modelConfig?.ollamaEndpoint ?? null });
      } catch (err) {
        console.error("Failed to save model config:", err);
      }
    }
  };

  const handleModelChange = async (model: string) => {
    if (!modelConfig) return;
    setModelConfig(prev => prev ? { ...prev, model } : null);
    try {
      await invoke("api_save_model_config", { provider: modelConfig.provider, model, whisperModel: modelConfig.whisperModel ?? "large-v3", apiKey: null, ollamaEndpoint: modelConfig.ollamaEndpoint ?? null });
    } catch (err) {
      console.error("Failed to save model config:", err);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setStatusMessage(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const response = await invoke<ChatResponse>("api_chat_with_meetings_v2", {
        message: text,
        history: messages,
        dateRangeDays: null,
      });

      setMessages(prev => [...prev, { role: "assistant", content: response.answer }]);
      setLatestCitedIds(response.cited_meeting_ids);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${errorText}` }]);
      setLatestCitedIds([]);
    } finally {
      setIsLoading(false);
      setStatusMessage(null);
    }
  };

  const handleRecompileAll = async () => {
    setIsRecompiling(true);
    try {
      const result = await invoke<string>("api_recompile_wiki_all");
      await refreshStatus();
      setMessages(prev => [...prev, { role: "assistant", content: `✅ ${result}` }]);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${errorText}` }]);
    } finally {
      setIsRecompiling(false);
    }
  };

  return (
    <div className="h-screen bg-background flex">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full p-6 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">Savant</h1>
              <p className="text-sm text-foreground/50">Your second brain for your meeting notes.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Model picker */}
            <div className="relative">
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="model-picker-trigger flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground bg-white/5 hover:bg-white/10 rounded-lg px-3 py-1.5 border border-white/10 transition-colors"
              >
                <Brain className="w-3.5 h-3.5" />
                <span className="max-w-[120px] truncate">{modelConfig?.model ?? "Select model"}</span>
              </button>

              {showModelPicker && (
                <div className="model-picker-dropdown absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-white/10 bg-zinc-950 shadow-2xl p-3 space-y-2">
                  <select
                    value={modelConfig?.provider ?? "builtin-ai"}
                    onChange={(e) => handleProviderChange(e.target.value as ModelConfig["provider"])}
                    className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500/60"
                  >
                    {PROVIDERS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  {modelConfig?.provider === "custom-openai" || modelOptions.length === 0 ? (
                    <input
                      value={modelConfig?.model ?? ""}
                      onChange={(e) => handleModelChange(e.target.value)}
                      placeholder="Enter model name"
                      className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/60"
                    />
                  ) : (
                    <select
                      value={modelConfig?.model ?? ""}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500/60"
                    >
                      {modelOptions.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* Wiki Status + Recompile */}
            {wikiStatus && (
              <div className="flex items-center gap-2 text-xs text-foreground/50 bg-white/5 rounded-lg px-3 py-1.5 border border-white/10">
                <BookOpen className="w-3.5 h-3.5" />
                <span>{wikiStatus.ready} ready</span>
                {wikiStatus.stale > 0 && (
                  <span className="text-amber-400">{wikiStatus.stale} stale</span>
                )}
                <span>{wikiStatus.total} total</span>
              </div>
            )}
            <button
              onClick={handleRecompileAll}
              disabled={isRecompiling}
              className="flex items-center gap-1.5 text-xs text-foreground/60 hover:text-foreground bg-white/5 hover:bg-white/10 rounded-lg px-3 py-1.5 border border-white/10 transition-colors disabled:opacity-50"
            >
              {isRecompiling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Re-compile
            </button>
          </div>
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2 mb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-foreground/40">
              <Sparkles className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">Ask about your meetings</p>
              <p className="text-sm mt-1">Try: "What did we decide in the last planning session?"</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i}>
              <div
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary/20 text-primary-foreground border border-primary/20"
                      : "bg-white/5 text-foreground border border-white/10"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
              {/* Citation cards */}
              {msg.role === "assistant" && i === messages.length - 1 && latestCitedIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 ml-2">
                  {latestCitedIds.map((id) => (
                    <div
                      key={id}
                      className="flex items-center gap-1.5 text-xs text-primary/80 bg-primary/10 rounded-lg px-2.5 py-1.5 border border-primary/20"
                    >
                      <File className="w-3 h-3" />
                      <span className="max-w-[200px] truncate">{id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-foreground/50" />
                {statusMessage && (
                  <span className="text-xs text-foreground/50">{statusMessage}</span>
                )}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask about your meetings..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-primary/40 transition-colors"
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="bg-primary/20 hover:bg-primary/30 border border-primary/30 rounded-xl px-4 py-3 text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
