import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";

const COIN_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;

#include<instancesDeclaration>

uniform mat4 viewProjection;
uniform float time;
varying float vShade;
varying float vGlint;

void main(void) {
  #include<instancesVertex>
  vec4 wp = finalWorld * vec4(position, 1.0);
  vec3 n = normalize((finalWorld * vec4(normal, 0.0)).xyz);
  vShade = clamp(dot(n, normalize(vec3(0.45, 0.8, -0.36))) * 0.5 + 0.5, 0.0, 1.0);
  // A highlight band sweeping across the face as the coin spins. Gold reads as
  // metal only when something moves across it — a static shade is just yellow.
  vGlint = sin(dot(n, vec3(1.0, 0.35, 0.6)) * 4.5 + time * 5.0);
  gl_Position = viewProjection * wp;
}
`;

const COIN_FRAGMENT = `
precision highp float;
varying float vShade;
varying float vGlint;
uniform vec3 faceColor;
uniform vec3 edgeColor;
void main(void) {
  // Two hard bands, matching the cel language used everywhere else.
  vec3 c = vShade > 0.62 ? faceColor : edgeColor;
  // Then a hard specular chip on top — a cel highlight, not a soft smear.
  float glint = smoothstep(0.78, 0.94, vGlint);
  c = mix(c, vec3(1.0, 0.99, 0.9), glint * 0.85);
  gl_FragColor = vec4(c, 1.0);
}
`;

let registered = false;

interface Coin {
  x: number;
  z: number;
  y: number;
  /** Spin phase, kept per coin so a scattered pile does not pulse in unison. */
  phase: number;
  alive: boolean;
  /** 0 while loose, ramps to 1 while being pulled in. */
  pull: number;
  /** Seconds into the brief touch-grow-sparkle exit, or -1 when idle. */
  collectT: number;
  vx: number;
  vz: number;
}

/**
 * Gold pickups.
 *
 * Every coin is a thin instance of one low-poly cylinder, so the entire scatter is a
 * single draw call. Only coins inside the magnet radius are integrated each frame —
 * the rest just spin, which is a matrix write and nothing else.
 */
export class Pickups {
  private readonly mesh: Mesh;
  private material!: ShaderMaterial;
  private readonly shadowMesh: Mesh;
  private readonly shadowMatrices: Float32Array;
  private readonly coins: Coin[] = [];
  private readonly matrices: Float32Array;
  private readonly capacity: number;
  private cursor = 0;
  private time = 0;
  private readonly scratch = Matrix.Identity();

  /** Total collected this run. */
  collected = 0;
  /** Set by main: is this point over solid ground? Keeps coins reachable. */
  onGround: ((x: number, z: number) => boolean) | null = null;
  /** Set by main: nearest point on solid ground to a position over water. */
  groundSeek: ((x: number, z: number) => { x: number; z: number }) | null = null;

  constructor(scene: Scene, capacity = 96) {
    if (!registered) {
      Effect.ShadersStore["carboyCoinVertexShader"] = COIN_VERTEX;
      Effect.ShadersStore["carboyCoinFragmentShader"] = COIN_FRAGMENT;
      registered = true;
    }
    this.capacity = capacity;

    const src = MeshBuilder.CreateCylinder(
      "coinSrc",
      { diameter: 0.78, height: 0.17, tessellation: 8 },
      scene
    );
    this.mesh = src;
    this.mesh.name = "coins";
    src.convertToFlatShadedMesh();

    const mat = new ShaderMaterial(
      "coinMat",
      scene,
      { vertex: "carboyCoin", fragment: "carboyCoin" },
      {
        attributes: ["position", "normal"],
        // `world` is required under THIN_INSTANCES — see the note in grass.ts.
        uniforms: ["world", "viewProjection", "faceColor", "edgeColor", "time"],
        defines: ["#define INSTANCES"],
      }
    );
    this.material = mat;
    mat.setColor3("faceColor", new Color3(1, 0.84, 0.24));
    mat.setColor3("edgeColor", new Color3(0.78, 0.5, 0.08));
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;

    // Ground shadows: one flat instanced disc per coin, so a scatter reads as
    // sitting on the grass instead of hovering over it.
    this.shadowMesh = MeshBuilder.CreateDisc("coinShadows", { radius: 0.42, tessellation: 10 }, scene);
    this.shadowMesh.rotation.x = Math.PI / 2;
    this.shadowMesh.bakeCurrentTransformIntoVertices();
    const shMat = new StandardMaterial("coinShadowMat", scene);
    shMat.diffuseColor = Color3.Black();
    shMat.specularColor = Color3.Black();
    shMat.emissiveColor = Color3.Black();
    shMat.alpha = 0.3;
    shMat.disableLighting = true;
    shMat.zOffset = -3;
    this.shadowMesh.material = shMat;
    this.shadowMesh.isPickable = false;
    this.shadowMesh.alwaysSelectAsActiveMesh = true;
    this.shadowMatrices = new Float32Array(capacity * 16);

    this.matrices = new Float32Array(capacity * 16);
    for (let i = 0; i < capacity; i++) {
      this.coins.push({ x: 0, z: 0, y: -50, phase: 0, alive: false, pull: 0, collectT: -1, vx: 0, vz: 0 });
      Matrix.ScalingToRef(0, 0, 0, this.scratch);
      this.scratch.copyToArray(this.matrices, i * 16);
    }
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.freezeWorldMatrix();
    this.shadowMesh.thinInstanceSetBuffer("matrix", this.shadowMatrices, 16, false);
    this.shadowMesh.freezeWorldMatrix();
  }

  /**
   * Bursts `count` coins. The origin is pulled back onto solid ground first, so a
   * car struck at the very rim still pays out somewhere you can drive.
   */
  burst(x: number, z: number, count: number, spread = 1): void {
    let ox = x;
    let oz = z;
    if (this.onGround && !this.onGround(ox, oz) && this.groundSeek) {
      const found = this.groundSeek(x, z);
      ox = found.x;
      oz = found.z;
    }
    for (let i = 0; i < count; i++) {
      const c = this.coins[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;
      const a = Math.random() * Math.PI * 2;
      const speed = (2.2 + Math.random() * 4.4) * spread;
      c.x = ox;
      c.z = oz;
      c.y = 0.5 + Math.random() * 0.5;
      c.vx = Math.cos(a) * speed;
      c.vz = Math.sin(a) * speed;
      c.phase = Math.random() * Math.PI * 2;
      c.pull = 0;
      c.collectT = -1;
      c.alive = true;
    }
  }

  get liveCount(): number {
    let n = 0;
    for (const c of this.coins) if (c.alive) n++;
    return n;
  }

  /**
   * @param magnetRadius distance at which a coin starts homing on the player
   * @returns number collected this frame, for the caller to turn into feedback
   */
  /** Positions where coins were collected this frame, for sparkle bursts. */
  readonly collectedAt: { x: number; y: number; z: number }[] = [];

  update(dt: number, playerX: number, playerZ: number, magnetRadius: number): number {
    this.time += dt;
    this.material.setFloat("time", this.time);
    let picked = 0;
    let anyAlive = false;
    this.collectedAt.length = 0;

    for (let i = 0; i < this.capacity; i++) {
      const c = this.coins[i];
      if (!c.alive) continue;
      anyAlive = true;

      const dx = playerX - c.x;
      const dz = playerZ - c.z;
      const dist = Math.hypot(dx, dz);

      let visualScale = 1;
      if (c.collectT >= 0) {
        const phase = Math.min(1, c.collectT / 0.16);
        const ease = 1 - Math.pow(1 - phase, 3);
        c.x += (playerX - c.x) * Math.min(1, dt * 18);
        c.z += (playerZ - c.z) * Math.min(1, dt * 18);
        c.y += (0.65 + ease * 0.24 - c.y) * Math.min(1, dt * 18);
        visualScale = 1 + ease * 1.25;
        c.collectT += dt;
        if (phase >= 1) {
          c.alive = false;
          c.y = -50;
          Matrix.ScalingToRef(0, 0, 0, this.scratch);
          this.scratch.copyToArray(this.matrices, i * 16);
          this.scratch.copyToArray(this.shadowMatrices, i * 16);
          continue;
        }
      } else {
      if (dist < magnetRadius) {
        // Ease in rather than snapping to full attraction, so coins peel off the
        // ground and stream toward the car instead of teleporting at the boundary.
        c.pull = Math.min(1, c.pull + dt * 3.4);
        const pullSpeed = 3 + c.pull * 22;
        c.vx += (dx / (dist || 1)) * pullSpeed * dt * 6;
        c.vz += (dz / (dist || 1)) * pullSpeed * dt * 6;
      } else {
        c.pull = Math.max(0, c.pull - dt * 2);
      }

      c.x += c.vx * dt;
      c.z += c.vz * dt;
      // Loose coins settle and rest; pulled coins lift toward the bonnet.
      const restY = 0.24 + Math.sin(this.time * 3 + c.phase) * 0.06;
      c.y += ((c.pull > 0.05 ? 0.62 : restY) - c.y) * Math.min(1, dt * 9);

      const damp = c.pull > 0.05 ? 1.5 : 7;
      const k = Math.exp(-damp * dt);
      c.vx *= k;
      c.vz *= k;

      if (dist < 1.05) {
        c.collectT = 0;
        c.pull = 0;
        c.vx = 0;
        c.vz = 0;
        this.collected++;
        picked++;
        this.collectedAt.push({ x: c.x, y: c.y, z: c.z });
      }

      // Loose coins are kept on solid ground. A coin that skitters out over the
      // water is unreachable, so it is not a reward, it is litter.
      if (this.onGround && c.pull < 0.05 && !this.onGround(c.x, c.z)) {
        const backX = c.x - c.vx * dt * 2;
        const backZ = c.z - c.vz * dt * 2;
        if (this.onGround(backX, backZ)) {
          c.x = backX;
          c.z = backZ;
        }
        c.vx *= -0.35;
        c.vz *= -0.35;
      }

      // Coins spin, and tilt harder the faster they are travelling — a streaming
      // coin reads as being pulled rather than sliding.
      }

      const spin = this.time * 6 + c.phase;
      Matrix.ComposeToRef(
        new Vector3(visualScale, visualScale, visualScale),
        Quaternion.RotationYawPitchRoll(spin, Math.PI / 2 - c.pull * 0.7, 0),
        new Vector3(c.x, c.y, c.z),
        this.scratch
      );
      this.scratch.copyToArray(this.matrices, i * 16);

      // Shadow shrinks and fades as the coin lifts — the cue that sells height.
      const lift = Math.max(0, c.y - 0.24);
      const collectFade = c.collectT >= 0 ? Math.max(0, 1 - c.collectT / 0.16) : 1;
      const sc = Math.max(0, Math.max(0.25, 1 - lift * 0.9) * collectFade);
      Matrix.ComposeToRef(
        new Vector3(sc, 1, sc),
        Quaternion.Identity(),
        new Vector3(c.x, 0.03, c.z),
        this.scratch
      );
      this.scratch.copyToArray(this.shadowMatrices, i * 16);
    }

    if (anyAlive || picked) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      this.shadowMesh.thinInstanceBufferUpdated("matrix");
    }
    return picked;
  }
}
