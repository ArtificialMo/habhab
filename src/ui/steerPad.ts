/**
 * A temporary virtual stick for drag steering.
 *
 * It is deliberately an overlay rather than a permanent HUD control: the base
 * appears exactly where the pointer or finger lands, the knob follows the drag,
 * and the whole thing disappears as soon as the pointer is released.
 */
export class SteerPad {
  private readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly frame: HTMLElement;
  private startX = 0;
  private startY = 0;

  constructor(frame: HTMLElement) {
    this.frame = frame;
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:absolute;inset:0;z-index:3;pointer-events:none;display:none;";

    this.base = document.createElement("div");
    this.base.style.cssText = [
      "position:absolute",
      "width:124px",
      "height:124px",
      "margin-left:-62px",
      "margin-top:-62px",
      "border:3px solid rgba(255,255,255,.74)",
      "border-radius:50%",
      "background:radial-gradient(circle,rgba(255,210,63,.16) 0 25%,transparent 26%),conic-gradient(from -22.5deg,rgba(255,255,255,.55) 0 4deg,transparent 4deg 40deg),rgba(9,22,43,.22)",
      "box-shadow:0 0 0 8px rgba(255,255,255,.12),0 0 24px rgba(255,210,63,.3),inset 0 0 20px rgba(0,0,0,.24)",
      "transform:translateZ(0)",
    ].join(";");

    this.knob = document.createElement("div");
    this.knob.style.cssText = [
      "position:absolute",
      "left:50%",
      "top:50%",
      "width:42px",
      "height:42px",
      "margin-left:-21px",
      "margin-top:-21px",
      "border:3px solid #fff6d5",
      "border-radius:50%",
      "background:radial-gradient(circle at 35% 28%,#ffe98a,#ffc52f 58%,#d68a00)",
      "box-shadow:0 3px 0 rgba(122,67,0,.55),0 0 16px rgba(255,210,63,.85)",
      "transition:transform .04s linear",
    ].join(";");

    const label = document.createElement("div");
    label.textContent = "DRAG";
    label.style.cssText =
      "position:absolute;left:50%;bottom:-25px;transform:translateX(-50%);color:#fff6d5;text-shadow:0 2px 4px rgba(0,0,0,.65);font:800 10px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.16em;";

    this.base.append(this.knob, label);
    this.root.append(this.base);
    frame.append(this.root);
  }

  show(clientX: number, clientY: number): void {
    this.startX = clientX;
    this.startY = clientY;
    this.root.style.display = "block";
    this.move(clientX, clientY);
  }

  move(clientX: number, clientY: number): void {
    if (this.root.style.display !== "block") return;
    const rect = this.frame.getBoundingClientRect();
    this.base.style.left = String(this.startX - rect.left) + "px";
    this.base.style.top = String(this.startY - rect.top) + "px";

    const dx = clientX - this.startX;
    const dy = clientY - this.startY;
    const length = Math.hypot(dx, dy);
    const max = 43;
    const scale = length > max ? max / length : 1;
    this.knob.style.transform =
      "translate(" + String(dx * scale) + "px," + String(dy * scale) + "px)";
  }

  hide(): void {
    this.root.style.display = "none";
    this.knob.style.transform = "translate(0,0)";
  }
}
