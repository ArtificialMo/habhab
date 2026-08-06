import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

type Letter = {
  node: TransformNode;
  x: number;
  index: number;
  landed: boolean;
};

type ImpactHandler = (position: Vector3, strength: number) => void;

const GLYPHS: Record<string, string[]> = {
  C: ["1111", "1000", "1000", "1000", "1000", "1000", "1111"],
  A: ["0110", "1001", "1001", "1111", "1001", "1001", "1001"],
  R: ["1110", "1001", "1001", "1110", "1010", "1001", "1001"],
  B: ["1110", "1001", "1001", "1110", "1001", "1001", "1110"],
  O: ["0110", "1001", "1001", "1001", "1001", "1001", "0110"],
  Y: ["1001", "1001", "0110", "0110", "0100", "0100", "0100"],
};

/**
 * A small, real Babylon mesh title. It deliberately uses chunky extruded boxes
 * instead of a font texture: every white letter is actual lit geometry that can
 * squash, stretch, cast depth, and throw particles into the scene.
 */
export class TitleReveal {
  readonly root: TransformNode;

  private readonly letters: Letter[] = [];
  private readonly material: StandardMaterial;
  private readonly onImpact: ImpactHandler;
  private readonly onComplete: () => void;
  private clock = 0;
  private active = false;
  private finished = false;

  constructor(scene: Scene, onImpact: ImpactHandler, onComplete: () => void) {
    this.onImpact = onImpact;
    this.onComplete = onComplete;
    this.root = new TransformNode("carboy-title-3d", scene);
    this.root.position.set(0, 8.8, 2.8);
    this.root.setEnabled(false);

    this.material = new StandardMaterial("carboy-title-white", scene);
    this.material.diffuseColor = new Color3(0.98, 0.99, 1);
    this.material.emissiveColor = new Color3(0.14, 0.16, 0.2);
    this.material.specularColor = new Color3(0.9, 0.92, 1);
    this.material.specularPower = 64;

    const cell = 0.64;
    const letterGap = 0.5;
    const word = "CAR BOY";
    let cursor = 0;
    let letterIndex = 0;
    for (const char of word) {
      if (char === " ") {
        cursor += cell * 1.6;
        continue;
      }
      const mesh = this.buildGlyph(scene, char, cell, `carboy-title-${letterIndex}`);
      const letter = new TransformNode(`carboy-title-letter-${char}-${letterIndex}`, scene);
      letter.parent = this.root;
      mesh.parent = letter;
      letter.position.x = cursor;
      this.letters.push({ node: letter, x: cursor, index: letterIndex, landed: false });
      cursor += cell * 4 + letterGap;
      letterIndex++;
    }

    // Centre the block-letter word around the island's title target.
    const centre = cursor * 0.5 - letterGap * 0.5;
    for (const letter of this.letters) letter.x -= centre;
  }

  start(): void {
    this.clock = 0;
    this.active = true;
    this.finished = false;
    this.root.setEnabled(true);
    for (const letter of this.letters) {
      letter.landed = false;
      letter.node.position.x = letter.x;
      letter.node.position.y = 7.2 + letter.index * 0.14;
      letter.node.position.z = (letter.index % 2 === 0 ? -1 : 1) * 0.65;
      letter.node.rotation.set(0.8, (letter.index % 2 === 0 ? -1 : 1) * 0.18, (letter.index % 2 === 0 ? -1 : 1) * 0.16);
      letter.node.scaling.set(0.22, 1.45, 0.72);
    }
  }

  update(dt: number): void {
    if (!this.active) return;
    this.clock += Math.min(dt, 0.05);
    let complete = true;

    for (const letter of this.letters) {
      const local = this.clock - letter.index * 0.2;
      if (local < 0) {
        complete = false;
        continue;
      }

      const t = Math.min(1, local / 0.72);
      const eased = 1 - Math.pow(1 - t, 3);
      const impactT = Math.max(0, Math.min(1, (t - 0.58) / 0.42));
      const bounce = Math.sin(impactT * Math.PI);
      const drop = 7.2 * (1 - eased);

      letter.node.position.y = drop + bounce * 0.48;
      letter.node.position.z = Math.sin(t * Math.PI) * 0.45;
      letter.node.rotation.x = 0.8 * (1 - eased) - bounce * 0.16;
      letter.node.rotation.y = (letter.index % 2 === 0 ? -1 : 1) * (0.18 * (1 - eased));
      letter.node.rotation.z = (letter.index % 2 === 0 ? -1 : 1) * (0.16 * (1 - eased)) + Math.sin(t * Math.PI) * 0.08;
      letter.node.scaling.set(1 + bounce * 0.46, 1 - bounce * 0.34, 1 + bounce * 0.16);

      if (t < 1) complete = false;
      if (t >= 0.58 && !letter.landed) {
        letter.landed = true;
        this.onImpact(letter.node.getAbsolutePosition().clone(), 0.72 + (letter.index % 2) * 0.08);
      }
    }

    if (complete && this.clock > 2.05) {
      this.active = false;
      if (!this.finished) {
        this.finished = true;
        this.onComplete();
      }
    }
  }

  hide(): void {
    this.active = false;
    this.root.setEnabled(false);
  }

  private buildGlyph(scene: Scene, char: string, cell: number, name: string): Mesh {
    const pattern = GLYPHS[char] ?? GLYPHS.O;
    const blocks: Mesh[] = [];
    const width = pattern[0].length;
    for (let row = 0; row < pattern.length; row++) {
      for (let col = 0; col < width; col++) {
        if (pattern[row][col] !== "1") continue;
        const block = MeshBuilder.CreateBox(`${name}-${row}-${col}`, {
          width: cell * 0.9,
          height: cell * 0.9,
          depth: 0.48,
        }, scene);
        block.position.set(
          (col - (width - 1) * 0.5) * cell,
          ((pattern.length - 1) * 0.5 - row) * cell,
          0
        );
        blocks.push(block);
      }
    }

    const mesh = Mesh.MergeMeshes(blocks, true, true);
    if (!mesh) throw new Error(`Unable to build title glyph ${char}`);
    mesh.name = name;
    mesh.material = this.material;
    mesh.isPickable = false;
    return mesh;
  }
}
