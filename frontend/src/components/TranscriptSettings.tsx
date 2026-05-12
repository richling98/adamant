import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { toast } from 'sonner';


export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai' | 'nvidia-inference';
    model: string;
    apiKey?: string | null;
    hasApiKey?: boolean;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const [apiKey, setApiKey] = useState<string>('');
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [hasStoredApiKey, setHasStoredApiKey] = useState<boolean>(Boolean(transcriptModelConfig.hasApiKey));
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(Boolean(transcriptModelConfig.hasApiKey));
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [selectedWhisperModel, setSelectedWhisperModel] = useState<string>(transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : 'small');
    const [selectedParakeetModel, setSelectedParakeetModel] = useState<string>(transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : 'parakeet-tdt-0.6b-v2-int8');
    const nvidiaInferenceModels = [
        'nvidia/nvidia/parakeet-1-1b-rnnt-multilingual',
        'nvidia/nvidia/parakeet-1-1b-ctc-en-us',
    ];

    useEffect(() => {
        if (transcriptModelConfig.provider === 'localWhisper' || transcriptModelConfig.provider === 'parakeet') {
            setApiKey('');
            setHasStoredApiKey(true);
            setIsApiKeyLocked(false);
        }
    }, [transcriptModelConfig.provider]);

    const fetchApiKey = async (provider: string) => {
        try {
            const data = await invoke('api_has_transcript_key', { provider }) as boolean;
            setHasStoredApiKey(Boolean(data));
            setApiKey('');
            setIsApiKeyLocked(Boolean(data));
        } catch (err) {
            console.error('Error checking API key presence:', err);
            setHasStoredApiKey(false);
            setApiKey('');
            setIsApiKeyLocked(false);
        }
    };
    const modelOptions = {
        localWhisper: [selectedWhisperModel],
        parakeet: [selectedParakeetModel],
        deepgram: ['nova-2-phonecall'],
        elevenLabs: ['eleven_multilingual_v2'],
        groq: ['llama-3.3-70b-versatile'],
        openai: ['gpt-4o'],
        'nvidia-inference': nvidiaInferenceModels,
    };
    const requiresApiKey = transcriptModelConfig.provider === 'deepgram' || transcriptModelConfig.provider === 'elevenLabs' || transcriptModelConfig.provider === 'openai' || transcriptModelConfig.provider === 'groq' || transcriptModelConfig.provider === 'nvidia-inference';

    useEffect(() => {
        setHasStoredApiKey(Boolean(transcriptModelConfig.hasApiKey));
    }, [transcriptModelConfig.hasApiKey]);

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const saveTranscriptConfig = async (config: TranscriptModelProps, keyOverride?: string | null) => {
        try {
            await invoke('api_save_transcript_config', {
                provider: config.provider,
                model: config.model,
                apiKey: keyOverride ?? config.apiKey ?? null,
            });
        } catch (error) {
            console.error('Failed to save transcript config:', error);
            throw error;
        }
    };

    const handleRemoteConfigSave = async () => {
        const trimmedKey = apiKey.trim();
        if (requiresApiKey && !hasStoredApiKey && !trimmedKey) {
            toast.error('API key required', {
                description: 'Enter an API key before saving this transcription provider.',
            });
            return;
        }

        try {
            await saveTranscriptConfig(transcriptModelConfig, trimmedKey || null);
            setTranscriptModelConfig({
                ...transcriptModelConfig,
                apiKey: null,
                hasApiKey: hasStoredApiKey || Boolean(trimmedKey),
            });
            setApiKey('');
            setHasStoredApiKey(hasStoredApiKey || Boolean(trimmedKey));
            setIsApiKeyLocked(hasStoredApiKey || Boolean(trimmedKey));
            toast.success('Transcription model saved');
        } catch (error) {
            toast.error('Failed to save transcription model', {
                description: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        setSelectedWhisperModel(modelName);
        if (transcriptModelConfig.provider === 'localWhisper') {
            setTranscriptModelConfig({
                ...transcriptModelConfig,
                model: modelName
            });
            // Close modal after selection
            if (onModelSelect) {
                onModelSelect();
            }
        }
    };

    const handleParakeetModelSelect = (modelName: string) => {
        setSelectedParakeetModel(modelName);
        if (transcriptModelConfig.provider === 'parakeet') {
            setTranscriptModelConfig({
                ...transcriptModelConfig,
                model: modelName
            });
            // Close modal after selection
            if (onModelSelect) {
                onModelSelect();
            }
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="bg-white/5 rounded-lg border border-white/10 p-6">
                <h3 className="text-lg font-semibold mb-4 text-white">Transcription Model Configuration</h3>
                <p className="text-sm text-zinc-400 mb-6">
                    Configure the AI model used for live meeting transcription.
                </p>

                <div className="space-y-4">
                    <div>
                        <Label className="block text-sm font-medium text-zinc-300 mb-1">
                            Transcript Model
                        </Label>
                        <div className="flex space-x-2 mx-1">
                            <Select
                                value={transcriptModelConfig.provider}
                                onValueChange={(value) => {
                                    const provider = value as TranscriptModelProps['provider'];
                                    const newModel = provider === 'localWhisper' ? selectedWhisperModel : modelOptions[provider][0];
                                    const updatedConfig = {
                                        ...transcriptModelConfig,
                                        provider,
                                        model: newModel,
                                        apiKey: null,
                                        hasApiKey: provider === 'localWhisper' || provider === 'parakeet'
                                    };
                                    setTranscriptModelConfig(updatedConfig);
                                    if (provider !== 'localWhisper' && provider !== 'parakeet') {
                                        fetchApiKey(provider);
                                    } else if (provider === 'localWhisper' || provider === 'parakeet') {
                                        saveTranscriptConfig(updatedConfig).catch(() => undefined);
                                    }
                                }}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="parakeet">⚡ Parakeet (Recommended - Real-time / Accurate)</SelectItem>
                                    <SelectItem value="localWhisper">🏠 Local Whisper (High Accuracy)</SelectItem>
                                    <SelectItem value="nvidia-inference">NVIDIA inference</SelectItem>
                                    {/* <SelectItem value="deepgram">☁️ Deepgram (Backup)</SelectItem>
                                    <SelectItem value="elevenLabs">☁️ ElevenLabs</SelectItem>
                                    <SelectItem value="groq">☁️ Groq</SelectItem>
                                    <SelectItem value="openai">☁️ OpenAI</SelectItem> */}
                                </SelectContent>
                            </Select>

                            {transcriptModelConfig.provider !== 'localWhisper' && transcriptModelConfig.provider !== 'parakeet' && (
                                <Select
                                    value={transcriptModelConfig.model}
                                    onValueChange={(value) => {
                                        const model = value as TranscriptModelProps['model'];
                                        setTranscriptModelConfig({ ...transcriptModelConfig, model });
                                        saveTranscriptConfig({ ...transcriptModelConfig, model }).catch(() => undefined);
                                    }}
                                >
                                    <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                        <SelectValue placeholder="Select model" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {modelOptions[transcriptModelConfig.provider].map((model) => (
                                            <SelectItem key={model} value={model}>{model}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                        </div>
                    </div>

                    {transcriptModelConfig.provider === 'localWhisper' && (
                        <div className="mt-6">
                            <ModelManager
                                selectedModel={selectedWhisperModel}
                                onModelSelect={handleWhisperModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {transcriptModelConfig.provider === 'parakeet' && (
                        <div className="mt-6">
                            <ParakeetModelManager
                                selectedModel={selectedParakeetModel}
                                onModelSelect={handleParakeetModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}


                    {requiresApiKey && (
                        <div>
                            <Label className="block text-sm font-medium text-zinc-300 mb-1">
                                API Key
                            </Label>
                            <div className="relative mx-1">
                                <Input
                                    type={showApiKey ? "text" : "password"}
                                    className={`pr-24 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${isApiKeyLocked ? 'bg-white/5 cursor-not-allowed' : ''
                                        }`}
                                    value={isApiKeyLocked && hasStoredApiKey ? '••••••••••••' : apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    disabled={isApiKeyLocked}
                                    onClick={handleInputClick}
                                    placeholder={hasStoredApiKey ? "Stored securely. Enter a new key only to replace it." : "Enter your API key"}
                                />
                                {isApiKeyLocked && hasStoredApiKey && (
                                    <div
                                        onClick={handleInputClick}
                                        className="absolute inset-0 flex items-center justify-center bg-white/5 bg-opacity-50 rounded-md cursor-not-allowed"
                                    />
                                )}
                                <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            const nextLocked = !isApiKeyLocked;
                                            setIsApiKeyLocked(nextLocked);
                                            if (!nextLocked) {
                                                setApiKey('');
                                            }
                                        }}
                                        className={`transition-colors duration-200 ${isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''
                                            }`}
                                        title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
                                    >
                                        {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                    >
                                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                            <div className="flex justify-end mt-3 mx-1">
                                <Button type="button" size="sm" onClick={handleRemoteConfigSave}>
                                    Save
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}



