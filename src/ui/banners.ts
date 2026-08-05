import { displayType } from "./theme";
/**
 * Short centred callouts — "REAR HIT!!", "CHARGE LOST", "DAY 2".
 *
 * One element, reused. These punctuate a moment and must never queue up: a stack
 * of stale banners is worse than missing one, so a new message replaces whatever
 * is on screen rather than waiting its turn.
 */
export class Banners {
  private readonly el: HTMLElement;
  private life = 0;
  private duration = 1;
  private pop = 0;

  constructor(frame: HTMLElement) {
    this.el = document.createElement("div");
    this.el.style.cssText = `position:absolute;top:27%;left:50%;transform:translateX(-50%);
      z-index:7;pointer-events:none;opacity:0;white-space:nowrap;
      ${displayType(36)}
      text-shadow:0 3px 0 rgba(0,0,0,.55), 0 0 18px rgba(0,0,0,.5);
      -webkit-user-select:none;user-select:none;`;
    frame.appendChild(this.el);
  }

  show(text: string, colour = "#ffd23f", duration = 1.1): void {
    this.el.textContent = text;
    this.el.style.color = colour;
    this.life = duration;
    this.duration = duration;
    this.pop = 1;
  }

  update(dt: number): void {
    if (this.life <= 0) {
      this.el.style.opacity = "0";
      return;
    }
    this.life = Math.max(0, this.life - dt);
    const t = this.life / this.duration;
    // Hold, then fade out over the last third only.
    this.el.style.opacity = String(Math.min(1, t * 3));
    this.pop = Math.max(0, this.pop - dt * 4);
    const scale = 1 + this.pop * this.pop * 0.65;
    this.el.style.transform = `translateX(-50%) scale(${scale})`;
  }
}
