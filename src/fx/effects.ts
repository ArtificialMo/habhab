import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Particles/particleSystemComponent";

import { TUNING } from "../data/tuning";
import { PALETTE } from "../render/style";

/** Effect identifiers (§3.5 hook 5): new events map to these, not to new systems. */
export type EffectId = "spark" | "dust" | "debris" | "smoke" | "leaf" | "spray" | "fire" | "sparkle";

const COMIC_WORDS = ["THWACK", "BONK", "BANG", "CRASH", "CLONK", "WHAM", "BOOM"];

/**
 * All impact feedback that is not camera or audio. Everything is pooled and
 * pre-warmed: allocating a particle system or a texture at the moment of impact is
 * exactly when a frame spike is least affordable.
 */
export class Effects {
  private readonly systems = new Map<EffectId, ParticleSystem[]>();
  private readonly cursors = new Map<EffectId, number>();
  private readonly words: ComicWord[] = [];
  private wordCursor = 0;
  private lastWordAt = -99;
  private time = 0;
  private readonly rings: ShockRing[] = [];
  private ringCursor = 0;
  private readonly flashEl: HTMLElement;
  private readonly impactRaysEl: HTMLElement;
  private readonly impactRayEls: HTMLElement[] = [];
  private flash = 0;
  private rayLife = 0;
  private rayStrength = 0;
  private usedWords = new Set<string>();

  constructor(
    private readonly scene: Scene,
    overlayRoot: HTMLElement
  ) {
    const dot = softDot(scene);
    const shard = shardTexture(scene);
    const blade = bladeTexture(scene);

    this.pool("spark", 4, () => this.makeSparks(shard));
    this.pool("debris", 3, () => this.makeDebris(shard));
    this.pool("dust", 3, () => this.makeDust(dot));
    this.pool("smoke", 2, () => this.makeSmoke(dot));
    this.pool("leaf", 2, () => this.makeLeaves(blade));
    this.pool("spray", 2, () => this.makeSpray(dot));
    this.pool("fire", 3, () => this.makeFire(dot));
    this.pool("sparkle", 3, () => this.makeSparkle(dot));

    for (let i = 0; i < 4; i++) this.words.push(new ComicWord(scene, i));
    for (let i = 0; i < 3; i++) this.rings.push(new ShockRing(scene, i));

    // Particles (group 1) keep the depth buffer from group 0, so geometry still
    // hides them. Comic words live in group 2 and *do* clear depth, because a word
    // half-swallowed by a car reads as a glitch rather than as punctuation.
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);
    scene.setRenderingAutoClearDepthStencil(2, true, false, false);

    this.flashEl = document.createElement("div");
    this.flashEl.style.cssText =
      "position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:3;";
    overlayRoot.appendChild(this.flashEl);

