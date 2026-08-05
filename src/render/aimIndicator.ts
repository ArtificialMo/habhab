import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Charge direction, drawn flat on the deck in front of Car Boy (§2.6, §2.17).
 *
 * On the ground rather than floating: at this camera angle a vertical arrow is
 * ambiguous about where it actually points, and where it points is the entire
 * question the player is asking.
 */
export class AimIndicator {
  private readonly root: TransformNode;
  private readonly chevrons: { mesh: Mesh; material: StandardMaterial; at: number }[] = [];
  private readonly beam: Mesh;
  private readonly beamMat: StandardMaterial;
  private pulse = 0;

  private static readonly COUNT = 5;

  constructor(scene: Scene, parent: TransformNode, noseOffset: number) {
    this.root = new TransformNode("aim", scene);
    this.root.parent = parent;
    this.root.position.z = noseOffset;

    this.beamMat = unlit(scene, "aimBeam", new Color3(1, 0.95, 0.6), 0);
    this.beam = MeshBuilder.CreatePlane("aimBeamMesh", { width: 0.5, height: 1 }, scene);
    this.beam.rotation.x = Math.PI / 2;
    this.beam.parent = this.root;
    this.beam.material = this.beamMat;
    this.beam.isPickable = false;

    for (let i = 0; i < AimIndicator.COUNT; i++) {
      const mat = unlit(scene, `aimChev${i}`, new Color3(1, 1, 1), 0);
      // Three-sided disc = a clean triangular chevron with no texture needed.
      const mesh = MeshBuilder.CreateCylinder(
        `aimChev${i}`,
        { diameterTop: 0, diameterBottom: 1, height: 0.001, tessellation: 3 },
        scene
      );
      mesh.rotation.y = Math.PI;
      mesh.parent = this.root;
      mesh.material = mat;
      mesh.isPickable = false;
      this.chevrons.push({ mesh, material: mat, at: 0.9 + i * 0.78 });
    }
    this.setVisible(false);
  }

  private setVisible(on: boolean): void {
    this.beam.setEnabled(on);
    for (const c of this.chevrons) c.mesh.setEnabled(on);
  }

  /**
   * `charge` fills the chevrons one at a time, so the player reads charge level as
   * a count rather than having to judge a length. The colour ramps white → gold →
   * hot orange at full, which is the "you can let go now" signal.
   */
  update(dt: number, charge: number, visible: boolean): void {
    this.setVisible(visible);
    if (!visible) return;

    this.pulse += dt * (7 + charge * 16);
    const lit = charge * AimIndicator.COUNT;
    // Saturated gold → hot red. The previous near-white ramp had almost no contrast
    // against warm stone paving, which is the one surface it always sits on.
    const hot = Color3.Lerp(
      new Color3(1, 0.72, 0.08),
      new Color3(1, 0.24, 0.04),
      Math.min(1, charge * 1.15)
    );

    for (let i = 0; i < this.chevrons.length; i++) {
      const c = this.chevrons[i];
      const fill = clamp(lit - i, 0, 1);
      const flicker = charge >= 0.98 ? 0.78 + Math.sin(this.pulse + i * 0.7) * 0.22 : 1;
      c.material.emissiveColor = fill > 0 ? hot : new Color3(0.28, 0.24, 0.3);
      c.material.alpha = (0.5 + fill * 0.5) * flicker;
      const s = 1.0 + fill * 0.6;
      c.mesh.scaling.set(s, 1, s * 1.15);
      c.mesh.position.set(0, 0.05, c.at + fill * 0.14);
    }

    const len = 1.2 + charge * 4.2;
    this.beam.scaling.set(0.55 + charge * 0.5, len, 1);
    this.beam.position.set(0, 0.04, len * 0.5 + 0.2);
    this.beamMat.emissiveColor = hot;
    this.beamMat.alpha = 0.3 + charge * 0.35;
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}

function unlit(scene: Scene, name: string, colour: Color3, alpha: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = colour;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  m.alpha = alpha;
  m.backFaceCulling = false;
  m.zOffset = -4;
  return m;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
