import { TUNING } from "../data/tuning";

interface SliderSpec {
  label: string;
  get: () => number;
  set: (v: number) => void;
  min: number;
  max: number;
  step: number;
}

/**
 * Development overlay (§3.4) plus live tuning. Game feel is found by iteration and
 * iteration speed is a design constraint (§3.2), so the collision numbers that
 * decide the gate are adjustable without a reload.
 */
export class DevOverlay {
  private readonly stats: HTMLElement;
  private readonly panel: HTMLElement;
  private frames = 0;
  private acc = 0;
  private fps = 0;

  knockouts = 0;
  lastHit = "—";
  extra = "";
  /** Set by main so mass sliders can re-apply to bodies that already exist. */
  onMassChanged: ((who: "player" | "enemy", mass: number) => void) | null = null;

  private setMass(who: "player" | "enemy", mass: number): void {
    if (who === "player") TUNING.player.mass = mass;
    else TUNING.enemy.mass = mass;
    this.onMassChanged?.(who, mass);
  }

  private section(title: string): void {
    const h = document.createElement("div");
    h.textContent = title;
    h.style.cssText =
      "margin:8px 0 3px;padding-top:5px;border-top:1px solid #44474d;color:#9fe6b0;letter-spacing:.08em;";
    this.panel.appendChild(h);
  }

  /** Standalone/shared builds hide developer UI entirely. */
  private readonly shared = !!(globalThis as { __CARBOY_SHARE__?: boolean }).__CARBOY_SHARE__;

