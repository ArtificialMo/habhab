/**
 * CARBOY title flow.
 *
 * Screen 1 is a pure white autoplay gate. Its first pointer gesture calls onStart
 * synchronously so browser audio policy is satisfied.
 *
 * Screen 2 is not a recreation of V14: it loads the real CARBOY_V14.html WebGL
 * renderer in a transparent same-origin iframe over the live Babylon island.
 * The lower part of the splash is a swipe surface; swiping up moves the complete
 * V14 renderer and prompt off-screen before gameplay begins.
 */
export class TitleScreen {
  private readonly root: HTMLDivElement;
  private readonly gate: HTMLButtonElement;
  private readonly splash: HTMLDivElement;
  private readonly v14: HTMLIFrameElement;
  private readonly swipeZone: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly onStart: (() => void) | null;
  private readonly onIntroComplete: (() => void) | null;
  private resolve: (() => void) | null = null;
  private gateOpened = false;
  private started = false;
  private done = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private dragY = 0;

  constructor(
    frame: HTMLElement,
    onStart: (() => void) | null = null,
    onIntroComplete: (() => void) | null = null,
    _onImpact: ((amount: number) => void) | null = null
  ) {
    this.onStart = onStart;
    this.onIntroComplete = onIntroComplete;

    this.root = document.createElement("div");
    this.root.style.cssText = `position:absolute;inset:0;z-index:30;overflow:hidden;
      -webkit-user-select:none;user-select:none;`;

    // The first screen is intentionally ONLY white + black text.
    this.gate = document.createElement("button");
    this.gate.type = "button";
    this.gate.textContent = "Tap to start.";
    this.gate.setAttribute("aria-label", "Tap to start");
    this.gate.style.cssText = `position:absolute;inset:0;z-index:20;border:0;border-radius:0;
      margin:0;padding:0;background:#fff;color:#000;display:grid;place-items:center;
      font:500 18px/1.2 Arial,Helvetica,sans-serif;letter-spacing:0;cursor:pointer;
      touch-action:manipulation;outline:none;`;

    // Transparent container: the actual Babylon island remains visible beneath it.
    this.splash = document.createElement("div");
    this.splash.style.cssText = `position:absolute;inset:0;z-index:10;opacity:0;
      pointer-events:none;will-change:transform,opacity;transform:translate3d(0,0,0);`;

    // This is the real V14 document. No DOM-letter recreation lives in this class.
    this.v14 = document.createElement("iframe");
    this.v14.title = "CARBOY V14 title";
    this.v14.setAttribute("allow", "autoplay");
    this.v14.setAttribute("allowtransparency", "true");
    this.v14.style.cssText = `position:absolute;inset:0;width:100%;height:100%;border:0;
      margin:0;padding:0;background:transparent;display:block;z-index:1;`;
    this.v14.addEventListener("load", () => this.forceV14Transparent());

    // Keep the upper/title region interactive for V14's own pull/tap deformation.
    // The lower 42% is the explicit swipe-up launch surface.
    this.swipeZone = document.createElement("div");
    this.swipeZone.setAttribute("role", "button");
    this.swipeZone.setAttribute("aria-label", "Swipe up to start");
    this.swipeZone.tabIndex = 0;
    this.swipeZone.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:42%;z-index:3;
      background:transparent;touch-action:none;cursor:ns-resize;outline:none;`;

    this.prompt = document.createElement("div");
    this.prompt.textContent = "Swipe up to start.";
    this.prompt.style.cssText = `position:absolute;left:50%;bottom:max(34px,env(safe-area-inset-bottom));
      transform:translateX(-50%);z-index:4;pointer-events:none;white-space:nowrap;
      color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.55);font:600 16px/1.2 Arial,Helvetica,sans-serif;
      letter-spacing:.01em;opacity:0;transition:opacity .28s ease;`;

    this.splash.append(this.v14, this.swipeZone, this.prompt);
    this.root.append(this.splash, this.gate);
    frame.appendChild(this.root);

    const openGate = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSplash();
    };
    // pointerdown is deliberate: onStart runs inside the original user gesture,
    // before any timeout, promise, animation callback or iframe load event.
    this.gate.addEventListener("pointerdown", openGate, { passive: false });
    this.gate.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openGate(event);
    });

    this.swipeZone.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.swipeZone.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.swipeZone.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    this.swipeZone.addEventListener("pointercancel", () => this.cancelDrag());
    this.swipeZone.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.beginGame();
      }
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

    // AUDIO ACCEPTANCE CHECK: this callback is synchronous with the first gesture.
    this.onStart?.();

    // Load V14 only now so its intro clock begins when the splash is revealed.
    this.v14.src = "/CARBOY_V14.html?v=14";
    this.splash.style.pointerEvents = "auto";
    this.splash.style.opacity = "1";

    this.gate.style.transition = "opacity .16s ease";
    this.gate.style.opacity = "0";
    this.gate.style.pointerEvents = "none";
    window.setTimeout(() => this.gate.remove(), 180);
    window.setTimeout(() => {
      if (!this.done) this.prompt.style.opacity = "1";
    }, 1550);
  }

  private forceV14Transparent(): void {
    // Same-origin safety net. The checked-in V14 file is also patched transparent
    // at build time, but this guarantees an old CDN copy cannot restore blue.
    try {
      const doc = this.v14.contentDocument;
      if (!doc) return;
      doc.documentElement.style.setProperty("background", "transparent", "important");
      doc.body?.style.setProperty("background", "transparent", "important");
      const hint = doc.querySelector<HTMLElement>(".hint");
      if (hint) hint.style.setProperty("display", "none", "important");
      const canvas = doc.querySelector<HTMLCanvasElement>("#gl");
      if (canvas) canvas.style.background = "transparent";
    } catch {
      // The static file is already transparent; cross-origin restrictions would
      // only affect this redundant safety net.
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    if (!this.gateOpened || this.started || this.done) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.dragY = 0;
    try {
      this.swipeZone.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional on older mobile browsers.
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId || this.started || this.done) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (dy >= 0 || Math.abs(dy) < Math.abs(dx) * .72) return;
    event.preventDefault();
    this.dragY = Math.max(-280, dy);
    const progress = Math.min(1, Math.abs(this.dragY) / 210);
    this.splash.style.transition = "none";
    this.splash.style.transform = `translate3d(0,${this.dragY}px,0)`;
    this.splash.style.opacity = String(1 - progress * .12);
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId || this.started || this.done) return;
    event.preventDefault();
    const launch = this.dragY <= -70;
    this.pointerId = null;
    if (launch) this.beginGame();
    else this.resetDrag();
  }

  private cancelDrag(): void {
    if (this.started || this.done) return;
    this.pointerId = null;
    this.resetDrag();
  }

  private resetDrag(): void {
    this.dragY = 0;
    this.splash.style.transition = "transform .24s ease,opacity .18s ease";
    this.splash.style.transform = "translate3d(0,0,0)";
    this.splash.style.opacity = "1";
  }

  private beginGame(): void {
    if (!this.gateOpened || this.started || this.done) return;
    this.started = true;
    this.pointerId = null;
    this.prompt.style.opacity = "0";
    this.splash.style.transition = "transform .38s cubic-bezier(.20,.82,.24,1),opacity .30s ease";
    this.splash.style.transform = "translate3d(0,-112%,0)";
    this.splash.style.opacity = "0";
    window.setTimeout(() => this.dismiss(), 390);
  }

  private dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.root.remove();
    // Gameplay begins only after the real V14 renderer has finished swiping away.
    this.onIntroComplete?.();
    this.resolve?.();
  }

  waitForStart(): Promise<void> {
    if (this.done) return Promise.resolve();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
}
