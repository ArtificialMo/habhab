import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

import { TUNING } from "../data/tuning";
import { celMaterial, outline, PALETTE } from "./style";
import { type Archipelago, bridgeSpan } from "../world/archipelago";

/**
 * The island and everything around it.
 *
 * The play surface is kept deliberately bare. §4.5 defers island elements, and
 * anything standing on the deck becomes a collision obstacle whether or not it was
 * meant to be one — so the scale anchors the reference calls for (cypresses, flower
 * pots, the villa) live on background land across the water instead. The arena is
 * decorated by paving and colour, not by geometry.
 */
export class Environment {
  private readonly foam: Mesh;
  private readonly sea: Mesh;
  private readonly seaMat: ShaderMaterial;
  private seaTime = 0;
  private readonly gulls: { node: TransformNode; radius: number; speed: number; phase: number; y: number }[] = [];
  private readonly clouds: { mesh: Mesh; speed: number }[] = [];
  private time = 0;
  private readonly lowPower: boolean;

  constructor(scene: Scene, world: Archipelago, options: { lowPower?: boolean } = {}) {
    this.lowPower = Boolean(options.lowPower);
    const R = TUNING.world.islandRadius;

    // ---- sea -------------------------------------------------------------
    this.sea = MeshBuilder.CreateGround("sea", { width: 840, height: 840, subdivisions: 110 }, scene);
    this.sea.position.y = -9;
    this.seaMat = celMaterial("seaMat", scene, PALETTE.sea, {
      waveAmp: 0.55,
      shade: PALETTE.seaDeep,
      rim: new Color3(0.7, 0.92, 1),
      rimStrength: 0.2,
      softness: 0.25,
      // Deepens with distance from the island, so the water has somewhere to go.
      ground: 1,
      groundRadius: 150,
      groundRimTint: new Color3(0.45, 0.62, 0.95),
    });
    this.sea.material = this.seaMat;
    this.sea.isPickable = false;

    // Lighter shelf right around the island, so the drop reads as a drop.
    const shelf = MeshBuilder.CreateDisc("shelf", { radius: R + 16, tessellation: 48 }, scene);
    shelf.rotation.x = Math.PI / 2;
    shelf.position.y = -8.7;
    shelf.material = celMaterial("shelfMat", scene, new Color3(0.16, 0.62, 0.95), {
      shade: new Color3(0.08, 0.42, 0.78),
      rimStrength: 0.1,
      softness: 0.3,
    });
    shelf.isPickable = false;

    // ---- cliff -----------------------------------------------------------
    // Faceted, slightly flared at the base so it reads as rock rather than a pipe.
    const cliff = MeshBuilder.CreateCylinder(
      "cliff",
      { diameterTop: R * 2, diameterBottom: R * 2.32, height: 11, tessellation: 22 },
      scene
    );
    cliff.position.y = -5.75;
    cliff.material = celMaterial("cliffMat", scene, PALETTE.cliff, {
      shade: PALETTE.cliffDark,
      rimStrength: 0.18,
      softness: 0.08,
    });
    cliff.convertToFlatShadedMesh();
    outline(cliff, 0.12);
    cliff.isPickable = false;

    // ---- deck ------------------------------------------------------------
    // The visual deck matches the collider radius exactly, so a car goes over the
    // edge at the moment it looks like it should.
    const deck = MeshBuilder.CreateCylinder(
      "deck",
      { diameter: R * 2, height: 0.5, tessellation: 48 },
      scene
    );
    deck.position.y = -0.25;
    // The deck reads as turf, not paving: the grass grows out of it, so the ground
    // under the blades has to be the same family of green or the field looks like
    // it is sitting on a beach.
    deck.material = celMaterial("deckMat", scene, PALETTE.grass.scale(0.72), {
      shade: PALETTE.cypress.scale(0.85),
      rimStrength: 0.12,
      softness: 0.12,
      // The arena floor is the largest thing on screen; without this it is one flat
      // value across a third of the frame.
      ground: 1,
      groundRadius: R,
      groundRimTint: new Color3(0.42, 0.5, 0.4),
    });
    // Deliberately no outline. Babylon draws outlines as a shell offset along the
    // normals, so a 0.1-unit outline on the deck floats a surface 0.1 above it and
    // swallows anything lying on the ground — grass mats, paving rings, the aim
    // arrow. The deck's silhouette against the sea is already a hard edge.
    deck.isPickable = false;

    // Darker paving band at the rim. Colour, not geometry: a raised lip would imply
    // the edge stops you, and it must not.
    const band = MeshBuilder.CreateTorus(
      "rimBand",
      { diameter: R * 2 - 1.1, thickness: 1.1, tessellation: 48 },
      scene
    );
    band.position.y = 0.008;
    band.scaling.y = 0.04;
    band.material = celMaterial("bandMat", scene, PALETTE.stoneShadow, {
      shade: PALETTE.stoneShadow.scale(0.7),
      rimStrength: 0.1,
      softness: 0.2,
    });
    band.isPickable = false;

    // Inner paving rings, for scale reference while sliding across the deck.
    for (const [d, a] of [
      [R * 1.05, 0.5],
      [R * 0.62, 0.35],
    ] as const) {
      const ring = MeshBuilder.CreateTorus(
        "paveRing",
        { diameter: d, thickness: 0.22, tessellation: 40 },
        scene
      );
      ring.position.y = 0.006;
      ring.scaling.y = 0.05;
      const m = new StandardMaterial("paveRingMat", scene);
      m.diffuseColor = PALETTE.stoneShadow;
      m.specularColor = Color3.Black();
      m.alpha = a;
      ring.material = m;
      ring.isPickable = false;
    }

    // ---- foam ------------------------------------------------------------
    this.foam = MeshBuilder.CreateTorus(
      "foam",
      { diameter: R * 2.34, thickness: 1.5, tessellation: 40 },
      scene
    );
    this.foam.position.y = -8.75;
    this.foam.scaling.y = 0.12;
    const foamMat = new StandardMaterial("foamMat", scene);
    foamMat.diffuseColor = PALETTE.seaFoam;
    foamMat.emissiveColor = PALETTE.seaFoam.scale(0.55);
    foamMat.specularColor = Color3.Black();
    foamMat.alpha = 0.85;
    this.foam.material = foamMat;
    this.foam.isPickable = false;

    this.buildOuterIsles(scene, world);
    this.buildBridges(scene, world);
    this.buildRocks(scene, R);
    this.buildBackgroundLand(scene, R);
    this.buildSky(scene);
    this.freezeStatics(scene);
  }

