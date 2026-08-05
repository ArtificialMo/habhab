import { displayType, slateStyle, UI_FONT } from "./theme";

export interface PauseMenuOptions {
  onPaused: (paused: boolean) => void;
  onMusicMuted: (muted: boolean) => void;
  onSfxMuted: (muted: boolean) => void;
}

/**
 * Small in-game pause control. The panel owns only UI state; main owns the
 * simulation pause so the render loop can keep the menu responsive.
 */
export class PauseMenu {
  private readonly pauseButton: HTMLButtonElement;
  private readonly root: HTMLDivElement;
  private readonly musicButton: HTMLButtonElement;
  private readonly sfxButton: HTMLButtonElement;
  private readonly options: PauseMenuOptions;
  private open = false;
  private musicMuted = false;
  private sfxMuted = false;

  constructor(frame: HTMLElement, options: PauseMenuOptions) {
    this.options = options;

    this.pauseButton = document.createElement("button");
    this.pauseButton.type = "button";
    this.pauseButton.setAttribute("aria-label", "Pause game");
    this.pauseButton.style.cssText =
      "position:absolute;top:12px;right:12px;z-index:14;display:none;" +
      "min-width:76px;padding:9px 12px;cursor:pointer;" +
      "font-family:" + UI_FONT + ";" +
      displayType(12) +
      slateStyle(6);
    this.pauseButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.pauseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(!this.open);
    });
    frame.appendChild(this.pauseButton);

    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:absolute;inset:0;z-index:13;display:none;align-items:flex-start;" +
      "justify-content:flex-end;padding:62px 12px 12px;box-sizing:border-box;" +
      "background:rgba(4,10,26,.28);pointer-events:auto;" +
      "font-family:" + UI_FONT + ";";
    this.root.addEventListener("pointerdown", (event) => {
      if (event.target === this.root) this.setOpen(false);
    });

    const card = document.createElement("div");
    card.style.cssText =
      "width:min(252px,calc(100vw - 24px));padding:17px;box-sizing:border-box;" +
      "display:flex;flex-direction:column;gap:10px;" +
      slateStyle(8);

    const title = document.createElement("div");
    title.textContent = "PAUSED";
    title.style.cssText = displayType(25) + "color:#183c68;text-align:center;";

    const hint = document.createElement("div");
    hint.textContent = "Take a breath, Car Boy.";
    hint.style.cssText =
      "text-align:center;color:#61708a;font:700 12px/1.3 " + UI_FONT + ";";

    const resume = document.createElement("button");
    resume.type = "button";
    resume.textContent = "RESUME";
    resume.style.cssText = this.buttonStyle("#ffd23f");
    resume.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(false);
    });

    this.musicButton = document.createElement("button");
    this.musicButton.type = "button";
    this.musicButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.musicMuted = !this.musicMuted;
      this.options.onMusicMuted(this.musicMuted);
      this.updateLabels();
    });

    this.sfxButton = document.createElement("button");
    this.sfxButton.type = "button";
    this.sfxButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.sfxMuted = !this.sfxMuted;
      this.options.onSfxMuted(this.sfxMuted);
      this.updateLabels();
    });

    card.append(title, hint, resume, this.musicButton, this.sfxButton);
    this.root.appendChild(card);
    frame.appendChild(this.root);
    this.updateLabels();
  }

  setVisible(visible: boolean): void {
    this.pauseButton.style.display = visible ? "block" : "none";
    if (!visible && this.open) this.setOpen(false);
    if (!visible) this.root.style.display = "none";
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.root.style.display = open ? "flex" : "none";
    this.pauseButton.textContent = open ? "RESUME" : "PAUSE";
    this.pauseButton.setAttribute("aria-label", open ? "Resume game" : "Pause game");
    this.options.onPaused(open);
  }

  private buttonStyle(colour: string): string {
    return (
      "width:100%;padding:10px 12px;cursor:pointer;border:0;" +
      "font-family:" + UI_FONT + ";color:#18253a;" +
      displayType(12) +
      "background:" + colour + ";border-radius:10px;" +
      "box-shadow:0 4px 0 rgba(92,57,0,.45);"
    );
  }

  private updateLabels(): void {
    this.musicButton.textContent = this.musicMuted ? "MUSIC: OFF" : "MUSIC: ON";
    this.sfxButton.textContent = this.sfxMuted ? "SOUND FX: OFF" : "SOUND FX: ON";
    this.musicButton.style.cssText = this.buttonStyle(this.musicMuted ? "#d7dde7" : "#eaf5ff");
    this.sfxButton.style.cssText = this.buttonStyle(this.sfxMuted ? "#d7dde7" : "#eaf5ff");
  }
}
