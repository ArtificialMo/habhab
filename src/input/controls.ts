import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * One-finger input (§2.6): drag anywhere in the play area to steer, hold the
 * arcade button to charge. Two pointers are tracked independently so steering
 * during a charge works on touch.
 *
 * The camera looks down +Z, so screen-space maps straight onto the ground plane:
 * screen right → +X, screen up → +Z. No projection needed, and the mapping stays
 * true while the camera pans.
 */
export class Controls {
  /** Unit direction of the current drag, or null when not steering. */
  readonly steerDir = new Vector3(0, 0, 0);
  steering = false;
  /** 0..1, how far past the deadzone the drag has travelled. */
  steerAmount = 0;

  charging = false;
  /** 0..1 charge level, driven by Player. */
  chargeLevel = 0;
  /** True on the frame the button is released. */
  released = false;

  /**
   * Aim direction set by dragging *from the ram button*. On a touchscreen you have
   * a second thumb to steer with; on a mouse you have one cursor, and it is already
   * held down on the button — so the button itself has to double as the aim stick.
   */
  readonly aimDir = new Vector3(0, 0, 1);
  aiming = false;

  private steerPointer: number | null = null;
  private chargePointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private aimOriginX = 0;
  private aimOriginY = 0;

  private readonly deadzone = 10;
  private readonly fullRadius = 70;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly button: HTMLElement
  ) {
    const opts = { passive: false } as const;
    canvas.addEventListener("pointerdown", this.onDown, opts);
    canvas.addEventListener("pointermove", this.onMove, opts);
    canvas.addEventListener("pointerup", this.onUp, opts);
    canvas.addEventListener("pointercancel", this.onUp, opts);

    button.addEventListener("pointerdown", this.onButtonDown, opts);
    // Move and up are bound on the window, not the button: once the pointer is
    // captured and dragged the cursor leaves the button immediately, and a
    // button-scoped listener would stop firing exactly when aiming begins.
    window.addEventListener("pointermove", this.onAimMove, opts);
    window.addEventListener("pointerup", this.onButtonUp, opts);
    window.addEventListener("pointercancel", this.onButtonUp, opts);

    // Desktop parity so the gate can be evaluated with a keyboard too.
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
  }

  private readonly keys = new Set<string>();

  private readonly onKey = (e: KeyboardEvent) => {
    const down = e.type === "keydown";
    if (e.code === "Space") {
      e.preventDefault();
      if (down && !this.charging) this.charging = true;
      else if (!down && this.charging) {
        this.charging = false;
        this.released = true;
      }
      return;
    }
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  private readonly onDown = (e: PointerEvent) => {
    if (this.steerPointer !== null) return;
    e.preventDefault();
    this.steerPointer = e.pointerId;
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.steering = true;
    this.steerAmount = 0;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.steerPointer) return;
    e.preventDefault();
    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    const len = Math.hypot(dx, dy);
    if (len <= this.deadzone) {
      this.steerAmount = 0;
      return;
    }
    this.steerAmount = Math.min(1, (len - this.deadzone) / (this.fullRadius - this.deadzone));
    this.steerDir.set(dx / len, 0, -dy / len);
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.steerPointer) return;
    this.steerPointer = null;
    this.steering = false;
    this.steerAmount = 0;
  };

  private readonly onButtonDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.chargePointer !== null) return;
    this.chargePointer = e.pointerId;
    this.charging = true;
    this.aiming = false;
    this.aimOriginX = e.clientX;
    this.aimOriginY = e.clientY;
    this.button.setPointerCapture?.(e.pointerId);
  };

  /** Dragging away from the button aims the car. */
  private readonly onAimMove = (e: PointerEvent) => {
    if (e.pointerId !== this.chargePointer) return;
    const dx = e.clientX - this.aimOriginX;
    const dy = e.clientY - this.aimOriginY;
    const len = Math.hypot(dx, dy);
    if (len < 12) return;
    // Same screen→ground mapping as steering: right is +X, up is +Z.
    this.aimDir.set(dx / len, 0, -dy / len);
    this.aiming = true;
  };

  private readonly onButtonUp = (e: PointerEvent) => {
    if (e.pointerId !== this.chargePointer) return;
    e.preventDefault();
    this.chargePointer = null;
    this.aiming = false;
    if (this.charging) {
      this.charging = false;
      this.released = true;
    }
  };

  /** Called by Player when a charge is cancelled by a hit. */
  cancelCharge(): void {
    this.charging = false;
    this.aiming = false;
    this.chargePointer = null;
  }

  /** Keyboard steering, folded in so WASD behaves like a drag. */
  pollKeyboard(): void {
    if (this.steering) return;
    let x = 0;
    let z = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) z += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) z -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (x === 0 && z === 0) {
      this.steerAmount = 0;
      return;
    }
    const len = Math.hypot(x, z);
    this.steerDir.set(x / len, 0, z / len);
    this.steerAmount = 1;
  }

  /** Called once per frame after the player has consumed input. */
  endFrame(): void {
    this.released = false;
    this.button.style.setProperty("--charge", String(this.chargeLevel));
  }
}
