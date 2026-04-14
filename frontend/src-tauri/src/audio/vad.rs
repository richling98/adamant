use anyhow::{anyhow, Result};
use log::{debug, info};
use silero_rs::{VadConfig, VadSession, VadTransition};
use std::time::Duration;

const VAD_SAMPLE_RATE: u32 = 16_000;
const VAD_FRAME_MS: usize = 30;
const VAD_FRAME_SAMPLES: usize = (VAD_SAMPLE_RATE as usize * VAD_FRAME_MS) / 1000;
const DEFAULT_MAX_SEGMENT_DURATION_MS: usize = 12_000;
const DEFAULT_SEGMENT_OVERLAP_MS: usize = 750;
const POSITIVE_SPEECH_THRESHOLD: f32 = 0.50;
const NEGATIVE_SPEECH_THRESHOLD: f32 = 0.35;
const PRE_SPEECH_PAD_MS: usize = 300;
const POST_SPEECH_PAD_MS: usize = 400;
const MIN_SPEECH_TIME_MS: usize = 250;

/// Represents a complete speech segment detected by VAD.
#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub start_timestamp_ms: f64,
    pub end_timestamp_ms: f64,
    pub confidence: f32,
}

/// Result of processing a batch of audio through the continuous VAD pipeline.
#[derive(Debug, Default)]
pub struct VadProcessResult {
    pub speech_present: bool,
    pub emitted_segments: Vec<SpeechSegment>,
    pub forced_flush_count: usize,
}

#[derive(Debug, Clone, Copy)]
struct VadChunkingPolicy {
    redemption_time_ms: u32,
    max_segment_duration_ms: usize,
    segment_overlap_ms: usize,
}

impl VadChunkingPolicy {
    fn new(redemption_time_ms: u32) -> Self {
        Self {
            redemption_time_ms,
            max_segment_duration_ms: DEFAULT_MAX_SEGMENT_DURATION_MS,
            segment_overlap_ms: DEFAULT_SEGMENT_OVERLAP_MS,
        }
    }

    fn max_segment_samples(&self) -> usize {
        ms_to_samples(self.max_segment_duration_ms)
    }

    fn overlap_samples(&self) -> usize {
        ms_to_samples(self.segment_overlap_ms).min(self.max_segment_samples().saturating_sub(1))
    }
}

#[derive(Debug)]
struct StreamingChunkBuffer {
    buffer: Vec<f32>,
    utterance_start_sample: usize,
    chunk_start_sample: usize,
    max_segment_samples: usize,
    overlap_samples: usize,
    active: bool,
}

impl StreamingChunkBuffer {
    fn new(policy: VadChunkingPolicy) -> Self {
        Self {
            buffer: Vec::with_capacity(policy.max_segment_samples()),
            utterance_start_sample: 0,
            chunk_start_sample: 0,
            max_segment_samples: policy.max_segment_samples(),
            overlap_samples: policy.overlap_samples(),
            active: false,
        }
    }

    fn start_utterance(&mut self, start_sample: usize) {
        self.buffer.clear();
        self.utterance_start_sample = start_sample;
        self.chunk_start_sample = start_sample;
        self.active = true;
    }

    fn append_chunk(&mut self, samples: &[f32]) {
        if self.active {
            self.buffer.extend_from_slice(samples);
        }
    }

    fn emit_forced_segments(&mut self) -> Vec<SpeechSegment> {
        let mut segments = Vec::new();

        while self.active && self.buffer.len() >= self.max_segment_samples {
            let emitted_len = self.max_segment_samples;
            let start_sample = self.chunk_start_sample;
            let end_sample = start_sample + emitted_len;

            segments.push(SpeechSegment {
                samples: self.buffer[..emitted_len].to_vec(),
                start_timestamp_ms: samples_to_ms(start_sample),
                end_timestamp_ms: samples_to_ms(end_sample),
                confidence: 0.85,
            });

            let retain_from = emitted_len.saturating_sub(self.overlap_samples);
            self.buffer.drain(..retain_from);
            self.chunk_start_sample += retain_from;
        }

        segments
    }

    fn finish_utterance(&mut self, full_utterance_samples: Option<&[f32]>) -> Option<SpeechSegment> {
        if !self.active {
            return None;
        }

        let final_samples = if let Some(samples) = full_utterance_samples {
            let emitted_offset = self
                .chunk_start_sample
                .saturating_sub(self.utterance_start_sample)
                .min(samples.len());

            if emitted_offset < samples.len() {
                samples[emitted_offset..].to_vec()
            } else {
                self.buffer.clone()
            }
        } else {
            self.buffer.clone()
        };

        self.active = false;
        self.buffer.clear();

        if final_samples.is_empty() {
            return None;
        }

        let start_sample = self.chunk_start_sample;
        let end_sample = start_sample + final_samples.len();

        Some(SpeechSegment {
            samples: final_samples,
            start_timestamp_ms: samples_to_ms(start_sample),
            end_timestamp_ms: samples_to_ms(end_sample),
            confidence: 0.9,
        })
    }

