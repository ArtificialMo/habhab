import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsActivationControl, PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsShapeBox, PhysicsShapeCylinder } from "@babylonjs/core/Physics/v2/physicsShape";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import HavokPhysics from "@babylonjs/havok";
// Vite resolves this to a served URL; Havok's loader is pointed at it below.
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

import { TUNING } from "../data/tuning";

/**
 * §3.5 hook 3 — the collision layer sits behind a thin interface so the physics
 * backend can be swapped later without rewriting gameplay. Thin means thin: this
 * is the surface gameplay actually uses, not a speculative engine abstraction.
 */
export interface Contact {
  /** World-space contact position. */
  point: Vector3;
  /** Unit normal, oriented from `a` toward `b`. */
  normal: Vector3;
  /** Solver-computed impulse magnitude, for feedback scaling only. */
  solverImpulse: number;
}

export type ContactHandler = (otherBody: PhysicsBody, contact: Contact) => void;

export class PhysicsWorld {
  readonly plugin: HavokPlugin;
  private readonly scene: Scene;
  /** Physics time consumed by the last step, in ms (dev overlay, §3.4). */
  stepMs = 0;
  bodyCount = 0;

  private constructor(scene: Scene, plugin: HavokPlugin) {
    this.scene = scene;
    this.plugin = plugin;
  }

  static async create(scene: Scene): Promise<PhysicsWorld> {
    // A standalone single-file build has no server to fetch the wasm from, so it
    // inlines the binary and hands it over directly. Falls back to the normal
    // URL fetch for the dev server and any ordinary hosted build.
    const inlined = (globalThis as { __CARBOY_WASM__?: ArrayBuffer }).__CARBOY_WASM__;
    const havok = inlined
      ? await HavokPhysics({ wasmBinary: inlined })
      : await HavokPhysics({
          locateFile: (file) => {
            const path = havokWasmUrl || file;
            try {
              if (typeof window !== "undefined" && window.location?.href) {
                return new URL(path, window.location.href).href;
              }
              if (typeof document !== "undefined" && document.baseURI) {
                return new URL(path, document.baseURI).href;
              }
              return new URL(path, "http://localhost/").href;
            } catch {
              return path;
            }
          },
        });
    const plugin = new HavokPlugin(true, havok);
    scene.enablePhysics(new Vector3(0, TUNING.world.gravity, 0), plugin);

    const engine = scene.getPhysicsEngine()!;
    // Stable stepping regardless of frame rate (§3.3): the frame delta is consumed
    // by an accumulator in fixed 1/120s substeps rather than one variable step.
    engine.setSubTimeStep(TUNING.world.fixedTimeStep * 1000);

    return new PhysicsWorld(scene, plugin).init();
  }

  /**
   * Slow motion scales the time budget, not the step size (§3.3) — substeps stay
   * at 1/120s and simply fewer of them are consumed per frame, so the simulation
   * is identical either side of the transition.
   */
  setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  createVehicleBody(
    mesh: AbstractMesh,
    opts: {
      size: { l: number; w: number; h: number };
      mass: number;
      comY: number;
      restitution: number;
      friction: number;
      linearDamping: number;
      angularDamping: number;
    }
  ): PhysicsBody {
    const { l, w, h } = opts.size;
    const shape = new PhysicsShapeBox(
      Vector3.Zero(),
      Quaternion.Identity(),
      new Vector3(w, h, l),
      this.scene
    );
    shape.material = { friction: opts.friction, restitution: opts.restitution };

    const body = new PhysicsBody(mesh, PhysicsMotionType.DYNAMIC, false, this.scene);
    body.shape = shape;

    // A box's default inertia tips the car on hard hits. Widening the pitch/roll
    // terms and dropping the centre of mass keeps it upright and readable, without
    // touching how far it travels.
    // Yaw-only rotation. Zero inertia about X and Z means a car physically cannot
    // pitch or roll: it can be spun, shoved and launched, but it always lands on its
    // wheels. Visual lean is supplied by the cosmetic rig, which is where it belongs.
    //
    // This is not a stylistic choice. Drive thrust runs along the car's nose, so a
    // car tipped onto its end has a forward vector with no horizontal component —
    // thrust becomes zero and it is stuck for good, with no way to right itself.
    // Under the raised gravity that started happening on the spawn drop.
    const m = opts.mass;
    body.setMassProperties({
      mass: m,
      centerOfMass: new Vector3(0, opts.comY, 0),
      inertia: new Vector3(0, ((m / 12) * (w * w + l * l)) / m, 0),
    });
    body.setLinearDamping(opts.linearDamping);
    body.setAngularDamping(opts.angularDamping);
    body.setCollisionCallbackEnabled(true);
    // Havok deactivates bodies that come to rest, and an impulse does not wake
    // them — a parked enemy simply stopped responding to being rammed, which is
    // the "immovable without visual justification" failure in §2.7. There are only
    // a handful of vehicles, so keeping them awake costs nothing.
    this.plugin.setActivationControl(body, PhysicsActivationControl.ALWAYS_ACTIVE);
    this.bodyCount++;
    return body;
  }

