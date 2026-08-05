import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";

import type { PhysicsWorld } from "../core/physics";
import { celMaterial, outline } from "../render/style";

export type PropKind = "crate" | "barrel";

interface Prop {
  kind: PropKind;
  mesh: Mesh;
  body: PhysicsBody;
  alive: boolean;
  /** Seconds until this slot respawns somewhere new. */
  respawn: number;
  /** Grace after spawning, so a prop cannot burst from its own settling bounce. */
  settle: number;
}

export interface PropsCallbacks {
  /** Fired when a prop is smashed: position, and how hard it was hit. */
  onBurst: (position: Vector3, kind: PropKind, strength: number) => void;
}

/**
 * Crates and barrels.
 *
 * Light dynamic bodies, so a car shoves and rolls them for real rather than playing
 * a canned reaction — and light enough that ploughing through one barely slows you.
 * Above a speed threshold they burst into pooled debris and pay out. They are a
 * reward on the racing line, never an obstacle in it.
 */
export class Props {
  private readonly props: Prop[] = [];
  private readonly islandRadius: number;
  private readonly keepClear: number;
  private rand: () => number;

  /** Speed a prop must reach after being struck before it breaks apart. */
  burstSpeed = 4.5;

  constructor(
    private readonly scene: Scene,
    private readonly world: PhysicsWorld,
    private readonly cb: PropsCallbacks,
    opts: { islandRadius: number; keepClearRadius: number; crates?: number; barrels?: number }
  ) {
    this.islandRadius = opts.islandRadius;
    this.keepClear = opts.keepClearRadius;
    this.rand = mulberry32(90210);

    for (let i = 0; i < (opts.crates ?? 7); i++) this.props.push(this.make("crate"));
    for (let i = 0; i < (opts.barrels ?? 5); i++) this.props.push(this.make("barrel"));
  }

  private scatterPoint(): Vector3 {
    const a = this.rand() * Math.PI * 2;
    const d = this.keepClear + this.rand() * (this.islandRadius * 0.8 - this.keepClear);
    return new Vector3(Math.cos(a) * d, 0.9, Math.sin(a) * d);
  }

  private make(kind: PropKind): Prop {
    const at = this.scatterPoint();
    let mesh: Mesh;
    let body: PhysicsBody;

    if (kind === "crate") {
      const s = 0.85;
      mesh = MeshBuilder.CreateBox("crate", { width: s, height: s, depth: s }, this.scene);
      mesh.position.copyFrom(at);
      mesh.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), this.rand() * Math.PI);
      mesh.material = celMaterial("crateMat", this.scene, new Color3(0.72, 0.5, 0.26), {
        shade: new Color3(0.4, 0.25, 0.12),
        rimStrength: 0.16,
      });
      body = this.world.createPropBody(mesh, {
        shape: "box",
        size: { x: s, y: s, z: s },
        mass: 38,
        friction: 0.5,
        restitution: 0.2,
      });
    } else {
      const r = 0.42;
      const h = 1.05;
      mesh = MeshBuilder.CreateCylinder(
        "barrel",
        { diameter: r * 2, height: h, tessellation: 10 },
        this.scene
      );
      mesh.position.copyFrom(at);
      // Laid on its side so it rolls when shoved — a standing barrel just slides.
      mesh.rotationQuaternion = Quaternion.RotationAxis(
        new Vector3(1, 0, 0),
        Math.PI / 2
      ).multiply(Quaternion.RotationAxis(Vector3.Up(), this.rand() * Math.PI));
      mesh.material = celMaterial("barrelMat", this.scene, new Color3(0.34, 0.55, 0.42), {
        shade: new Color3(0.16, 0.28, 0.22),
        rimStrength: 0.2,
      });
      body = this.world.createPropBody(mesh, {
        shape: "cylinder",
        size: { x: r * 2, y: h, z: r * 2 },
        mass: 30,
        friction: 0.22,
        restitution: 0.25,
      });
    }

    outline(mesh, 0.035);
    mesh.isPickable = false;
    return { kind, mesh, body, alive: true, respawn: 0, settle: 0.8 };
  }

  get liveCount(): number {
    let n = 0;
    for (const p of this.props) if (p.alive) n++;
    return n;
  }

  update(dt: number): void {
    for (const p of this.props) {
      if (!p.alive) {
        p.respawn -= dt;
        if (p.respawn <= 0) this.revive(p);
        continue;
      }

      if (p.settle > 0) {
        p.settle -= dt;
        continue;
      }

      const v = p.body.getLinearVelocity();
      const speed = Math.hypot(v.x, v.z);
      // Struck hard enough to break. Below this it just gets shoved and rolls,
      // which is the more common and more satisfying outcome.
      if (speed > this.burstSpeed) {
        this.burst(p, speed);
        continue;
      }

      // Knocked off the island — retire quietly, no payout.
      if (p.mesh.position.y < -4) {
        this.retire(p, 6);
      }
    }
  }

  private burst(p: Prop, speed: number): void {
    this.cb.onBurst(p.mesh.position.clone(), p.kind, speed);
    this.retire(p, 7 + Math.random() * 5);
  }

  private retire(p: Prop, delay: number): void {
    p.alive = false;
    p.respawn = delay;
    p.mesh.setEnabled(false);
    // Parked far below and frozen, so a retired body cannot interact with anything.
    this.world.teleport(p.body, new Vector3(0, -200, 0));
  }

  private revive(p: Prop): void {
    const at = this.scatterPoint();
    this.world.teleport(p.body, at);
    p.mesh.setEnabled(true);
    p.alive = true;
    p.settle = 0.8;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
