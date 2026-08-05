/**
 * Procedural soundtrack.
 *
 * Synthesised rather than streamed: there is no asset pipeline here, and a loop
 * short enough to ship as audio would wear out fast anyway. Instead a small
 * scheduler plays a chord cycle with a plucked lead over it, and the arrangement
 * thins or thickens with what is happening on screen — so the music tracks the
 * fight instead of running underneath it.
 *
 * Notes are scheduled a beat ahead against the AudioContext clock, never against
 * frame timing. Frame-timed audio jitters audibly the moment the frame rate moves.
 */

/** Phrygian-flavoured cycle: the flat second is what gives it the Mediterranean tilt. */
const PROGRESSION = [
  [0, 3, 7], // i
  [1, 5, 8], // bII  ← the Phrygian colour
  [-2, 3, 7], // bVII
  [0, 3, 7], // i
];

/** Lead phrase, scale degrees over the cycle. -99 is a rest. */
const LEAD = [
  0, 3, 7, 3, -99, 7, 10, 7,
  1, 5, 8, 5, -99, 8, 12, 8,
  -2, 3, 7, 10, -99, 7, 3, 0,
  0, 3, 7, 12, 10, 7, 3, -99,
];

export class Music {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private step = 0;
  private nextNoteAt = 0;
  private started = false;

  /** 0..1 — how hot the fight is. Drives percussion and lead density. */
  intensity = 0;
  private smoothed = 0;

  private readonly bpm = 132;
  private get stepDur(): number {
    // Eighth notes.
    return 30 / this.bpm;
  }

  attach(ctx: AudioContext, master: GainNode, noise: AudioBuffer): void {
    this.ctx = ctx;
    this.noise = noise;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.34;
    this.bus.connect(master);
    this.nextNoteAt = ctx.currentTime + 0.1;
    this.started = true;
  }

  setVolume(v: number): void {
    if (this.bus) this.bus.gain.value = v;
  }

  /** Pump the scheduler. Safe to call every frame. */
  update(): void {
    if (!this.started || !this.ctx || !this.bus) return;
    this.smoothed += (this.intensity - this.smoothed) * 0.02;

    // Schedule everything falling due in the next 200 ms.
    const horizon = this.ctx.currentTime + 0.2;
    let guard = 0;
    while (this.nextNoteAt < horizon && guard++ < 32) {
      this.playStep(this.step, this.nextNoteAt);
      this.step = (this.step + 1) % 32;
      this.nextNoteAt += this.stepDur;
    }
  }

  private playStep(step: number, when: number): void {
    const bar = Math.floor(step / 8) % PROGRESSION.length;
    const chord = PROGRESSION[bar];
    const beat = step % 8;
    const hot = this.smoothed;

    // --- bass: root on the beat, fifth on the off-beat push ---
    if (beat === 0 || beat === 3 || beat === 6) {
      const semi = chord[0] + (beat === 6 ? 7 : 0);
      this.pluck(this.hz(semi, 2), when, 0.34, 0.42, "triangle");
    }

    // --- chord stabs on the backbeat, mandolin-ish ---
    if (beat === 2 || beat === 5) {
      for (const s of chord) this.pluck(this.hz(s, 4), when, 0.1, 0.2, "sawtooth");
    }

    // --- lead phrase, thinning out when nothing is happening ---
    const note = LEAD[step];
    if (note !== -99 && (hot > 0.18 || beat % 2 === 0)) {
      this.pluck(this.hz(note, 5), when, 0.13 + hot * 0.1, 0.3, "square");
    }

    // --- percussion, entering with intensity ---
    if (hot > 0.08) {
      if (beat === 0 || beat === 4) this.kick(when, 0.4 + hot * 0.3);
      if (beat % 2 === 1) this.hat(when, 0.055 + hot * 0.08);
    }
  }

  /** Semitone offset from A, at a given octave. */
  private hz(semi: number, octave: number): number {
    return 27.5 * Math.pow(2, octave + semi / 12);
  }

  /** Short plucked note: fast attack, exponential decay, no sustain. */
  private pluck(
    freq: number,
    when: number,
    gain: number,
    life: number,
    type: OscillatorType
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    // Slight detune per note keeps repeated phrases from sounding machine-stamped.
    osc.detune.value = (Math.random() - 0.5) * 9;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(7000, freq * 7), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(220, freq * 1.7), when + life);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, when + life);

    osc.connect(lp).connect(env).connect(this.bus);
    osc.start(when);
    osc.stop(when + life + 0.02);
  }

  private kick(when: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, when);
    osc.frequency.exponentialRampToValueAtTime(44, when + 0.1);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    osc.connect(env).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.2);
  }

  private hat(when: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 2.2;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(hp).connect(env).connect(this.bus);
    src.start(when);
    src.stop(when + 0.07);
  }
}
