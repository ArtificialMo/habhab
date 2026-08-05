import { displayType, UI_FONT } from "./theme";
/**
 * Combo meter.
 *
 * Knock a car off while the timer is still running and the chain continues; let it
 * expire and it resets. The countdown is the whole point — it has to be legible at a
 * glance while you are driving, so it is a bar draining left-to-right rather than a
 * number you would have to read.
 */
export class ComboMeter {
  private readonly root: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly labelEl: HTMLElement;

  /** Current chain length. 0 or 1 means no chain to show. */
  combo = 0;
  private timeLeft = 0;
  private window = 10;
  private popT = 0;

  constructor(frame: HTMLElement, windowSeconds = 10) {
    this.window = windowSeconds;

    this.root = document.createElement("div");
    this.root.style.cssText = `position:absolute;top:12%;left:50%;transform:translateX(-50%);
      z-index:6;pointer-events:none;text-align:center;opacity:0;transition:opacity .18s ease;
      font:900 13px/1 ${UI_FONT};letter-spacing:.12em;
      -webkit-user-select:none;user-select:none;`;

    this.countEl = document.createElement("div");
    this.countEl.style.cssText = `${displayType(52)}color:#ffd23f;
      text-shadow:0 0 14px rgba(255,150,20,.85), 0 3px 0 #7a3a00, 0 5px 10px rgba(0,0,0,.55);
      transform-origin:50% 50%;will-change:transform;`;

    this.labelEl = document.createElement("div");
    this.labelEl.textContent = "COMBO";
    this.labelEl.style.cssText = `margin-top:2px;color:#fff2c9;text-shadow:0 2px 4px rgba(0,0,0,.7);`;

    // Drain bar. Colour shifts toward red as the window closes, so urgency is
    // readable from peripheral vision without reading the bar's length.
    const track = document.createElement("div");
    track.style.cssText = `margin:6px auto 0;width:104px;height:6px;border-radius:3px;
      background:rgba(0,0,0,.42);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);overflow:hidden;`;
    this.barEl = document.createElement("div");
    this.barEl.style.cssText = `height:100%;width:100%;border-radius:3px;background:#ffd23f;
      transform-origin:left center;will-change:transform;`;
    track.appendChild(this.barEl);

    this.root.append(this.countEl, this.labelEl, track);
    frame.appendChild(this.root);
  }

  /** Call on every knockout. Returns the new combo length. */
  register(): number {
    this.combo++;
    this.timeLeft = this.window;
    this.popT = 1;
    return this.combo;
  }

  get active(): boolean {
    return this.combo > 1 && this.timeLeft > 0;
  }

  /** Seconds remaining before the chain drops. */
  get remaining(): number {
    return this.timeLeft;
  }

  update(dt: number): void {
    if (this.timeLeft > 0) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft === 0) this.combo = 0;
    }

    const show = this.combo > 1 && this.timeLeft > 0;
    this.root.style.opacity = show ? "1" : "0";
    if (!show) return;

    this.countEl.textContent = `×${this.combo}`;
    const frac = this.timeLeft / this.window;
    this.barEl.style.transform = `scaleX(${frac})`;
    // Yellow → orange → red as it drains.
    const hue = 48 * frac;
    this.barEl.style.background = `hsl(${hue} 95% ${52 + frac * 8}%)`;

    // A short scale punch each time the chain extends.
    this.popT = Math.max(0, this.popT - dt * 3.4);
    const pop = 1 + this.popT * this.popT * 0.5;
    this.countEl.style.transform = `scale(${pop})`;
  }
}
