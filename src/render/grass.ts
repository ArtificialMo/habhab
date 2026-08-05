import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
// Side effect: adds thinInstance* to Mesh.prototype in the tree-shaken build.
import "@babylonjs/core/Meshes/thinInstanceMesh";
// Side effect: registers the #include chunks used below. Without these the shader
// processor cannot resolve them and the material silently never compiles an
// effect — no error, nothing drawn.
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";

import { PALETTE } from "./style";

export interface GrassInfluencer {
  x: number;
  z: number;
  /** Radius of effect. Zero disables the slot. */
  radius: number;
  /** How far blades are pushed outward, in metres. */
  strength: number;
}

export interface GrassOptions {
  patchCount?: number;
  bladesPerPatch?: number;
  name?: string;
  base?: Color3;
  tip?: Color3;
  crushTint?: Color3;
  bladeWidth?: number;
  bladeHeight?: number;
  /** Patches are kept outside this radius from the island centre. */
  minRadius?: number;
  maxRadiusFactor?: number;
  seed?: number;
  patchRadius?: [number, number];
  /** Islands to scatter across. Patch count is shared out by area. */
  regions?: { x: number; z: number; radius: number }[];
  /**
   * Cover the whole disc uniformly instead of scattering discrete patches. The
   * `patches` list is still populated, as a coarse grid, because the zone index and
   * the screenshot poses both key off it.
   */
  fill?: boolean;
}

/** Uniform array size. Player plus a handful of enemies is the realistic ceiling. */
const MAX_INFLUENCERS = 6;
/** Seconds crushed grass stays fully flattened before it starts standing back up. */
const CRUSH_HOLD = 11;
/** Seconds it then takes to recover. */
const CRUSH_RECOVER = 4;

const GRASS_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec2 crush;

#include<instancesDeclaration>

uniform mat4 viewProjection;
uniform float time;
uniform vec4 influencers[${MAX_INFLUENCERS}];

varying float vH;
varying float vCrush;

