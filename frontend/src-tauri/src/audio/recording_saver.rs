use std::sync::{Arc, Mutex};
use anyhow::Result;
use log::{info, warn, error};
use tauri::{AppHandle, Runtime, Emitter};
use tokio::sync::mpsc;
use serde::{Serialize, Deserialize};
use std::path::PathBuf;

use super::recording_state::AudioChunk;
use super::audio_processing::create_meeting_folder;

/// Structured transcript segment for JSON export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub audio_start_time: f64, // Seconds from recording start
    pub audio_end_time: f64,   // Seconds from recording start
    pub duration: f64,          // Segment duration in seconds
    pub display_time: String,   // Formatted time for display like "[02:15]"
    pub confidence: f32,
    pub sequence_id: u64,
}

/// Meeting metadata written to metadata.json alongside transcripts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub version: String,
    pub meeting_id: Option<String>,
    pub meeting_name: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub duration_seconds: Option<f64>,
    pub devices: DeviceInfo,
    pub transcript_file: String,
    pub sample_rate: u32,
    pub status: String,  // "recording", "completed", "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub microphone: Option<String>,
    pub system_audio: Option<String>,
}

/// Records transcripts and metadata to disk. Audio saving has been removed —
/// the app no longer writes MP4 files to disk during recording.
pub struct RecordingSaver {
    meeting_folder: Option<PathBuf>,
    meeting_name: Option<String>,
    meeting_id: Option<String>,
    metadata: Option<MeetingMetadata>,
    transcript_segments: Arc<Mutex<Vec<TranscriptSegment>>>,
    chunk_receiver: Option<mpsc::UnboundedReceiver<AudioChunk>>,
    is_saving: Arc<Mutex<bool>>,
}

impl RecordingSaver {
    pub fn new() -> Self {
        Self {
            meeting_folder: None,
            meeting_name: None,
            meeting_id: None,
            metadata: None,
            transcript_segments: Arc::new(Mutex::new(Vec::new())),
            chunk_receiver: None,
            is_saving: Arc::new(Mutex::new(false)),
        }
    }

    /// Set the meeting name for this recording session
    pub fn set_meeting_name(&mut self, name: Option<String>) {
        self.meeting_name = name;
    }

    /// Set the meeting ID for this recording session
    pub fn set_meeting_id(&mut self, id: Option<String>) {
        self.meeting_id = id;
    }

    /// Get the meeting ID
    pub fn get_meeting_id(&self) -> Option<String> {
        self.meeting_id.clone()
    }

    /// Set device information in metadata
    pub fn set_device_info(&mut self, mic_name: Option<String>, sys_name: Option<String>) {
        if let Some(ref mut metadata) = self.metadata {
            metadata.devices.microphone = mic_name;
            metadata.devices.system_audio = sys_name;

            if let Some(folder) = &self.meeting_folder {
                let metadata_clone = metadata.clone();
                if let Err(e) = self.write_metadata(folder, &metadata_clone) {
                    warn!("Failed to update metadata with device info: {}", e);
                }
            }
        }
    }

