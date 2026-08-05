import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

/**
 * The floating aim arrow that hangs over the car while a ram is winding up.
 *
 * The ground chevrons already show the line of the shot, but with a two-second
 * wind-up the player spends a long time looking at their own car deciding where to
 * point it — so the direction needs to be readable *at the car*, not only on the
 * ground in front of it.
 */
export class AimArrow {
  private readonly root: TransformNode;
  private readonly shaft: Mesh;
  private readonly head: Mesh;
  private readonly mat: StandardMaterial;
  private bob = 0;

  constructor(scene: Scene, parent: TransformNode) {
    this.root = new TransformNode("aimArrow", scene);
    this.root.parent = parent;

    this.mat = new StandardMaterial("aimArrowMat", scene);
    this.mat.disableLighting = true;
    this.mat.emissiveColor = new Color3(1, 0.72, 0.1);
    this.mat.specularColor = Color3.Black();

    this.shaft = MeshBuilder.CreateBox("aimArrowShaft", { width: 0.22, height: 0.1, depth: 0.8 }, scene);
    this.shaft.parent = this.root;
    this.shaft.material = this.mat;
    this.shaft.isPickable = false;

    // A 3-sided cylinder on its side is a triangular head, no asset required.
    this.head = MeshBuilder.CreateCylinder("aimArrowHead", { diameterTop: 0, diameterBottom: 0.62, height: 0.6, tessellation: 4 }, scene);
    this.head.rotation.x = Math.PI / 2;
    this.head.position.z = 0.7;
    this.head.parent = this.root;
    this.head.material = this.mat;
    this.head.isPickable = false;

    this.root.setEnabled(false);
  }

  /**
   * @param yaw world aim direction
   * @param charge 0..1
   * @param height how far above the car to float
   */
  update(dt: number, visible: boolean, yaw: number, charge: number, height: number): void {
    this.root.setEnabled(visible);
    if (!visible) return;

    this.bob += dt * (3 + charge * 9);
    // The arrow is parented to the car, so its yaw is subtracted out — the arrow
    // points where the *shot* goes, which during aiming is exactly where the car is
    // being turned to, but it must not inherit the car's spin while being knocked.
    this.root.rotation.y = yaw - (parentYaw(this.root) ?? 0);
    this.root.position.set(0, height + 0.55 + Math.sin(this.bob) * 0.09, 0);

    const s = 0.85 + charge * 0.9;
    this.root.scaling.setAll(s);
    // Gold → hot red as it fills, matching the ground chevrons and the button ring.
    this.mat.emissiveColor = Color3.Lerp(
      new Color3(1, 0.75, 0.12),
      new Color3(1, 0.25, 0.05),
      Math.min(1, charge * 1.1)
    );
  }
}

/** Yaw of the arrow's parent, so the arrow can be given an absolute heading. */
function parentYaw(node: TransformNode): number | null {
  const p = node.parent as TransformNode | null;
  if (!p) return null;
  const f = p.forward;
  return Math.atan2(f.x, f.z);
}
