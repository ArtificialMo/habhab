const INTRO_TRACKS = ["/audio/music/intro-1.mp3", "/audio/music/intro-2.mp3"];
const DAY_TRACKS = [
  "/audio/music/day-1.mp3",
  "/audio/music/day-3.mp3",
  "/audio/music/day-2.mp3",
  "/audio/music/day-4.mp3",
  "/audio/music/day-5.mp3",
];

type MusicGlobals = {
  __CARBOY_MUSIC__?: Partial<Record<string, string>>;
};

type MusicMode = "intro" | "day" | null;

/**
 * Track player for the authored Car Boy soundtrack.
 *
 * The HTML audio element keeps the music independent from the effect mixer, so
 * pause-menu music mute never silences coins, impacts, or the engine.
 */
export class Music {
  private current: HTMLAudioElement | null = null;
  private currentKey = "";
  private mode: MusicMode = null;
  private dayIndex = 0;
  private introIndex = 0;
  private attached = false;
  private paused = false;
  private muted = false;
  private volume = 0.52;

  /** Kept as a public cue for the existing gameplay HUD/audio integration. */
  intensity = 0;

  attach(_ctx: AudioContext, _master: GainNode, _noise: AudioBuffer): void {
    this.attached = true;
    if (this.mode === "intro") this.startIntro(this.introIndex);
    else if (this.mode === "day") this.startDay(this.dayIndex);
  }

  playIntro(): void {
    this.mode = "intro";
    if (this.current && this.currentKey.startsWith("intro:")) {
      this.playCurrent();
      return;
    }
    this.startIntro(this.introIndex);
  }

  playDay(day: number): void {
    const index = Math.max(0, Math.min(DAY_TRACKS.length - 1, day - 1));
    this.mode = "day";
    this.dayIndex = index;
    if (this.current && this.currentKey === "day:" + index) {
      this.playCurrent();
      return;
    }
    this.startDay(index);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.current) this.current.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.current) this.current.volume = this.volume;
  }

  pause(): void {
    this.paused = true;
    this.current?.pause();
  }

  resume(): void {
    this.paused = false;
    if (this.current) this.playCurrent();
    else if (this.mode === "intro") this.startIntro(this.introIndex);
    else if (this.mode === "day") this.startDay(this.dayIndex);
  }

  /** The main loop still calls this; authored tracks do not need a scheduler. */
  update(): void {
    // Playback is driven by the audio element clock.
  }

  private startIntro(index: number): void {
    if (!this.attached) return;
    const safeIndex = ((index % INTRO_TRACKS.length) + INTRO_TRACKS.length) % INTRO_TRACKS.length;
    this.introIndex = safeIndex;
    this.startTrack(
      INTRO_TRACKS[safeIndex],
      "intro:" + safeIndex,
      () => {
        if (this.mode !== "intro") return;
        this.startIntro((safeIndex + 1) % INTRO_TRACKS.length);
      }
    );
  }

  private startDay(index: number): void {
    if (!this.attached) return;
    this.dayIndex = index;
    this.startTrack(
      DAY_TRACKS[index],
      "day:" + index,
      () => {
        if (this.mode !== "day" || this.dayIndex !== index) return;
        this.current = null;
        this.currentKey = "";
        this.startDay(index);
      }
    );
  }

  private playCurrent(): void {
    const element = this.current;
    if (!element || this.paused) return;
    void element.play().catch(() => undefined);
  }

  private startTrack(url: string, key: string, onEnded: () => void): void {
    if (this.currentKey === key && this.current) {
      this.playCurrent();
      return;
    }

    this.current?.pause();
    this.current?.remove();
    this.current = null;
    this.currentKey = key;

    const element = document.createElement("audio");
    const inline = (globalThis as MusicGlobals).__CARBOY_MUSIC__;
    element.src = inline?.[url] ?? url;
    element.preload = "auto";
    element.autoplay = true;
    element.setAttribute("playsinline", "");
    element.setAttribute("aria-hidden", "true");
    element.volume = this.mode === "intro" ? Math.max(this.volume, 0.58) : this.volume;
    element.muted = this.muted;
    element.onended = onEnded;
    element.oncanplay = () => {
      if (this.current === element && !this.paused) this.playCurrent();
    };
    element.style.display = "none";
    document.body.appendChild(element);
    this.current = element;
    element.load();
    this.playCurrent();
  }
}
