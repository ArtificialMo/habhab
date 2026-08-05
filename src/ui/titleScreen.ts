import { displayType, slateStyle, UI_FONT } from "./theme";

/**
 * Intro title card for CAR BOY / Trouble in paradise.
 *
 * The face stays white while layered grayscale shadows fake a small polygonal
 * extrusion. Each glyph has its own landing beat so the word arrives as a
 * sequence of impacts instead of a single flat title.
 */
export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly onStart: (() => void) | null;
  private readonly onIntroComplete: (() => void) | null;
  private readonly onImpact: ((amount: number) => void) | null;
  private readonly letters: HTMLElement[] = [];
  private readonly subtitle: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private resolve: (() => void) | null = null;
  private introRun = 0;
  private started = false;
  private done = false;

  constructor(
    frame: HTMLElement,
    onStart: (() => void) | null = null,
    onIntroComplete: (() => void) | null = null,
    onImpact: ((amount: number) => void) | null = null
  ) {
    this.onStart = onStart;
    this.onIntroComplete = onIntroComplete;
    this.onImpact = onImpact;
    this.root = document.createElement("div");
    this.root.style.cssText = `position:absolute;inset:0;z-index:10;display:flex;
      flex-direction:column;align-items:center;justify-content:center;gap:4px;
      padding-bottom:5%;
      background:linear-gradient(180deg,rgba(4,10,26,.54),rgba(4,10,26,.15) 44%,rgba(4,10,26,.48));
      -webkit-user-select:none;user-select:none;cursor:default;
      font-family:${UI_FONT};`;

    const title = document.createElement("div");
    title.setAttribute("aria-label", "CAR BOY");
    title.style.cssText = `position:relative;width:100%;height:132px;
      display:flex;align-items:flex-end;justify-content:center;gap:0;
      perspective:720px;transform-style:preserve-3d;`;

    let letterIndex = 0;
    for (const char of "CAR BOY") {
      if (char === " ") {
        const spacer = document.createElement("span");
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.cssText = "display:inline-block;width:.25em;";
        title.appendChild(spacer);
        continue;
      }

      const letter = document.createElement("span");
      letter.className = "carboyTitleLetter";
      letter.textContent = char;
      letter.setAttribute("aria-hidden", "true");
      letter.style.cssText = `display:inline-block;transform-origin:50% 100%;
        transform-style:preserve-3d;${displayType(72)}
        color:#fff;-webkit-text-stroke:1px #fff;
        text-shadow:1px 2px 0 #e0e5ec,2px 4px 0 #c1cad6,3px 6px 0 #9ba8b8,
          0 14px 24px rgba(0,0,0,.66);
        --carboy-tilt:${letterIndex % 2 === 0 ? "-8deg" : "8deg"};
        animation-delay:${letterIndex * 0.27}s;`;
      this.letters.push(letter);
      title.appendChild(letter);
      letterIndex++;
    }

    this.subtitle = document.createElement("div");
    this.subtitle.className = "carboySubtitle";
    this.subtitle.textContent = "Trouble in paradise";
    this.subtitle.style.cssText = `margin-top:20px;font:800 17px/1 ${UI_FONT};
      letter-spacing:.18em;color:#fff;text-shadow:0 3px 0 rgba(26,38,58,.8),
      0 0 14px rgba(255,255,255,.25);font-style:italic;`;

    this.startButton = document.createElement("button");
    this.startButton.type = "button";
    this.startButton.className = "carboyStartButton";
    this.startButton.textContent = "START GAME";
    this.startButton.setAttribute("aria-label", "Start game");
    this.startButton.style.cssText = `width:min(78vw,300px);min-height:82px;margin-top:38px;
      padding:18px 24px 16px;box-sizing:border-box;appearance:none;cursor:pointer;
      touch-action:manipulation;${displayType(22)}letter-spacing:.08em;
      ${slateStyle(10)}
      text-shadow:0 2px 0 rgba(255,255,255,.8);transition:transform .08s ease,box-shadow .08s ease;`;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes carboyLetterSlam{
        0%{opacity:0;transform:translate3d(0,-170px,0) rotateX(74deg) rotateZ(var(--carboy-tilt)) scale(.78);filter:blur(4px)}
        56%{opacity:1;transform:translate3d(0,12px,0) rotateX(-8deg) rotateZ(0deg) scale(1.05);filter:blur(0)}
        76%{transform:translate3d(0,-5px,0) rotateX(2deg) scale(.98)}
        100%{opacity:1;transform:translate3d(0,0,0) rotateX(0deg) rotateZ(0deg) scale(1)}
      }
      @keyframes carboySubtitleSlam{
        0%{opacity:0;transform:translate3d(0,130px,0) scaleY(.72)}
        64%{opacity:1;transform:translate3d(0,-8px,0) scaleY(1.04)}
        100%{opacity:1;transform:translate3d(0,0,0) scaleY(1)}
      }
      .carboyTitleLetter{animation:carboyLetterSlam .42s cubic-bezier(.16,.88,.28,1) both}
      .carboySubtitle{animation:carboySubtitleSlam .44s cubic-bezier(.16,.88,.28,1) 1.54s both}
      .carboyStartButton:active{
        transform:translateY(8px);
        box-shadow:0 1px 0 #a7b0c0,0 2px 0 #8d97a8,0 4px 10px rgba(4,10,26,.5),inset 0 2px 0 rgba(255,255,255,.95);
      }
      .carboyStartButton:disabled{cursor:default}
    `;
    document.head.appendChild(style);

    this.root.append(title, this.subtitle, this.startButton);
    frame.appendChild(this.root);

    const start = (event: Event) => {
      event.preventDefault();
      this.beginStart();
    };
    this.startButton.addEventListener("pointerdown", start, { passive: false });
    this.startButton.addEventListener("click", start);
    this.startButton.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") start(event);
    });

    this.playIntroSequence();
  }

  get open(): boolean {
    return !this.done;
  }

  /** Test seam: start the game without a real pointer event. */
  startNow(): void {
    this.beginStart();
  }

  private beginStart(): void {
    if (this.started || this.done) return;
    this.started = true;
    this.startButton.disabled = true;
    this.startButton.style.opacity = ".38";
    this.onStart?.();
    this.playIntroSequence();
    window.setTimeout(() => {
      if (this.done) return;
      this.onIntroComplete?.();
      this.dismiss();
    }, 2200);
  }

  private playIntroSequence(): void {
    const run = ++this.introRun;
    for (const letter of this.letters) letter.style.animation = "none";
    this.subtitle.style.animation = "none";
    void this.root.offsetWidth;
    for (const letter of this.letters) letter.style.animation = "";
    this.subtitle.style.animation = "";

    this.letters.forEach((_, index) => {
      window.setTimeout(() => {
        if (this.introRun === run) this.onImpact?.(0.72);
      }, 300 + index * 270);
    });
    window.setTimeout(() => {
      if (this.introRun === run) this.onImpact?.(0.52);
    }, 1840);
  }

  private dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.root.style.transition = "opacity .35s ease";
    this.root.style.opacity = "0";
    setTimeout(() => this.root.remove(), 400);
    this.resolve?.();
  }

  waitForStart(): Promise<void> {
    if (this.done) return Promise.resolve();
    return new Promise((res) => {
      this.resolve = res;
    });
  }
}
