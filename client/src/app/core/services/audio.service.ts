import { Injectable, signal } from '@angular/core';

/**
 * Cyberpunk audio layer synthesized entirely with the Web Audio API — no
 * asset files. The AudioContext is created lazily on first use so it can be
 * resumed inside a user gesture (autoplay policy compliant).
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly isMuted = signal<boolean>(this.readMutedPreference());

  private ctx?: AudioContext;
  private masterGain?: GainNode;

  // Ambient hum nodes (kept so they can be stopped).
  private ambientOsc?: OscillatorNode;
  private ambientLfo?: OscillatorNode;
  private ambientGain?: GainNode;
  private ambientRunning = false;

  setMuted(muted: boolean): void {
    this.isMuted.set(muted);
    localStorage.setItem('cryptex-muted', String(muted));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
    if (muted) {
      this.stopAmbient();
    }
  }

  toggleMute(): void {
    this.setMuted(!this.isMuted());
  }

  /** Rising synth sweep (150–400ms) played as a message reveals. */
  playReveal(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.35);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.35);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

    osc.connect(filter).connect(gain).connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.42);
  }

  /** Brief bit-crushed glitch burst played while scrambling. */
  playScramble(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const duration = 0.18;

    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let hold = 0;
    for (let i = 0; i < data.length; i++) {
      // Sample-and-hold noise => crunchy "bit-crush" texture.
      if (i % 4 === 0) {
        hold = Math.random() * 2 - 1;
      }
      data[i] = hold * (1 - i / data.length);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter).connect(gain).connect(this.masterGain!);
    noise.start(now);
    noise.stop(now + duration);
  }

  /** Soft neon ping with a short echo when a message arrives. */
  playIncoming(): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      console.warn('[Audio] AudioContext not available for playIncoming');
      return;
    }
    console.log('[Audio] Playing incoming sound, ctx state:', ctx.state);
    const now = ctx.currentTime;

    const delay = ctx.createDelay();
    delay.delayTime.value = 0.18;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    delay.connect(feedback).connect(delay);
    delay.connect(this.masterGain!);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    gain.connect(delay);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  /** Starts the looping low-frequency ambient hum (~50Hz, slowly modulated). */
  startAmbient(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.ambientRunning || this.isMuted()) return;

    const now = ctx.currentTime;
    this.ambientOsc = ctx.createOscillator();
    this.ambientGain = ctx.createGain();
    this.ambientLfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    this.ambientOsc.type = 'sine';
    this.ambientOsc.frequency.value = 50;

    filter.type = 'lowpass';
    filter.frequency.value = 220;

    // Slow amplitude modulation for an "alive" hum.
    this.ambientLfo.type = 'sine';
    this.ambientLfo.frequency.value = 0.12;
    lfoGain.gain.value = 0.025;
    this.ambientLfo.connect(lfoGain).connect(this.ambientGain.gain);

    this.ambientGain.gain.value = 0.05;

    this.ambientOsc.connect(filter).connect(this.ambientGain).connect(this.masterGain!);
    this.ambientOsc.start(now);
    this.ambientLfo.start(now);
    this.ambientRunning = true;
  }

  /** Alias for startAmbient to satisfy the documented API. */
  playAmbient(): void {
    this.startAmbient();
  }

  stopAmbient(): void {
    if (!this.ambientRunning) return;
    try {
      this.ambientOsc?.stop();
      this.ambientLfo?.stop();
    } catch {
      /* already stopped */
    }
    this.ambientOsc = undefined;
    this.ambientLfo = undefined;
    this.ambientGain = undefined;
    this.ambientRunning = false;
  }

  private ensureContext(): AudioContext | undefined {
    if (this.isMuted()) {
      return undefined;
    }
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        console.warn('[Audio] AudioContext not available on this browser');
        return undefined;
      }
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted() ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);
      console.log('[Audio] AudioContext created, state:', this.ctx.state);
    }
    if (this.ctx.state === 'suspended') {
      console.log('[Audio] AudioContext suspended, attempting resume...');
      void this.ctx.resume().then(() => {
        console.log('[Audio] AudioContext resumed');
      }).catch(err => {
        console.error('[Audio] Failed to resume AudioContext:', err);
      });
    }
    return this.ctx;
  }

  private readMutedPreference(): boolean {
    return localStorage.getItem('cryptex-muted') === 'true';
  }
}
