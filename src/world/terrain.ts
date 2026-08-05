import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

import { celMaterial } from "../render/style";
import type { ZoneGrid, Zone } from "./zones";

export interface TerrainOptions {
  islandRadius: number;
  /**
   * Zones are kept outside this radius. The impact bench stages cars within ~7 m of
   * the origin, and a mud patch there would silently change the measured physics —
   * terrain must not be able to invalidate the collision numbers.
   */
  keepClearRadius: number;
}

/**
 * Cosmetic puddle ground zones.
 *
 * Visuals are merged per kind into a single mesh, so the whole terrain layer costs
 * two draw calls no matter how many patches there are. Nothing here has a collider:
 * puddles change the look and splash response, never how a car drives.
 */
export class Terrain {
  readonly puddles: Zone[] = [];

  constructor(scene: Scene, grid: ZoneGrid, opts: TerrainOptions) {
    const rand = mulberry32(20260804);
    const inner = opts.keepClearRadius;
    const outer = opts.islandRadius * 0.82;

    const puddleDiscs: Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const d = inner + rand() * (outer - inner);
      const r = 1.5 + rand() * 1.6;
      const zone: Zone = {
        kind: "puddle",
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        radius: r,
        active: false,
        idle: 99,
      };
      this.puddles.push(zone);
      grid.add(zone);
      puddleDiscs.push(disc(scene, zone.x, zone.z, r, 0.02));
    }
    mergeInto(
      scene,
      puddleDiscs,
      "puddlePatches",
      new Color3(0.24, 0.53, 0.72),
      new Color3(0.12, 0.3, 0.5)
    );
  }
}

function disc(scene: Scene, x: number, z: number, r: number, y: number): Mesh {
  const m = MeshBuilder.CreateDisc("terrainDisc", { radius: r, tessellation: 14 }, scene);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function mergeInto(
  scene: Scene,
  parts: Mesh[],
  name: string,
  base: Color3,
  shade: Color3
): Mesh | null {
  if (!parts.length) return null;
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) return null;
  merged.name = name;
  const mat = celMaterial(`${name}Mat`, scene, base, { shade, rimStrength: 0.06, softness: 0.3 });
  // Laid-flat discs can end up wound either way depending on how the rotation took
  // their normal; culling here buys one triangle and risks an invisible patch.
  mat.backFaceCulling = false;
  merged.material = mat;
  merged.isPickable = false;
  merged.freezeWorldMatrix();
  return merged;
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