  /**
   * Scenery never moves, so its world matrices never need recomputing. Environment
   * is built before anything else exists, so every mesh in the scene at this point
   * is ours — except the handful this class animates, which are excluded by name.
   *
   * This is CPU only. The draw-call count is unchanged, and with outlines doubling
   * the passes on gameplay objects that remains the thing to watch on mobile.
   */
  private freezeStatics(scene: Scene): void {
    const moving = new Set<unknown>([this.sea, this.foam]);
    for (const c of this.clouds) moving.add(c.mesh);
    for (const g of this.gulls) for (const child of g.node.getChildMeshes()) moving.add(child);

    for (const mesh of scene.meshes) {
      if (moving.has(mesh)) continue;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
    }
  }

  /**
   * The outlying isles. Same deck/cliff recipe as the arena so they read as the
   * same landmass family, at a smaller scale.
   */
  private buildOuterIsles(scene: Scene, world: Archipelago): void {
    const deckMat = celMaterial("isleDeckMat", scene, PALETTE.grass.scale(0.72), {
      shade: PALETTE.cypress.scale(0.85),
      rimStrength: 0.12,
      softness: 0.12,
    });
    const cliffMat = celMaterial("isleCliffMat", scene, PALETTE.cliff, {
      shade: PALETTE.cliffDark,
      rimStrength: 0.18,
      softness: 0.08,
    });

    for (const [i, isle] of world.islands.entries()) {
      if (i === 0) continue; // the arena is built above

      const cliff = MeshBuilder.CreateCylinder(
        `isleCliff${i}`,
        {
          diameterTop: isle.radius * 2,
          diameterBottom: isle.radius * 2.3,
          height: 11,
          tessellation: 16,
        },
        scene
      );
      cliff.position.set(isle.x, -5.75, isle.z);
      cliff.material = cliffMat;
      cliff.convertToFlatShadedMesh();
      outline(cliff, 0.12);

      const deck = MeshBuilder.CreateCylinder(
        `isleDeck${i}`,
        { diameter: isle.radius * 2, height: 0.5, tessellation: 32 },
        scene
      );
      deck.position.set(isle.x, -0.25, isle.z);
      deck.material = deckMat;

      const foam = MeshBuilder.CreateTorus(
        `isleFoam${i}`,
        { diameter: isle.radius * 2.32, thickness: 1.2, tessellation: 28 },
        scene
      );
      foam.position.set(isle.x, -8.75, isle.z);
      foam.scaling.y = 0.12;
      const fm = new StandardMaterial(`isleFoamMat${i}`, scene);
      fm.diffuseColor = PALETTE.seaFoam;
      fm.emissiveColor = PALETTE.seaFoam.scale(0.5);
      fm.specularColor = Color3.Black();
      fm.alpha = 0.8;
      foam.material = fm;

      for (let c = 0; c < isle.cottages; c++) {
        const a = (c / Math.max(1, isle.cottages)) * Math.PI * 2 + i;
        const d = isle.radius * 0.42;
        this.buildCottage(scene, isle.x + Math.cos(a) * d, isle.z + Math.sin(a) * d, a, `${i}-${c}`);
      }
    }
  }