  /**
   * A light dynamic prop. Real body, real contacts — crates must be shoved, rolled
   * and tipped by the solver, not animated to look like they were.
   */
  createPropBody(
    mesh: AbstractMesh,
    opts: {
      shape: "box" | "cylinder";
      size: { x: number; y: number; z: number };
      mass: number;
      friction: number;
      restitution: number;
    }
  ): PhysicsBody {
    const shape =
      opts.shape === "box"
        ? new PhysicsShapeBox(
            Vector3.Zero(),
            Quaternion.Identity(),
            new Vector3(opts.size.x, opts.size.y, opts.size.z),
            this.scene
          )
        : new PhysicsShapeCylinder(
            new Vector3(0, -opts.size.y / 2, 0),
            new Vector3(0, opts.size.y / 2, 0),
            opts.size.x / 2,
            this.scene
          );
    shape.material = { friction: opts.friction, restitution: opts.restitution };
    const body = new PhysicsBody(mesh, PhysicsMotionType.DYNAMIC, false, this.scene);
    body.shape = shape;
    body.setMassProperties({ mass: opts.mass });
    body.setLinearDamping(0.45);
    body.setAngularDamping(0.35);
    this.plugin.setActivationControl(body, PhysicsActivationControl.ALWAYS_ACTIVE);
    this.bodyCount++;
    return body;
  }

  /** Static box, used for bridge decks. */
  createStaticBox(mesh: AbstractMesh, w: number, h: number, d: number): PhysicsBody {
    const shape = new PhysicsShapeBox(
      Vector3.Zero(),
      mesh.rotationQuaternion ?? Quaternion.RotationAxis(Vector3.Up(), mesh.rotation.y),
      new Vector3(w, h, d),
      this.scene
    );
    shape.material = { friction: 0.6, restitution: 0.15 };
    const body = new PhysicsBody(mesh, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = shape;
    this.bodyCount++;
    return body;
  }

  createStaticDisc(mesh: AbstractMesh, radius: number, thickness: number): PhysicsBody {
    const shape = new PhysicsShapeCylinder(
      new Vector3(0, -thickness / 2, 0),
      new Vector3(0, thickness / 2, 0),
      radius,
      this.scene
    );
    shape.material = { friction: 0.6, restitution: 0.2 };
    const body = new PhysicsBody(mesh, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = shape;
    this.bodyCount++;
    return body;
  }

  /** Keeps the overlay's body count honest across respawns (§3.4 memory trend). */
  releaseBody(): void {
    this.bodyCount--;
  }

  onContact(body: PhysicsBody, handler: ContactHandler): void {
    body.getCollisionObservable().add((ev) => {
      if (!ev.point || !ev.normal) return;
      const other = ev.collidedAgainst as PhysicsBody | undefined;
      if (!other) return;
      handler(other, {
        point: ev.point.clone(),
        normal: ev.normal.clone(),
        solverImpulse: ev.impulse,
      });
    });
  }

  /** Ground probe used by edge prediction and support tests (§2.9). */
  raycastDown(from: Vector3, maxDistance: number): boolean {
    const to = new Vector3(from.x, from.y - maxDistance, from.z);
    const result = this.scene.getPhysicsEngine()!.raycast(from, to);
    return result.hasHit;
  }

  /**
   * Teleport for respawns and test setup. Never used for gameplay motion (§2.7).
   *
   * Note this deliberately does *not* use `setTargetTransform`: on a dynamic body
   * that asks the solver to *reach* the pose, which it does by inventing the
   * velocity needed to cover the gap in one substep — a 6 m respawn came out as
   * several hundred m/s. Pushing the transform through the pre-step is the only
   * way to actually move a dynamic body without giving it momentum.
   */
  teleport(body: PhysicsBody, position: Vector3, rotation?: Quaternion): void {
    const node = body.transformNode;
    body.disablePreStep = false;
    node.position.copyFrom(position);
    // Assign rather than mutate in place: the setter is what marks the transform
    // dirty. Mutating the existing quaternion left `mesh.forward` reading the old
    // heading, so a teleported car charged in whatever direction it used to face.
    if (rotation) node.rotationQuaternion = rotation.clone();
    node.computeWorldMatrix(true);
    body.setLinearVelocity(Vector3.Zero());
    body.setAngularVelocity(Vector3.Zero());
    this.pendingPreStep.push(body);
  }

  private readonly pendingPreStep: PhysicsBody[] = [];

  /**
   * Instantly re-aims a body about Y, keeping its position. Used for the reversal
   * pivot — steering a full 180° through the yaw controller takes most of a second
   * and reads as the car ignoring the input.
   */
  setYaw(body: PhysicsBody, yaw: number): void {
    const node = body.transformNode;
    body.disablePreStep = false;
    node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), yaw);
    node.computeWorldMatrix(true);
    // Angular velocity is dropped: leaving spin on a snapped body makes it
    // overshoot past the direction the player just asked for.
    body.setAngularVelocity(Vector3.Zero());
    this.pendingPreStep.push(body);
  }

  /**
   * Advance the simulation by hand. Babylon normally does this inside
   * `scene.render()`, which means physics stops whenever the browser stops
   * painting — no good for headless tests, and no good for slow motion either,
   * since the frame delta would not be ours to scale. Taking the step gives both.
   */
  advance(dtSeconds: number): void {
    const t0 = performance.now();
    this.rawAdvance(dtSeconds * 1000 * this.timeScale);
    this.stepMs = performance.now() - t0;

    // The teleported pose has been consumed by the pre-step; hand the body back
    // to the solver so it is not re-seeded from the mesh every frame.
    while (this.pendingPreStep.length) {
      this.pendingPreStep.pop()!.disablePreStep = true;
    }
  }

  private timeScale = 1;
  private rawAdvance: (stepMs: number) => void = () => {};

  private init(): this {
    type SteppableScene = Scene & { _advancePhysicsEngineStep(step: number): void };
    const scene = this.scene as SteppableScene;
    this.rawAdvance = scene._advancePhysicsEngineStep.bind(scene);
    // Suppress the automatic step; `advance` is now the only caller.
    scene._advancePhysicsEngineStep = () => {};
    return this;
  }
}