    fn force_flush_tail(&mut self) -> Option<SpeechSegment> {
        self.finish_utterance(None)
    }
}

/// Processes audio in 30ms chunks and exposes both continuous speech activity
/// and transcript-oriented speech segments.
pub struct ContinuousVadProcessor {
    session: VadSession,
    input_sample_rate: u32,
    chunk_size: usize,
    resample_buffer: Vec<f32>,
    processed_vad_samples: usize,
    in_speech: bool,
    last_logged_state: bool,
    chunk_buffer: StreamingChunkBuffer,
    policy: VadChunkingPolicy,
    total_forced_flush_count: usize,
}

impl ContinuousVadProcessor {
    pub fn new(input_sample_rate: u32, redemption_time_ms: u32) -> Result<Self> {
        let policy = VadChunkingPolicy::new(redemption_time_ms);

        let mut config = VadConfig::default();
        config.sample_rate = VAD_SAMPLE_RATE as usize;
        config.positive_speech_threshold = POSITIVE_SPEECH_THRESHOLD;
        config.negative_speech_threshold = NEGATIVE_SPEECH_THRESHOLD;
        config.redemption_time = Duration::from_millis(policy.redemption_time_ms as u64);
        config.pre_speech_pad = Duration::from_millis(PRE_SPEECH_PAD_MS as u64);
        config.post_speech_pad = Duration::from_millis(POST_SPEECH_PAD_MS as u64);
        config.min_speech_time = Duration::from_millis(MIN_SPEECH_TIME_MS as u64);

        debug!(
            "Creating VAD session with: vad_rate={}Hz, redemption={}ms, max_segment={}ms, overlap={}ms, input_rate={}Hz",
            VAD_SAMPLE_RATE,
            policy.redemption_time_ms,
            policy.max_segment_duration_ms,
            policy.segment_overlap_ms,
            input_sample_rate
        );

        let session = VadSession::new(config)
            .map_err(|e| anyhow!("Failed to create VAD session: {:?}", e))?;

        info!(
            "VAD processor created: input={}Hz, vad={}Hz, frame={} samples, redemption={}ms, max_segment={}ms, overlap={}ms",
            input_sample_rate,
            VAD_SAMPLE_RATE,
            VAD_FRAME_SAMPLES,
            policy.redemption_time_ms,
            policy.max_segment_duration_ms,
            policy.segment_overlap_ms
        );

        Ok(Self {
            session,
            input_sample_rate,
            chunk_size: VAD_FRAME_SAMPLES,
            resample_buffer: Vec::with_capacity(VAD_FRAME_SAMPLES * 2),
            processed_vad_samples: 0,
            in_speech: false,
            last_logged_state: false,
            chunk_buffer: StreamingChunkBuffer::new(policy),
            policy,
            total_forced_flush_count: 0,
        })
    }

    pub fn policy_summary(&self) -> String {
        format!(
            "redemption={}ms, max_segment={}ms, overlap={}ms, pre_pad={}ms, post_pad={}ms, min_speech={}ms",
            self.policy.redemption_time_ms,
            self.policy.max_segment_duration_ms,
            self.policy.segment_overlap_ms,
            PRE_SPEECH_PAD_MS,
            POST_SPEECH_PAD_MS,
            MIN_SPEECH_TIME_MS
        )
    }

    /// Process incoming audio samples and return both current speech presence
    /// and any completed or forced transcript segments.
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<VadProcessResult> {
        let resampled_audio = if self.input_sample_rate == VAD_SAMPLE_RATE {
            samples.to_vec()
        } else {
            self.resample_to_16k(samples)?
        };

        self.resample_buffer.extend_from_slice(&resampled_audio);
        let mut result = VadProcessResult::default();

        while self.resample_buffer.len() >= self.chunk_size {
            let chunk: Vec<f32> = self.resample_buffer.drain(..self.chunk_size).collect();
            let chunk_result = self.process_chunk(&chunk)?;
            result.speech_present |= chunk_result.speech_present;
            result.forced_flush_count += chunk_result.forced_flush_count;
            result.emitted_segments.extend(chunk_result.emitted_segments);
        }

        Ok(result)
    }