  /**
   * A small Italian cottage: cream walls, terracotta roof, green shutters. Placed
   * on the outer isles only — anything standing on the arena deck becomes a
   * collision obstacle whether or not it was meant to be one.
   */
  private buildCottage(scene: Scene, x: number, z: number, yaw: number, id: string): void {
    const wallMat = celMaterial(`cottageWall${id}`, scene, PALETTE.cream, {
      shade: PALETTE.cream.scale(0.7),
      rimStrength: 0.16,
      softness: 0.1,
    });
    const roofMat = celMaterial(`cottageRoof${id}`, scene, PALETTE.terracotta, {
      shade: PALETTE.terracotta.scale(0.62),
      rimStrength: 0.2,
      softness: 0.08,
    });
    const shutterMat = celMaterial(`cottageShutter${id}`, scene, PALETTE.shutterGreen, {
      rimStrength: 0.15,
    });

    const root = new TransformNode(`cottage${id}`, scene);
    root.position.set(x, 0, z);
    root.rotation.y = yaw;

    const w = 3.1;
    const d = 2.5;
    const h = 2.4;
    const walls = MeshBuilder.CreateBox(`cottageBody${id}`, { width: w, height: h, depth: d }, scene);
    walls.position.y = h / 2;
    walls.parent = root;
    walls.material = wallMat;
    walls.convertToFlatShadedMesh();
    outline(walls, 0.05);

    // Pitched roof: a 3-sided cylinder is a prism, which is a gable for free.
    const roof = MeshBuilder.CreateCylinder(
      `cottageRoof${id}`,
      { diameter: w * 1.16, height: d * 1.2, tessellation: 3 },
      scene
    );
    roof.rotation.set(Math.PI / 2, 0, 0);
    roof.position.y = h + 0.42;
    roof.parent = root;
    roof.material = roofMat;
    roof.convertToFlatShadedMesh();
    outline(roof, 0.05);

    for (const side of [-1, 1]) {
      const shutter = MeshBuilder.CreateBox(
        `cottageShutter${id}${side}`,
        { width: 0.52, height: 0.72, depth: 0.08 },
        scene
      );
      shutter.position.set(side * 0.7, h * 0.55, d / 2 + 0.04);
      shutter.parent = root;
      shutter.material = shutterMat;
      outline(shutter, 0.03);
    }
  }

