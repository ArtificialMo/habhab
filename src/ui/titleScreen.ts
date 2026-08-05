import { displayType, slateStyle, UI_FONT } from "./theme";
/**
 * Title card: CAR BOY / trouble in paradise.
 *
 * The lettering is built from stacked DOM layers rather than extruded geometry.
 * Real 3D text in Babylon needs a typeface JSON shipped as an asset; layering the
 * same glyphs with a per-layer offset and a darkening ramp gives the same read at
 * title scale for nothing, and stays crisp at any resolution.
 *
 * The island renders behind it while gameplay stays frozen, so the first thing you
 * see is a title card rather than an already-running round.
 */
export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly onStart: (() => void) | null;
  private resolve: (() => void) | null = null;
  private done = false;

  constructor(frame: HTMLElement, onStart: (() => void) | null = null) {
    this.onStart = onStart;
    this.root = document.createElement("div");
    this.root.style.cssText = `position:absolute;inset:0;z-index:10;display:flex;
      flex-direction:column;align-items:center;justify-content:center;gap:4px;
      justify-content:center;padding-bottom:6%;
      background:linear-gradient(180deg, rgba(4,10,26,.78), rgba(4,10,26,.32) 42%, rgba(4,10,26,.72));
      -webkit-user-select:none;user-select:none;cursor:default;
      font-family:${UI_FONT};`;

    const title = document.createElement("div");
    title.style.cssText = `position:relative;height:112px;width:100%;`;

    // Depth is faked by stacking the same word with a downward offset, darkest at
    // the back. Eight layers is enough to read as extrusion and cheap enough to
    // animate as one unit.
    const LAYERS = 9;
    for (let i = LAYERS - 1; i >= 0; i--) {
      const layer = document.createElement("div");
      const t = i / (LAYERS - 1);
      layer.textContent = "CAR BOY";
      const face = i === 0;
      layer.style.cssText = `position:absolute;inset:0;display:grid;place-items:center;
        ${displayType(78)}
        transform:translate(${i * 1.1}px, ${i * 2.7}px);
        color:${face ? "#ffd23f" : `rgb(${Math.round(150 - t * 105)},${Math.round(70 - t * 48)},${Math.round(10)})`};
        ${face ? "text-shadow:0 0 26px rgba(255,180,40,.55);" : ""}`;
      title.appendChild(layer);
    }

    const sub = document.createElement("div");
    sub.textContent = "trouble in paradise";
    sub.style.cssText = `margin-top:26px;font:800 17px/1 ${UI_FONT};letter-spacing:.24em;color:#cfe6ff;
      text-shadow:0 2px 8px rgba(0,0,0,.8);font-style:italic;`;

    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "carboyStartButton";
    startButton.textContent = "START DAY 1";
    startButton.setAttribute("aria-label", "Start Day 1");
    startButton.style.cssText = `width:min(78vw,300px);min-height:82px;margin-top:42px;
      padding:18px 24px 16px;box-sizing:border-box;appearance:none;cursor:pointer;
      touch-action:manipulation;${displayType(22)}letter-spacing:.08em;
      ${slateStyle(10)}
      text-shadow:0 2px 0 rgba(255,255,255,.8);transition:transform .08s ease,box-shadow .08s ease;`;

    const style = document.createElement("style");
    style.textContent = `@keyframes carboyPulse{0%,100%{opacity:.35}50%{opacity:1}}
      .carboyStartButton:active{
        transform:translateY(8px);
        box-shadow:0 1px 0 #a7b0c0,0 2px 0 #8d97a8,0 4px 10px rgba(4,10,26,.5),inset 0 2px 0 rgba(255,255,255,.95);
      }`;
    document.head.appendChild(style);

    this.root.append(title, sub, startButton);
    frame.appendChild(this.root);

    const start = (event: Event) => {
      event.preventDefault();
      this.dismiss();
    };
    startButton.addEventListener("pointerdown", start, { passive: false });
    startButton.addEventListener("click", start);
    startButton.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") start(event);
    });
  }

  get open(): boolean {
    return !this.done;
  }

  /** Test seam: start the game without a real pointer event. */
  startNow(): void {
    this.dismiss();
  }

  private dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.onStart?.();
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
