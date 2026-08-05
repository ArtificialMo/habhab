import { Music } from "./music";
import { TUNING } from "../data/tuning";

/**
 * Layered event audio (§2.16). Recorded samples carry the physical texture while
 * procedural layers keep charge, engine, and impact weight responsive to gameplay.
 *
 * Browsers will not start an AudioContext without a gesture, so this stays dormant
 * until the first touch and is silent, not broken, before then.
 */
type SampleId = "coin" | "impact";

type AudioGlobals = {
  __CARBOY_AUDIO__?: Partial<Record<SampleId, string>>;
};

const SAMPLE_URLS: Record<SampleId, string> = {
  coin: "/audio/coin-drop.ogg",
  impact: "/audio/metal-impact.ogg",
};

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly samples = new Map<SampleId, AudioBuffer>();
  private samplesLoading = false;
  /** Procedural soundtrack, attached once the context exists. */
  readonly music = new Music();

  /** Charge wind-up voices, held for the duration of a charge. */
  private chargeOsc: OscillatorNode | null = null;
  private chargeSub: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  private chargeBuzz: GainNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  muted = false;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // One second of white noise, reused for every impact and skid.
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    if (this.master) this.music.attach(this.ctx, this.master, buf);

    this.startEngine();
    void this.loadSamples();
  }

  private async loadSamples(): Promise<void> {
    if (!this.ctx || this.samplesLoading) return;
    this.samplesLoading = true;
    const ctx = this.ctx;
    const inline = (globalThis as AudioGlobals).__CARBOY_AUDIO__;
    try {
      for (const [id, url] of Object.entries(SAMPLE_URLS) as [SampleId, string][]) {
        try {
          const response = await fetch(inline?.[id] ?? url);
          if (!response.ok) continue;
          const bytes = await response.arrayBuffer();
          this.samples.set(id, await ctx.decodeAudioData(bytes));
        } catch {
          // The procedural layer is a deliberate offline fallback.
        }
      }
    } finally {
      this.samplesLoading = false;
    }
  }

  /** Play a short section of a recorded sample with a tiny transient envelope. */
  private playSample(
    id: SampleId,
    volume: number,
    playbackRate = 1,
    startOffset = 0,
    maxDuration?: number
  ): boolean {
    if (!this.ctx || !this.master || this.muted) return false;
    const buffer = this.samples.get(id);
    if (!buffer) return false;
    const offset = Math.min(Math.max(0, startOffset), Math.max(0, buffer.duration - 0.02));
    const available = Math.max(0.02, buffer.duration - offset);
    const duration = Math.min(available, maxDuration ?? available);
    const now = this.t;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(gain).connect(this.master);
    source.start(now, offset, duration);
    source.stop(now + duration + 0.02);
    return true;
  }

  private get t(): number {
    return this.ctx!.currentTime;
  }

  private startEngine(): void {
    if (!this.ctx || !this.master) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 42;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 220;
    this.engineFilter.Q.value = 3;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  /** Idle rumble that rises with speed. Kept quiet — it is a bed, not an event. */
  engine(speed: number, maxSpeed: number): void {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineFilter) return;
    const r = Math.min(1, speed / maxSpeed);
    const now = this.t;
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.028 + r * 0.05, now, 0.12);
    this.engineOsc.frequency.setTargetAtTime(40 + r * 58, now, 0.1);
    this.engineFilter.frequency.setTargetAtTime(200 + r * 620, now, 0.1);
  }

  /**
   * Charge wind-up. A rising tone plus a tremolo whose rate climbs with the charge,
   * matching the visual vibration — hearing the buzz accelerate is most of what
   * makes a full charge feel like it is about to let go.
   */
  chargeStart(): void {
    if (!this.ctx || !this.master || this.chargeOsc) return;
    const now = this.t;

    this.chargeGain = this.ctx.createGain();
    this.chargeGain.gain.setValueAtTime(0.0001, now);
    this.chargeGain.gain.exponentialRampToValueAtTime(0.1, now + 0.09);
    this.chargeGain.connect(this.master);

    // Tremolo: an LFO on a gain node, its rate driven from chargeUpdate.
    this.chargeBuzz = this.ctx.createGain();
    this.chargeBuzz.gain.value = 1;
    this.chargeBuzz.connect(this.chargeGain);

    this.chargeOsc = this.ctx.createOscillator();
    this.chargeOsc.type = "sawtooth";
    this.chargeOsc.frequency.setValueAtTime(120, now);
    this.chargeOsc.connect(this.chargeBuzz);
    this.chargeOsc.start();

    this.chargeSub = this.ctx.createOscillator();
    this.chargeSub.type = "square";
    this.chargeSub.frequency.setValueAtTime(TUNING.chargeFeel.vibrationHzMin, now);
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.35;
    this.chargeSub.connect(subGain).connect(this.chargeBuzz.gain);
    this.chargeSub.start();
  }

  chargeUpdate(level: number): void {
    if (!this.ctx || !this.chargeOsc || !this.chargeSub || !this.chargeGain) return;
    const now = this.t;
    const cf = TUNING.chargeFeel;
    this.chargeOsc.frequency.setTargetAtTime(118 + level * level * 340, now, 0.04);
    this.chargeSub.frequency.setTargetAtTime(
      cf.vibrationHzMin + (cf.vibrationHzMax - cf.vibrationHzMin) * level,
      now,
      0.05
    );
    this.chargeGain.gain.setTargetAtTime(this.muted ? 0 : 0.05 + level * 0.11, now, 0.05);
  }

  chargeStop(): void {
    if (!this.ctx || !this.chargeOsc) return;
    const now = this.t;
    this.chargeGain?.gain.cancelScheduledValues(now);
    this.chargeGain?.gain.setTargetAtTime(0.0001, now, 0.04);
    const osc = this.chargeOsc;
    const sub = this.chargeSub;
    this.chargeOsc = null;
    this.chargeSub = null;
    setTimeout(() => {
      try {
        osc.stop();
        sub?.stop();
      } catch {
        /* already stopped */
      }
    }, 220);
  }

  /** Release whoosh — filtered noise sweeping down as the car leaves. */
  launch(power: number): void {
    if (!this.ctx || !this.master || !this.noise || this.muted) return;
    const now = this.t;
    const shaper = this.grit(0.6);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(900 + power * 1400, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13 + power * 0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    // Through the soft-clipper: a clean noise sweep sounds like a synth whoosh,
    // a clipped one sounds like air being torn.
    if (shaper) src.connect(filter).connect(shaper).connect(gain).connect(this.master);
    else src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.36);
  }

  /**
   * Impact. Three layers: a rubber thud that carries the weight, a metallic clang
   * that carries the surprise, and a noise transient that carries the sharpness.
   * Layering is what stops repeated hits sounding like one looping sample.
   */
  /** Soft-clip curve. Adds harmonics so a hit sounds torn rather than padded. */
  private grit(amount: number): WaveShaperNode | null {
    if (!this.ctx) return null;
    const ws = this.ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    const k = amount * 40;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    ws.curve = curve;
    ws.oversample = "2x";
    return ws;
  }

  impact(strength: number, rear: boolean): void {
    if (!this.ctx || !this.master || !this.noise || this.muted) return;
    const now = this.t;
    const power = Math.min(1, strength / 26);

    // A real metal recording carries the first millisecond of contact; the
    // procedural body and transient below keep the hit scalable instead of flat.
    this.playSample("impact", 0.22 + power * 0.2, 0.88 + Math.random() * 0.18, 0, rear ? 0.75 : 0.58);

    // Body thud
    const thud = this.ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(150 + power * 60, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    const thudGain = this.ctx.createGain();
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.3 + power * 0.5, now + 0.008);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    thud.connect(thudGain).connect(this.master);
    thud.start(now);
    thud.stop(now + 0.28);

    // Metal transient
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + power * 0.8;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(rear ? 2600 : 1700, now);
    bp.frequency.exponentialRampToValueAtTime(500, now + 0.12);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.exponentialRampToValueAtTime(0.1 + power * 0.28, now + 0.005);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    src.connect(bp).connect(nGain).connect(this.master);
    src.start(now);
    src.stop(now + 0.2);

    // Rear hits get a bright ring on top, so the bonus is audible as well as visible.
    if (rear) {
      const ring = this.ctx.createOscillator();
      ring.type = "triangle";
      ring.frequency.setValueAtTime(880 + power * 460, now);
      const rGain = this.ctx.createGain();
      rGain.gain.setValueAtTime(0.0001, now);
      rGain.gain.exponentialRampToValueAtTime(0.09 + power * 0.1, now + 0.01);
      rGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      ring.connect(rGain).connect(this.master);
      ring.start(now);
      ring.stop(now + 0.42);
    }
  }

  /**
   * Coin pickup. Pitch climbs a scale as a run of coins comes in and resets when
   * the run lapses — the rising ladder is what turns a stream of pickups into a
   * single satisfying phrase rather than the same blip N times.
   */
  private coinStep = 0;
  private coinLastAt = -99;

  /** A short set of high, staggered pitch lines layered over the recorded strike. */
  private coinTwinkle(root: number, step: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    const startAt = this.t;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.78, startAt);
    bus.connect(master);
    const ratios = [1.2, 1.48, 2.08];
    for (let i = 0; i < ratios.length; i++) {
      const start = startAt + i * 0.022;
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "triangle" : "sine";
      const startFrequency = root * ratios[i];
      osc.frequency.setValueAtTime(startFrequency, start);
      osc.frequency.exponentialRampToValueAtTime(
        startFrequency * (1.025 + step * 0.004),
        start + 0.12
      );

      const env = ctx.createGain();
      const amp = (0.15 + Math.min(0.08, step * 0.006)) / (1 + i * 0.24);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(amp, start + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.28 + i * 0.06);
      osc.connect(env).connect(bus);
      osc.start(start);
      osc.stop(start + 0.36 + i * 0.06);
    }
  }

  /**
   * Coin pickup: a struck metal disc, not a tone.
   *
   * A sine or triangle at a musical pitch reads as a menu beep. Real metal rings on
   * *inharmonic* partials — ratios that are not whole numbers — over a very short
   * noise transient that carries the strike itself. Detuning the partials slightly
   * on every pickup keeps a fast run from sounding like a sampler.
   */
  coinPickup(now: number): void {
    if (!this.ctx || !this.master || !this.noise || this.muted) return;
    if (now - this.coinLastAt > 1.1) this.coinStep = 0;
    this.coinLastAt = now;

    // The ladder still climbs, so a run builds — but in metal, not in melody.
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const semis = scale[Math.min(scale.length - 1, this.coinStep)];
    this.coinStep++;

    // Prefer the recorded coin/metal drop. The old inharmonic ring is retained as
    // an offline fallback for a blocked asset request, never as the primary coin
    // voice when the bundled field recording is available.
    const root = 1050 * Math.pow(2, semis / 12);
    const recorded = this.playSample(
      "coin",
      0.46 + Math.min(0.2, this.coinStep * 0.018),
      1 + semis / 36,
      0,
      0.72
    );
    this.coinTwinkle(root, this.coinStep);
    if (recorded) {
      return;
    }

    const t = this.t;
    const out = this.ctx.createGain();
    out.gain.value = 0.42;
    out.connect(this.master);

    // Strike transient: a couple of milliseconds of bright noise.
    const hit = this.ctx.createBufferSource();
    hit.buffer = this.noise;
    hit.playbackRate.value = 2.4;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2600;
    const hitEnv = this.ctx.createGain();
    hitEnv.gain.setValueAtTime(0.5, t);
    hitEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    hit.connect(hp);
    hp.connect(hitEnv);
    hitEnv.connect(out);
    hit.start(t);
    hit.stop(t + 0.06);

    // Inharmonic ring. These ratios are roughly those of a small struck plate.
    const ratios = [1, 2.41, 3.83, 5.17];
    for (let i = 0; i < ratios.length; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      const detune = 1 + (Math.random() - 0.5) * 0.012;
      osc.frequency.value = root * ratios[i] * detune;
      const env = this.ctx.createGain();
      // Higher partials die first, which is what makes it read as metal.
      const life = 0.42 / (1 + i * 0.85);
      const amp = 0.34 / (1 + i * 1.3);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + life);
      osc.connect(env);
      env.connect(out);
      osc.start(t);
      osc.stop(t + life + 0.03);
    }
  }

  /**
   * A car going over: a broadband crash rather than a rising arpeggio. Filtered
   * noise with a fast attack and a long tail, plus a low thump underneath.
   */
  private crash(gain: number, brightness: number, length: number): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(brightness, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(90, brightness * 0.22), t + length);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(bp);
    bp.connect(env);
    env.connect(this.master);
    src.start(t);
    src.stop(t + length + 0.05);
  }

  /** Stylised splash for a car going over the edge. */
  splash(): void {
    if (!this.ctx || !this.master || !this.noise || this.muted) return;
    const now = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(4200, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.55);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.34, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.72);
  }

  /** Knockout: a heavy crash and a low boom. No melody. */
  knockout(): void {
    if (!this.ctx || !this.master || this.muted) return;
    this.crash(0.5, 3200, 0.55);
    const t = this.t;
    const boom = this.ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(150, t);
    boom.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.55, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    boom.connect(env);
    env.connect(this.master);
    boom.start(t);
    boom.stop(t + 0.55);
  }
}
