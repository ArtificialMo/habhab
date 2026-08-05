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
  private centered = false;

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
    this.centered = false;
    this.el.textContent = text;
    this.el.style.color = colour;
    this.el.style.top = "27%";
    this.el.style.zIndex = "7";
    this.el.style.letterSpacing = ".02em";
    this.el.style.textShadow = "0 3px 0 rgba(0,0,0,.55), 0 0 18px rgba(0,0,0,.5)";
    this.el.style.setProperty("-webkit-text-stroke", "0");
    const size = Math.max(18, Math.min(36, 560 / Math.max(1, text.length)));
    this.el.style.fontSize = String(size) + "px";
    this.life = duration;
    this.duration = duration;
    this.pop = 1;
    this.el.style.opacity = "1";
  }

  showCountdown(text: string, colour = "#ffffff", duration = 0.82): void {
    this.centered = true;
    this.el.textContent = text;
    this.el.style.color = colour;
    this.el.style.top = "50%";
    this.el.style.zIndex = "12";
    this.el.style.fontSize = "clamp(96px, 30vw, 210px)";
    this.el.style.letterSpacing = ".03em";
    this.el.style.textShadow =
      "0 9px 0 #5e4218, 0 14px 0 rgba(15,25,42,.72), 0 0 34px rgba(255,210,63,.78)";
    this.el.style.setProperty("-webkit-text-stroke", "3px rgba(15,25,42,.92)");
    this.life = duration;
    this.duration = duration;
    this.pop = 1;
    this.el.style.opacity = "1";
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
    this.el.style.transform = this.centered
      ? `translate(-50%,-50%) scale(${scale})`
      : `translateX(-50%) scale(${scale})`;
  }
}
