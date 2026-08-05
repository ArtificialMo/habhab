import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import type { Arena } from "../gameplay/arena";
import type { Combat } from "../gameplay/combat";
import type { Controls } from "../input/controls";
import type { Enemy } from "../gameplay/enemy";
import type { Grass } from "../render/grass";
import type { PhysicsWorld } from "../core/physics";
import type { Player } from "../gameplay/player";

export interface PoseDeps {
  scene: Scene;
  world: PhysicsWorld;
  arena: Arena;
  player: Player;
  enemies: Enemy[];
  combat: Combat;
  controls: Controls;
  grass: Grass;
  step: (dt: number) => void;
  render: () => void;
}

export type PoseName = "approach" | "charge" | "impact" | "edge" | "wide";

const FACE_POS_Z = Quaternion.Identity();

/**
 * Canonical, deterministic camera/actor setups for screenshot comparison.
 *
 * Round-to-round visual judgement is worthless if the two frames are not the same
 * scene. These pose the world identically every time so a change can be attributed
 * to the change rather than to where the cars happened to be.
 */
export function pose(d: PoseDeps, name: PoseName): void {
  const tick = () => {
    d.step(1 / 60);
    d.render();
  };
  d.controls.steering = true;
  d.controls.charging = false;
  d.controls.steerAmount = 0;

  // Always stage around the same grass patch so terrain is in frame.
  const patch = d.grass.patches.slice().sort((a, b) => b.radius - a.radius)[0];
  const px = patch.x;
  const pz = patch.z;

  switch (name) {
    case "wide": {
      d.world.teleport(d.player.vehicle.body, new Vector3(0, 0.5, -3), FACE_POS_Z);
      if (d.enemies[0]) d.world.teleport(d.enemies[0].vehicle.body, new Vector3(4.5, 0.75, 4.5), FACE_POS_Z);
      for (let i = 0; i < 45; i++) tick();
      break;
    }
    case "approach": {
      d.world.teleport(d.player.vehicle.body, new Vector3(px - 3.2, 0.5, pz - 3.2), FACE_POS_Z);
      if (d.enemies[0]) d.world.teleport(d.enemies[0].vehicle.body, new Vector3(px + 3.4, 0.75, pz + 2.4), FACE_POS_Z);
      d.controls.steerDir.set(0.707, 0, 0.707);
      d.controls.steerAmount = 1;
      for (let i = 0; i < 28; i++) tick();
      break;
    }
    case "charge": {
      d.world.teleport(d.player.vehicle.body, new Vector3(px - 2.4, 0.5, pz - 2.4), FACE_POS_Z);
      if (d.enemies[0]) d.world.teleport(d.enemies[0].vehicle.body, new Vector3(px + 3.6, 0.75, pz + 2.2), FACE_POS_Z);
      d.controls.steerDir.set(0.707, 0, 0.707);
      d.controls.steerAmount = 1;
      for (let i = 0; i < 26; i++) tick();
      d.controls.charging = true;
      for (let i = 0; i < 50; i++) tick();
      break;
    }
    case "impact": {
      d.world.teleport(d.player.vehicle.body, new Vector3(px - 5.0, 0.5, pz - 5.0), FACE_POS_Z);
      if (d.enemies[0]) d.world.teleport(d.enemies[0].vehicle.body, new Vector3(px, 0.75, pz), FACE_POS_Z);
      d.controls.steerDir.set(0.707, 0, 0.707);
      d.controls.steerAmount = 1;
      for (let i = 0; i < 20; i++) tick();
      d.controls.charging = true;
      for (let i = 0; i < 52; i++) tick();
      d.controls.charging = false;
      d.controls.released = true;
      tick();
      d.controls.released = false;
      const before = d.combat.hitCount;
      for (let i = 0; i < 120 && d.combat.hitCount === before; i++) tick();
      for (let i = 0; i < 5; i++) tick();
      break;
    }
    case "edge": {
      const r = d.arena.radius;
      d.world.teleport(d.player.vehicle.body, new Vector3(r - 7.5, 0.5, 1), FACE_POS_Z);
      if (d.enemies[0]) d.world.teleport(d.enemies[0].vehicle.body, new Vector3(r - 2.2, 0.75, 1), FACE_POS_Z);
      d.controls.steerDir.set(1, 0, 0);
      d.controls.steerAmount = 1;
      for (let i = 0; i < 30; i++) tick();
      break;
    }
  }

  d.controls.steerAmount = 0;
  d.controls.steering = false;
  d.controls.charging = false;
  d.render();
}
