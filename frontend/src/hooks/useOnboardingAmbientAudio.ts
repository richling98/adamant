'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Elegant, musical ambient — string bass ostinato + delicate upper melody.
 *
 * Vibe:
 *   - Warm sustained pad bed (C + G) — barely there, just air
 *   - Plucked/bowed string-bass ostinato: slow walking C-E-G-A in low range
 *     with soft attack (~250ms) and natural decay — like upright bass with bow
 *   - Light upper melody (3-note motif) chiming above — sparse, elegant
 *   - Phrase: 8 bars, ~16s loop, repeats seamlessly (pentatonic C major so
 *     never gets annoying — no tense intervals)
 *   - Master low-pass at ~900Hz + subtle delay wash = round, not sharp
 *   - Sine only + gentle saturation — intimate, not buzzy
 *
 * Technical:
 *   - Melody is SCHEDULED via AudioContext time — not setTimeout drifting
 *   - Loops forever: after phrase ends it re-schedules itself
 *   - Gain-based mute — instant toggle
 */

const STORAGE_KEY = 'adamant-onboarding-audio-muted';

// C major pentatonic low — bass ostinato (midi-ish, but using Hz directly)
// Elegant 8-note looping phrase, each note ~2s — unhurried, like Satie
// Frequencies chosen to feel like a gentle repeating lullaby
const BASS_PHRASE: { freq: number; dur: number; vel: number }[] = [
  { freq: 65.41, dur: 2.0, vel: 0.32 },  // C2
  { freq: 82.41, dur: 2.0, vel: 0.28 },  // E2
  { freq: 98.0,  dur: 2.2, vel: 0.30 },  // G2
  { freq: 110.0, dur: 1.8, vel: 0.26 },  // A2 — gentle lift
  { freq: 98.0,  dur: 2.0, vel: 0.28 },  // G2 — settling
  { freq: 82.41, dur: 2.0, vel: 0.26 },  // E2
  { freq: 65.41, dur: 2.2, vel: 0.30 },  // C2 — resolving
  { freq: 73.42, dur: 2.8, vel: 0.24 },  // D2 — soft passing, breath before loop
];

// Upper melody — sparse, only plays every other bass note so it doesn't clutter
// Bell-like but warm — higher, but low-passed and very quiet
const MELODY_PHRASE: { freq: number; atBeat: number; dur: number; vel: number }[] = [
  // atBeat = index into BASS_PHRASE to align with
  { freq: 261.63, atBeat: 0, dur: 3.5, vel: 0.055 }, // C4 — over first C2
  { freq: 329.63, atBeat: 2, dur: 3.0, vel: 0.045 }, // E4 — over G2
  { freq: 392.0,  atBeat: 4, dur: 4.0, vel: 0.050 }, // G4 — over G2 return
  { freq: 293.66, atBeat: 6, dur: 3.5, vel: 0.040 }, // D4 — over final C2, gentle
];

const STORAGE_KEY_MUTE = STORAGE_KEY;

