/**
 * Procedural WebAudio SFX — no audio assets. Everything is oscillator +
 * envelope, with a tiny noise buffer for the shatter crunch. Match pitch rises
 * with cascade depth so a long chain is audibly ascending.
 */

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private started = false;

  /** Must be called from a user gesture before any sound will be audible. */
  unlock(): void {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      const master = this.ctx.createGain();
      master.gain.value = 0.32;
      master.connect(this.ctx.destination);
      this.master = master;
      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.32, this.ctx.currentTime, 0.02);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master && !this.muted;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'triangle',
    gain = 0.5,
    delay = 0,
    slideTo?: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noiseBurst(dur: number, gain = 0.35, delay = 0, hp = 900): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this.noise = buf;
    }
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  select(): void {
    this.tone(520, 0.07, 'square', 0.16);
  }

  swap(): void {
    this.tone(340, 0.09, 'triangle', 0.24, 0, 520);
  }

  rejected(): void {
    this.tone(190, 0.16, 'sawtooth', 0.2, 0, 110);
    this.noiseBurst(0.1, 0.16, 0, 400);
  }

  /** `cascade` is 1-based; the blip walks up a pentatonic scale with it. */
  pop(cascade: number, size: number): void {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    const step = scale[Math.min(cascade - 1, scale.length - 1)] ?? 0;
    const base = 392 * Math.pow(2, step / 12);
    const extra = Math.min(3, Math.max(0, size - 3)) * 60;
    this.tone(base, 0.16, 'triangle', 0.3);
    this.tone(base * 1.5, 0.12, 'sine', 0.18, 0.02);
    this.tone(base * 2 + extra, 0.1, 'sine', 0.12, 0.04);
    this.noiseBurst(0.16, 0.2, 0, 1200);
  }

  land(distance: number): void {
    this.tone(140 + Math.random() * 40, 0.07, 'sine', 0.1 + Math.min(0.16, distance * 0.02));
  }

  /** Ascending arpeggio when a motif assembles — bigger tiers ring longer. */
  motif(tier: number): void {
    const chords = [
      [0, 4, 7],
      [0, 4, 7, 11],
      [0, 3, 7, 10],
      [0, 4, 7, 11, 14],
      [0, 4, 7, 11, 14, 17],
    ];
    const notes = chords[Math.min(tier - 1, chords.length - 1)] ?? chords[0];
    const root = 523.25;
    notes.forEach((semi, i) => {
      this.tone(root * Math.pow(2, semi / 12), 0.42 + tier * 0.05, 'sine', 0.24, i * 0.055);
    });
    this.tone(root * 2, 0.5 + tier * 0.06, 'triangle', 0.1, notes.length * 0.055);
  }

  cascadeBeat(depth: number): void {
    this.tone(220 * Math.pow(2, depth / 12), 0.14, 'square', 0.14, 0, 330);
  }

  levelWin(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.26, i * 0.11));
    this.noiseBurst(0.5, 0.1, 0.1, 2400);
  }

  levelLose(): void {
    const notes = [392, 349.23, 293.66, 233.08];
    notes.forEach((f, i) => this.tone(f, 0.45, 'sawtooth', 0.18, i * 0.13));
  }

  reshuffle(): void {
    for (let i = 0; i < 6; i++) this.tone(300 + i * 90, 0.1, 'square', 0.1, i * 0.04);
  }

  click(): void {
    this.tone(660, 0.05, 'square', 0.12);
  }

  dispose(): void {
    void this.ready();
    this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.started = false;
  }
}
