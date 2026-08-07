const V14_SHA256 = "2d715c4c21839529615ee9d051ba2bad3258e087a94dfaff376bc993fbe34016";
const V14_MARKERS = [
  'getContext("webgl"',
  "gl.drawElements(gl.TRIANGLES",
  "const DATA=",
  "impactCloudlet",
  "subtitleState",
];

type V14Window = typeof globalThis & {
  __CARBOY_V14_HTML__?: string;
};

type SplashMessage = {
  source?: string;
  type?: "drag" | "release";
  dy?: number;
  swipe?: boolean;
};

/**
 * CARBOY title flow using the actual CARBOY V14 WebGL document as the renderer.
 *
 * Screen 1 is deliberately only a white autoplay gate. Its pointerdown calls
 * onStart synchronously so the browser gesture directly unlocks/starts music.
 * After that, the exact V14 document is mounted transparently over the live
 * Babylon island. The whole V14 surface is dismissed with an upward swipe.
 */
export class TitleScreen {
  private readonly root: HTMLDivElement;
  private readonly gate: HTMLButtonElement;
  private readonly splash: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;
  private readonly prompt: HTMLDivElement;
  private readonly onStart: (() => void) | null;
  private readonly onIntroComplete: (() => void) | null;
  private readonly sourcePromise: Promise<string>;
  private resolve: (() => void) | null = null;
  private gateOpened = false;
  private mounted = false;
  private started = false;
  private done = false;
  private dragY = 0;
  private readonly onMessageBound: (event: MessageEvent<SplashMessage>) => void;

  constructor(
    frame: HTMLElement,
    onStart: (() => void) | null = null,
    onIntroComplete: (() => void) | null = null,
    _onImpact: ((amount: number) => void) | null = null
  ) {
    this.onStart = onStart;
    this.onIntroComplete = onIntroComplete;

    this.root = document.createElement("div");
    this.root.id = "carboy-title-root";
    this.root.style.cssText = [
      "position:absolute",
      "inset:0",
      "z-index:30",
      "overflow:hidden",
      "user-select:none",
      "-webkit-user-select:none",
      "touch-action:none",
    ].join(";");

    // The autoplay gate is intentionally nothing except white + black text.
    this.gate = document.createElement("button");
    this.gate.type = "button";
    this.gate.textContent = "Tap to start.";
    this.gate.setAttribute("aria-label", "Tap to start");
    this.gate.style.cssText = [
      "position:absolute",
      "inset:0",
      "z-index:20",
      "border:0",
      "border-radius:0",
      "margin:0",
      "padding:0",
      "background:#fff",
      "color:#000",
      "display:grid",
      "place-items:center",
      "font:500 18px/1.2 Arial,Helvetica,sans-serif",
      "letter-spacing:0",
      "cursor:pointer",
      "touch-action:manipulation",
      "outline:none",
    ].join(";");

    // The live Babylon island remains behind this transparent surface.
    this.splash = document.createElement("div");
    this.splash.id = "carboy-v14-splash";
    this.splash.style.cssText = [
      "position:absolute",
      "inset:0",
      "z-index:10",
      "opacity:0",
      "pointer-events:none",
      "touch-action:none",
      "will-change:transform,opacity",
    ].join(";");

    this.iframe = document.createElement("iframe");
    this.iframe.id = "carboy-v14-frame";
    this.iframe.title = "CARBOY";
    this.iframe.setAttribute("aria-label", "CARBOY Trouble in Paradise");
    this.iframe.setAttribute("allow", "autoplay");
    this.iframe.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "border:0",
      "background:transparent",
      "display:block",
      "touch-action:none",
    ].join(";");

    this.prompt = document.createElement("div");
    this.prompt.textContent = "Swipe up to start.";
    this.prompt.setAttribute("aria-label", "Swipe up to start");
    this.prompt.style.cssText = [
      "position:absolute",
      "left:50%",
      "bottom:max(34px,calc(env(safe-area-inset-bottom) + 22px))",
      "transform:translateX(-50%)",
      "z-index:3",
      "pointer-events:none",
      "white-space:nowrap",
      "color:#fff",
      "font:600 15px/1.1 Arial,Helvetica,sans-serif",
      "letter-spacing:.01em",
      "text-shadow:0 2px 8px rgba(0,0,0,.48)",
      "opacity:0",
      "transition:opacity .28s ease",
    ].join(";");

    this.splash.append(this.iframe, this.prompt);
    this.root.append(this.splash, this.gate);
    frame.appendChild(this.root);

    // Start loading before the gesture so the white gate can hand off immediately.
    this.sourcePromise = this.loadExactV14();

    const openFromGesture = (event: Event): void => {
      if (this.gateOpened || this.done) return;
      event.preventDefault();
      event.stopPropagation();
      this.gateOpened = true;

      // CRITICAL: this runs synchronously inside the user's pointer/key gesture.
      // main.ts uses it to call audio.unlock() and music.playIntro().
      this.onStart?.();

      void this.mountExactV14();
    };