    /// Flush any remaining audio and emit the final tail segment.
    pub fn flush(&mut self) -> Result<VadProcessResult> {
        let mut result = VadProcessResult::default();

        if !self.resample_buffer.is_empty() {
            let mut padded_chunk = std::mem::take(&mut self.resample_buffer);
            if padded_chunk.len() < self.chunk_size {
                padded_chunk.resize(self.chunk_size, 0.0);
            }

            let chunk_result = self.process_chunk(&padded_chunk)?;
            result.speech_present |= chunk_result.speech_present;
            result.forced_flush_count += chunk_result.forced_flush_count;
            result.emitted_segments.extend(chunk_result.emitted_segments);
        }

        if self.in_speech {
            if let Some(segment) = self.chunk_buffer.force_flush_tail() {
                info!(
                    "VAD: Forced final flush at shutdown: {:.1}ms duration, {} samples",
                    segment.end_timestamp_ms - segment.start_timestamp_ms,
                    segment.samples.len()
                );
                result.emitted_segments.push(segment);
            }

            self.in_speech = false;
            self.last_logged_state = false;
        }

        Ok(result)
    }

    /// Improved resampling from input sample rate to 16kHz with anti-aliasing.
    fn resample_to_16k(&self, samples: &[f32]) -> Result<Vec<f32>> {
        if self.input_sample_rate == VAD_SAMPLE_RATE {
            return Ok(samples.to_vec());
        }

        let ratio = self.input_sample_rate as f64 / VAD_SAMPLE_RATE as f64;
        let output_len = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_len);

        let cutoff_freq = 0.4;
        let mut filtered_samples = Vec::with_capacity(samples.len());

        let filter_size =
            (self.input_sample_rate as f64 / (cutoff_freq * self.input_sample_rate as f64)) as usize;
        let filter_size = std::cmp::max(1, std::cmp::min(filter_size, 5));

        for i in 0..samples.len() {
            let start = if i >= filter_size { i - filter_size } else { 0 };
            let end = std::cmp::min(i + filter_size + 1, samples.len());
            let sum: f32 = samples[start..end].iter().sum();
            filtered_samples.push(sum / (end - start) as f32);
        }

        for i in 0..output_len {
            let source_pos = i as f64 * ratio;
            let source_index = source_pos as usize;
            let fraction = source_pos - source_index as f64;

            if source_index + 1 < filtered_samples.len() {
                let sample1 = filtered_samples[source_index];
                let sample2 = filtered_samples[source_index + 1];
                let interpolated = sample1 + (sample2 - sample1) * fraction as f32;
                resampled.push(interpolated);
            } else if source_index < filtered_samples.len() {
                resampled.push(filtered_samples[source_index]);
            }
        }

        debug!(
            "Resampled from {} samples ({}Hz) to {} samples ({}Hz)",
            samples.len(),
            self.input_sample_rate,
            resampled.len(),
            VAD_SAMPLE_RATE
        );

        Ok(resampled)
    }

    fn process_chunk(&mut self, chunk: &[f32]) -> Result<VadProcessResult> {
        let transitions = self
            .session
            .process(chunk)
            .map_err(|e| anyhow!("VAD processing failed: {}", e))?;

        let mut result = VadProcessResult {
            speech_present: self.in_speech,
            ..VadProcessResult::default()
        };

        for transition in transitions {
            match transition {
                VadTransition::SpeechStart { timestamp_ms } => {
                    if !self.last_logged_state {
                        info!("VAD: Speech started at {}ms", timestamp_ms);
                        self.last_logged_state = true;
                    }

                    self.in_speech = true;
                    self.chunk_buffer.start_utterance(self.processed_vad_samples);
                    result.speech_present = true;
                }
                VadTransition::SpeechEnd {
                    start_timestamp_ms,
                    end_timestamp_ms,
                    samples,
                } => {
                    if self.last_logged_state {
                        info!(
                            "VAD: Speech ended at {}ms (duration: {}ms)",
                            end_timestamp_ms,
                            end_timestamp_ms - start_timestamp_ms
                        );
                        self.last_logged_state = false;
                    }

                    self.in_speech = false;
                    result.speech_present = true;

                    if let Some(segment) = self.chunk_buffer.finish_utterance(Some(&samples)) {
                        info!(
                            "VAD: Completed speech segment: {:.1}ms duration, {} samples",
                            segment.end_timestamp_ms - segment.start_timestamp_ms,
                            segment.samples.len()
                        );
                        result.emitted_segments.push(segment);
                    }
                }
            }
        }

        if self.in_speech {
            self.chunk_buffer.append_chunk(chunk);
            result.speech_present = true;

            let forced_segments = self.chunk_buffer.emit_forced_segments();
            if !forced_segments.is_empty() {
                self.total_forced_flush_count += forced_segments.len();
                result.forced_flush_count += forced_segments.len();

                for segment in &forced_segments {
                    info!(
                        "VAD: Forced transcript flush during continuous speech: {:.1}ms duration, {} samples",
                        segment.end_timestamp_ms - segment.start_timestamp_ms,
                        segment.samples.len()
                    );
                }

                result.emitted_segments.extend(forced_segments);
            }
        }

        self.processed_vad_samples += chunk.len();
        Ok(result)
    }
}

