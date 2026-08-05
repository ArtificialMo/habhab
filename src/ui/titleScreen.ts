import { displayType, UI_FONT } from "./theme";
/**
 * Title card: CAR BOY / trouble in paradise.
 *
 * The lettering is built from stacked DOM layers rather than extruded geometry.
 * Real 3D text in Babylon needs a typeface JSON shipped as an asset; layering the
 * same glyphs with a per-layer offset and a darkening ramp gives the same read at
 * title scale for nothing, and stays crisp at any resolution.
 *
 * The live island renders behind it, slowly orbiting, so the first thing you see is
 * the game rather than a static splash.
 */
export class TitleScreen {
  private readonly root: HTMLElement;
  private resolve: (() => void) | null = null;
  private done = false;

  constructor(frame: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `position:absolute;inset:0;z-index:10;display:flex;
      flex-direction:column;align-items:center;justify-content:center;gap:4px;
      justify-content:center;padding-bottom:6%;
      background:linear-gradient(180deg, rgba(4,10,26,.78), rgba(4,10,26,.32) 42%, rgba(4,10,26,.72));
      -webkit-user-select:none;user-select:none;cursor:pointer;
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

    const prompt = document.createElement("div");
    prompt.textContent = "TAP TO START";
    prompt.style.cssText = `margin-top:44px;font:900 14px/1 ${UI_FONT};letter-spacing:.3em;color:#ffd23f;
      animation:carboyPulse 1.5s ease-in-out infinite;`;

    const style = document.createElement("style");
    style.textContent = `@keyframes carboyPulse{0%,100%{opacity:.35}50%{opacity:1}}`;
    document.head.appendChild(style);

    this.root.append(title, sub, prompt);
    frame.appendChild(this.root);

    const start = () => this.dismiss();
    this.root.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start, { once: true });
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
