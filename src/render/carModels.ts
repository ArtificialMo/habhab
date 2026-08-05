import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Scene } from "@babylonjs/core/scene";

import { celMaterial, GAS_TANK_COLOUR, outline, PALETTE } from "./style";

export interface WheelPart {
  /** Pivot the wheel steers around. */
  pivot: TransformNode;
  /** The wheel itself, spun about its axle. */
  spin: TransformNode;
  front: boolean;
  /** -1 left, +1 right. */
  side: number;
  restY: number;
}

export interface CarParts {
  /** Cosmetic root. Parented to the physics mesh; carries hop and vibration. */
  root: TransformNode;
  /** Sprung mass. Carries squat, roll and pitch. Wheels stay outside it. */
  body: TransformNode;
  wheels: WheelPart[];
  /** Bottom-up chain of antenna segments, if this car has one. */
  antenna: TransformNode[];
  /** Every cel material on the car, so a hit can flash the whole thing white. */
  materials: ShaderMaterial[];
  /** Ground blob, kept flat on the deck independent of body roll. */
  shadow: Mesh;
  headlights: Mesh[];
  /** Headlight material, brightened as a charge builds. */
  lightMaterial: ShaderMaterial;
}

export interface CarStyle {
  length: number;
  width: number;
  height: number;
  body: Color3;
  roof: Color3;
  /** Rounded bubble (player) vs. slab-sided brute (enemy). */
  rounded: boolean;
  antenna: boolean;
  spoiler: boolean;
  roofRack: boolean;
  /** 0 = wide and nervous, 1 = narrowed and hostile. Drives the brow angle. */
  menace: number;
  /** Headlight colour. Enemies get a hot, malevolent glow. */
  lightColour?: Color3;
  outlineWidth: number;
  /** Red drum on the tail — the weak point, only on enemies. */
  gasTank?: boolean;
}

export const PLAYER_STYLE: CarStyle = {
  length: 2.2,
  width: 1.4,
  height: 1.0,
  body: PALETTE.playerYellow,
  roof: PALETTE.cream,
  rounded: true,
  antenna: true,
  spoiler: false,
  roofRack: false,
  menace: 0,
  outlineWidth: 0.04,
};

export function enemyStyle(tier: Color3): CarStyle {
  return {
    length: 3.0,
    width: 1.8,
    height: 1.5,
    body: tier,
    roof: tier.scale(0.75),
    rounded: false,
    antenna: false,
    spoiler: true,
    roofRack: true,
    menace: 1,
    outlineWidth: 0.05,
    gasTank: true,
    // Hot red, unlit and self-emitting: two narrow eyes in a black silhouette. The
    // only other warm thing on the car is the tank you are trying to hit.
    lightColour: new Color3(1.0, 0.14, 0.08),
  };
}

/**
 * Builds a car from primitives. Everything is flat-shaded and outlined — the look
 * comes from silhouette and banding, not from detail (§2.15).
 *
 * The size and shape contrast between the two cars is doing the most work here: the
 * player is a rounded bubble that sits low, the enemy is a slab that stands over
 * it. That reads as threat before any colour does.
 */
