import { UI_FONT } from "./theme";
/**
 * First-run teaching.
 *
 * Two prompts, in the order the verbs matter: drive, then ram. Each clears the
 * moment the player does the thing, so a player who already understands never
 * reads a word — and each also times out, so a prompt can never block the game or
 * sit on screen arguing with someone who is already playing.
 *
 * Deliberately text-light. §2.17 wants the collision readable at all times, so the
 * prompt lives at the top of the frame, away from the cars and the button.
 */
export type OnboardStep = "drive" | "ram" | "done";

export class Onboarding {
  private step: OnboardStep = "drive";
  private readonly el: HTMLElement;
  private readonly caption: HTMLElement;
  private driveHeld = 0;
  private elapsed = 0;
  private shownAt = 0;

  /** Hidden entirely while the title card is up. */
  setHidden(hidden: boolean): void {
    this.el.style.display = hidden ? "none" : "flex";
  }

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.style.cssText = `position:absolute;left:0;right:0;top:11%;display:flex;
      flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:4;
      transition:opacity .35s ease;`;

    this.caption = document.createElement("div");
    this.caption.style.cssText = `font:900 15px/1.2 ${UI_FONT};
      letter-spacing:.14em;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 14px rgba(0,0,0,.4);
      padding:7px 15px;border-radius:999px;background:rgba(18,16,30,.42);
      backdrop-filter:blur(2px);white-space:nowrap;`;

    const pulse = document.createElement("style");
    pulse.textContent = `@keyframes cbPulse{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.07);opacity:1}}`;
    document.head.appendChild(pulse);
    this.caption.style.animation = "cbPulse 1.5s ease-in-out infinite";

    this.el.appendChild(this.caption);
    root.appendChild(this.el);
    this.setText("DRAG  TO  DRIVE");
  }

  private setText(t: string): void {
    this.caption.textContent = t;
    this.el.style.opacity = "1";
    this.shownAt = this.elapsed;
  }

  private advance(next: OnboardStep, text?: string): void {
    this.step = next;
    if (next === "done") {
      this.el.style.opacity = "0";
      return;
    }
    if (text) this.setText(text);
  }

  get current(): OnboardStep {
    return this.step;
  }

  /**
   * @param steering how hard the player is currently steering, 0..1
   * @param charged true on the frame a charge is released
   */
  update(dt: number, steering: number, charged: boolean): void {
    if (this.step === "done") return;
    this.elapsed += dt;

    if (this.step === "drive") {
      if (steering > 0.25) this.driveHeld += dt;
      // Cleared by doing it, or by waiting — never a gate.
      if (this.driveHeld > 0.7 || this.elapsed - this.shownAt > 9) {
        this.advance("ram", "HOLD  RAM  TO  CHARGE");
      }
      return;
    }

    if (this.step === "ram") {
      if (charged || this.elapsed - this.shownAt > 11) this.advance("done");
    }
  }
}
