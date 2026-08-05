import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;

// instanceColor is declared by the include when INSTANCESCOLOR is defined, and
// Babylon defines that itself once a "color" thin-instance buffer exists. Declaring
// it here as well is a duplicate attribute: the shader fails to compile, the
// material reports "not ready" forever, and nothing is drawn with no error raised.
#include<instancesDeclaration>

uniform mat4 viewProjection;
varying vec2 vUV;
varying vec4 vColor;

void main(void) {
  #include<instancesVertex>
  vUV = uv;
  vColor = instanceColor;
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUV;
varying vec4 vColor;
void main(void) {
  // Soft along the width, soft at both ends: a tyre mark has no hard edges.
  float across = 1.0 - smoothstep(0.35, 1.0, abs(vUV.x * 2.0 - 1.0));
  float along = 1.0 - smoothstep(0.72, 1.0, abs(vUV.y * 2.0 - 1.0));
  float a = vColor.a * across * along;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

let registered = false;

/**
 * Drift marks.
 *
 * A fixed ring of thin instances on one quad, so the whole trail history is a single
 * draw call and laying a mark never allocates. Marks are stamped per wheel while the
 * car is sliding sideways, and fade out over a few seconds.
 */
export class DriftTrails {
  private readonly mesh: Mesh;
  private readonly matrices: Float32Array;
  private readonly colours: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly peak: Float32Array;
  private readonly capacity: number;
  private cursor = 0;
  private readonly scratch = Matrix.Identity();

  constructor(scene: Scene, capacity = 240) {
    if (!registered) {
      Effect.ShadersStore["carboyDriftVertexShader"] = VERT;
      Effect.ShadersStore["carboyDriftFragmentShader"] = FRAG;
      registered = true;
    }
    this.capacity = capacity;

    this.mesh = new Mesh("driftTrails", scene);
    quad().applyToMesh(this.mesh);

    const mat = new ShaderMaterial(
      "driftMat",
      scene,
      { vertex: "carboyDrift", fragment: "carboyDrift" },
      {
        // `world` is required under THIN_INSTANCES; instanceColor is added by
        // Babylon when it sees the colour buffer, so it must not be listed here.
        attributes: ["position", "uv"],
        uniforms: ["world", "viewProjection"],
        defines: ["#define INSTANCES"],
      }
    );
    mat.needAlphaBlending = () => true;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.zOffset = -10;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;

    this.matrices = new Float32Array(capacity * 16);
    this.colours = new Float32Array(capacity * 4);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.peak = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      Matrix.ScalingToRef(0, 0, 0, this.scratch);
      this.scratch.copyToArray(this.matrices, i * 16);
    }
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colours, 4, false);
    this.mesh.freezeWorldMatrix();
  }

  stamp(x: number, z: number, yaw: number, width: number, length: number, alpha: number, life: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    Matrix.ComposeToRef(
      new Vector3(width, 1, length),
      Quaternion.RotationAxis(Vector3.Up(), yaw),
      // Slight per-slot lift so overlapping marks do not z-fight each other.
      new Vector3(x, 0.03 + (i % 6) * 0.0015, z),
      this.scratch
    );
    this.scratch.copyToArray(this.matrices, i * 16);
    // Dark rubber, not soil: a warm brown here reads as a worn tyre smear.
    this.colours[i * 4 + 0] = 0.11;
    this.colours[i * 4 + 1] = 0.1;
    this.colours[i * 4 + 2] = 0.12;
    this.colours[i * 4 + 3] = alpha;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.peak[i] = alpha;
    this.mesh.thinInstanceBufferUpdated("matrix");
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const next = Math.max(0, l - dt);
      this.life[i] = next;
      // Holds, then fades — a mark that starts fading immediately never reads.
      const t = next / this.maxLife[i];
      this.colours[i * 4 + 3] = Math.min(1, t * 1.8) * this.peak[i];
      any = true;
    }
    if (any) this.mesh.thinInstanceBufferUpdated("color");
  }

  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.life[i] > 0) n++;
    return n;
  }
}

function quad(): VertexData {
  const d = new VertexData();
  d.positions = [-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5];
  d.uvs = [0, 0, 1, 0, 0, 1, 1, 1];
  d.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  d.indices = [0, 1, 2, 2, 1, 3];
  return d;
}