  /** Wooden plank bridges between the isles. */
  private buildBridges(scene: Scene, world: Archipelago): void {
    const plankMat = celMaterial("plankMat", scene, new Color3(0.55, 0.38, 0.22), {
      shade: new Color3(0.32, 0.21, 0.13),
      rimStrength: 0.18,
      softness: 0.1,
    });
    const railMat = celMaterial("railMat", scene, new Color3(0.42, 0.28, 0.16), {
      shade: new Color3(0.24, 0.15, 0.09),
      rimStrength: 0.2,
    });

    for (const [i, b] of world.bridges.entries()) {
      const span = bridgeSpan(world.islands[b.from], world.islands[b.to]);
      const root = new TransformNode(`bridge${i}`, scene);
      root.position.set((span.x1 + span.x2) / 2, 0, (span.z1 + span.z2) / 2);
      root.rotation.y = span.angle;

      // Individual planks, so the deck reads as timber rather than as a brown slab.
      const plankCount = Math.max(4, Math.round(span.length / 0.85));
      const step = span.length / plankCount;
      for (let p = 0; p < plankCount; p++) {
        const plank = MeshBuilder.CreateBox(
          `plank${i}_${p}`,
          { width: b.width, height: 0.16, depth: step * 0.82 },
          scene
        );
        plank.position.set(0, -0.06, -span.length / 2 + step * (p + 0.5));
        plank.parent = root;
        plank.material = plankMat;
      }

      // Rails: posts and a top rail. Visual only — no collider, so a car pushed
      // sideways off a bridge actually goes over, which is the point of a bridge.
      for (const side of [-1, 1]) {
        const rail = MeshBuilder.CreateBox(
          `rail${i}${side}`,
          { width: 0.12, height: 0.12, depth: span.length },
          scene
        );
        rail.position.set((side * b.width) / 2, 0.62, 0);
        rail.parent = root;
        rail.material = railMat;
        outline(rail, 0.03);

        const posts = Math.max(2, Math.round(span.length / 3));
        for (let q = 0; q <= posts; q++) {
          const post = MeshBuilder.CreateBox(
            `post${i}${side}_${q}`,
            { width: 0.16, height: 0.72, depth: 0.16 },
            scene
          );
          post.position.set(
            (side * b.width) / 2,
            0.3,
            -span.length / 2 + (span.length / posts) * q
          );
          post.parent = root;
          post.material = railMat;
          outline(post, 0.03);
        }
      }
    }
  }

  /** Rocks at the waterline, so the fall has something to fall past. */
  private buildRocks(scene: Scene, R: number): void {
    const rockMat = celMaterial("rockMat", scene, PALETTE.cliff.scale(0.92), {
      shade: PALETTE.cliffDark.scale(0.85),
      rimStrength: 0.2,
    });
    const seeded = mulberry32(7);
    for (let i = 0; i < 16; i++) {
      const a = seeded() * Math.PI * 2;
      const dist = R + 2.5 + seeded() * 8;
      // A 3-segment sphere gives an irregular chunk. A flattened octahedron — the
      // obvious choice — renders as a clean diamond plate, which at this scale read
      // as brown slabs floating on the water rather than as rock.
      const s = 0.5 + seeded() * 1.15;
      const rock = MeshBuilder.CreateSphere("rock", { segments: 3, diameter: s * 2 }, scene);
      rock.position.set(Math.cos(a) * dist, -9.3 + seeded() * 0.7, Math.sin(a) * dist);
      rock.rotation.set(seeded() * 3, seeded() * 3, seeded() * 3);
      rock.scaling.set(1 + seeded() * 0.5, 0.8 + seeded() * 0.7, 1 + seeded() * 0.5);
      rock.material = rockMat;
      rock.convertToFlatShadedMesh();
      outline(rock, 0.06);
      rock.isPickable = false;
    }
  }