export function buildCar(scene: Scene, style: CarStyle, name: string): CarParts {
  const root = new TransformNode(`${name}-visual`, scene);
  const body = new TransformNode(`${name}-body`, scene);
  body.parent = root;

  const materials: ShaderMaterial[] = [];
  const { length: L, width: W, height: H } = style;

  const mat = (n: string, c: Color3, opts?: Parameters<typeof celMaterial>[3]) => {
    const m = celMaterial(`${name}-${n}`, scene, c, opts);
    materials.push(m);
    return m;
  };

  const bodyMat = mat("body", style.body);
  const roofMat = mat("roof", style.roof);
  const darkMat = mat("dark", PALETTE.tyre, { rimStrength: 0.5 });
  const glassMat = mat("glass", PALETTE.glass, { rimStrength: 0.62, rimPower: 2.2 });
  const chromeMat = mat("chrome", PALETTE.chrome, { rimStrength: 0.55 });

  const attach = (m: Mesh, parent: TransformNode, material: ShaderMaterial, ow = style.outlineWidth) => {
    m.parent = parent;
    m.material = material;
    m.convertToFlatShadedMesh();
    outline(m, ow);
    return m;
  };

  // ---- hull -------------------------------------------------------------
  const hullY = H * 0.34;
  let hull: Mesh;
  if (style.rounded) {
    // A low-segment sphere scaled to car proportions: faceted, soft-cornered, and
    // instantly readable as "small friendly car" at gameplay zoom.
    hull = MeshBuilder.CreateSphere(`${name}-hull`, { segments: 6, diameter: 1 }, scene);
    hull.scaling.set(W, H * 0.82, L);
  } else {
    hull = MeshBuilder.CreateBox(`${name}-hull`, { width: W, height: H * 0.62, depth: L }, scene);
  }
  hull.position.y = hullY;
  attach(hull, body, bodyMat);

  // ---- cabin ------------------------------------------------------------
  const cabin = style.rounded
    ? MeshBuilder.CreateSphere(`${name}-cabin`, { segments: 5, diameter: 1 }, scene)
    : MeshBuilder.CreateBox(`${name}-cabin`, { width: W * 0.86, height: H * 0.5, depth: L * 0.48 }, scene);
  if (style.rounded) cabin.scaling.set(W * 0.82, H * 0.6, L * 0.62);
  cabin.position.set(0, H * (style.rounded ? 0.66 : 0.62), style.rounded ? -L * 0.04 : -L * 0.06);
  attach(cabin, body, roofMat);

  // Windscreen band, so the cabin does not read as a solid lump. Deliberately not
  // a face — the face lives on the front bumper (§2.15).
  const glass = MeshBuilder.CreateBox(
    `${name}-glass`,
    { width: W * 0.7, height: H * 0.26, depth: L * 0.5 },
    scene
  );
  glass.position.set(0, H * (style.rounded ? 0.72 : 0.66), style.rounded ? -L * 0.02 : -L * 0.04);
  attach(glass, body, glassMat, style.outlineWidth * 0.6);

  // ---- face: headlights + grille ----------------------------------------
  const noseZ = L * 0.5;
  const eyeY = H * 0.36;
  const eyeX = W * 0.29;
  const eyeR = style.rounded ? 0.2 : 0.17;
  const headlights: Mesh[] = [];

  const lightColour = style.lightColour ?? PALETTE.headlight;
  const lightMat = mat("light", lightColour, {
    rimStrength: style.lightColour ? 0.9 : 0.15,
    rim: style.lightColour ?? undefined,
    shade: style.lightColour ? lightColour.scale(0.85) : undefined,
  });
  const pupilMat = mat("pupil", new Color3(0.08, 0.09, 0.14), { rimStrength: 0.1 });

  for (const side of [-1, 1]) {
    const lamp = MeshBuilder.CreateSphere(
      `${name}-lamp`,
      { segments: 6, diameter: eyeR * 2 },
      scene
    );
    lamp.scaling.set(1, style.rounded ? 1 : 0.72, 0.55);
    lamp.position.set(side * eyeX, eyeY, noseZ * 0.94);
    attach(lamp, body, lightMat, style.outlineWidth * 0.8);
    headlights.push(lamp);

    const pupil = MeshBuilder.CreateSphere(
      `${name}-pupil`,
      { segments: 6, diameter: eyeR * (style.rounded ? 1.0 : 0.85) },
      scene
    );
    pupil.scaling.set(1, style.rounded ? 1 : 0.7, 0.4);
    pupil.position.set(side * eyeX, eyeY - eyeR * 0.06, noseZ * 0.99);
    attach(pupil, body, pupilMat, 0);

    // Brow. Level and high on the player (wide-eyed), angled down and inward on the
    // enemy (hostile). One number does the whole personality difference.
    const brow = MeshBuilder.CreateBox(
      `${name}-brow`,
      { width: eyeR * 2.5, height: eyeR * 0.52, depth: eyeR * 0.5 },
      scene
    );
    brow.position.set(side * eyeX, eyeY + eyeR * (style.menace > 0 ? 0.9 : 1.15), noseZ * 0.95);
    brow.rotation.z = side * style.menace * 0.5;
    attach(brow, body, darkMat, style.outlineWidth * 0.7);
  }

  // Grille: the mouth. Small and pursed on the player, wide with teeth on the enemy.
  const grille = MeshBuilder.CreateBox(
    `${name}-grille`,
    {
      width: W * (style.menace > 0 ? 0.62 : 0.36),
      height: H * (style.menace > 0 ? 0.2 : 0.12),
      depth: 0.12,
    },
    scene
  );
  grille.position.set(0, H * (style.menace > 0 ? 0.16 : 0.14), noseZ * 0.99);
  attach(grille, body, darkMat, style.outlineWidth * 0.7);

  if (style.menace > 0) {
    for (let i = -2; i <= 2; i++) {
      const tooth = MeshBuilder.CreateBox(
        `${name}-tooth`,
        { width: W * 0.055, height: H * 0.2, depth: 0.06 },
        scene
      );
      tooth.position.set(i * W * 0.11, H * 0.16, noseZ * 1.02);
      attach(tooth, body, chromeMat, 0);
    }
  }

  // ---- bumpers ----------------------------------------------------------
  for (const z of [noseZ * 0.98, -noseZ * 0.98]) {
    const bumper = MeshBuilder.CreateBox(
      `${name}-bumper`,
      { width: W * 1.02, height: H * 0.16, depth: 0.16 },
      scene
    );
    bumper.position.set(0, H * 0.06, z);
    attach(bumper, body, chromeMat, style.outlineWidth * 0.7);
  }

  // ---- wheels -----------------------------------------------------------
  const wheelR = 0.33;
  const wheelZ = L * 0.31;
  const wheelX = W * 0.5;
  const wheels: WheelPart[] = [];
  const tyreMat = mat("tyre", PALETTE.tyre, { rimStrength: 0.28 });
  const hubMat = mat("hub", PALETTE.chrome, { rimStrength: 0.4 });

  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      const pivot = new TransformNode(`${name}-wheelPivot`, scene);
      pivot.parent = root; // unsprung: wheels do not roll with the body
      pivot.position.set(side * wheelX, wheelR, front ? wheelZ : -wheelZ);

      const spin = new TransformNode(`${name}-wheelSpin`, scene);
      spin.parent = pivot;

      const tyre = MeshBuilder.CreateCylinder(
        `${name}-tyre`,
        { diameter: wheelR * 2, height: 0.26, tessellation: 10 },
        scene
      );
      tyre.rotation.z = Math.PI / 2;
      attach(tyre, spin, tyreMat, style.outlineWidth * 0.8);

      const hub = MeshBuilder.CreateCylinder(
        `${name}-hub`,
        { diameter: wheelR * 1.05, height: 0.28, tessellation: 8 },
        scene
      );
      hub.rotation.z = Math.PI / 2;
      attach(hub, spin, hubMat, 0);

      wheels.push({ pivot, spin, front, side, restY: wheelR });
    }
  }

  // ---- extras -----------------------------------------------------------
  if (style.roofRack) {
    const rack = MeshBuilder.CreateBox(
      `${name}-rack`,
      { width: W * 0.9, height: 0.09, depth: L * 0.42 },
      scene
    );
    rack.position.set(0, H * 0.92, -L * 0.06);
    attach(rack, body, darkMat, style.outlineWidth * 0.7);
    for (const side of [-1, 1]) {
      const bar = MeshBuilder.CreateBox(
        `${name}-rackbar`,
        { width: 0.07, height: 0.16, depth: L * 0.42 },
        scene
      );
      bar.position.set(side * W * 0.4, H * 1.0, -L * 0.06);
      attach(bar, body, darkMat, 0);
    }
  }

  // ---- gas tank: the weak point -----------------------------------------
  // Deliberately the only saturated colour on an otherwise black car, sitting
  // proud of the tail so it is legible from the gameplay camera. It is a target,
  // so it has to look like one before anyone explains it.
  if (style.gasTank) {
    const tankMat = mat("tank", GAS_TANK_COLOUR, { rimStrength: 0.5 });
    const drum = MeshBuilder.CreateCylinder(
      `${name}-tank`,
      { diameter: H * 0.46, height: W * 0.72, tessellation: 10 },
      scene
    );
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, H * 0.3, -L * 0.54);
    attach(drum, body, tankMat, style.outlineWidth);

    // Filler cap, so the drum reads as a fuel tank rather than a pipe.
    const cap = MeshBuilder.CreateCylinder(
      `${name}-tankCap`,
      { diameter: H * 0.14, height: 0.08, tessellation: 8 },
      scene
    );
    cap.position.set(W * 0.2, H * 0.53, -L * 0.54);
    attach(cap, body, chromeMat, style.outlineWidth * 0.6);
  }

  if (style.spoiler) {
    const wing = MeshBuilder.CreateBox(
      `${name}-wing`,
      { width: W * 0.92, height: 0.08, depth: 0.32 },
      scene
    );
    wing.position.set(0, H * 0.78, -L * 0.52);
    attach(wing, body, darkMat, style.outlineWidth * 0.8);
    for (const side of [-1, 1]) {
      const strut = MeshBuilder.CreateBox(
        `${name}-strut`,
        { width: 0.08, height: 0.2, depth: 0.1 },
        scene
      );
      strut.position.set(side * W * 0.34, H * 0.68, -L * 0.52);
      attach(strut, body, darkMat, 0);
    }
  }

  // ---- antenna ----------------------------------------------------------
  // A chain of short segments, each rotated a little by the one below it. Three is
  // enough to read as whippy without any real cost.
  const antenna: TransformNode[] = [];
  if (style.antenna) {
    const segLen = 0.44;
    let parent: TransformNode = body;
    let baseY = H * 0.95;
    for (let i = 0; i < 3; i++) {
      const seg = new TransformNode(`${name}-ant${i}`, scene);
      seg.parent = parent;
      seg.position.set(0, i === 0 ? baseY : segLen, i === 0 ? -L * 0.3 : 0);
      const rod = MeshBuilder.CreateCylinder(
        `${name}-rod`,
        { diameter: 0.1, height: segLen, tessellation: 5 },
        scene
      );
      rod.position.y = segLen * 0.5;
      attach(rod, seg, darkMat, 0);
      antenna.push(seg);
      parent = seg;
      baseY = 0;
    }
    const ball = MeshBuilder.CreateSphere(`${name}-antball`, { segments: 5, diameter: 0.15 }, scene);
    ball.position.y = segLen;
    ball.scaling.setAll(2);
    attach(ball, antenna[antenna.length - 1], mat("antball", PALETTE.playerYellow), 0.02);
  }

  // ---- shadow -----------------------------------------------------------
  // Two layers rather than a shadow map. A real shadow map would need the cel
  // shader to sample it, and these materials are hand-written — that is a lot of
  // fragile plumbing for a look that wants stylised shadows anyway.
  //
  // The soft layer is a wide, faint penumbra that sells contact with the ground.
  // The core is small, dark and tight under the chassis: that hard edge is what
  // makes the car feel like it is *sitting* on the deck rather than hovering over
  // a smudge. One without the other reads as either a stain or a sticker.
  const shadow = new Mesh(`${name}-shadow`, scene);

  const soft = MeshBuilder.CreateDisc(`${name}-shadowSoft`, { radius: 1, tessellation: 20 }, scene);
  soft.rotation.x = Math.PI / 2;
  soft.parent = shadow;
  const softMat = new StandardMaterial(`${name}-shadowSoftMat`, scene);
  softMat.diffuseColor = Color3.Black();
  softMat.specularColor = Color3.Black();
  softMat.emissiveColor = new Color3(0.03, 0.02, 0.08);
  softMat.alpha = 0.2;
  softMat.disableLighting = true;
  softMat.zOffset = -3;
  soft.material = softMat;
  soft.isPickable = false;
  soft.scaling.setAll(1.55);

  const core = MeshBuilder.CreateDisc(`${name}-shadowCore`, { radius: 1, tessellation: 16 }, scene);
  core.rotation.x = Math.PI / 2;
  core.parent = shadow;
  const coreMat = new StandardMaterial(`${name}-shadowCoreMat`, scene);
  coreMat.diffuseColor = Color3.Black();
  coreMat.specularColor = Color3.Black();
  coreMat.emissiveColor = Color3.Black();
  coreMat.alpha = 0.46;
  coreMat.disableLighting = true;
  coreMat.zOffset = -4;
  core.material = coreMat;
  core.isPickable = false;
  core.scaling.setAll(0.82);

  shadow.isPickable = false;
  shadow.scaling.set(W * 0.62, L * 0.6, 1);

  return { root, body, wheels, antenna, materials, shadow, headlights, lightMaterial: lightMat };
}
