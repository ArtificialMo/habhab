import type { Upgrade } from "../gameplay/progression";
import { displayType, makePressable, slateStyle, UI_FONT } from "./theme";

/**
 * End-of-day summary and upgrade pick.
 *
 * Deliberately modal and deliberately short: it is the only moment in the run where
 * the player is not driving, so it shows what they earned, offers exactly three
 * cards, and gets out of the way the instant one is chosen.
 */
export class UpgradeScreen {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly cards: HTMLElement;
  private resolve: ((u: Upgrade) => void) | null = null;
  /** Set by main so a card press kicks the camera. */
  onShake: ((amount: number) => void) | null = null;

  constructor(frame: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `position:absolute;inset:0;z-index:9;display:none;
      flex-direction:column;align-items:center;justify-content:center;gap:10px;
      background:radial-gradient(ellipse at 50% 40%, rgba(12,16,28,.82), rgba(6,8,16,.94));
      font:700 13px/1.4 ${UI_FONT};color:#e9edf4;
      -webkit-user-select:none;user-select:none;padding:16px;box-sizing:border-box;`;

    this.title = document.createElement("div");
    this.title.style.cssText = `${displayType(38)}color:#ffd23f;
      text-shadow:0 4px 0 #7a3a00, 0 8px 20px rgba(0,0,0,.65);`;

    this.stats = document.createElement("div");
    this.stats.style.cssText = `color:#9fb0c8;letter-spacing:.08em;margin-bottom:6px;text-align:center;`;

    const pick = document.createElement("div");
    pick.textContent = "CHOOSE AN UPGRADE";
    pick.style.cssText = `color:#7fe0a0;letter-spacing:.16em;font-size:11px;`;

    this.cards = document.createElement("div");
    this.cards.style.cssText = `display:flex;flex-direction:column;gap:8px;width:100%;max-width:290px;`;

    this.root.append(this.title, this.stats, pick, this.cards);
    frame.appendChild(this.root);
  }

  get open(): boolean {
    return this.root.style.display !== "none";
  }

  /** Shows the summary and resolves with whichever card is chosen. */
  show(
    day: number,
    summary: { knockouts: number; coins: number; stash: number; bestCombo: number },
    offers: Upgrade[]
  ): Promise<Upgrade> {
    this.title.textContent = `DAY ${day} CLEARED`;
    this.stats.innerHTML =
      `${summary.knockouts} knocked off &nbsp;·&nbsp; ${summary.coins} coins &nbsp;·&nbsp; best ×${summary.bestCombo}` +
      `<br><span style="color:#ffd23f">STASH ${summary.stash}</span>`;

    this.cards.replaceChildren();
    for (const u of offers) {
      const card = document.createElement("div");
      card.style.cssText =
        `display:block;width:100%;text-align:left;cursor:pointer;padding:11px 13px;
         box-sizing:border-box;font:inherit;-webkit-user-select:none;user-select:none;` +
        slateStyle(7);
      card.innerHTML =
        `<div style="${displayType(17)}color:#12305c">${u.name}</div>` +
        `<div style="color:#41506b;margin:3px 0 4px;font-weight:700;font-size:12px">${u.blurb}</div>` +
        `<div style="color:#0f7a43;font-size:12px;font-weight:900">${u.effect}</div>`;
      makePressable(
        card,
        7,
        () => {
          this.root.style.display = "none";
          this.resolve?.(u);
          this.resolve = null;
        },
        (amount) => this.onShake?.(amount)
      );
      this.cards.appendChild(card);
    }

    this.root.style.display = "flex";
    return new Promise((res) => {
      this.resolve = res;
    });
  }
}