    /// Add or update a structured transcript segment (upserts based on sequence_id).
    /// Also saves incrementally to disk.
    pub fn add_transcript_segment(&self, segment: TranscriptSegment) {
        if let Ok(mut segments) = self.transcript_segments.lock() {
            if let Some(existing) = segments.iter_mut().find(|s| s.sequence_id == segment.sequence_id) {
                *existing = segment.clone();
                info!("Updated transcript segment {} (seq: {}) - total: {}",
                      segment.id, segment.sequence_id, segments.len());
            } else {
                segments.push(segment.clone());
                info!("Added transcript segment {} (seq: {}) - total: {}",
                      segment.id, segment.sequence_id, segments.len());
            }
        } else {
            error!("Failed to lock transcript segments for segment {}", segment.id);
        }

        // Save incrementally to disk
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                warn!("Failed to write incremental transcript update: {}", e);
            }
        }
    }

    /// Legacy method — converts raw text to a basic segment
    pub fn add_transcript_chunk(&self, text: String) {
        let segment = TranscriptSegment {
            id: format!("seg_{}", chrono::Utc::now().timestamp_millis()),
            text,
            audio_start_time: 0.0,
            audio_end_time: 0.0,
            duration: 0.0,
            display_time: "[00:00]".to_string(),
            confidence: 1.0,
            sequence_id: 0,
        };
        self.add_transcript_segment(segment);
    }

    /// Start accumulation: creates the meeting folder for transcripts/metadata and
    /// spawns a task that drains (discards) incoming audio chunks — audio is not saved.
    pub fn start_accumulation(&mut self) -> mpsc::UnboundedSender<AudioChunk> {
        info!("Starting recording saver (transcript-only mode, audio not saved)");

        let (sender, receiver) = mpsc::unbounded_channel::<AudioChunk>();
        self.chunk_receiver = Some(receiver);

        // Create meeting folder for transcripts + metadata even though audio is not saved
        if let Some(name) = self.meeting_name.clone() {
            match self.initialize_meeting_folder(&name) {
                Ok(()) => info!("Successfully initialized meeting folder (transcripts only)"),
                Err(e) => error!("Failed to initialize meeting folder: {}", e),
            }
        }

        // Drain incoming audio chunks without saving them
        let is_saving_clone = self.is_saving.clone();
        if let Some(mut receiver) = self.chunk_receiver.take() {
            tokio::spawn(async move {
                info!("Recording saver drain task started (audio discarded)");
                while let Some(_chunk) = receiver.recv().await {
                    if let Ok(saving) = is_saving_clone.lock() {
                        if !*saving { break; }
                    }
                    // Audio chunks are intentionally discarded — transcription
                    // already occurred in the pipeline before this point.
                }
                info!("Recording saver drain task ended");
            });
        }

        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = true;
        }

        sender
    }

    /// Initialize meeting folder structure and write initial metadata.json.
    /// No audio checkpoint directory is created.
    fn initialize_meeting_folder(&mut self, meeting_name: &str) -> Result<()> {
        let base_folder = super::recording_preferences::get_default_recordings_folder();

        // create_meeting_folder with create_checkpoints=false: makes the folder
        // but skips the .checkpoints/ subdirectory
        let meeting_folder = create_meeting_folder(&base_folder, meeting_name, false)?;

        let metadata = MeetingMetadata {
            version: "1.0".to_string(),
            meeting_id: None,
            meeting_name: Some(meeting_name.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            duration_seconds: None,
            devices: DeviceInfo {
                microphone: None,
                system_audio: None,
            },
            transcript_file: "transcripts.json".to_string(),
            sample_rate: 48000,
            status: "recording".to_string(),
        };

        self.write_metadata(&meeting_folder, &metadata)?;

        self.meeting_folder = Some(meeting_folder);
        self.metadata = Some(metadata);
        Ok(())
    }

    /// Atomic write of metadata.json (write to temp file, then rename)
    fn write_metadata(&self, folder: &PathBuf, metadata: &MeetingMetadata) -> Result<()> {
        let metadata_path = folder.join("metadata.json");
        let temp_path = folder.join(".metadata.json.tmp");
        let json_string = serde_json::to_string_pretty(metadata)?;
        std::fs::write(&temp_path, json_string)?;
        std::fs::rename(&temp_path, &metadata_path)?;
        Ok(())
    }

    /// Atomic write of transcripts.json (write to temp file, then rename)
    fn write_transcripts_json(&self, folder: &PathBuf) -> Result<()> {
        let segments_clone = if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            error!("Failed to lock transcript segments for writing");
            return Err(anyhow::anyhow!("Failed to lock transcript segments"));
        };

        info!("Writing {} transcript segments to JSON", segments_clone.len());

        let transcript_path = folder.join("transcripts.json");
        let temp_path = folder.join(".transcripts.json.tmp");

        let json = serde_json::json!({
            "version": "1.0",
            "segments": segments_clone,
            "last_updated": chrono::Utc::now().to_rfc3339(),
            "total_segments": segments_clone.len()
        });

        let json_string = serde_json::to_string_pretty(&json)
            .map_err(|e| anyhow::anyhow!("JSON serialization failed: {}", e))?;

        std::fs::write(&temp_path, &json_string)
            .map_err(|e| anyhow::anyhow!("Failed to write temp file: {}", e))?;

        std::fs::rename(&temp_path, &transcript_path)
            .map_err(|e| anyhow::anyhow!("Failed to rename transcript file: {}", e))?;

        info!("✅ Successfully wrote transcripts.json with {} segments", segments_clone.len());
        Ok(())
    }

    /// Stub for backward compatibility with recording_manager.rs — always returns (0, 48000)
    pub fn get_stats(&self) -> (usize, u32) {
        (0, 48000)
    }

    /// Finalize the recording: write final transcripts, update metadata, emit event.
    pub async fn stop_and_save<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        recording_duration: Option<f64>
    ) -> Result<Option<String>, String> {
        info!("Stopping recording saver (transcript-only mode)");

        // Signal the drain task to stop
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = false;
        }

        // Brief pause to let any in-flight transcript writes settle
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Write final transcripts.json
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                error!("❌ Failed to write final transcripts: {}", e);
                return Err(format!("Failed to save transcripts: {}", e));
            }

            let transcript_path = folder.join("transcripts.json");
            if !transcript_path.exists() {
                error!("❌ Transcript file was not created at: {}", transcript_path.display());
                return Err("Transcript file verification failed".to_string());
            }
            info!("✅ Transcripts saved at: {}", transcript_path.display());
        }

        // Update metadata to completed status
        if let (Some(folder), Some(mut metadata)) = (&self.meeting_folder, self.metadata.clone()) {
            metadata.status = "completed".to_string();
            metadata.completed_at = Some(chrono::Utc::now().to_rfc3339());
            metadata.duration_seconds = recording_duration.or_else(|| {
                if let Ok(segments) = self.transcript_segments.lock() {
                    segments.last().map(|seg| seg.audio_end_time)
                } else {
                    None
                }
            });

            if let Err(e) = self.write_metadata(folder, &metadata) {
                error!("❌ Failed to update metadata to completed: {}", e);
                return Err(format!("Failed to update metadata: {}", e));
            }
            info!("✅ Metadata updated with duration: {:?}s", metadata.duration_seconds);
        }

        // Emit recording-saved event (no audio_file path — audio is not saved)
        let save_event = serde_json::json!({
            "transcript_file": self.meeting_folder.as_ref()
                .map(|f| f.join("transcripts.json").to_string_lossy().to_string()),
            "meeting_name": self.meeting_name,
            "meeting_folder": self.meeting_folder.as_ref()
                .map(|f| f.to_string_lossy().to_string())
        });

        if let Err(e) = app.emit("recording-saved", &save_event) {
            warn!("Failed to emit recording-saved event: {}", e);
        }

        // Clear in-memory transcript segments
        if let Ok(mut segments) = self.transcript_segments.lock() {
            segments.clear();
        }

        Ok(None) // No audio file path to return
    }

    /// Get the meeting folder path (for passing to backend)
    pub fn get_meeting_folder(&self) -> Option<&PathBuf> {
        self.meeting_folder.as_ref()
    }

    /// Get accumulated transcript segments (for reload sync)
    pub fn get_transcript_segments(&self) -> Vec<TranscriptSegment> {
        if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            Vec::new()
        }
    }

    /// Get meeting name (for reload sync)
    pub fn get_meeting_name(&self) -> Option<String> {
        self.meeting_name.clone()
    }
}

impl Default for RecordingSaver {
    fn default() -> Self {
        Self::new()
    }
}