export function useOnboardingAmbientAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const padGainRef = useRef<GainNode | null>(null);
  const bassSendGainRef = useRef<GainNode | null>(null);
  const melodySendGainRef = useRef<GainNode | null>(null);

  // Keep track of per-note oscillators for cleanup (not per-loop, those self-clean)
  const staticNodesRef = useRef<{ osc: OscillatorNode; gain: GainNode; filter?: BiquadFilterNode }[]>([]);

  // Loop timer
  const loopTimeoutRef = useRef<number | null>(null);
  const isLoopingRef = useRef(false);

  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY_MUTE) === 'true') {
        setIsMuted(true);
        isMutedRef.current = true;
      }
    } catch {}
  }, []);

  const destroyAll = useCallback(() => {
    isLoopingRef.current = false;
    if (loopTimeoutRef.current !== null) {
      window.clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;
    }

    for (const n of staticNodesRef.current) {
      try { n.osc.stop(); } catch {}
      try { n.osc.disconnect(); } catch {}
      try { n.gain.disconnect(); } catch {}
      try { n.filter?.disconnect(); } catch {}
    }
    staticNodesRef.current = [];

    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    masterGainRef.current = null;
    padGainRef.current = null;
    bassSendGainRef.current = null;
    melodySendGainRef.current = null;
    hasStartedRef.current = false;
    setHasStarted(false);
  }, []);

  /**
   * Schedule one note with string-bass envelope:
   * - Sine oscillator (pure, round)
   * - Slight detuned pair for body (chorus 4 cents) — like thick string
   * - Soft attack (bowed) ~250ms, then slow decay
   * - Touch of vibrato (5.5Hz, 6 cents) — like finger on string
   * - Low-pass filtered per note
   * - Auto-stops after dur + release
   */
  const scheduleStringNote = useCallback((
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    startTime: number,
    dur: number,
    vel: number,
    opts: { lpFreq?: number; attackTime?: number; releaseTime?: number; withVibrato?: boolean; detune?: number } = {}
  ) => {
    const lpFreq = opts.lpFreq ?? 650;
    const attack = opts.attackTime ?? 0.28;
    const release = opts.releaseTime ?? 0.9;
    const withVibrato = opts.withVibrato ?? true;
    const detuneCents = opts.detune ?? 4;

    // Pair for body
    [-detuneCents, detuneCents].forEach((det) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.detune.setValueAtTime(det, startTime);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lpFreq, startTime);
      lp.Q.value = 0.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      // Bowed attack
      gain.gain.linearRampToValueAtTime(vel * 0.52, startTime + attack);
      // Gentle decay through note
      gain.gain.linearRampToValueAtTime(vel * 0.35, startTime + dur * 0.6);
      // Release
      gain.gain.linearRampToValueAtTime(0.001, startTime + dur + release * 0.6);
      gain.gain.linearRampToValueAtTime(0, startTime + dur + release);

      // Vibrato — like left hand on string
      if (withVibrato) {
        const vib = ctx.createOscillator();
        vib.type = 'sine';
        vib.frequency.value = 5.2 + Math.random() * 0.8;
        const vibGain = ctx.createGain();
        vibGain.gain.value = 7; // cents
        vib.connect(vibGain);
        vibGain.connect(osc.detune);
        vib.start(startTime);
        vib.stop(startTime + dur + release);
        // we'll let vib GC — not tracking since it auto-stops
      }

      osc.connect(lp);
      lp.connect(gain);
      gain.connect(dest);

      osc.start(startTime);
      osc.stop(startTime + dur + release);
    });
  }, []);

  const scheduleBellNote = useCallback((
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    startTime: number,
    dur: number,
    vel: number,
  ) => {
    // Bell/chime — sine + very light 2nd harmonic for sparkle but still mellow
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, startTime);
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0, startTime);
    osc2Gain.gain.linearRampToValueAtTime(vel * 0.12, startTime + 0.15);
    osc2Gain.gain.linearRampToValueAtTime(0, startTime + dur * 0.3);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vel, startTime + 0.4);
    gain.gain.linearRampToValueAtTime(vel * 0.4, startTime + dur * 0.5);
    gain.gain.linearRampToValueAtTime(0, startTime + dur + 0.8);

    // Slow tremolo for shimmer
    const trem = ctx.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = 0.8;
    const tremGain = ctx.createGain();
    tremGain.gain.value = vel * 0.2;
    trem.connect(tremGain);
    tremGain.connect(gain.gain);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(dest);
    osc2.connect(osc2Gain);
    osc2Gain.connect(lp);

    osc.start(startTime);
    osc2.start(startTime);
    trem.start(startTime);
    const end = startTime + dur + 1.0;
    osc.stop(end);
    osc2.stop(end);
    trem.stop(end);
  }, []);

  /**
   * Schedule one full phrase (bass + melody) starting at `when`
   */
  const schedulePhrase = useCallback((ctx: AudioContext, when: number) => {
    const bassDest = bassSendGainRef.current ?? masterGainRef.current!;
    const melodyDest = melodySendGainRef.current ?? masterGainRef.current!;

    let cursor = when;

    BASS_PHRASE.forEach((note, idx) => {
      scheduleStringNote(ctx, bassDest, note.freq, cursor, note.dur, note.vel, {
        lpFreq: note.freq < 80 ? 380 : 520,
        attackTime: 0.32,
        releaseTime: 1.0,
        withVibrato: true,
        detune: 3.5,
      });

      // Check if melody note aligns here
      const mel = MELODY_PHRASE.find(m => m.atBeat === idx);
      if (mel) {
        // Slight offset so melody blooms just after bass
        scheduleBellNote(ctx, melodyDest, mel.freq, cursor + 0.35, mel.dur, mel.vel);
      }

      cursor += note.dur;
    });

    return cursor;
  }, [scheduleStringNote, scheduleBellNote]);

  const startLoop = useCallback((ctx: AudioContext) => {
    if (isLoopingRef.current) return;
    isLoopingRef.current = true;

    const loop = () => {
      if (!audioCtxRef.current || !isLoopingRef.current) return;
      const c = audioCtxRef.current;
      // Schedule phrase starting slightly in future to avoid clicks
      const startAt = c.currentTime + 0.1;
      const phraseEnd = schedulePhrase(c, startAt);
      const msUntilNext = (phraseEnd - c.currentTime) * 1000;

      // Queue next loop
      loopTimeoutRef.current = window.setTimeout(() => {
        loop();
      }, Math.max(msUntilNext - 200, 100)); // slight overlap for seamlessness
    };

    loop();
  }, [schedulePhrase]);

  const buildGraph = useCallback(() => {
    const ctx = audioCtxRef.current!;

    // Master low-pass — warm, not harsh ceiling at 1100 Hz
    const masterLP = ctx.createBiquadFilter();
    masterLP.type = 'lowpass';
    masterLP.frequency.value = 400; // starts dull, opens up
    masterLP.Q.value = 0.5;
    masterLP.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(masterLP);

    masterGainRef.current = master;

    // Pad bed gain — separate so bass melody can be louder relative
    const padGain = ctx.createGain();
    padGain.gain.value = 0.20;
    padGain.connect(master);
    padGainRef.current = padGain;

    // Bass send gain
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.92;
    bassGain.connect(master);
    bassSendGainRef.current = bassGain;

    // Melody send gain
    const melodyGain = ctx.createGain();
    melodyGain.gain.value = 1.0;
    melodyGain.connect(master);
    melodySendGainRef.current = melodyGain;

    // Delay wash — dreamy but subtle
    const delayTime = 0.42;
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = delayTime;
    const delayFeed = ctx.createGain();
    delayFeed.gain.value = 0.20;
    const delayLP = ctx.createBiquadFilter();
    delayLP.type = 'lowpass';
    delayLP.frequency.value = 650;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.18;

    delay.connect(delayFeed);
    delayFeed.connect(delayLP);
    delayLP.connect(delay);
    delayLP.connect(delayOut);
    delayOut.connect(master);

    // Send master to delay at low level
    const masterToDelay = ctx.createGain();
    masterToDelay.gain.value = 0.12;
    master.connect(masterToDelay);
    masterToDelay.connect(delay);

    // --- Sustained pad bed: C2 + G2 — very soft, static, just air ---
    const padNotes = [
      { freq: 65.41, gain: 0.09, lp: 300 },  // C2
      { freq: 98.0, gain: 0.07, lp: 380 },   // G2
    ];

    padNotes.forEach(({ freq, gain, lp: lpFreq }, idx) => {
      [-3.5, 3.5].forEach((det) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = det;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = lpFreq;
        lp.Q.value = 0.4;

        const g = ctx.createGain();
        g.gain.value = gain * 0.52;

        // Breathing LFO
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.03 + idx * 0.015;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = gain * 0.15;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);

        osc.connect(lp);
        lp.connect(g);
        g.connect(padGain);

        osc.start();
        lfo.start();

        staticNodesRef.current.push({ osc, gain: g, filter: lp });
        staticNodesRef.current.push({ osc: lfo, gain: lfoGain });
      });
    });

    // --- Start musical loop ---
    const target = isMutedRef.current ? 0 : 0.70;
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(target, ctx.currentTime + 3.5);

    masterLP.frequency.setValueAtTime(380, ctx.currentTime);
    masterLP.frequency.linearRampToValueAtTime(1100, ctx.currentTime + 5);

    startLoop(ctx);
  }, [startLoop]);

  const startAudio = useCallback(async () => {
    if (hasStartedRef.current) {
      if (audioCtxRef.current?.state === 'suspended') {
        try { await audioCtxRef.current.resume(); } catch {}
      }
      return;
    }

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        latencyHint: 'playback',
      });
      if (ctx.state === 'suspended') await ctx.resume();
      audioCtxRef.current = ctx;
      buildGraph();
      hasStartedRef.current = true;
      setHasStarted(true);
    } catch (e) {
      console.warn('[OnboardingAudio] Failed to start:', e);
    }
  }, [buildGraph]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    try { localStorage.setItem(STORAGE_KEY_MUTE, String(nextMuted)); } catch {}

    const master = masterGainRef.current;
    const ctx = audioCtxRef.current;

    if (!master || !ctx) {
      if (!nextMuted) startAudio();
      return;
    }

    try {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      if (nextMuted) {
        master.gain.linearRampToValueAtTime(0, now + 0.5);
        setTimeout(async () => {
          try {
            if (audioCtxRef.current?.state === 'running' && isMutedRef.current) {
              await audioCtxRef.current.suspend();
            }
          } catch {}
        }, 600);
      } else {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        master.gain.linearRampToValueAtTime(0.70, now + 0.8);
      }
    } catch {
      if (!nextMuted) {
        destroyAll();
        startAudio();
      }
    }
  }, [startAudio, destroyAll]);

  useEffect(() => {
    return () => { destroyAll(); };
  }, [destroyAll]);

  return { isMuted, hasStarted, startAudio, toggleMute, stopAudio: destroyAll };
}
