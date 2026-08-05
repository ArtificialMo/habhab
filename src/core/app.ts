import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/groundBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Rendering/outlineRenderer";

import { TUNING } from "../data/tuning";

/** Presentation-layer bootstrap (§3.2). */
export class App {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: FreeCamera;

  private readonly camTarget = new Vector3(0, 0, 0);
  private readonly lead = new Vector3(0, 0, 0);

  private shake = 0;
  private shakePhase = 0;
  private readonly shakeDir = { x: 1, z: 0.6 };
  private zoom = 0;
  private hitStop = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(
      canvas,
      true,
      { preserveDrawingBuffer: true, stencil: true, alpha: true },
      true
    );
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new Scene(this.engine);
    // Cleared transparent so the CSS sky gradient behind the canvas shows through.
    // A flat clear colour was reading as coloured paper behind the island.
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.ambientColor = new Color3(0.5, 0.5, 0.55);
    // The cel shader lights itself from a fixed sun; this only serves the few
    // StandardMaterials left (foam, rings, comic text).
    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.95;
    hemi.groundColor = new Color3(0.4, 0.42, 0.5);

    this.camera = new FreeCamera("cam", new Vector3(0, TUNING.camera.height, -TUNING.camera.distance), this.scene);
    this.camera.fov = TUNING.camera.fov;
    this.camera.minZ = 1;
    this.camera.maxZ = 700;
    this.camera.setTarget(Vector3.Zero());

    window.addEventListener("resize", () => this.engine.resize());
  }

  /**
   * Hit-stop (§2.8). Returns the factor gameplay time should be scaled by this
   * frame — a brief near-freeze at the moment of contact, which is what makes an
   * impact feel like it had mass rather than like a position change.
   */
  consumeTimeScale(dt: number): number {
    if (this.hitStop <= 0) return 1;
    this.hitStop = Math.max(0, this.hitStop - dt);
    return 0.06;
  }

  /**
   * Overrides the framing during the edge-suspense shot: the camera drifts to the
   * endangered car and pulls in. Blended by `weight` so entry and exit are smooth.
   */
  setDramaFocus(point: Vector3 | null, weight: number): void {
    this.dramaWeight = weight;
    if (point) this.dramaPoint.copyFrom(point);
  }

  private readonly dramaPoint = new Vector3();
  private dramaWeight = 0;

  /** Camera follows the player with lag, leading slightly toward their heading. */
  updateCamera(target: Vector3, heading: Vector3, dt: number): void {
    const c = TUNING.camera;
    const k = 1 - Math.exp(-c.follow * dt);

    // Look a little ahead of the car, so you can see what you are about to hit.
    const leadK = 1 - Math.exp(-2.5 * dt);
    this.lead.x += (heading.x * c.lead - this.lead.x) * leadK;
    this.lead.z += (heading.z * c.lead - this.lead.z) * leadK;

    const limit = TUNING.world.islandRadius * 0.75;
    let cx = clamp(target.x + this.lead.x, -limit, limit);
    let cz = clamp(target.z + this.lead.z, -limit, limit);
    if (this.dramaWeight > 0.001) {
      // Frame between the player and the car on the brink, biased toward the brink.
      const w = this.dramaWeight;
      cx = cx * (1 - w) + clamp(this.dramaPoint.x, -limit, limit) * w;
      cz = cz * (1 - w) + clamp(this.dramaPoint.z, -limit, limit) * w;
    }
    this.camTarget.x += (cx - this.camTarget.x) * k;
    this.camTarget.z += (cz - this.camTarget.z) * k;

    // Decaying oscillation rather than per-frame noise: random jitter reads as a
    // broken camera, a damped shake reads as a blow.
    let jx = 0;
    let jy = 0;
    if (this.shake > 0.0005) {
      this.shakePhase += dt * c.shakeFrequency * Math.PI * 2;
      const env = this.shake;
      jx = Math.sin(this.shakePhase) * env * this.shakeDir.x;
      jy = Math.sin(this.shakePhase * 1.37 + 0.8) * env * this.shakeDir.z;
      this.shake = Math.max(0, this.shake - c.shakeDecay * dt * this.shake - 0.0008);
    } else {
      this.shake = 0;
    }

    if (this.zoom > 0.0001) this.zoom = Math.max(0, this.zoom - c.zoomRecover * dt * this.zoom - 0.0002);
    this.camera.fov = c.fov - this.zoom;

    // Pull in during the drama shot so the moment fills the frame.
    const pull = 1 - TUNING.drama.zoom * this.dramaWeight;
    this.camera.position.set(
      this.camTarget.x + jx,
      TUNING.camera.height * pull + jy,
      this.camTarget.z - TUNING.camera.distance * pull
    );
    this.camera.setTarget(new Vector3(this.camTarget.x + jx * 0.35, 0, this.camTarget.z));
  }

  /** §2.8 — every hit moves the screen. `strength` is the Δv delivered. */
  addImpact(strength: number): void {
    const c = TUNING.camera;
    if (c.shakeEnabled) {
      const amount = Math.min(c.shakeMax, Math.max(c.shakeMin, strength * c.shakePerDeltaV));
      if (amount > this.shake) {
        // New direction per hit, so consecutive hits do not cancel each other out.
        const a = Math.random() * Math.PI * 2;
        this.shakeDir.x = Math.cos(a);
        this.shakeDir.z = Math.sin(a);
        this.shakePhase = 0;
      }
      this.shake = Math.min(c.shakeMax, this.shake + amount);
    }
    if (c.hitStopEnabled) {
      this.hitStop = Math.max(this.hitStop, Math.min(c.hitStopMax, strength * c.hitStopPerDeltaV));
    }
    this.zoom = Math.min(c.zoomMax, this.zoom + strength * c.zoomPerDeltaV);
  }

  /** Continuous low-level tremble, used while a charge winds up. */
  setTremble(amount: number, dt: number): void {
    if (!TUNING.camera.shakeEnabled || amount <= 0) return;
    this.shakePhase += dt * TUNING.camera.shakeFrequency * Math.PI * 2;
    this.shake = Math.max(this.shake, amount);
  }

  run(update: (dt: number) => void): void {
    this.engine.runRenderLoop(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
      update(dt);
      this.scene.render();
    });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