    // pointerdown is the primary mobile autoplay gesture. click is only a fallback.
    this.gate.addEventListener("pointerdown", openFromGesture, { passive: false });
    this.gate.addEventListener("click", openFromGesture);
    this.gate.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openFromGesture(event);
    });

    this.onMessageBound = (event) => this.onSplashMessage(event);
    window.addEventListener("message", this.onMessageBound);
  }

  get open(): boolean {
    return !this.done;
  }

  startNow(): void {
    if (this.done) return;
    if (!this.gateOpened) {
      this.gateOpened = true;
      this.onStart?.();
      void this.mountExactV14();
      return;
    }
    this.finishSwipe();
  }

  waitForStart(): Promise<void> {
    if (this.done) return Promise.resolve();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private async loadExactV14(): Promise<string> {
    const embedded = (globalThis as V14Window).__CARBOY_V14_HTML__;
    const html = embedded ?? (await this.fetchExactV14());
    await this.assertExactV14(html);
    return html;
  }

  private async fetchExactV14(): Promise<string> {
    const response = await fetch("/CARBOY_V14.html", { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`CARBOY V14 failed to load (${response.status})`);
    }
    return response.text();
  }

  private async assertExactV14(html: string): Promise<void> {
    for (const marker of V14_MARKERS) {
      if (!html.includes(marker)) {
        throw new Error(`CARBOY V14 marker missing: ${marker}`);
      }
    }

    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(html);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0")
      ).join("");
      if (hash !== V14_SHA256) {
        throw new Error(`CARBOY V14 hash mismatch: ${hash}`);
      }
    }
  }

  private patchForIsland(html: string): string {
    // Do not touch V14's DATA, WebGL shaders, deformation, particles or timing.
    // This patch only removes its sky UI/background and adds a host swipe bridge.
    const hostPatch = String.raw`
<style id="carboy-v14-host-patch">
html,body{background:transparent!important}
body{background:transparent!important}
.hint{display:none!important}
#err{background:transparent!important}
</style>
<script id="carboy-v14-host-bridge">
(()=>{
  let id=null,sx=0,sy=0,dy=0,swipe=false;
  const send=(type,extra={})=>parent.postMessage(Object.assign({source:"carboy-v14",type},extra),"*");
  addEventListener("pointerdown",e=>{
    if(id!==null)return;
    id=e.pointerId;sx=e.clientX;sy=e.clientY;dy=0;swipe=false;
  },true);
  addEventListener("pointermove",e=>{
    if(e.pointerId!==id)return;
    const dx=e.clientX-sx, y=e.clientY-sy;
    if(!swipe && y<-12 && Math.abs(y)>Math.abs(dx)*1.15) swipe=true;
    if(!swipe)return;
    dy=Math.max(-innerHeight,Math.min(0,y));
    send("drag",{dy});
  },true);
  const release=e=>{
    if(e.pointerId!==id)return;
    send("release",{dy:swipe?dy:0,swipe});
    id=null;dy=0;swipe=false;
  };
  addEventListener("pointerup",release,true);
  addEventListener("pointercancel",release,true);
})();
<\/script>`;

    if (!html.includes("</head>")) {
      throw new Error("CARBOY V14 head is missing");
    }
    return html.replace("</head>", `${hostPatch}</head>`);
  }

  private async mountExactV14(): Promise<void> {
    try {
      const exactHtml = await this.sourcePromise;
      if (this.done) return;

      this.iframe.onload = () => {
        if (this.done || this.mounted) return;
        this.mounted = true;
        this.splash.style.transition = "opacity .18s ease";
        this.splash.style.opacity = "1";
        this.splash.style.pointerEvents = "auto";

        this.gate.style.transition = "opacity .16s ease";
        this.gate.style.opacity = "0";
        this.gate.style.pointerEvents = "none";
        window.setTimeout(() => this.gate.remove(), 190);

        // V14's own intro starts when its exact script starts. Prompt comes later.
        window.setTimeout(() => {
          if (!this.done && !this.started) this.prompt.style.opacity = "1";
        }, 1500);
      };
      this.iframe.srcdoc = this.patchForIsland(exactHtml);
    } catch (error) {
      console.error("Exact CARBOY V14 splash failed:", error);
      // Never fall back to pseudo-3D. Keep the binary white gate instead.
      this.gateOpened = false;
      this.gate.style.pointerEvents = "auto";
      this.gate.style.opacity = "1";
    }
  }

  private onSplashMessage(event: MessageEvent<SplashMessage>): void {
    if (event.source !== this.iframe.contentWindow || this.done || this.started) return;
    if (event.data?.source !== "carboy-v14") return;

    if (event.data.type === "drag") {
      const dy = Math.min(0, Number(event.data.dy) || 0);
      this.dragY = dy;
      this.splash.style.transition = "none";
      this.splash.style.transform = `translate3d(0,${dy}px,0)`;
      const progress = Math.min(1, Math.abs(dy) / Math.max(1, this.root.clientHeight));
      this.splash.style.opacity = String(1 - progress * 0.18);
      return;
    }

    if (event.data.type === "release") {
      const threshold = -Math.min(88, Math.max(58, this.root.clientHeight * 0.09));
      const passed = event.data.swipe === true && this.dragY <= threshold;
      if (passed) this.finishSwipe();
      else this.resetSwipe();
    }
  }

  private resetSwipe(): void {
    this.dragY = 0;
    this.splash.style.transition =
      "transform .22s cubic-bezier(.22,.82,.24,1), opacity .18s ease";
    this.splash.style.transform = "translate3d(0,0,0)";
    this.splash.style.opacity = "1";
  }

  private finishSwipe(): void {
    if (this.started || this.done || !this.gateOpened) return;
    this.started = true;
    this.prompt.style.opacity = "0";
    this.splash.style.transition =
      "transform .34s cubic-bezier(.22,.82,.24,1), opacity .28s ease";
    this.splash.style.transform = "translate3d(0,-112%,0)";
    this.splash.style.opacity = "0";

    // Countdown begins only after the actual V14 title has cleared the screen.
    window.setTimeout(() => this.onIntroComplete?.(), 340);
    window.setTimeout(() => this.dismiss(), 390);
  }

  private dismiss(): void {
    if (this.done) return;
    this.done = true;
    window.removeEventListener("message", this.onMessageBound);
    this.iframe.srcdoc = "";
    this.root.remove();
    this.resolve?.();
  }
}
