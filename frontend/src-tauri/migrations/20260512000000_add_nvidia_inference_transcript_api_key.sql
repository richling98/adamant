-- Add NVIDIA inference API key storage for the transcription model provider.
ALTER TABLE transcript_settings ADD COLUMN nvidiaInferenceApiKey TEXT;
