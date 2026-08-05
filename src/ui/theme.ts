/**
 * Shared UI look.
 *
 * One font stack and one slate recipe, so every panel in the game reads as the same
 * physical object. Fonts are system stacks rather than a webfont: a CSP-locked page
 * cannot fetch one, and a heavy grotesque is available everywhere anyway.
 */
export const UI_FONT =
  '"Arial Black", "Arial Bold", Gadget, "Helvetica Neue", Impact, system-ui, sans-serif';

/** Chunky display type for titles and callouts. */
export function displayType(size: number, weight = 900): string {
  return `font:${weight} ${size}px/1.02 ${UI_FONT};letter-spacing:.02em;`;
}

/**
 * A white slate: a thick card lit from above with a hard bottom edge, so it reads
 * as a solid object with depth rather than a flat rectangle.
 */
export function slateStyle(depth = 7): string {
  return `
    background:linear-gradient(180deg,#ffffff 0%,#f2f4f8 58%,#dfe4ec 100%);
    border-radius:14px;
    border:1px solid #ffffff;
    box-shadow:
      0 ${depth}px 0 #a7b0c0,
      0 ${depth + 1}px 0 #8d97a8,
      0 ${depth + 8}px ${depth + 14}px rgba(4,10,26,.55),
      inset 0 2px 0 rgba(255,255,255,.95);
    color:#1b2230;
  `;
}

/**
 * Wires a 3D press to a slate: it travels down into its own shadow on pointerdown
 * and springs back on release. `onPress` fires on release so the shake and the
 * action land together with the visual.
 */
export function makePressable(
  el: HTMLElement,
  depth: number,
  onPress: () => void,
  onShake?: (amount: number) => void
): void {
  let down = false;
  const press = () => {
    down = true;
    el.style.transform = `translateY(${depth}px)`;
    el.style.boxShadow = `
      0 1px 0 #a7b0c0,
      0 2px 0 #8d97a8,
      0 3px 8px rgba(4,10,26,.5),
      inset 0 2px 0 rgba(255,255,255,.95)`;
  };
  const release = (fire: boolean) => {
    if (!down) return;
    down = false;
    el.style.transform = "translateY(0)";
    el.style.boxShadow = "";
    el.style.cssText += slateStyle(depth);
    if (fire) {
      onShake?.(1);
      onPress();
    }
  };
  el.style.transition = "transform .06s ease-out, box-shadow .06s ease-out";
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    press();
  });
  el.addEventListener("pointerup", () => release(true));
  el.addEventListener("pointerleave", () => release(false));
  el.addEventListener("pointercancel", () => release(false));
}