void main(void) {
  #include<instancesVertex>

  // The blade bends as a whole, driven by where its *base* sits. Testing each
  // vertex separately shears the blade instead of laying it over.
  vec3 base = (finalWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 wp = finalWorld * vec4(position, 1.0);
  float h = uv.y;

  vec2 sway = vec2(
    sin(time * 1.9 + base.x * 0.55 + base.z * 0.4),
    cos(time * 1.5 + base.z * 0.6)
  ) * 0.13;

  vec2 push = vec2(0.0);
  float flatten = 0.0;
  for (int i = 0; i < ${MAX_INFLUENCERS}; i++) {
    float r = influencers[i].z;
    if (r <= 0.0) continue;
    vec2 d = base.xz - influencers[i].xy;
    float dist = length(d);
    float k = 1.0 - smoothstep(r * 0.25, r, dist);
    if (k <= 0.0) continue;
    vec2 dir = dist > 0.001 ? d / dist : vec2(1.0, 0.0);
    push += dir * k * influencers[i].w;
    flatten = max(flatten, k);
  }

  // Crush is per blade, carried in instance data rather than a uniform ring of
  // recent stamps: a uniform array large enough to hold ten seconds of tracks at
  // driving speed would need hundreds of slots, and would still quantise the trail
  // into blobs. crush.x is the amount, crush.y the direction it was flattened.
  float crushAmt = crush.x;
  vec2 crushDir = vec2(cos(crush.y), sin(crush.y));

  // Tips move, roots do not: h*h keeps the blade anchored in the ground.
  wp.xz += (sway + push + crushDir * crushAmt * 0.5) * h * h;
  float lay = max(flatten * 0.72, crushAmt * 0.88);
  wp.y = base.y + (wp.y - base.y) * (1.0 - lay);

  vH = h;
  vCrush = crushAmt;
  gl_Position = viewProjection * wp;
}
`;

const GRASS_FRAGMENT = `
precision highp float;
varying float vH;
varying float vCrush;
uniform vec3 baseColor;
uniform vec3 tipColor;
uniform vec3 crushColor;
void main(void) {
  // Darker at the root, so a patch reads as depth rather than as a flat green mat.
  vec3 c = mix(baseColor * 0.62, tipColor, vH * vH);
  // Crushed grass browns off where it has been driven over — without the colour
  // shift a flattened blade just looks like a short blade.
  c = mix(c, crushColor, clamp(vCrush * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

let registered = false;

/**
 * Interactive grass.
 *
 * Every blade is a thin instance of one two-triangle mesh, so the whole field is a
 * single draw call and the per-blade cost on the CPU is zero. Interaction is done
 * entirely in the vertex shader from a small uniform array of car positions — the
 * alternative, rewriting instance matrices when a car moves, would mean touching
 * thousands of matrices per frame to animate something purely decorative.
 *
 * Purely cosmetic: no colliders. Grass is something you drive *through*, so it must
 * not become an obstacle — the deck stays clear (§4.5).
 */
export class Grass {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly influencerData = new Float32Array(MAX_INFLUENCERS * 4);
  /** Per blade: [crush amount 0..1, direction angle]. Uploaded as instance data. */
  private crushData!: Float32Array;
  /** Per blade: seconds of crush remaining (hold + recover). */
  private crushTimer!: Float32Array;
  /** Indices currently crushed — the only blades `update` has to touch. */
  private readonly crushed = new Set<number>();
  private crushDirty = false;
  private bladeX!: Float32Array;
  private bladeZ!: Float32Array;
  /** Uniform grid over blade positions, so crushing queries a handful of cells. */
  private readonly grid = new Map<number, number[]>();
  private time = 0;
  /** Patch centres and radii, for cheap "car entered a patch" tests. */
  readonly patches: { x: number; z: number; radius: number }[] = [];

  constructor(scene: Scene, islandRadius: number, opts: GrassOptions = {}) {
    const {
      patchCount = 15,
      bladesPerPatch = 85,
      name = "grass",
      base = PALETTE.grass,
      tip = PALETTE.grass.scale(1.25).add(new Color3(0.06, 0.1, 0)),
      crushTint = new Color3(0.3, 0.44, 0.16),
      bladeWidth = 0.19,
      bladeHeight = 0.95,
      minRadius = 0,
      maxRadiusFactor = 0.84,
      seed = 1234,
      patchRadius = [1.2, 2.9] as [number, number],
      regions,
      fill = false,
    } = opts;
    if (!registered) {
      Effect.ShadersStore["carboyGrassVertexShader"] = GRASS_VERTEX;
      Effect.ShadersStore["carboyGrassFragmentShader"] = GRASS_FRAGMENT;
      registered = true;
    }

    this.mesh = new Mesh(name, scene);
    buildBlade(bladeWidth, bladeHeight).applyToMesh(this.mesh);

    this.material = new ShaderMaterial(
      `${name}Mat`,
      scene,
      { vertex: "carboyGrass", fragment: "carboyGrass" },
      {
        attributes: ["position", "uv", "crush"],
        // "world" is not optional here. Under THIN_INSTANCES the instancesVertex
        // chunk computes `finalWorld = world * finalWorld`, so leaving it out of the
        // uniform list binds it as an all-zero matrix and every blade collapses to a
        // degenerate point — the material compiles and reports ready, and draws
        // nothing at all.
        uniforms: [
          "world",
          "viewProjection",
          "time",
          "influencers",
          "baseColor",
          "tipColor",
          "crushColor",
        ],
        defines: ["#define INSTANCES"],
      }
    );
    this.material.setColor3("baseColor", base);
    this.material.setColor3("tipColor", tip);
    this.material.setColor3("crushColor", crushTint);
    this.material.backFaceCulling = false;
    this.mesh.material = this.material;
    this.mesh.isPickable = false;

    const rand = mulberry32(seed);
    const total = patchCount * bladesPerPatch;
    const matrices = new Float32Array(total * 16);
    this.bladeX = new Float32Array(total);
    this.bladeZ = new Float32Array(total);
    const m = Matrix.Identity();
    let n = 0;

    if (fill) {
      // Every island gets turf, with blades shared out by area so a small isle is
      // planted as densely as the arena rather than looking scalped.
      const discs = regions ?? [{ x: 0, z: 0, radius: islandRadius }];
      const areas = discs.map((d) => d.radius * d.radius);
      const areaTotal = areas.reduce((a, b) => a + b, 0) || 1;

      for (const [di, disc] of discs.entries()) {
        const share = di === discs.length - 1 ? total - n : Math.round((areas[di] / areaTotal) * total);
        const outer = disc.radius * maxRadiusFactor;
        for (let b = 0; b < share && n < total; b++) {
          // sqrt on the radius keeps density even; otherwise everything crowds
          // the middle of each disc.
          const br = Math.sqrt(rand()) * outer;
          const ba = rand() * Math.PI * 2;
          const scale = 0.68 + rand() * 0.6;
          const bx = disc.x + Math.cos(ba) * br;
          const bz = disc.z + Math.sin(ba) * br;
          Matrix.ComposeToRef(
            new Vector3(scale * (0.8 + rand() * 0.4), scale, scale),
            Quaternion.RotationAxis(Vector3.Up(), rand() * Math.PI * 2),
            new Vector3(bx, 0, bz),
            m
          );
          m.copyToArray(matrices, n * 16);
          this.bladeX[n] = bx;
          this.bladeZ[n] = bz;
          n++;
        }
        // Coarse grid of nominal patches so zone queries and poses still work.
        const step = 4;
        for (let gx = -outer; gx <= outer; gx += step) {
          for (let gz = -outer; gz <= outer; gz += step) {
            if (Math.hypot(gx, gz) > outer) continue;
            this.patches.push({ x: disc.x + gx, z: disc.z + gz, radius: step * 0.8 });
          }
        }
      }
    } else {
    // Patches are shared across the islands in proportion to their area, so a small
    // isle looks as densely planted as the arena rather than sparser.
    const areas = regions ? regions.map((r) => r.radius * r.radius) : null;
    const areaTotal = areas ? areas.reduce((a, b) => a + b, 0) : 0;

    for (let p = 0; p < patchCount; p++) {
      const angle = rand() * Math.PI * 2;
      let region: { x: number; z: number; radius: number } | null = null;
      if (regions && areas) {
        let pick = rand() * areaTotal;
        for (let r = 0; r < regions.length; r++) {
          pick -= areas[r];
          if (pick <= 0) {
            region = regions[r];
            break;
          }
        }
        region = region ?? regions[regions.length - 1];
      }
      // Kept off the very rim so a patch is never half-hanging over the edge.
      const originX = region ? region.x : 0;
      const originZ = region ? region.z : 0;
      const reach = region ? region.radius : islandRadius;
      const span = reach * maxRadiusFactor - minRadius;
      const dist = minRadius + rand() * Math.max(0, span);
      const px = originX + Math.cos(angle) * dist;
      const pz = originZ + Math.sin(angle) * dist;
      const pr = patchRadius[0] + rand() * (patchRadius[1] - patchRadius[0]);
      this.patches.push({ x: px, z: pz, radius: pr });

      for (let b = 0; b < bladesPerPatch; b++) {
        // sqrt keeps density even rather than clumping at the centre.
        const br = Math.sqrt(rand()) * pr;
        const ba = rand() * Math.PI * 2;
        const scale = 0.68 + rand() * 0.6;
        const bx = px + Math.cos(ba) * br;
        const bz = pz + Math.sin(ba) * br;
        Matrix.ComposeToRef(
          new Vector3(scale * (0.8 + rand() * 0.4), scale, scale),
          Quaternion.RotationAxis(Vector3.Up(), rand() * Math.PI * 2),
          new Vector3(bx, 0, bz),
          m
        );
        m.copyToArray(matrices, n * 16);
        this.bladeX[n] = bx;
        this.bladeZ[n] = bz;
        n++;
      }
    }

    }

    this.crushData = new Float32Array(n * 2);
    this.crushTimer = new Float32Array(n);
    // Spatial grid over blade roots. Crushing touches only the cells a wheel
    // overlaps, so cost tracks contact area rather than field size.
    for (let i = 0; i < n; i++) {
      const key = this.cellKey(this.bladeX[i], this.bladeZ[i]);
      let list = this.grid.get(key);
      if (!list) {
        list = [];
        this.grid.set(key, list);
      }
      list.push(i);
    }

    this.mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    this.mesh.thinInstanceSetBuffer("crush", this.crushData, 2, false);
    this.mesh.alwaysSelectAsActiveMesh = true; // one draw call, never worth culling
    this.mesh.freezeWorldMatrix();
  }

  get bladeCount(): number {
    return this.mesh.thinInstanceCount;
  }

  private cellKey(x: number, z: number): number {
    return (Math.floor(x / 1.3) + 512) * 1024 + (Math.floor(z / 1.3) + 512);
  }

  /**
   * Flattens every blade under a wheel. Only the grid cells the contact disc
   * overlaps are visited, so this costs the same whether the island has one patch
   * or a hundred.
   */
  crush(x: number, z: number, radius: number, angle = 0): void {
    const r2 = radius * radius;
    const minX = Math.floor((x - radius) / 1.3);
    const maxX = Math.floor((x + radius) / 1.3);
    const minZ = Math.floor((z - radius) / 1.3);
    const maxZ = Math.floor((z + radius) / 1.3);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const list = this.grid.get((cx + 512) * 1024 + (cz + 512));
        if (!list) continue;
        for (const i of list) {
          const dx = this.bladeX[i] - x;
          const dz = this.bladeZ[i] - z;
          if (dx * dx + dz * dz > r2) continue;
          this.crushData[i * 2] = 1;
          // Lay the blade away from the wheel centre, falling back to the travel
          // direction when it is dead under the middle.
          this.crushData[i * 2 + 1] = dx * dx + dz * dz > 0.0004 ? Math.atan2(dz, dx) : angle;
          this.crushTimer[i] = CRUSH_HOLD + CRUSH_RECOVER;
          this.crushed.add(i);
        }
      }
    }
    this.crushDirty = true;
  }

  get crushedCount(): number {
    return this.crushed.size;
  }

  update(dt: number, influencers: GrassInfluencer[]): void {
    this.time += dt;
    this.material.setFloat("time", this.time);

    // Only crushed blades are visited. They hold flat for CRUSH_HOLD seconds and
    // then spring back, so a route stays legible long after the car has gone.
    if (this.crushed.size) {
      for (const i of this.crushed) {
        const t = this.crushTimer[i] - dt;
        if (t <= 0) {
          this.crushTimer[i] = 0;
          this.crushData[i * 2] = 0;
          this.crushed.delete(i);
          this.crushDirty = true;
        } else {
          this.crushTimer[i] = t;
          // Only blades actually springing back change value. During the hold
          // phase — which is most of a blade's crushed life, and most of the set —
          // the buffer is untouched, so the whole field is not re-uploaded every
          // frame just to write the same 1.0 back into it.
          if (t < CRUSH_RECOVER) {
            this.crushData[i * 2] = t / CRUSH_RECOVER;
            this.crushDirty = true;
          }
        }
      }
    }
    if (this.crushDirty) {
      this.mesh.thinInstanceBufferUpdated("crush");
      this.crushDirty = false;
    }

    const d = this.influencerData;
    d.fill(0);
    const count = Math.min(influencers.length, MAX_INFLUENCERS);
    for (let i = 0; i < count; i++) {
      const inf = influencers[i];
      d[i * 4 + 0] = inf.x;
      d[i * 4 + 1] = inf.z;
      d[i * 4 + 2] = inf.radius;
      d[i * 4 + 3] = inf.strength;
    }
    this.material.setArray4("influencers", d as unknown as number[]);
  }

  /** True if the point is inside any patch — used to trigger a rustle burst. */
  patchAt(x: number, z: number): { x: number; z: number; radius: number } | null {
    for (const p of this.patches) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < p.radius * p.radius) return p;
    }
    return null;
  }
}

/**
 * One tapered blade: 4 verts, 2 triangles, pivot at the root.
 *
 * Deliberately chunky. The camera sits ~50 m back and shows roughly 22 m of ground
 * across a phone-width frame, so a realistically thin blade is under a pixel wide
 * and the whole field collapses into a flat mat. These are tufts, not lawn.
 */
function buildBlade(w: number, h: number): VertexData {
  const tip = w * 0.3;
  // Leaned slightly so a field of them has some natural variation in silhouette.
  const lean = 0.14;

  const data = new VertexData();
  data.positions = [-w, 0, 0, w, 0, 0, -tip + lean, h, 0.1, tip + lean, h, 0.1];
  data.uvs = [0, 0, 1, 0, 0, 1, 1, 1];
  // Facing straight up: grass should catch light like the ground it grows from,
  // not flicker as blades rotate past the sun.
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  data.indices = [0, 1, 2, 2, 1, 3];
  return data;
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
