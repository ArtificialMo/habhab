import { UI_FONT } from "./theme";

/**
 * CARBOY title flow.
 *
 * The first screen is deliberately nothing but a white autoplay gate. The first
 * user gesture unlocks music, then the gate disappears and the live Babylon
 * island remains visible behind this transparent title treatment.
 *
 * The title intentionally mirrors the V14 feel: heavy white pseudo-extruded
 * letters, 100 ms staggered impacts, hard squash/rebound, white dust cloudlets,
 * a subtitle that rises from below and collides with the title, and camera kicks
 * routed through onImpact.
 */
export class TitleScreen {
  private readonly root: HTMLDivElement;
  private readonly gate: HTMLButtonElement;
  private readonly splash: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly letters: HTMLSpanElement[] = [];
  private readonly subtitle: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly onStart: (() => void) | null;
  private readonly onIntroComplete: (() => void) | null;
  private readonly onImpact: ((amount: number) => void) | null;
  private resolve: (() => void) | null = null;
  private introRun = 0;
  private gateOpened = false;
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

    const style = document.createElement("style");
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500&display=swap&text=Trouble%20in%20Paradise');

      @keyframes carboyV14LetterSlam {
        0% {
          opacity:0;
          transform:translate3d(0,-46vh,0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)) scale3d(.82,1.42,.9);
        }
        66% {
          opacity:1;
          transform:translate3d(0,0,0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)) scale3d(1.30,.48,1.16);
        }
        77% {
          transform:translate3d(0,-18px,0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)) scale3d(.92,1.20,.96);
        }
        87% {
          transform:translate3d(0,7px,0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)) scale3d(1.08,.88,1.04);
        }
        100% {
          opacity:1;
          transform:translate3d(0,0,0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)) scale3d(1,1,1);
        }
      }

      @keyframes carboyV14SubtitleHit {
        0% { opacity:0; transform:translate3d(-50%,62vh,0) scale3d(1,1,1); }
        72% { opacity:1; transform:translate3d(-50%,-34px,0) scale3d(1,.82,1); }
        79% { transform:translate3d(-50%,-34px,0) scale3d(1,.72,1); }
        86% { transform:translate3d(-50%,5px,0) scale3d(1,1.07,1); }
        100% { opacity:1; transform:translate3d(-50%,0,0) scale3d(1,1,1); }
      }

      @keyframes carboyPuffShrink {
        0% { transform:translate3d(var(--dx0),0,0) scale(var(--size)); opacity:1; }
        100% { transform:translate3d(var(--dx1),var(--dy1),0) scale(0); opacity:1; }
      }

      @keyframes carboyButtonIn {
        0% { opacity:0; transform:translateY(20px); }
        100% { opacity:1; transform:translateY(0); }
      }

      .carboyV14Letter {
        display:inline-block;
        position:relative;
        transform-origin:50% 100%;
        transform-style:preserve-3d;
        color:#fff;
        font-family:Arial Black,Arial,Helvetica,sans-serif;
        font-weight:900;
        font-size:clamp(54px,16vw,108px);
        line-height:.86;
        letter-spacing:-.075em;
        -webkit-text-stroke:1px rgba(255,255,255,.98);
        text-shadow:
          1px 1px 0 #f5f6f7,
          2px 2px 0 #e9ebee,
          3px 3px 0 #d9dde1,
          4px 4px 0 #c7ccd2,
          5px 5px 0 #b5bbc3,
          6px 6px 0 #9fa7b1,
          7px 7px 0 #89939f,
          9px 12px 18px rgba(15,24,31,.28);
        will-change:transform;
      }

      .carboyV14Letter.slam {
        animation:carboyV14LetterSlam .62s cubic-bezier(.18,.88,.22,1.02) both;
        animation-delay:var(--delay);
      }

      .carboyDust {
        position:absolute;
        width:14px;
        height:14px;
        border-radius:50%;
        background:#fff;
        pointer-events:none;
        z-index:4;
        animation:carboyPuffShrink .34s cubic-bezier(.12,.58,.27,.98) forwards;
      }

      .carboySplashButton {
        border:1px solid rgba(255,255,255,.72);
        border-radius:999px;
        background:rgba(255,255,255,.90);
        color:#111;
        min-width:154px;
        padding:13px 23px 12px;
        font:600 15px/1.1 Poppins,${UI_FONT};
        cursor:pointer;
        touch-action:manipulation;
        box-shadow:0 8px 30px rgba(10,23,34,.14);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        opacity:0;
      }
      .carboySplashButton.show { animation:carboyButtonIn .28s ease-out both; }
      .carboySplashButton:active { transform:translateY(2px) scale(.98); }
      .carboySplashButton:disabled { opacity:.4; }
    `;
    document.head.appendChild(style);

    this.root = document.createElement("div");
    this.root.style.cssText = `position:absolute;inset:0;z-index:30;overflow:hidden;
      -webkit-user-select:none;user-select:none;touch-action:manipulation;`;

    // Screen 1: intentionally only white + black text, nothing else.
    this.gate = document.createElement("button");
    this.gate.type = "button";
    this.gate.textContent = "Tap to start.";
    this.gate.setAttribute("aria-label", "Tap to start");
    this.gate.style.cssText = `position:absolute;inset:0;z-index:20;border:0;border-radius:0;
      margin:0;padding:0;background:#fff;color:#000;display:grid;place-items:center;
      font:500 18px/1.2 Arial,Helvetica,sans-serif;letter-spacing:0;cursor:pointer;
      touch-action:manipulation;outline:none;`;

    // Screen 2: transparent so the live island is the splash background.
    this.splash = document.createElement("div");
    this.splash.style.cssText = `position:absolute;inset:0;z-index:10;opacity:0;
      pointer-events:none;transition:opacity .20s ease;`;

    this.title = document.createElement("div");
    this.title.setAttribute("aria-label", "CARBOY");
    this.title.style.cssText = `position:absolute;left:50%;top:29%;transform:translateX(-50%);
      width:100%;display:flex;align-items:flex-end;justify-content:center;gap:.01em;
      perspective:900px;transform-style:preserve-3d;white-space:nowrap;z-index:3;`;

    const rotations = [
      [-2.1, 1.4, -1.8],
      [1.8, -1.1, 1.2],
      [-1.4, 2.0, -.7],
      [2.2, -1.7, 1.6],
      [-1.7, 1.1, -1.2],
      [1.3, -2.2, 1.9],
    ];

    for (const [index, char] of [..."CARBOY"].entries()) {
      const letter = document.createElement("span");
      const [rx, ry, rz] = rotations[index];
      letter.className = "carboyV14Letter";
      letter.textContent = char;
      letter.style.setProperty("--delay", `${index * 0.10}s`);
      letter.style.setProperty("--rx", `${rx}deg`);
      letter.style.setProperty("--ry", `${ry}deg`);
      letter.style.setProperty("--rz", `${rz}deg`);
      this.letters.push(letter);
      this.title.appendChild(letter);
    }

    this.subtitle = document.createElement("div");
    this.subtitle.textContent = "Trouble in Paradise";
    this.subtitle.style.cssText = `position:absolute;left:50%;top:43.2%;transform:translateX(-50%);
      width:max-content;max-width:92%;white-space:nowrap;color:#090909;text-align:center;
      font:500 clamp(22px,6.2vw,42px)/1 Poppins,Arial,Helvetica,sans-serif;
      letter-spacing:-.035em;opacity:0;z-index:3;will-change:transform;`;

    this.startButton = document.createElement("button");
    this.startButton.type = "button";
    this.startButton.className = "carboySplashButton";
    this.startButton.textContent = "Tap to start.";
    this.startButton.setAttribute("aria-label", "Tap to start game");
    this.startButton.style.cssText += `position:absolute;left:50%;top:61%;transform:translateX(-50%);z-index:5;`;

    this.splash.append(this.title, this.subtitle, this.startButton);
    this.root.append(this.splash, this.gate);
    frame.appendChild(this.root);

    const openGate = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSplash();
    };
    this.gate.addEventListener("pointerdown", openGate, { passive: false });
    this.gate.addEventListener("click", openGate);
    this.gate.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openGate(event);
    });

    const startGame = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.beginGame();
    };
    this.startButton.addEventListener("pointerdown", startGame, { passive: false });
    this.startButton.addEventListener("click", startGame);
    this.startButton.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") startGame(event);
    });
  }

  get open(): boolean {
    return !this.done;
  }

  startNow(): void {
    if (!this.gateOpened) this.openSplash();
    else this.beginGame();
  }

  private openSplash(): void {
    if (this.gateOpened || this.done) return;
    this.gateOpened = true;

    // This callback is intentionally fired from the user's first gesture: it is
    // what unlocks the browser audio policy and starts the rotating intro tracks.
    this.onStart?.();

    this.gate.style.transition = "opacity .16s ease";
    this.gate.style.opacity = "0";
    this.gate.style.pointerEvents = "none";
    this.splash.style.pointerEvents = "auto";
    this.splash.style.opacity = "1";

    window.setTimeout(() => this.gate.remove(), 190);
    window.setTimeout(() => this.playIntroSequence(), 110);
  }

  private playIntroSequence(): void {
    const run = ++this.introRun;

    for (const letter of this.letters) {
      letter.classList.remove("slam");
      void letter.offsetWidth;
      letter.classList.add("slam");
    }

    this.subtitle.style.animation = "none";
    this.startButton.classList.remove("show");
    void this.subtitle.offsetWidth;
    this.subtitle.style.animation = "carboyV14SubtitleHit .78s cubic-bezier(.20,.82,.24,1) .68s both";

    this.letters.forEach((letter, index) => {
      window.setTimeout(() => {
        if (this.introRun !== run || this.done) return;
        this.onImpact?.(.66 + index * .018);
        this.emitDust(letter);
      }, 410 + index * 100);
    });

    window.setTimeout(() => {
      if (this.introRun !== run || this.done) return;
      this.onImpact?.(.48);
      this.emitSubtitleDust();
    }, 1260);

    window.setTimeout(() => {
      if (this.introRun !== run || this.done) return;
      this.startButton.classList.add("show");
    }, 1510);
  }

  private emitDust(letter: HTMLElement): void {
    const frameRect = this.root.getBoundingClientRect();
    const rect = letter.getBoundingClientRect();
    const baseX = rect.left - frameRect.left + rect.width * .5;
    const baseY = rect.bottom - frameRect.top - 3;
    this.emitCloudlets(baseX, baseY, Math.max(24, rect.width * .55));
  }

  private emitSubtitleDust(): void {
    const frameRect = this.root.getBoundingClientRect();
    const rect = this.subtitle.getBoundingClientRect();
    this.emitCloudlets(
      rect.left - frameRect.left + rect.width * .5,
      rect.top - frameRect.top + 4,
      Math.max(62, rect.width * .22)
    );
  }

  private emitCloudlets(x: number, y: number, width: number): void {
    const clouds = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < clouds; i++) {
      const pieces = 2 + Math.floor(Math.random() * 2);
      const side = Math.random() < .5 ? -1 : 1;
      const cloudX = x + (Math.random() - .5) * width;
      const travel = side * (26 + Math.random() * 58);
      const rise = -(8 + Math.random() * 34);
      const baseSize = 5 + Math.random() * 12;
      for (let piece = 0; piece < pieces; piece++) {
        const puff = document.createElement("span");
        puff.className = "carboyDust";
        const size = baseSize * (.66 + Math.random() * .72);
        puff.style.left = `${cloudX + (Math.random() - .5) * 13}px`;
        puff.style.top = `${y + (Math.random() - .5) * 8}px`;
        puff.style.width = `${size}px`;
        puff.style.height = `${size}px`;
        puff.style.setProperty("--size", String(.9 + Math.random() * .75));
        puff.style.setProperty("--dx0", "0px");
        puff.style.setProperty("--dx1", `${travel + (Math.random() - .5) * 18}px`);
        puff.style.setProperty("--dy1", `${rise + (Math.random() - .5) * 15}px`);
        this.splash.appendChild(puff);
        puff.addEventListener("animationend", () => puff.remove(), { once: true });
      }
    }
  }

  private beginGame(): void {
    if (this.started || this.done || !this.gateOpened) return;
    this.started = true;
    this.startButton.disabled = true;
    this.onIntroComplete?.();
    this.dismiss();
  }

  private dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.root.style.transition = "opacity .30s ease";
    this.root.style.opacity = "0";
    this.root.style.pointerEvents = "none";
    window.setTimeout(() => this.root.remove(), 330);
    this.resolve?.();
  }

  waitForStart(): Promise<void> {
    if (this.done) return Promise.resolve();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
}