  constructor(root: HTMLElement) {
    const host = document.createElement("div");
    host.style.cssText = `position:absolute;top:0;left:0;right:0;padding:6px 8px;color:#cfd3d8;
      font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;pointer-events:none;z-index:5;`;
    this.stats = document.createElement("pre");
    this.stats.style.cssText = "margin:0;white-space:pre;text-shadow:0 1px 2px #000;";
    host.appendChild(this.stats);
    if (!this.shared) root.appendChild(host);

    this.panel = document.createElement("div");
    this.panel.style.cssText = `position:absolute;left:0;bottom:0;width:100%;max-height:46%;overflow:auto;
      background:rgba(16,17,19,.86);color:#cfd3d8;font:10px/1.3 ui-monospace,Menlo,Consolas,monospace;
      padding:6px 8px 10px;z-index:6;display:none;box-sizing:border-box;`;
    root.appendChild(this.panel);

    const toggle = document.createElement("button");
    toggle.textContent = "tune";
    toggle.style.cssText = `position:absolute;top:6px;right:8px;z-index:7;background:#3a3d42;color:#e6e8ea;
      border:1px solid #55585e;border-radius:4px;font:10px ui-monospace,monospace;padding:4px 8px;`;
    toggle.onclick = () => {
      this.panel.style.display = this.panel.style.display === "none" ? "block" : "none";
    };
    if (!this.shared) root.appendChild(toggle);

    const c = TUNING.collision;
    const ch = TUNING.charge;
    this.build([
      { label: "transferRatio", get: () => c.transferRatio, set: (v) => (c.transferRatio = v), min: 0.1, max: 1.2, step: 0.01 },
      { label: "deltaVMin", get: () => c.deltaVMin, set: (v) => (c.deltaVMin = v), min: 0, max: 20, step: 0.5 },
      { label: "deltaVMax", get: () => c.deltaVMax, set: (v) => (c.deltaVMax = v), min: 5, max: 45, step: 0.5 },
      { label: "attackMult", get: () => c.attackMultiplier, set: (v) => (c.attackMultiplier = v), min: 1, max: 4, step: 0.05 },
      { label: "chargeScale", get: () => c.chargeScaling, set: (v) => (c.chargeScaling = v), min: 0, max: 2, step: 0.05 },
      { label: "gasTankMult", get: () => c.gasTankMultiplier, set: (v) => (c.gasTankMultiplier = v), min: 1, max: 6, step: 0.1 },
      { label: "gasTankCone", get: () => c.gasTankDot, set: (v) => (c.gasTankDot = v), min: 0.5, max: 0.99, step: 0.01 },
      { label: "rearMult", get: () => c.rearMultiplier, set: (v) => (c.rearMultiplier = v), min: 1, max: 3, step: 0.05 },
      { label: "playerRecoil", get: () => c.playerRecoilFactor, set: (v) => (c.playerRecoilFactor = v), min: 0, max: 1, step: 0.01 },
      { label: "recoilLock", get: () => c.recoilLock, set: (v) => (c.recoilLock = v), min: 0, max: 0.5, step: 0.01 },
      { label: "recoilRecover", get: () => c.recoilRecover, set: (v) => (c.recoilRecover = v), min: 0, max: 1, step: 0.01 },
      { label: "chargeMaxImp", get: () => ch.impulseMax, set: (v) => (ch.impulseMax = v), min: 3000, max: 20000, step: 100 },
      { label: "chargeTime", get: () => ch.timeToFull, set: (v) => (ch.timeToFull = v), min: 0.2, max: 2, step: 0.05 },
      { label: "playerMaxSpeed", get: () => TUNING.player.maxSpeed, set: (v) => (TUNING.player.maxSpeed = v), min: 4, max: 20, step: 0.5 },
      { label: "enemyDamping", get: () => TUNING.enemy.linearDamping, set: (v) => (TUNING.enemy.linearDamping = v), min: 0, max: 2, step: 0.05 },
      { label: "shake", get: () => TUNING.camera.shakePerDeltaV, set: (v) => (TUNING.camera.shakePerDeltaV = v), min: 0, max: 0.12, step: 0.002 },
      { label: "hitStop", get: () => TUNING.camera.hitStopPerDeltaV, set: (v) => (TUNING.camera.hitStopPerDeltaV = v), min: 0, max: 0.01, step: 0.0002 },
      { label: "chargeShake", get: () => TUNING.chargeFeel.vibrationAmplitude, set: (v) => (TUNING.chargeFeel.vibrationAmplitude = v), min: 0, max: 0.2, step: 0.005 },
      { label: "touchSeparate", get: () => c.touchSeparation, set: (v) => (c.touchSeparation = v), min: 0, max: 10, step: 0.1 },
      { label: "enemyRecoil", get: () => c.enemyRecoilFactor, set: (v) => (c.enemyRecoilFactor = v), min: 0, max: 1, step: 0.01 },
    ]);

    // Per-car handling. Mass is live-editable because the whole feel of a hit is
    // the mass ratio, and that is the first thing you want to try moving.
    const pl = TUNING.player;
    const en = TUNING.enemy;
    this.section("player");
    this.build([
      { label: "mass", get: () => pl.mass, set: (v) => this.setMass("player", v), min: 150, max: 2000, step: 10 },
      { label: "maxSpeed", get: () => pl.maxSpeed, set: (v) => (pl.maxSpeed = v), min: 4, max: 24, step: 0.5 },
      { label: "accel", get: () => pl.accel, set: (v) => (pl.accel = v), min: 5, max: 60, step: 1 },
      { label: "steerRate", get: () => pl.steerRate, set: (v) => (pl.steerRate = v), min: 1, max: 20, step: 0.5 },
      { label: "snapAngle°", get: () => pl.snapYawThreshold * 57.3, set: (v) => (pl.snapYawThreshold = v / 57.3), min: 60, max: 180, step: 5 },
      { label: "damping", get: () => pl.linearDamping, set: (v) => (pl.linearDamping = v), min: 0, max: 2, step: 0.05 },
      { label: "friction", get: () => pl.friction, set: (v) => (pl.friction = v), min: 0, max: 1.5, step: 0.02 },
      { label: "grip", get: () => pl.grip, set: (v) => (pl.grip = v), min: 0, max: 14, step: 0.2 },
    ]);
    this.section("enemy");
    this.build([
      { label: "mass", get: () => en.mass, set: (v) => this.setMass("enemy", v), min: 150, max: 3000, step: 10 },
      { label: "maxSpeed", get: () => en.maxSpeed, set: (v) => (en.maxSpeed = v), min: 0, max: 20, step: 0.5 },
      { label: "accel", get: () => en.accel, set: (v) => (en.accel = v), min: 0, max: 60, step: 1 },
      { label: "steerRate", get: () => en.steerRate, set: (v) => (en.steerRate = v), min: 0.5, max: 20, step: 0.5 },
      { label: "damping", get: () => en.linearDamping, set: (v) => (en.linearDamping = v), min: 0, max: 3, step: 0.05 },
      { label: "friction", get: () => en.friction, set: (v) => (en.friction = v), min: 0, max: 1.5, step: 0.02 },
      { label: "grip", get: () => en.grip, set: (v) => (en.grip = v), min: 0, max: 14, step: 0.2 },
      { label: "edgeFear", get: () => en.edgeFear, set: (v) => (en.edgeFear = v), min: 0, max: 12, step: 0.5 },
      { label: "aggression", get: () => en.aggression, set: (v) => (en.aggression = v), min: 0, max: 2, step: 0.05 },
      { label: "standoff", get: () => en.attackStandoff, set: (v) => (en.attackStandoff = v), min: 0, max: 14, step: 0.5 },
      { label: "trackRange", get: () => en.trackRange, set: (v) => (en.trackRange = v), min: 2, max: 25, step: 0.5 },
      { label: "commitTime", get: () => en.commitTime, set: (v) => (en.commitTime = v), min: 0, max: 4, step: 0.1 },
      { label: "commitTrack", get: () => en.commitTrack, set: (v) => (en.commitTrack = v), min: 0, max: 4, step: 0.05 },
      { label: "lungeImpulse", get: () => en.lungeImpulse, set: (v) => (en.lungeImpulse = v), min: 0, max: 20, step: 0.5 },
      { label: "lungeCooldown", get: () => en.lungeCooldown, set: (v) => (en.lungeCooldown = v), min: 0.3, max: 6, step: 0.1 },
    ]);

    // §0.2 wants the bounce judged with no screen feedback at all. One switch
    // strips every layer added after the gate, so that judgement stays available.
    this.buildToggles([
      {
        label: "raw bounce (no juice)",
        get: () => !TUNING.camera.shakeEnabled,
        set: (on) => {
          TUNING.camera.shakeEnabled = !on;
          TUNING.camera.hitStopEnabled = !on;
        },
      },
    ]);
  }

