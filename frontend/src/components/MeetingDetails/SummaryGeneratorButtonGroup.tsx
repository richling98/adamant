"use client";

import { ModelConfig } from '@/components/ModelSettingsModal';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Sparkles, Loader2, Square } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useState } from 'react';
import { isOllamaNotInstalledError } from '@/lib/utils';
import { BuiltInModelInfo } from '@/lib/builtin-ai';

interface SummaryGeneratorButtonGroupProps {
  modelConfig: ModelConfig;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  hasTranscripts?: boolean;
}

export function SummaryGeneratorButtonGroup({
  modelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryStatus,
  hasTranscripts = true,
}: SummaryGeneratorButtonGroupProps) {
  const [isCheckingModels, setIsCheckingModels] = useState(false);

  if (!hasTranscripts) {
    return null;
  }

  const checkBuiltInAIModelsAndGenerate = async () => {
    setIsCheckingModels(true);
    try {
      const selectedModel = modelConfig.model;

      if (!selectedModel) {
        toast.error('No built-in AI model selected', {
          description: 'Please select a model in settings',
          duration: 5000,
        });
        return;
      }

      const isReady = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: selectedModel,
        refresh: true,
      });

      if (isReady) {
        onGenerateSummary(customPrompt);
        return;
      }

      const modelInfo = await invoke<BuiltInModelInfo | null>('builtin_ai_get_model_info', {
        modelName: selectedModel,
      });

      if (!modelInfo) {
        toast.error('Model not found', {
          description: `Could not find information for model: ${selectedModel}`,
          duration: 5000,
        });
        return;
      }

      const status = modelInfo.status;

      if (status.type === 'downloading') {
        toast.info('Model download in progress', {
          description: `${selectedModel} is downloading (${status.progress}%). Please wait until download completes.`,
          duration: 5000,
        });
        return;
      }

      if (status.type === 'not_downloaded') {
        toast.error('Model not downloaded', {
          description: `${selectedModel} needs to be downloaded before use.`,
          duration: 5000,
        });
        return;
      }

      if (status.type === 'corrupted') {
        toast.error('Model file corrupted', {
          description: `${selectedModel} file is corrupted. Please delete and re-download.`,
          duration: 7000,
        });
        return;
      }

      if (status.type === 'error') {
        toast.error('Model error', {
          description: status.Error || 'An error occurred with the model',
          duration: 5000,
        });
        return;
      }

      toast.error('Model not available', {
        description: 'The selected model is not ready for use',
        duration: 5000,
      });
    } catch (error) {
      console.error('Error checking built-in AI models:', error);
      toast.error('Failed to check model status', {
        description: error instanceof Error ? error.message : String(error),
        duration: 5000,
      });
    } finally {
      setIsCheckingModels(false);
    }
  };

  const checkOllamaModelsAndGenerate = async () => {
    if (modelConfig.provider === 'builtin-ai') {
      await checkBuiltInAIModelsAndGenerate();
      return;
    }

    if (modelConfig.provider !== 'ollama') {
      onGenerateSummary(customPrompt);
      return;
    }

    setIsCheckingModels(true);
    try {
      const endpoint = modelConfig.ollamaEndpoint || null;
      const models = await invoke('get_ollama_models', { endpoint }) as any[];

      if (!models || models.length === 0) {
        toast.error(
          'No Ollama models found. Please download gemma2:2b from Model Settings.',
          { duration: 5000 }
        );
        return;
      }

      onGenerateSummary(customPrompt);
    } catch (error) {
      console.error('Error checking Ollama models:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isOllamaNotInstalledError(errorMessage)) {
        toast.error(
          'Ollama is not installed',
          {
            description: 'Please download and install Ollama to use local models.',
            duration: 7000,
            action: {
              label: 'Download',
              onClick: () => invoke('open_external_url', { url: 'https://ollama.com/download' })
            }
          }
        );
      } else {
        toast.error(
          'Failed to check Ollama models. Please check if Ollama is running and download a model.',
          { duration: 5000 }
        );
      }
    } finally {
      setIsCheckingModels(false);
    }
  };

  const isGenerating = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';

  return (
    <ButtonGroup>
      {isGenerating ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            Analytics.trackButtonClick('stop_summary_generation', 'meeting_details');
            onStopGeneration();
          }}
          title="Stop summary generation"
        >
          <Square className="lg:mr-2" size={16} fill="currentColor" />
          <span className="hidden lg:inline">Stop</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            Analytics.trackButtonClick('generate_summary', 'meeting_details');
            checkOllamaModelsAndGenerate();
          }}
          disabled={isCheckingModels}
          title={isCheckingModels ? 'Checking models...' : 'Generate AI Summary'}
        >
          {isCheckingModels ? (
            <>
              <Loader2 className="animate-spin lg:mr-2" size={16} />
              <span className="hidden lg:inline">Checking...</span>
            </>
          ) : (
            <>
              <Sparkles className="lg:mr-2" size={16} />
              <span className="hidden lg:inline">Generate Summary</span>
            </>
          )}
        </Button>
      )}
    </ButtonGroup>
  );
}