  /**
   * Background land across the water: the villa, cypresses and flower pots from the
   * art reference, placed where they can be scale anchors without ever being
   * something a car can hit.
   */
  private buildBackgroundLand(scene: Scene, R: number): void {
    const land = new TransformNode("backgroundLand", scene);
    land.position.set(R * 1.35, 0, R * 1.55);
    land.rotation.y = -0.6;

    const stoneMat = celMaterial("bgStone", scene, PALETTE.cliff, {
      shade: PALETTE.cliffDark,
      rimStrength: 0.15,
    });
    const deckMat = celMaterial("bgDeck", scene, PALETTE.stone, { shade: PALETTE.stoneShadow });
    const creamMat = celMaterial("bgCream", scene, PALETTE.cream, {
      shade: PALETTE.cream.scale(0.62),
    });
    const roofMat = celMaterial("bgRoof", scene, PALETTE.terracotta, {
      shade: PALETTE.terracotta.scale(0.6),
    });
    const shutterMat = celMaterial("bgShutter", scene, PALETTE.shutterGreen, {
      shade: PALETTE.shutterGreen.scale(0.6),
    });
    const cypressMat = celMaterial("bgCypress", scene, PALETTE.cypress, {
      shade: PALETTE.cypress.scale(0.55),
      rimStrength: 0.25,
    });
    const potMat = celMaterial("bgPot", scene, PALETTE.terracotta.scale(0.92), {
      shade: PALETTE.terracotta.scale(0.55),
    });
    const flowerMat = celMaterial("bgFlower", scene, PALETTE.flower, {
      shade: PALETTE.flower.scale(0.6),
    });

    const plateau = MeshBuilder.CreateCylinder(
      "bgPlateau",
      { diameterTop: 34, diameterBottom: 40, height: 12, tessellation: 16 },
      scene
    );
    plateau.position.y = -4.2;
    plateau.parent = land;
    plateau.material = stoneMat;
    plateau.convertToFlatShadedMesh();
    outline(plateau, 0.12);

    const terrace = MeshBuilder.CreateCylinder(
      "bgTerrace",
      { diameter: 34, height: 0.6, tessellation: 16 },
      scene
    );
    terrace.position.y = 1.9;
    terrace.parent = land;
    terrace.material = deckMat;
    outline(terrace, 0.1);

    // Villa
    const villa = new TransformNode("villa", scene);
    villa.parent = land;
    villa.position.set(0, 2.2, 2);

    const walls = MeshBuilder.CreateBox("villaWalls", { width: 12, height: 6.5, depth: 9 }, scene);
    walls.position.y = 3.25;
    walls.parent = villa;
    walls.material = creamMat;
    outline(walls, 0.09);

    const roof = MeshBuilder.CreateCylinder(
      "villaRoof",
      { diameter: 10.4, height: 11.5, tessellation: 4 },
      scene
    );
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 4;
    roof.scaling.y = 1.25;
    roof.position.y = 7.2;
    roof.parent = villa;
    roof.material = roofMat;
    roof.convertToFlatShadedMesh();
    outline(roof, 0.1);

    for (const [x, y] of [
      [-3.6, 4.4],
      [3.6, 4.4],
      [-3.6, 1.6],
      [3.6, 1.6],
    ] as const) {
      const shutter = MeshBuilder.CreateBox("shutter", { width: 1.9, height: 2.2, depth: 0.2 }, scene);
      shutter.position.set(x, y, 4.6);
      shutter.parent = villa;
      shutter.material = shutterMat;
      outline(shutter, 0.05);
    }

    const door = MeshBuilder.CreateBox("door", { width: 2.2, height: 3.4, depth: 0.24 }, scene);
    door.position.set(0, 1.7, 4.6);
    door.parent = villa;
    door.material = shutterMat;
    outline(door, 0.05);

    // Cypresses and pots, the reference's scale anchors.
    const seeded = mulberry32(21);
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + seeded() * 2.6;
      const dist = 11 + seeded() * 5;
      const h = 4.5 + seeded() * 3.2;
      const tree = MeshBuilder.CreateCylinder(
        "cypress",
        { diameterTop: 0.15, diameterBottom: 1.5, height: h, tessellation: 7 },
        scene
      );
      tree.position.set(Math.cos(a) * dist, 2.2 + h / 2, Math.sin(a) * dist);
      tree.parent = land;
      tree.material = cypressMat;
      tree.convertToFlatShadedMesh();
      outline(tree, 0.07);
    }

    for (let i = 0; i < 6; i++) {
      const a = -1.2 + seeded() * 3.0;
      const dist = 13 + seeded() * 3;
      const pot = MeshBuilder.CreateCylinder(
        "pot",
        { diameterTop: 1.2, diameterBottom: 0.85, height: 1.1, tessellation: 8 },
        scene
      );
      pot.position.set(Math.cos(a) * dist, 2.75, Math.sin(a) * dist);
      pot.parent = land;
      pot.material = potMat;
      outline(pot, 0.06);

      const bloom = MeshBuilder.CreateSphere("bloom", { segments: 4, diameter: 1.35 }, scene);
      bloom.position.set(pot.position.x, 3.6, pot.position.z);
      bloom.scaling.y = 0.65;
      bloom.parent = land;
      bloom.material = flowerMat;
      bloom.convertToFlatShadedMesh();
      outline(bloom, 0.05);
    }

