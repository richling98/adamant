// audio/transcription/nvidia_inference_provider.rs
//
// NVIDIA inference transcription provider.

use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use reqwest::{multipart, Client};
use serde::Deserialize;
use std::time::Duration;

const SAMPLE_RATE_HZ: u32 = 16_000;

#[derive(Debug, Deserialize)]
struct TranscriptionResponse {
    text: Option<String>,
    transcript: Option<String>,
}

pub struct NvidiaInferenceProvider {
    client: Client,
    api_key: String,
    model: String,
}

impl NvidiaInferenceProvider {
    pub fn new(api_key: String, model: String) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to create NVIDIA inference client: {}", e))?;

        Ok(Self {
            client,
            api_key,
            model,
        })
    }

    fn transcription_url(&self) -> Option<&'static str> {
        match self.model.as_str() {
            "nvidia/nvidia/parakeet-1-1b-ctc-en-us" => {
                Some("https://inference-api.nvidia.com/v1/audio/nvidia/parakeet-1-1b-ctc-en-us/transcriptions")
            }
            "nvidia/nvidia/parakeet-1-1b-rnnt-multilingual" => {
                Some("https://inference-api.nvidia.com/v1/audio/nvidia/parakeet-1-1b-rnnt-multilingual/transcriptions")
            }
            _ => None,
        }
    }

    fn language_code(&self, language: Option<String>) -> String {
        if self.model == "nvidia/nvidia/parakeet-1-1b-ctc-en-us" {
            return "en-US".to_string();
        }

        match language.as_deref() {
            Some("en-GB") | Some("es-US") | Some("es-ES") | Some("fr-FR") | Some("de-DE") => {
                language.unwrap()
            }
            Some("es") => "es-ES".to_string(),
            Some("fr") => "fr-FR".to_string(),
            Some("de") => "de-DE".to_string(),
            Some("en") | Some("auto-translate") | Some("auto") | None => "en-US".to_string(),
            Some(_) => "en-US".to_string(),
        }
    }

    fn encode_wav(audio: &[f32]) -> Vec<u8> {
        let bits_per_sample = 16u16;
        let channels = 1u16;
        let bytes_per_sample = bits_per_sample / 8;
        let byte_rate = SAMPLE_RATE_HZ * channels as u32 * bytes_per_sample as u32;
        let block_align = channels * bytes_per_sample;
        let data_size = audio.len() as u32 * bytes_per_sample as u32;
        let file_size = 36 + data_size;

        let mut wav = Vec::with_capacity(44 + data_size as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&file_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&SAMPLE_RATE_HZ.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&bits_per_sample.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());

        for sample in audio {
            let pcm = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            wav.extend_from_slice(&pcm.to_le_bytes());
        }

        wav
    }

    pub async fn test_connection(&self) -> Result<(), String> {
        let sample_count = (SAMPLE_RATE_HZ / 2) as usize;
        let probe_audio = (0..sample_count)
            .map(|idx| {
                let t = idx as f32 / SAMPLE_RATE_HZ as f32;
                (t * 440.0 * std::f32::consts::TAU).sin() * 0.05
            })
            .collect();

        <Self as TranscriptionProvider>::transcribe(self, probe_audio, Some("en".to_string()))
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[async_trait]
impl TranscriptionProvider for NvidiaInferenceProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        if audio.is_empty() {
            return Ok(TranscriptResult {
                text: String::new(),
                confidence: None,
                is_partial: false,
            });
        }

        let url = self.transcription_url().ok_or_else(|| {
            TranscriptionError::EngineFailed(format!(
                "Unsupported NVIDIA inference transcription model: {}",
                self.model
            ))
        })?;
        let wav = Self::encode_wav(&audio);
        let file_part = multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        let form = multipart::Form::new()
            .part("file", file_part)
            .text("language", self.language_code(language));

        let response = self
            .client
            .post(url)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        if !status.is_success() {
            return Err(TranscriptionError::EngineFailed(format!(
                "NVIDIA inference request failed with status {}: {}",
                status, body
            )));
        }

        let parsed: TranscriptionResponse = serde_json::from_str(&body).map_err(|e| {
            TranscriptionError::EngineFailed(format!("Invalid NVIDIA inference response: {}", e))
        })?;
        let text = parsed.text.or(parsed.transcript).unwrap_or_default();

        Ok(TranscriptResult {
            text: text.trim().to_string(),
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        !self.api_key.trim().is_empty() && !self.model.trim().is_empty()
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        "NVIDIA inference"
    }
}
