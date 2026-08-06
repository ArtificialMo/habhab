import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { DepthOfFieldEffectBlurLevel } from "@babylonjs/core/PostProcesses/depthOfFieldEffect";
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
  private readonly cameraLook = new Vector3(0, 0, 0);
  private readonly renderingPipeline: DefaultRenderingPipeline | null;

  private shake = 0;
  private shakePhase = 0;
  private readonly shakeDir = { x: 1, z: 0.6 };
  private zoom = 0;
  private hitStop = 0;
  private impactSlow = 0;
  private impactSlowScale = 1;
  private titleClock = 0;

  constructor(canvas: HTMLCanvasElement) {
    const sharedArtifact = Boolean((globalThis as { __CARBOY_SHARE__?: boolean }).__CARBOY_SHARE__);
    const touchDevice =
      navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
    this.engine = new Engine(
      canvas,
      true,
      { preserveDrawingBuffer: !sharedArtifact, stencil: true, alpha: true },
      true
    );
    const maxPixelRatio = touchDevice ? 1.25 : 2;
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    this.engine.resize();
    this.scene = new Scene(this.engine);
    // Use opaque sky blue clearColor to ensure 3D scene renders reliably across all post-processing pipelines.
    this.scene.clearColor = new Color4(0.12, 0.42, 0.78, 1);
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

    // A restrained focus pass keeps the platform and Car Boy crisp while the
    // high clouds, sea and distant isles fall gently out of focus. Low blur keeps
    // the cel silhouettes readable on mobile and lets the depth cue feel cinematic
    // rather than like a smeared post-process.
    if (!sharedArtifact && !touchDevice) {
      const pipeline = new DefaultRenderingPipeline("carboyDepth", false, this.scene, [this.camera]);
      pipeline.fxaaEnabled = true;
      pipeline.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Low;
      pipeline.depthOfField.focalLength = 32;
      pipeline.depthOfField.fStop = 7;
      pipeline.depthOfField.lensSize = 34;
      pipeline.depthOfField.focusDistance = Math.hypot(TUNING.camera.height, TUNING.camera.distance) * 1000;
      pipeline.depthOfFieldEnabled = this.engine.getCaps().depthTextureExtension;
      this.renderingPipeline = pipeline;
    } else {
      this.renderingPipeline = null;
    }

    window.addEventListener("resize", () => this.engine.resize());
  }

  /**
   * Hit-stop (§2.8). Returns the factor gameplay time should be scaled by this
   * frame — a brief near-freeze at the moment of contact, which is what makes an
   * impact feel like it had mass rather than like a position change.
   */
  consumeTimeScale(dt: number): number {
    this.impactSlow = Math.max(0, this.impactSlow - dt);
    if (this.impactSlow <= 0) this.impactSlowScale = 1;

    let scale = this.impactSlow > 0 ? this.impactSlowScale : 1;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      scale = Math.min(scale, 0.06);
    }
    return scale;
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

  /** Wider, gently drifting title framing. Gameplay uses updateCamera below. */
  updateTitleCamera(dt: number): void {
    const c = TUNING.camera;
    this.titleClock += dt;
    const k = 1 - Math.exp(-1.8 * dt);
    const targetX = 4 + Math.sin(this.titleClock * 0.22) * 2.4;
    const targetZ = 8 + Math.cos(this.titleClock * 0.17) * 1.8;
    this.camTarget.x += (targetX - this.camTarget.x) * k;
    this.camTarget.z += (targetZ - this.camTarget.z) * k;

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

    const distance = c.distance * 1.82;
    const height = c.height * 1.82;
    this.camera.fov = c.fov + 0.1 - this.zoom;
    this.camera.position.set(this.camTarget.x + jx, height + jy, this.camTarget.z - distance);
    if (this.renderingPipeline) {
      this.renderingPipeline.depthOfField.focusDistance = Math.max(
        48000,
        Math.hypot(this.camera.position.x - this.camTarget.x, this.camera.position.y, this.camera.position.z - this.camTarget.z) * 1000
      );
    }
    this.cameraLook.set(this.camTarget.x + jx * 0.35, 0, this.camTarget.z);
    this.camera.setTarget(this.cameraLook);
  }

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
    if (this.renderingPipeline) {
      this.renderingPipeline.depthOfField.focusDistance = Math.max(
        38000,
        Math.hypot(this.camera.position.x - this.camTarget.x, this.camera.position.y, this.camera.position.z - this.camTarget.z) * 1000
      );
    }
    this.cameraLook.set(this.camTarget.x + jx * 0.35, 0, this.camTarget.z);
    this.camera.setTarget(this.cameraLook);
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

  /** A rear hit gets a readable, cinematic time pull in addition to ordinary hit-stop. */
  triggerRearHit(): void {
    const c = TUNING.camera;
    this.impactSlow = Math.max(this.impactSlow, c.rearHitSlowDuration);
    this.impactSlowScale = Math.min(this.impactSlowScale, c.rearHitSlowScale);
    this.zoom = Math.min(c.zoomMax, Math.max(this.zoom, c.rearHitZoom));
  }

  /** Continuous low-level tremble, used while a charge winds up. */
  setTremble(amount: number, dt: number): void {
    if (!TUNING.camera.shakeEnabled || amount <= 0) return;
    this.shakePhase += dt * TUNING.camera.shakeFrequency * Math.PI * 2;
    this.shake = Math.max(this.shake, amount);
  }

  /** A restrained FOV pull that builds with the ram charge and releases naturally. */
  setChargeZoom(amount: number): void {
    if (amount <= 0) return;
    this.zoom = Math.min(TUNING.camera.zoomMax, Math.max(this.zoom, amount));
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
