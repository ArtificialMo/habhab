/**
 * Screen-space grading that costs nothing on the GPU.
 *
 * A vignette and a sky gradient are the two cheapest things that separate "3D scene
 * in a browser" from "a shot". Both are done as DOM layers rather than
 * post-processes: a fullscreen post-process pass is real bandwidth on a mid-range
 * phone, and neither of these needs to know anything about the depth buffer.
 *
 * The sky sits *behind* a transparent-cleared canvas; the vignette sits in front of
 * it and behind the HUD.
 */
/**
 * Radial speed lines for the slow-motion moment.
 *
 * Rebuilt around a square element centred with a transform rather than margins.
 * The previous version sized itself in percentages and offset with negative
 * margins — and percentage margins resolve against the parent's *width* on every
 * side, including top. In a 9:16 portrait frame that pushed the centre of the
 * pattern far below the middle of the screen, so the lines fanned up from the
 * bottom edge instead of radiating from the centre.
 *
 * Sizing off `vmax` and centring with translate(-50%,-50%) makes the geometric
 * centre of the cone exactly the centre of the frame, whatever the aspect ratio,
 * and leaves room to spin without ever exposing a corner.
 */
export class SpeedLines {
  private readonly el: HTMLElement;

  constructor(frame: HTMLElement) {
    this.el = document.createElement("div");
    this.el.style.cssText = `position:absolute;left:50%;top:50%;
      width:260vmax;height:260vmax;
      transform:translate(-50%,-50%);transform-origin:50% 50%;
      pointer-events:none;z-index:3;opacity:0;
      background:repeating-conic-gradient(from 0deg at 50% 50%,
        rgba(255,255,255,.92) 0deg .45deg, rgba(255,255,255,0) .45deg 1.9deg);
      -webkit-mask-image:radial-gradient(circle at 50% 50%, transparent 3%, #000 11%);
      mask-image:radial-gradient(circle at 50% 50%, transparent 3%, #000 11%);
      transition:opacity .1s linear;will-change:opacity,transform;`;
    frame.appendChild(this.el);
  }

  /** @param intensity 0..1 */
  update(intensity: number, time: number): void {
    if (intensity <= 0.01) {
      this.el.style.opacity = "0";
      return;
    }
    this.el.style.opacity = String(Math.min(0.7, intensity * 0.78));
    const spin = time * 22;
    const scale = 1 + Math.sin(time * 9) * 0.015;
    // Centring stays in the transform, so rotation pivots on the frame centre.
    this.el.style.transform = `translate(-50%,-50%) rotate(${spin}deg) scale(${scale})`;
  }
}

export function buildScreenFx(frame: HTMLElement): void {
  const style = document.createElement("style");
  style.textContent = `
    #frame {
      /* Sky. Warm near the horizon, deeper overhead — the flat single-colour clear
         was reading as coloured paper behind the island. */
      background:
        linear-gradient(
          to bottom,
          #1f6fd0 0%,
          #3f95e6 32%,
          #71bdf3 58%,
          #a8dcf7 76%,
          #cfeaf6 100%
        );
    }
    #vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      /* Corner darkening plus a slight warm lift in the centre. Keep it subtle —
         at high strength it reads as a dirty screen rather than as a lens. */
      background:
        radial-gradient(
          ellipse 78% 62% at 50% 46%,
          rgba(255, 240, 210, 0.07) 0%,
          rgba(0, 0, 0, 0) 46%,
          rgba(12, 10, 24, 0.2) 78%,
          rgba(10, 8, 20, 0.42) 100%
        );
    }
  `;
  document.head.appendChild(style);

  const vignette = document.createElement("div");
  vignette.id = "vignette";
  frame.appendChild(vignette);
}