  private buildToggles(specs: { label: string; get: () => boolean; set: (v: boolean) => void }[]): void {
    for (const s of specs) {
      const row = document.createElement("label");
      row.style.cssText = "display:flex;align-items:center;gap:6px;margin:6px 0 2px;";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = s.get();
      box.onchange = () => s.set(box.checked);
      const name = document.createElement("span");
      name.textContent = s.label;
      row.append(box, name);
      this.panel.appendChild(row);
    }
  }

  private build(specs: SliderSpec[]): void {
    for (const s of specs) {
      const row = document.createElement("label");
      row.style.cssText = "display:flex;align-items:center;gap:6px;margin:2px 0;";
      const name = document.createElement("span");
      name.textContent = s.label;
      name.style.cssText = "width:96px;flex:none;";
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.value = String(s.get());
      input.style.cssText = "flex:1;min-width:0;";
      const out = document.createElement("span");
      out.textContent = String(s.get());
      out.style.cssText = "width:52px;flex:none;text-align:right;";
      input.oninput = () => {
        const v = Number(input.value);
        s.set(v);
        out.textContent = String(v);
      };
      row.append(name, input, out);
      this.panel.appendChild(row);
    }
  }

  update(dt: number, info: { stepMs: number; bodies: number; state: string }): void {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
    }
    this.stats.textContent =
      `fps ${this.fps.toFixed(0)}  frame ${(dt * 1000).toFixed(1)}ms  physics ${info.stepMs.toFixed(2)}ms\n` +
      `bodies ${info.bodies}  state ${info.state}  knockouts ${this.knockouts}\n` +
      `hit ${this.lastHit}${this.extra ? `\n${this.extra}` : ""}`;
  }
}