/// Legacy function for backward compatibility - now uses the redesigned approach.
pub fn extract_speech_16k(samples_mono_16k: &[f32]) -> Result<Vec<f32>> {
    let mut processor = ContinuousVadProcessor::new(VAD_SAMPLE_RATE, 400)?;

    let mut all_segments = processor.process_audio(samples_mono_16k)?.emitted_segments;
    let final_segments = processor.flush()?.emitted_segments;
    all_segments.extend(final_segments);

    let mut result = Vec::new();
    let num_segments = all_segments.len();
    for segment in &all_segments {
        result.extend_from_slice(&segment.samples);
    }

    if result.len() < 1600 {
        let input_energy: f32 =
            samples_mono_16k.iter().map(|&x| x * x).sum::<f32>() / samples_mono_16k.len() as f32;
        let rms = input_energy.sqrt();
        let peak = samples_mono_16k
            .iter()
            .map(|&x| x.abs())
            .fold(0.0f32, f32::max);

        if rms < 0.2 || peak < 0.20 {
            info!(
                "-----VAD detected silence/noise (RMS: {:.6}, Peak: {:.6}), skipping to prevent hallucinations-----",
                rms, peak
            );
            return Ok(Vec::new());
        } else {
            info!(
                "VAD detected speech with sufficient energy (RMS: {:.6}, Peak: {:.6})",
                rms, peak
            );
            return Ok(samples_mono_16k.to_vec());
        }
    }

    debug!(
        "VAD: Processed {} samples, extracted {} speech samples from {} segments",
        samples_mono_16k.len(),
        result.len(),
        num_segments
    );

    Ok(result)
}

/// Simple convenience function to get speech chunks from audio.
pub fn get_speech_chunks(samples_mono_16k: &[f32], redemption_time_ms: u32) -> Result<Vec<SpeechSegment>> {
    let mut processor = ContinuousVadProcessor::new(VAD_SAMPLE_RATE, redemption_time_ms)?;

    let mut segments = processor.process_audio(samples_mono_16k)?.emitted_segments;
    let final_segments = processor.flush()?.emitted_segments;
    segments.extend(final_segments);

    Ok(segments)
}

fn ms_to_samples(duration_ms: usize) -> usize {
    (duration_ms * VAD_SAMPLE_RATE as usize) / 1000
}

fn samples_to_ms(samples: usize) -> f64 {
    (samples as f64 / VAD_SAMPLE_RATE as f64) * 1000.0
}

#[cfg(test)]
mod tests {
    use super::{samples_to_ms, StreamingChunkBuffer, VadChunkingPolicy};

    #[test]
    fn forced_flushes_split_continuous_speech_with_overlap() {
        let max_samples = super::ms_to_samples(600);
        let overlap_samples = super::ms_to_samples(200);
        let mut buffer = StreamingChunkBuffer::new(VadChunkingPolicy {
            redemption_time_ms: 400,
            max_segment_duration_ms: 600,
            segment_overlap_ms: 200,
        });

        buffer.start_utterance(0);
        buffer.append_chunk(&vec![1.0; super::ms_to_samples(1200)]);

        let segments = buffer.emit_forced_segments();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].samples.len(), max_samples);
        assert_eq!(segments[1].samples.len(), max_samples);
        assert_eq!(segments[0].start_timestamp_ms, 0.0);
        assert_eq!(segments[0].end_timestamp_ms, samples_to_ms(max_samples));
        assert_eq!(
            segments[1].start_timestamp_ms,
            samples_to_ms(max_samples - overlap_samples)
        );
        assert_eq!(
            segments[1].end_timestamp_ms,
            samples_to_ms((max_samples - overlap_samples) + max_samples)
        );
    }

    #[test]
    fn final_segment_uses_tail_after_forced_flushes() {
        let max_samples = super::ms_to_samples(600);
        let overlap_samples = super::ms_to_samples(200);
        let mut buffer = StreamingChunkBuffer::new(VadChunkingPolicy {
            redemption_time_ms: 400,
            max_segment_duration_ms: 600,
            segment_overlap_ms: 200,
        });

        buffer.start_utterance(0);
        buffer.append_chunk(&vec![1.0; super::ms_to_samples(1200)]);
        let _ = buffer.emit_forced_segments();

        let final_segment = buffer
            .finish_utterance(Some(&vec![1.0; super::ms_to_samples(1400)]))
            .expect("expected final segment");

        assert_eq!(final_segment.samples.len(), max_samples);
        assert_eq!(
            final_segment.start_timestamp_ms,
            samples_to_ms(2 * (max_samples - overlap_samples))
        );
        assert_eq!(final_segment.end_timestamp_ms, samples_to_ms(super::ms_to_samples(1400)));
    }
}
