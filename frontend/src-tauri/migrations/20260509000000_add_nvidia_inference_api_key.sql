-- Add NVIDIA inference API key storage for the summary model provider.
ALTER TABLE settings ADD COLUMN nvidiaInferenceApiKey TEXT;
