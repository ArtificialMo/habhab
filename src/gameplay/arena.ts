import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { TUNING } from "../data/tuning";
import type { PhysicsWorld } from "../core/physics";
import type { Vehicle } from "./vehicle";
import {
  type Archipelago,
  bridgeSpan,
  buildArchipelago,
  groundMargin,
} from "../world/archipelago";

/**
 * The playable ground: a main arena, outlying isles, and the bridges between them.
 *
 * Colliders only — the visible geometry is built by `Environment` from the same
 * layout, so the edge you can see is exactly the edge you fall off.
 */
export class Arena {
  readonly radius = TUNING.world.islandRadius;
  readonly world: Archipelago;

  constructor(scene: Scene, world: PhysicsWorld) {
    this.world = buildArchipelago(this.radius);

    const thickness = 2;
    for (const [i, isle] of this.world.islands.entries()) {
      const disc = MeshBuilder.CreateCylinder(
        `islandCollider${i}`,
        { diameter: isle.radius * 2, height: thickness, tessellation: 40 },
        scene
      );
      disc.position.set(isle.x, TUNING.world.islandTop - thickness / 2, isle.z);
      disc.isVisible = false;
      disc.isPickable = false;
      world.createStaticDisc(disc, isle.radius, thickness);
    }

    // Bridge decks. Their top face sits at exactly the island top, so crossing one
    // is seamless — a lip at either end would bounce a car at speed.
    for (const [i, b] of this.world.bridges.entries()) {
      const span = bridgeSpan(this.world.islands[b.from], this.world.islands[b.to]);
      const deck = MeshBuilder.CreateBox(
        `bridgeCollider${i}`,
        { width: b.width, height: thickness, depth: span.length },
        scene
      );
      deck.position.set(
        (span.x1 + span.x2) / 2,
        TUNING.world.islandTop - thickness / 2,
        (span.z1 + span.z2) / 2
      );
      deck.rotation.y = span.angle;
      deck.isVisible = false;
      deck.isPickable = false;
      world.createStaticBox(deck, b.width, thickness, span.length);
    }
  }

  /**
   * Fall confirmation (§2.9): committed only once the car is below the deck
   * entirely. With several islands and bridges in play there is no single radius to
   * test against, and height alone is unambiguous — nothing solid exists down there.
   */
  hasFallen(vehicle: Vehicle): boolean {
    return vehicle.position.y < TUNING.world.knockoutY;
  }

  /** 1 = fully over ground, 0 = fully out over the water. Drives edge prediction. */
  supportFraction(vehicle: Vehicle): number {
    const p = vehicle.position;
    const half = Math.max(vehicle.config.size.l, vehicle.config.size.w) / 2;
    const margin = groundMargin(this.world, p.x, p.z);
    return Math.min(1, Math.max(0, (margin + half) / (half * 2)));
  }

  /** Metres of solid ground beyond this point; negative means out over water. */
  marginAt(x: number, z: number): number {
    return groundMargin(this.world, x, z);
  }

  spawnPointOnRim(angle: number, inset = 3): Vector3 {
    const r = this.radius - inset;
    return new Vector3(Math.cos(angle) * r, 1.2, Math.sin(angle) * r);
  }
}