    // Distant coastline, purely for depth.
    const hazeMat = celMaterial("haze", scene, new Color3(0.62, 0.72, 0.8), {
      shade: new Color3(0.48, 0.6, 0.72),
      rimStrength: 0.1,
      softness: 0.3,
    });
    for (let i = 0; i < 9; i++) {
      const a = seeded() * Math.PI * 2;
      const dist = 190 + seeded() * 90;
      const w = 40 + seeded() * 90;
      const h = 8 + seeded() * 22;
      const hill = MeshBuilder.CreateCylinder(
        "coast",
        { diameterTop: w * 0.3, diameterBottom: w, height: h, tessellation: 6 },
        scene
      );
      hill.position.set(Math.cos(a) * dist, -9 + h / 2, Math.sin(a) * dist);
      hill.material = hazeMat;
      hill.convertToFlatShadedMesh();
      hill.isPickable = false;
    }

    // A sailboat, straight from the reference.
    const boat = new TransformNode("sailboat", scene);
    boat.position.set(-R * 2.4, -8.4, R * 1.1);
    boat.rotation.y = 0.7;
    const hull = MeshBuilder.CreateBox("boatHull", { width: 1.4, height: 0.7, depth: 4.6 }, scene);
    hull.parent = boat;
    hull.material = celMaterial("boatHull", scene, PALETTE.cream, { shade: PALETTE.cream.scale(0.6) });
    outline(hull, 0.06);
    const sail = MeshBuilder.CreateCylinder("sail", { diameterTop: 0.05, diameterBottom: 2.4, height: 4.4, tessellation: 3 }, scene);
    sail.position.y = 2.5;
    sail.parent = boat;
    sail.material = celMaterial("sailMat", scene, new Color3(1, 1, 1), { shade: new Color3(0.7, 0.78, 0.88) });
    sail.convertToFlatShadedMesh();
    outline(sail, 0.06);
  }

  private buildSky(scene: Scene): void {
    const cloudMat = celMaterial("cloudMat", scene, new Color3(1, 1, 1), {
      shade: new Color3(0.82, 0.88, 0.96),
      rimStrength: 0.12,
      softness: 0.3,
    });
    const gullMat = celMaterial("gullMat", scene, new Color3(0.99, 0.99, 1), {
      shade: new Color3(0.7, 0.75, 0.85),
      rimStrength: 0.1,
    });
    const seeded = mulberry32(99);

    for (let i = 0; i < (this.lowPower ? 5 : 10); i++) {
      const cloud = new Mesh(`cloud${i}`, scene);
      const puffs: Mesh[] = [];
      const puffCount = 3 + Math.floor(seeded() * 3);
      for (let p = 0; p < puffCount; p++) {
        const puff = MeshBuilder.CreateSphere("puff", { segments: 4, diameter: 6 + seeded() * 9 }, scene);
        puff.position.set((p - puffCount / 2) * 5 + seeded() * 2, seeded() * 2.2, seeded() * 3);
        puff.scaling.y = 0.62;
        puffs.push(puff);
      }
      const merged = Mesh.MergeMeshes(puffs, true, true, undefined, false, false);
      cloud.dispose();
      if (!merged) continue;
      merged.name = `cloud${i}`;
      merged.material = cloudMat;
      merged.convertToFlatShadedMesh();
      merged.isPickable = false;
      const a = seeded() * Math.PI * 2;
      const dist = 90 + seeded() * 140;
      merged.position.set(Math.cos(a) * dist, 34 + seeded() * 26, Math.sin(a) * dist);
      this.clouds.push({ mesh: merged, speed: 0.5 + seeded() * 0.9 });
    }

    this.buildSoftClouds(scene, this.lowPower);

    for (let i = 0; i < (this.lowPower ? 2 : 5); i++) {
      const node = new TransformNode(`gull${i}`, scene);
      for (const side of [-1, 1]) {
        const wing = MeshBuilder.CreateBox("wing", { width: 1.5, height: 0.09, depth: 0.42 }, scene);
        wing.position.set(side * 0.75, 0, 0);
        wing.rotation.z = -side * 0.32;
        wing.parent = node;
        wing.material = gullMat;
        outline(wing, 0.03);
      }
      const radius = 34 + seeded() * 30;
      this.gulls.push({
        node,
        radius,
        speed: 0.16 + seeded() * 0.16,
        phase: seeded() * Math.PI * 2,
        y: 22 + seeded() * 14,
      });
    }
  }

  /** Large alpha-soft cloud cards sit high and wide, framing the playable island. */
  private buildSoftClouds(scene: Scene, lowPower = false): void {
    const cloudTexture = softCloudTexture(scene);
    const cloudMat = new StandardMaterial("softCloudMat", scene);
    cloudMat.diffuseTexture = cloudTexture;
    cloudMat.useAlphaFromDiffuseTexture = true;
    cloudMat.diffuseColor = new Color3(1, 1, 1);
    cloudMat.emissiveColor = new Color3(0.92, 0.95, 1);
    cloudMat.specularColor = Color3.Black();
    cloudMat.disableLighting = true;
    cloudMat.backFaceCulling = false;
    cloudMat.alpha = 0.68;

    const framing = [
      { x: -30, y: 23, z: 56, width: 28, height: 12, speed: 0.2 },
      { x: 28, y: 27, z: 66, width: 34, height: 14, speed: 0.26 },
      { x: -8, y: 34, z: 92, width: 42, height: 17, speed: 0.14 },
      { x: 37, y: 18, z: 38, width: 22, height: 9, speed: 0.32 },
      { x: -38, y: 17, z: 32, width: 24, height: 10, speed: 0.28 },
    ];

    const visibleFraming = lowPower ? framing.slice(0, 3) : framing;
    for (const [index, cloud] of visibleFraming.entries()) {
      const plane = MeshBuilder.CreatePlane(
        "softCloud" + index,
        { width: cloud.width, height: cloud.height },
        scene
      );
      plane.position.set(cloud.x, cloud.y, cloud.z);
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.material = cloudMat;
      plane.isPickable = false;
      plane.renderingGroupId = 0;
      this.clouds.push({ mesh: plane, speed: cloud.speed });
    }
  }

  update(dt: number): void {
    // Water animates on real time, independent of any gameplay slow-motion.
    this.seaTime += dt;
    this.seaMat.setFloat("waveTime", this.seaTime);
    this.time += dt;

    // Swell: the sea and its foam breathe, which is most of what sells water at
    // this level of stylisation.
    this.sea.position.y = -9 + Math.sin(this.time * 0.55) * 0.16;
    const pulse = 1 + Math.sin(this.time * 0.85) * 0.012;
    this.foam.scaling.x = pulse;
    this.foam.scaling.z = pulse;
    this.foam.position.y = -8.75 + Math.sin(this.time * 0.55 + 0.6) * 0.16;

    for (const c of this.clouds) {
      c.mesh.position.x += c.speed * dt;
      if (c.mesh.position.x > 250) c.mesh.position.x = -250;
    }

    for (const g of this.gulls) {
      const a = this.time * g.speed + g.phase;
      g.node.position.set(Math.cos(a) * g.radius, g.y + Math.sin(a * 2.3) * 1.6, Math.sin(a) * g.radius);
      g.node.rotation.y = -a + Math.PI / 2;
      g.node.rotation.z = Math.sin(this.time * 6 + g.phase) * 0.22;
    }
  }
}

function softCloudTexture(scene: Scene): DynamicTexture {
  const size = { width: 256, height: 128 };
  const texture = new DynamicTexture("softCloudTexture", size, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size.width, size.height);

  const blobs = [
    { x: 38, y: 80, rx: 56, ry: 30 },
    { x: 94, y: 54, rx: 70, ry: 42 },
    { x: 158, y: 64, rx: 68, ry: 38 },
    { x: 218, y: 82, rx: 52, ry: 28 },
  ];
  for (const blob of blobs) {
    const gradient = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, Math.max(blob.rx, blob.ry));
    gradient.addColorStop(0, "rgba(255,255,255,0.78)");
    gradient.addColorStop(0.48, "rgba(255,255,255,0.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(blob.x, blob.y, blob.rx, blob.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/** Small deterministic PRNG, so scenery layout is identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