    this.impactRaysEl = document.createElement("div");
    this.impactRaysEl.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden;mix-blend-mode:screen;";
    for (let i = 0; i < 8; i++) {
      const ray = document.createElement("span");
      ray.style.cssText =
        "position:absolute;left:50%;top:50%;width:13vmin;height:3px;" +
        "transform-origin:0 50%;opacity:0;border-radius:999px;" +
        "box-shadow:0 0 12px currentColor;will-change:transform,opacity;";
      this.impactRayEls.push(ray);
      this.impactRaysEl.appendChild(ray);
    }
    overlayRoot.appendChild(this.impactRaysEl);
  }

  private pool(id: EffectId, count: number, make: () => ParticleSystem): void {
    const arr: ParticleSystem[] = [];
    for (let i = 0; i < count; i++) {
      const ps = make();
      // Group 1 draws after the ground, so smoke and dust sit on top of skid marks
      // instead of being lost under them. Depth is deliberately *not* cleared for
      // this group (see Effects constructor), so cars still occlude particles
      // properly — only the flat ground decals lose the argument.
      ps.renderingGroupId = 1;
      arr.push(ps);
    }
    this.systems.set(id, arr);
    this.cursors.set(id, 0);
  }

  private next(id: EffectId): ParticleSystem {
    const arr = this.systems.get(id)!;
    const i = this.cursors.get(id)!;
    this.cursors.set(id, (i + 1) % arr.length);
    return arr[i];
  }

  /**
   * The whole impact response for one hit, tiered by strength per §2.8. Taking the
   * tier decision in one place is what keeps small taps and big charges feeling
   * like the same language at different volumes.
   */
  impact(position: Vector3, strength: number, rear: boolean, normal: Vector3): void {
    const v = TUNING.vfx;
    const major = strength >= v.majorThreshold;
    const medium = strength >= v.mediumThreshold;
    this.rayBurst(strength, rear);

    const sparks = this.next("spark");
    sparks.emitter = position.clone();
    const count = Math.min(v.sparkCountMax, Math.round(6 + strength * v.sparkCountPerDeltaV));
    sparks.manualEmitCount = rear ? Math.round(count * 1.5) : count;
    const spread = 3 + strength * 0.55;
    sparks.direction1 = new Vector3(normal.x * spread - 2, 2, normal.z * spread - 2);
    sparks.direction2 = new Vector3(normal.x * spread + 2, 5.5, normal.z * spread + 2);
    // Rear hits burn hotter — the colour shift is a second channel telling you the
    // positional bonus landed, on top of the size difference.
    sparks.color1 = rear ? new Color4(1, 0.95, 0.55, 1) : new Color4(1, 0.78, 0.28, 1);
    sparks.color2 = rear ? new Color4(1, 0.6, 0.1, 1) : new Color4(1, 0.45, 0.12, 1);
    sparks.start();

    if (medium) {
      const debris = this.next("debris");
      debris.emitter = position.clone();
      debris.manualEmitCount = Math.round(4 + strength * 0.5);
      debris.start();
    }

    if (major) {
      this.ring(position, strength);
      this.flash = Math.max(this.flash, v.screenFlashMax * Math.min(1, strength / 26));
    }

    if (medium || rear) this.word(position, strength, rear, normal);
  }

  /** Dust kicked up by a car sliding sideways or being shoved across the deck. */
  scuff(position: Vector3, intensity: number): void {
    const dust = this.next("dust");
    dust.emitter = position.clone();
    dust.manualEmitCount = Math.round(2 + intensity * 2);
    dust.start();
  }

  /**
   * Rear/tank hit detonation. A short fireball, hot debris and a bright ring — the
   * tank going up is the payoff for the hardest shot to line up, so it gets its own
   * effect rather than a louder version of the ordinary spark burst.
   */
  explode(position: Vector3, strength: number): void {
    const fire = this.next("fire");
    fire.emitter = position.clone();
    fire.manualEmitCount = Math.round(14 + strength * 0.9);
    fire.start();

    const debris = this.next("debris");
    debris.emitter = position.clone();
    debris.manualEmitCount = Math.round(8 + strength * 0.7);
    debris.start();

    const smoke = this.next("smoke");
    smoke.emitter = position.clone();
    smoke.manualEmitCount = 8;
    smoke.start();

    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.play(position, 2.2 + strength * 0.14, new Color3(1, 0.62, 0.16));

    this.flash = Math.max(this.flash, Math.min(0.5, 0.18 + strength * 0.012));
  }

  /** Bright little burst where a coin was swallowed. */
  sparkle(position: Vector3): void {
    const ps = this.next("sparkle");
    ps.emitter = position.clone();
    ps.manualEmitCount = 16;
    ps.start();
    this.flash = Math.max(this.flash, 0.045);
  }

  /** Water thrown up by a car crossing a puddle, plus an expanding ripple. */
  splash(position: Vector3, intensity: number): void {
    const spray = this.next("spray");
    spray.emitter = position.clone();
    spray.manualEmitCount = Math.round(6 + intensity * 12);
    spray.start();
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.play(position, 1.4 + intensity * 1.6, new Color3(0.72, 0.92, 1));
  }

  /** Torn blades thrown up when a car crosses a grass patch at speed. */
  rustle(position: Vector3, intensity: number): void {
    const leaves = this.next("leaf");
    leaves.emitter = position.clone();
    leaves.manualEmitCount = Math.round(4 + intensity * 9);
    leaves.start();
  }

  /** Smoke plume, used for the wind-up and for a car dropping off the edge. */
  puff(position: Vector3, count = 6): void {
    const smoke = this.next("smoke");
    smoke.emitter = position.clone();
    smoke.manualEmitCount = count;
    smoke.start();
  }

  private word(position: Vector3, strength: number, rear: boolean, normal: Vector3): void {
    // A rally lands hits faster than a word can read. Without a floor between them
    // two words stack on top of each other and neither is legible.
    if (this.time - this.lastWordAt < 0.24) return;
    this.lastWordAt = this.time;

    const w = this.words[this.wordCursor];
    this.wordCursor = (this.wordCursor + 1) % this.words.length;
    // Avoid repeating the previous word back to back — repetition is what makes
    // comic hit text read as a debug label rather than as punctuation.
    let text = COMIC_WORDS[Math.floor(Math.random() * COMIC_WORDS.length)];
    let guard = 0;
    while (this.usedWords.has(text) && guard++ < 8) {
      text = COMIC_WORDS[Math.floor(Math.random() * COMIC_WORDS.length)];
    }
    this.usedWords.add(text);
    if (this.usedWords.size > 3) this.usedWords = new Set([text]);

    // Pushed along the hit direction so it lands over the car that was hit rather
    // than over Car Boy — the word must punctuate the collision, not hide it.
    const at = new Vector3(position.x + normal.x * 1.3, position.y, position.z + normal.z * 1.3);
    const scale = 0.55 + Math.min(1.15, strength * 0.05);
    w.play(text, at, scale, rear ? new Color3(1, 0.86, 0.2) : new Color3(1, 1, 1));
  }

  private ring(position: Vector3, strength: number): void {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.play(position, 1.5 + strength * 0.12);
  }

  /** Screen-space comic rays make a hard contact legible even when the car is small. */
  private rayBurst(strength: number, rear: boolean): void {
    this.rayLife = 0.34;
    this.rayStrength = Math.min(1, strength / 26) * (rear ? 1.12 : 0.9);
    const colour = rear ? "#ffd23f" : "#f7fbff";
    for (const ray of this.impactRayEls) {
      ray.style.color = colour;
      ray.style.background = `linear-gradient(90deg, ${colour}, rgba(255,255,255,0))`;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const w of this.words) w.update(dt);
    for (const r of this.rings) r.update(dt);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - TUNING.vfx.screenFlashDecay * dt);
      this.flashEl.style.opacity = String(this.flash);
    }
    if (this.rayLife > 0) {
      this.rayLife = Math.max(0, this.rayLife - dt);
      const t = 1 - this.rayLife / 0.34;
      const eased = 1 - Math.pow(1 - Math.min(1, t * 1.4), 3);
      const opacity = (1 - t) * (0.48 + this.rayStrength * 0.52);
      const distance = 5 + eased * (13 + this.rayStrength * 15);
      for (let i = 0; i < this.impactRayEls.length; i++) {
        const ray = this.impactRayEls[i];
        const angle = i * 45 + this.time * 7;
        ray.style.opacity = String(opacity);
        ray.style.transform =
          `translate(-50%, -50%) rotate(${angle}deg) translateX(${distance}vmin) ` +
          `scaleX(${0.7 + this.rayStrength * 0.7})`;
      }
    } else {
      for (const ray of this.impactRayEls) ray.style.opacity = "0";
    }
  }

  // ---- system factories --------------------------------------------------

  private makeSparks(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("sparks", 120, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.09;
    ps.maxSize = 0.3;
    ps.minLifeTime = 0.16;
    ps.maxLifeTime = 0.44;
    ps.emitRate = 0;
    ps.manualEmitCount = 0;
    ps.gravity = new Vector3(0, -26, 0);
    ps.minEmitPower = 3;
    ps.maxEmitPower = 11;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.colorDead = new Color4(1, 0.4, 0, 0);
    ps.minAngularSpeed = -9;
    ps.maxAngularSpeed = 9;
    ps.disposeOnStop = false;
    ps.preWarmCycles = 0;
    return ps;
  }

  private makeDebris(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("debris", 60, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.1;
    ps.maxSize = 0.24;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.1;
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, -22, 0);
    ps.direction1 = new Vector3(-4, 5, -4);
    ps.direction2 = new Vector3(4, 9, 4);
    ps.minEmitPower = 1.5;
    ps.maxEmitPower = 4.5;
    ps.color1 = new Color4(0.5, 0.5, 0.55, 1);
    ps.color2 = new Color4(0.3, 0.3, 0.34, 1);
    ps.colorDead = new Color4(0.2, 0.2, 0.24, 0);
    ps.minAngularSpeed = -12;
    ps.maxAngularSpeed = 12;
    ps.disposeOnStop = false;
    return ps;
  }

  private makeDust(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("dust", 90, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.3;
    ps.maxSize = 0.85;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.5;
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, 1.2, 0);
    ps.direction1 = new Vector3(-1.4, 0.6, -1.4);
    ps.direction2 = new Vector3(1.4, 2.0, 1.4);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 2;
    ps.color1 = new Color4(PALETTE.stone.r, PALETTE.stone.g, PALETTE.stone.b, 0.4);
    ps.color2 = new Color4(PALETTE.stoneShadow.r, PALETTE.stoneShadow.g, PALETTE.stoneShadow.b, 0.28);
    ps.colorDead = new Color4(PALETTE.stone.r, PALETTE.stone.g, PALETTE.stone.b, 0);
    ps.disposeOnStop = false;
    return ps;
  }

  private makeLeaves(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("leaves", 70, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.13;
    ps.maxSize = 0.32;
    ps.minLifeTime = 0.65;
    ps.maxLifeTime = 1.45;
    ps.emitRate = 0;
    // Leaves get a real downward pull: a quick lift, then a readable drop back to
    // the deck instead of weightless confetti hanging in the air.
    ps.gravity = new Vector3(0, -18, 0);
    ps.direction1 = new Vector3(-2.8, 2.7, -2.8);
    ps.direction2 = new Vector3(2.8, 5.8, 2.8);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3.1;
    ps.color1 = new Color4(PALETTE.grass.r * 1.3, PALETTE.grass.g * 1.25, PALETTE.grass.b, 1);
    ps.color2 = new Color4(PALETTE.cypress.r, PALETTE.cypress.g, PALETTE.cypress.b, 1);
    ps.colorDead = new Color4(PALETTE.cypress.r, PALETTE.cypress.g, PALETTE.cypress.b, 0);
    ps.minAngularSpeed = -14;
    ps.maxAngularSpeed = 14;
    ps.disposeOnStop = false;
    return ps;
  }

  private makeSpray(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("spray", 90, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.1;
    ps.maxSize = 0.34;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.6;
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, -17, 0);
    // Wide and low: water sheets sideways off a tyre rather than fountaining up.
    ps.direction1 = new Vector3(-3.4, 1.6, -3.4);
    ps.direction2 = new Vector3(3.4, 4.2, 3.4);
    ps.minEmitPower = 1.2;
    ps.maxEmitPower = 3.6;
    ps.color1 = new Color4(0.78, 0.93, 1, 0.9);
    ps.color2 = new Color4(0.45, 0.72, 0.95, 0.75);
    ps.colorDead = new Color4(0.6, 0.85, 1, 0);
    ps.disposeOnStop = false;
    return ps;
  }

  private makeSparkle(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("sparkle", 90, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.09;
    ps.maxSize = 0.3;
    ps.minLifeTime = 0.16;
    ps.maxLifeTime = 0.4;
    ps.emitRate = 0;
    // Floats up and outward briefly: a glint, not a fountain.
    ps.gravity = new Vector3(0, 1.2, 0);
    ps.direction1 = new Vector3(-2.6, 1.4, -2.6);
    ps.direction2 = new Vector3(2.6, 3.6, 2.6);
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 2.2;
    ps.color1 = new Color4(1, 0.98, 0.75, 1);
    ps.color2 = new Color4(1, 0.84, 0.24, 1);
    ps.colorDead = new Color4(1, 0.9, 0.5, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.disposeOnStop = false;
    return ps;
  }

  private makeFire(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("fire", 140, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.35;
    ps.maxSize = 1.5;
    ps.minLifeTime = 0.18;
    ps.maxLifeTime = 0.5;
    ps.emitRate = 0;
    // Rises and slows: a fireball billows upward rather than falling like debris.
    ps.gravity = new Vector3(0, 5.5, 0);
    ps.direction1 = new Vector3(-5, 1.5, -5);
    ps.direction2 = new Vector3(5, 7, 5);
    ps.minEmitPower = 1.5;
    ps.maxEmitPower = 6;
    ps.color1 = new Color4(1, 0.95, 0.55, 1);
    ps.color2 = new Color4(1, 0.42, 0.05, 1);
    ps.colorDead = new Color4(0.25, 0.12, 0.1, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.disposeOnStop = false;
    return ps;
  }

  private makeSmoke(tex: Texture): ParticleSystem {
    const ps = new ParticleSystem("smoke", 60, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minSize = 0.6;
    ps.maxSize = 2.2;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.4;
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, 2.4, 0);
    ps.direction1 = new Vector3(-0.8, 1.4, -0.8);
    ps.direction2 = new Vector3(0.8, 3, 0.8);
    ps.minEmitPower = 0.4;
    ps.maxEmitPower = 1.4;
    ps.color1 = new Color4(0.85, 0.85, 0.88, 0.55);
    ps.color2 = new Color4(0.65, 0.65, 0.7, 0.4);
    ps.colorDead = new Color4(0.8, 0.8, 0.85, 0);
    ps.disposeOnStop = false;
    return ps;
  }
}

/** Billboarded comic word (§2.8) that punches in, drifts up and fades. */
class ComicWord {
  private readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private life = 0;
  private duration = 0.72;
  private scale = 1;
  private readonly origin = new Vector3();

  constructor(scene: Scene, index: number) {
    this.texture = new DynamicTexture(`word${index}`, { width: 512, height: 192 }, scene, false);
    this.texture.hasAlpha = true;
    this.material = new StandardMaterial(`wordMat${index}`, scene);
    this.material.diffuseTexture = this.texture;
    this.material.opacityTexture = this.texture;
    this.material.emissiveTexture = this.texture;
    this.material.emissiveColor = new Color3(1, 1, 1);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.material.zOffset = -6;

    this.mesh = MeshBuilder.CreatePlane(`word${index}`, { width: 2.4, height: 0.9 }, scene);
    this.mesh.material = this.material;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.mesh.isPickable = false;
    // Drawn after the world, ignoring depth. The word punctuates the collision, so
    // it has to stay legible even though it spawns right where the cars are — half
    // a word poking out from behind a car reads as a glitch, not as impact.
    this.mesh.renderingGroupId = 2;
    this.material.disableDepthWrite = true;
    this.mesh.setEnabled(false);
  }

  play(text: string, position: Vector3, scale: number, colour: Color3): void {
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 192);
    ctx.font = "900 116px Impact, 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.save();
    ctx.translate(256, 96);
    ctx.rotate(-0.08);
    ctx.lineWidth = 20;
    ctx.strokeStyle = "#14121c";
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = `rgb(${colour.r * 255 | 0},${colour.g * 255 | 0},${colour.b * 255 | 0})`;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    this.texture.update();

    this.origin.copyFrom(position);
    this.origin.y += 2.1;
    this.scale = scale;
    this.life = this.duration;
    this.mesh.setEnabled(true);
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.mesh.setEnabled(false);
      return;
    }
    const t = 1 - this.life / this.duration;
    // Overshoot then settle, then float away — a linear pop reads as a placeholder.
    const punch = t < 0.22 ? easeOutBack(t / 0.22) : 1;
    const s = this.scale * punch * (1 + t * 0.25);
    this.mesh.scaling.set(s, s, s);
    this.mesh.position.set(this.origin.x, this.origin.y + t * 1.9, this.origin.z);
    this.material.alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
  }
}

/** Expanding ground shockwave for major hits (§2.8). */
class ShockRing {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private life = 0;
  private readonly duration = 0.42;
  private target = 4;

  constructor(scene: Scene, index: number) {
    this.mesh = MeshBuilder.CreateTorus(`ring${index}`, { diameter: 2, thickness: 0.16, tessellation: 28 }, scene);
    this.mesh.scaling.y = 0.05;
    this.material = new StandardMaterial(`ringMat${index}`, scene);
    this.material.emissiveColor = new Color3(1, 0.95, 0.8);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.alpha = 0;
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    // With the particles, above the ground decals.
    this.mesh.renderingGroupId = 1;
    this.mesh.setEnabled(false);
  }

  play(position: Vector3, size: number, colour?: Color3): void {
    if (colour) this.material.emissiveColor = colour;
    else this.material.emissiveColor = new Color3(1, 0.95, 0.8);
    this.mesh.position.set(position.x, 0.09, position.z);
    this.target = size;
    this.life = this.duration;
    this.mesh.setEnabled(true);
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.mesh.setEnabled(false);
      return;
    }
    const t = 1 - this.life / this.duration;
    const s = 0.4 + easeOutCubic(t) * this.target;
    this.mesh.scaling.set(s, 0.05, s);
    this.material.alpha = (1 - t) * 0.85;
  }
}

// ---- procedural textures --------------------------------------------------

function softDot(scene: Scene): Texture {
  const size = 64;
  const tex = new DynamicTexture("softDot", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** A hard-edged sliver: sparks should read as shards, not as soft blobs. */
/** A tapered blade silhouette, so torn grass reads as grass and not as confetti. */
function bladeTexture(scene: Scene): Texture {
  const size = 64;
  const tex = new DynamicTexture("blade", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  // Root at the bottom centre, curving to a point — a leaf, not a rectangle.
  ctx.moveTo(size * 0.42, size * 0.98);
  ctx.quadraticCurveTo(size * 0.1, size * 0.55, size * 0.47, size * 0.03);
  ctx.quadraticCurveTo(size * 0.82, size * 0.55, size * 0.58, size * 0.98);
  ctx.closePath();
  ctx.fill();
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

function shardTexture(scene: Scene): Texture {
  const size = 64;
  const tex = new DynamicTexture("shard", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.06);
  ctx.lineTo(size * 0.64, size * 0.5);
  ctx.lineTo(size * 0.5, size * 0.94);
  ctx.lineTo(size * 0.36, size * 0.5);
  ctx.closePath();
  ctx.fill();
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

function easeOutBack(t: number): number {
  const c1 = 2.2;
  const c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}

function easeOutCubic(t: number): number {
  const p = 1 - t;
  return 1 - p * p * p;
}
