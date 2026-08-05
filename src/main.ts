import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { App } from "./core/app";
import { PhysicsWorld } from "./core/physics";
import { TUNING } from "./data/tuning";
import { Controls } from "./input/controls";
import { Arena } from "./gameplay/arena";
import { Player } from "./gameplay/player";
import { DirectChargerBehaviour, Enemy } from "./gameplay/enemy";
import { Combat } from "./gameplay/combat";
import { Environment } from "./render/environment";
import { Grass, type GrassInfluencer } from "./render/grass";
import { ZoneGrid } from "./world/zones";
import { DriftTrails } from "./fx/driftTrails";
import { Terrain } from "./world/terrain";
import { Pickups } from "./world/pickups";
import { Props } from "./world/props";
import { Effects } from "./fx/effects";
import { Audio } from "./audio/audio";
import { DevOverlay } from "./dev/overlay";
import { type BenchDeps, frameRateBench, impactBench } from "./dev/bench";
import { pose as poseScene, type PoseName } from "./dev/poses";
import { buildChargeButton } from "./ui/chargeButton";
import { buildScreenFx } from "./ui/screenFx";
import { ComboMeter } from "./ui/combo";
import { Banners } from "./ui/banners";
import { UpgradeScreen } from "./ui/upgradeScreen";
import { TitleScreen } from "./ui/titleScreen";
import { Progression } from "./gameplay/progression";
import { Onboarding } from "./ui/onboarding";
import { SpeedLines } from "./ui/screenFx";
import { EdgeDrama } from "./gameplay/edgeDrama";
import { PauseMenu } from "./ui/pauseMenu";
import { MobNameDealer } from "./data/mobNames";
import { SteerPad } from "./ui/steerPad";

const frame = document.getElementById("frame")!;
const canvas = document.getElementById("render") as HTMLCanvasElement;

buildScreenFx(frame);
const combo = new ComboMeter(frame, 10);
const banners = new Banners(frame);
const upgradeScreen = new UpgradeScreen(frame);
// A card press kicks the camera, so the slate feels struck rather than clicked.
upgradeScreen.onShake = (amount) => app.addImpact(14 * amount);
const titleScreen = new TitleScreen(frame, () => beginCountdown());
const progress = new Progression();
let elapsed = 0;
let dayKills = 0;
let dayCoinsStart = 0;
let bestCombo = 0;
let dayPaused = false;
const onboarding = new Onboarding(frame);
const speedLines = new SpeedLines(frame);
const drama = new EdgeDrama();
let dramaClock = 0;
let shownDramaOutcome: "fell" | "saved" | null = null;
const button = buildChargeButton(frame);
button.element.style.display = "none";

const app = new App(canvas);
const overlay = new DevOverlay(frame);
const controls = new Controls(canvas, button.element);
const steerPad = new SteerPad(frame);
controls.onSteerStart = (x, y) => steerPad.show(x, y);
controls.onSteerMove = (x, y) => steerPad.move(x, y);
controls.onSteerEnd = () => steerPad.hide();
const audio = new Audio();
let gamePaused = false;
let introGrace = 0;
let countdownValue = 0;
let countdownClock = 0;
let playStarted = false;
let gameReady = false;
let startRequested = false;
const pauseMenu = new PauseMenu(frame, {
  onPaused: (paused) => {
    gamePaused = paused;
    if (paused) audio.pause();
    else audio.resume();
  },
  onMusicMuted: (muted) => audio.music.setMuted(muted),
  onSfxMuted: (muted) => audio.setSfxMuted(muted),
});

// Browsers refuse to start audio without a gesture; the first touch anywhere does.
for (const ev of ["pointerdown", "keydown"]) {
  window.addEventListener(
    ev,
    () => {
      const wasIntro = titleScreen.open;
      audio.unlock();
      if (wasIntro || countdownValue > 0) {
        audio.music.playIntro();
        introGrace = 0.45;
      }
    },
    { once: false, capture: true }
  );
}

const world = await PhysicsWorld.create(app.scene);
const arena = new Arena(app.scene, world);
const touchDevice =
  navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
const environment = new Environment(app.scene, arena.world, { lowPower: touchDevice });
const player = new Player(app.scene, world, new Vector3(0, 1.2, -4));
player.rig.parts.root.setEnabled(false);
player.rig.parts.shadow.setEnabled(false);
const effects = new Effects(app.scene, frame);

// Grass is decoration you drive through, never an obstacle — no colliders, so the
// deck stays clear (§4.5). Bending is done on the GPU; see render/grass.ts.
// The tufts sit straight on the paving. A tinted mat under each patch was tried and
// removed: it never resolved above the deck no matter how it was ordered, and the
// blades read perfectly well on their own.
// The whole island is a meadow, not paving with tufts on it. One draw call still —
// blade count is essentially free here, the cost is all in the crush bookkeeping,
// which only ever touches blades under a wheel.
const grass = new Grass(app.scene, arena.radius, {
  regions: arena.world.islands.map((i) => ({ x: i.x, z: i.z, radius: i.radius })),
  fill: true,
  patchCount: 150,
  bladesPerPatch: 300,
  maxRadiusFactor: 0.97,
});
const influencers: GrassInfluencer[] = [];
const drift = new DriftTrails(app.scene);

// Spatial index over every interactive patch. Queries hit one bucket, so per-frame
// cost tracks how many zones are near a car, not how many exist.
const zones = new ZoneGrid();
for (const p of grass.patches) {
  zones.add({ kind: "grass", x: p.x, z: p.z, radius: p.radius, active: false, idle: 99 });
}

// Cosmetic puddles are kept clear of the arena centre; the impact bench stages cars
// there and a grip change would silently invalidate the collision numbers.
const terrain = new Terrain(app.scene, zones, {
  islandRadius: arena.radius,
  keepClearRadius: 9,
});

// Gold. A knocked-out enemy pays out; coins magnetise to Car Boy and stream in.
const pickups = new Pickups(app.scene);
pickups.onGround = (x, z) => arena.marginAt(x, z) > 0.6;
// Nearest solid ground to a point: the island whose rim is closest. Used when a car
// is struck out over the water so its payout still lands somewhere driveable.
pickups.groundSeek = (x, z) => {
  let best = arena.world.islands[0];
  let bestD = Infinity;
  for (const isle of arena.world.islands) {
    const d = Math.hypot(x - isle.x, z - isle.z) - isle.radius;
    if (d < bestD) {
      bestD = d;
      best = isle;
    }
  }
  const dx = x - best.x;
  const dz = z - best.z;
  const d = Math.hypot(dx, dz) || 1;
  const r = Math.min(d, best.radius * 0.8);
  return { x: best.x + (dx / d) * r, z: best.z + (dz / d) * r };
};

// Crates and barrels: light enough to plough through, and they pay out when they
// break. A reward on the racing line, never an obstacle in it.
const props = new Props(
  app.scene,
  world,
  {
    onBurst: (at, kind, strength) => {
      effects.impact(at, Math.min(14, 6 + strength), false, new Vector3(0, 0, 1));
      effects.puff(at, kind === "barrel" ? 8 : 5);
      pickups.burst(at.x, at.z, kind === "barrel" ? 5 : 3);
      app.addImpact(Math.min(9, strength * 1.1));
    },
  },
  { islandRadius: arena.radius, keepClearRadius: 9 }
);

/** Per-vehicle terrain bookkeeping: distance travelled since the last mark. */
const tracked = new Map<number, { lastX: number; lastZ: number; sinceStamp: number; driftGap: number }>();

const enemies: Enemy[] = [];
const vehicles = [player.vehicle];
const vehiclePositions: Vector3[] = [];
const mobNames = new MobNameDealer();
let spawnAngle = 0;

function spawnEnemy(): void {
  spawnAngle += 2.399; // golden-angle stepping, so respawns are not predictable
  const enemy = new Enemy(
    app.scene,
    world,
    arena.spawnPointOnRim(spawnAngle, 6),
    new DirectChargerBehaviour(),
    2,
    mobNames.next()
  );
  enemies.push(enemy);
  combat.register(enemy);
}

/**
 * §3.5 hook 4 — one well-defined "fall committed" event. Everything that reacts to
 * a knockout subscribes here rather than polling positions, so the celebration,
 * scoring and audio in later phases cannot disagree about when it happened.
 */
type FallListener = (enemy: Enemy) => void;
const fallListeners: FallListener[] = [];
function onFallCommitted(fn: FallListener): void {
  fallListeners.push(fn);
}

// Mass sliders must re-apply to bodies that already exist, or the number in the
// panel and the number the solver uses drift apart.
overlay.onMassChanged = (who, mass) => {
  const targets = who === "player" ? [player.vehicle] : enemies.map((e) => e.vehicle);
  for (const v of targets) v.setMass(mass);
};

const combat = new Combat(world, player, (hit) => {
  overlay.lastHit = combat.lastReport;
  app.addImpact(hit.strength);
  if (hit.rear) {
    app.triggerRearHit();
    effects.slowMotion(TUNING.camera.rearHitSlowDuration, TUNING.camera.rearHitSlowScale);
  }
  effects.impact(hit.point, hit.strength, hit.rear, hit.normal);
  // A hit up the back detonates. Lifted off the deck so the fireball reads as
  // coming out of the car rather than out of the ground under it.
  if (hit.rear) {
    effects.explode(new Vector3(hit.point.x, hit.point.y + 0.35, hit.point.z), hit.strength);
  }
  if (hit.gasTank) banners.show("TANK SHOT!!", "#ff5a3c", 1.1);
  else if (hit.rear) banners.show("REAR HIT!!", "#ffd23f", 0.9);
  // Every hit shakes coins loose, dropped on the ground nearest the car that was
  // struck rather than wherever the contact happened to be.
  const payout = hit.gasTank ? 5 : hit.rear ? 3 : 2;
  pickups.burst(hit.point.x, hit.point.z, payout, 0.7);
  audio.impact(hit.strength, hit.rear);
  // §2.8 — light device haptic where supported.
  navigator.vibrate?.(
    hit.strength > TUNING.vfx.majorThreshold
      ? [0, 36, 36, 18]
      : hit.rear
        ? [0, 20, 22, 10]
        : 12
  );
});

onFallCommitted((enemy) => {
  overlay.knockouts++;
  const chain = combo.register();
  if (chain > bestCombo) bestCombo = chain;
  if (chain > 1) audio.knockout();
  dayKills++;
  audio.splash();
  audio.knockout();
  banners.show(enemy.displayName + " DEFEATED", "#ffd23f", 1.35);
  effects.puff(new Vector3(enemy.vehicle.position.x, -8, enemy.vehicle.position.z), 14);
  navigator.vibrate?.([0, 40, 60, 90]);
});

/**
 * Cars allowed on the deck at once, and how many remain to be beaten today. The
 * day ends when the quota is met and the deck is clear.
 */
function targetEnemyCount(): number {
  const remaining = progress.enemiesThisDay - dayKills;
  return Math.max(0, Math.min(progress.concurrentEnemies, remaining));
}

let respawnT = 0;
let fallSmokeT = 0;
let wasCharging = false;
let hapticT = 0;
let scuffT = 0;

function setPlayerVisible(visible: boolean): void {
  player.rig.parts.root.setEnabled(visible);
  player.rig.parts.shadow.setEnabled(visible);
}

function beginCountdown(): void {
  if (playStarted || countdownValue > 0) return;
  if (!gameReady) {
    startRequested = true;
    return;
  }
  audio.unlock();
  audio.music.playIntro();
  setPlayerVisible(true);
  countdownValue = 3;
  countdownClock = 0.82;
  banners.show("3", "#ffd23f", 0.82);
}

function startDay(): void {
  playStarted = true;
  countdownValue = 0;
  countdownClock = 0;
  spawnEnemy();
  audio.music.playDay(progress.day);
  banners.show("GO!", "#7fe0a0", 0.9);
}

function frameUpdate(rawDt: number): void {
  introGrace = Math.max(0, introGrace - rawDt);
  pauseMenu.setVisible(!titleScreen.open && countdownValue === 0 && !upgradeScreen.open && !dayPaused);
  button.element.style.display = titleScreen.open || countdownValue > 0 ? "none" : "";
  if (gamePaused) return;
  if (titleScreen.open) {
    // The title card is a true attract state: the island animates, but the
    // physics world, enemies, player, particles and scoring remain untouched.
    controls.steerAmount = 0;
    controls.charging = false;
    controls.released = false;
    onboarding.setHidden(true);
    environment.update(rawDt);
    app.updateCamera(player.vehicle.position, player.vehicle.forward, rawDt);
    controls.endFrame();
    return;
  }
  if (countdownValue > 0) {
    countdownClock -= rawDt;
    if (countdownClock <= 0) {
      if (countdownValue > 1) {
        countdownValue -= 1;
        countdownClock = 0.82;
        banners.show(String(countdownValue), "#ffd23f", 0.82);
      } else {
        startDay();
      }
    }
    controls.steerAmount = 0;
    controls.charging = false;
    controls.released = false;
    onboarding.setHidden(true);
    environment.update(rawDt);
    app.updateCamera(player.vehicle.position, player.vehicle.forward, rawDt);
    controls.endFrame();
    return;
  }
  if (!titleScreen.open && !upgradeScreen.open && !dayPaused && introGrace <= 0) {
    audio.music.playDay(progress.day);
  }

  // Hit-stop scales gameplay time only. The camera, scenery and UI keep running,
  // which is what makes the freeze read as impact rather than as a dropped frame.
  // Edge suspense (§2.9) scales gameplay time; the simulation itself is untouched,
  // so whether the car goes over is still decided by Havok.
  const dramaScale = drama.update(rawDt, enemies, arena);
  if (drama.lastOutcome !== shownDramaOutcome) {
    if (drama.lastOutcome === "saved") banners.show("NEAR MISS!", "#fff6d5", 1.15);
    shownDramaOutcome = drama.lastOutcome;
  }
  const dt = rawDt * app.consumeTimeScale(rawDt) * dramaScale;

  if (titleScreen.open) {
    // Title is up: the world keeps rendering behind it, but nothing responds.
    controls.steerAmount = 0;
    controls.charging = false;
  } else {
    controls.pollKeyboard();
  }

  combat.tick(dt);
  vehicles.length = 1;
  for (const e of enemies) vehicles.push(e.vehicle);
  // Grip and drag are ground effects. Once a car is over the edge it should
  // plummet, but linear damping applies on every axis, so a heavily damped body
  // drifts down like a leaf — which drains all the drama out of a knockout.
  for (const v of vehicles) {
    const airborne = arena.marginAt(v.position.x, v.position.z) < -0.5 || v.position.y < -0.6;
    v.body.setLinearDamping(airborne ? 0 : v.config.linearDamping);
    if (!airborne) v.applyGrip(dt, v === player.vehicle ? TUNING.player.grip : TUNING.enemy.grip);
  }
  player.update(dt, controls);
  for (const e of enemies) e.update(dt, player.vehicle.position, arena.radius, (x, z) => arena.marginAt(x, z));

  // Snapshot velocities for approach-speed measurement (see Combat) *after* intent
  // is applied and before the solver touches them. Sampling earlier meant a charge
  // released while already touching an enemy measured an approach speed of zero,
  // so point-blank charges — the common case, since the enemy drives at you while
  // you charge — did nothing at all.
  player.vehicle.cacheVelocity();
  for (const e of enemies) e.vehicle.cacheVelocity();

  world.advance(dt);

  // Clamp spin *after* the solver, not just before it: a hard contact can spike
  // angular velocity during the step, and clamping only on the next frame lets a
  // visible frame of unreadable spinning through (§2.7).
  player.vehicle.clampAngular(TUNING.collision.maxAngularSpeed);
  player.vehicle.syncTransform();
  for (const e of enemies) {
    e.vehicle.clampAngular(TUNING.collision.maxAngularSpeed);
    e.vehicle.syncTransform();
  }

  // ---- charge feedback ---------------------------------------------------
  const charging = controls.charging && player.cooldownT === 0;
  if (charging && !wasCharging) audio.chargeStart();
  if (!charging && wasCharging) audio.chargeStop();
  if (charging) {
    const level = player.chargeLevel;
    audio.chargeUpdate(level);
    app.setTremble(TUNING.chargeFeel.cameraTremble * level * level, rawDt);
    app.setChargeZoom(TUNING.chargeFeel.cameraZoom * level);
    // Haptic pulses that quicken as the wind-up tightens (§2.8).
    const cf = TUNING.chargeFeel;
    hapticT -= rawDt;
    if (hapticT <= 0) {
      navigator.vibrate?.(8);
      hapticT = cf.hapticIntervalMin + (cf.hapticIntervalMax - cf.hapticIntervalMin) * level;
    }
  } else {
    hapticT = 0;
  }
  wasCharging = charging;

  if (player.justLaunched) {
    audio.launch(player.attackPower);
    effects.puff(
      new Vector3(player.vehicle.position.x, 0.2, player.vehicle.position.z),
      3 + Math.round(player.attackPower * 5)
    );
    navigator.vibrate?.(18);
  }

  // Dust from cars sliding across the deck (§2.15 realism of response), and torn
  // blades where one crosses a grass patch.
  scuffT -= dt;
  const emitScuff = scuffT <= 0;
  // Sparse: at 0.05s the trail built into a continuous smoke plume behind any car
  // driving in a straight line, which read as damage rather than as tyres on stone.
  if (emitScuff) scuffT = 0.11;

  vehiclePositions.length = 0;
  for (const v of vehicles) vehiclePositions.push(v.position);
  zones.refresh(vehiclePositions, dt, 3);

  influencers.length = vehicles.length;
  for (let vehicleIndex = 0; vehicleIndex < vehicles.length; vehicleIndex++) {
    const v = vehicles[vehicleIndex];
    const grounded = v.position.y < 1.6;
    const influencer = influencers[vehicleIndex] ?? { x: 0, z: 0, radius: 0, strength: 0 };
    influencer.x = v.position.x;
    influencer.z = v.position.z;
    // A car that has left the deck stops flattening grass.
    influencer.radius = grounded ? Math.max(v.config.size.w, v.config.size.l) * 0.78 : 0;
    influencer.strength = 0.42 + Math.min(0.45, v.planarSpeed * 0.03);
    influencers[vehicleIndex] = influencer;
    if (!grounded) continue;

    // Distance-based stamping, so marks are evenly spaced along the path rather
    // than bunching up when the car is slow and gapping when it is fast.
    let t = tracked.get(v.id);
    if (!t) {
      t = { lastX: v.position.x, lastZ: v.position.z, sinceStamp: 0, driftGap: 0 };
      tracked.set(v.id, t);
    }
    const t2 = t;
    const moved = Math.hypot(v.position.x - t.lastX, v.position.z - t.lastZ);
    t.lastX = v.position.x;
    t.lastZ = v.position.z;
    t.sinceStamp += moved;

    // Drift: how much of the car's motion is sideways rather than along its nose.
    // Marks come off the rear wheels, which is where a slide actually scrubs.
    const vel = v.velocity;
    const speed = v.planarSpeed;
    if (speed > TUNING.feel.driftMinSpeed) {
      const f = v.forward;
      const lateral = Math.abs(vel.x * f.z - vel.z * f.x) / speed;
      if (lateral > TUNING.feel.driftSlipThreshold) {
        t2.driftGap += moved;
        if (t2.driftGap >= 0.32) {
          t2.driftGap = 0;
          const yaw = Math.atan2(vel.x, vel.z);
          const sx = f.z * v.config.size.w * 0.36;
          const sz = -f.x * v.config.size.w * 0.36;
          const strength = Math.min(1, (lateral - TUNING.feel.driftSlipThreshold) * 2.4);
          for (const side of [-1, 1]) {
            drift.stamp(
              v.position.x + sx * side - f.x * v.config.size.l * 0.28,
              v.position.z + sz * side - f.z * v.config.size.l * 0.28,
              yaw,
              0.34,
              0.95,
              0.3 + strength * 0.45,
              3.6
            );
          }
          if (strength > 0.45) {
            effects.scuff(new Vector3(v.position.x, 0.12, v.position.z), 0.5 + strength);
          }
        }
      }
    }

    const inGrass = zones.kindAt(v.position.x, v.position.z, "grass");
    const inPuddle = zones.kindAt(v.position.x, v.position.z, "puddle");

    // Surface patches are visuals only; collisions and top speed stay unchanged.

    // Puddles are cosmetic only: spray and a ripple, throttled by distance so a slow crawl through one
    // does not machine-gun splashes.
    if (inPuddle && v.planarSpeed > 3.5 && t.sinceStamp >= 0.4) {
      effects.splash(new Vector3(v.position.x, 0.12, v.position.z), Math.min(1.6, v.planarSpeed / 8));
    }

    if (t.sinceStamp >= 0.55 && v.planarSpeed > 1.5) {
      t.sinceStamp = 0;
      const yaw = v.yaw;
      if (inGrass) {
        // Tear the grass up along the wheel line, leaving crushed stubble that
        // stays down, and throw the torn blades into the air.
        grass.crush(v.position.x, v.position.z, v.config.size.w * 0.9, yaw);
        if (v.planarSpeed > 4) {
          effects.rustle(new Vector3(v.position.x, 0.3, v.position.z), 0.6 + v.planarSpeed / 9);
        }
      }
    }

    if (emitScuff && v.planarSpeed > TUNING.vfx.dustSpeed) {
      if (!inGrass) effects.scuff(new Vector3(v.position.x, 0.1, v.position.z), v.planarSpeed / 10);
    }
  }
  elapsed += rawDt;
  // Music tracks the fight: intensity rises with cars on the deck, the combo
  // chain, and how close the player is to going over.
  {
    const p = player.vehicle.position;
    const m = arena.marginAt(p.x, p.z);
    const danger = Math.max(0, 1 - Math.max(0, m) / 8);
    const crowd = Math.min(1, enemies.length / 3);
    const chain = Math.min(1, combo.combo / 4);
    audio.music.intensity = Math.max(danger * 0.9, crowd * 0.7, chain);
    audio.music.update();
  }
  combo.update(rawDt);
  banners.update(rawDt);
  grass.update(rawDt, influencers);
  drift.update(rawDt);

  props.update(rawDt);

  pickups.update(rawDt, player.vehicle.position.x, player.vehicle.position.z, progress.magnetRadius);
  for (const coin of pickups.collectedAt) {
    effects.sparkle(new Vector3(coin.x, coin.y, coin.z));
    audio.coinPickup(elapsed);
  }
  if (pickups.collectedAt.length > 0) {
    const count = pickups.collectedAt.length;
    app.addImpact(Math.min(3.5, 1.1 + count * 0.45));
    banners.show(count > 1 ? `+${count} COINS` : "+1 COIN", "#ffd23f", 0.7);
    navigator.vibrate?.(count > 1 ? [0, 10, 22, 10] : 8);
  }

  // ---- fall confirmation and respawn --------------------------------------
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    // A car on its way down trails smoke, so the fall is a clear moment rather
    // than a car quietly leaving the frame.
    if (e.vehicle.position.y < -0.8 && e.vehicle.position.y > TUNING.world.knockoutY) {
      fallSmokeT -= rawDt;
      if (fallSmokeT <= 0) {
        fallSmokeT = 0.05;
        effects.puff(e.vehicle.position.clone(), 3);
      }
    }
    if (arena.hasFallen(e.vehicle)) {
      // Payout scales with tier, so a tougher enemy is visibly worth more.
      pickups.burst(e.vehicle.position.x, e.vehicle.position.z, 7 + e.tier * 3);
      for (const fn of fallListeners) fn(e);

      combat.unregister(e);
      e.dispose();
      world.releaseBody();
      enemies.splice(i, 1);
      respawnT = 1.1;
    }
  }
  if (enemies.length < targetEnemyCount()) {
    respawnT -= rawDt;
    if (respawnT <= 0) spawnEnemy();
  }

  // Day complete: quota met and the deck is clear.
  if (!dayPaused && dayKills >= progress.enemiesThisDay && enemies.length === 0) {
    dayPaused = true;
    void endOfDay();
  }

  if (player.vehicle.position.y < TUNING.world.knockoutY) {
    audio.splash();
    world.teleport(player.vehicle.body, new Vector3(0, 1.5, -4));
  }

  // ---- presentation -------------------------------------------------------
  player.updateVisuals(dt, controls);
  for (const e of enemies) e.updateVisuals(dt);
  environment.update(rawDt);
  effects.update(rawDt);
  audio.engine(player.vehicle.planarSpeed, TUNING.player.maxSpeed);

  // Point the camera at whatever is about to go over, and pull in on it.
  dramaClock += rawDt;
  const focus = drama.focus;
  app.setDramaFocus(focus ? focus.vehicle.position : null, focus ? drama.intensity : drama.intensity * 0.35);
  speedLines.update(drama.intensity, dramaClock, rawDt);
  app.updateCamera(player.vehicle.position, player.vehicle.forward, rawDt);
  // Screen-space heading for the needle: world +Z is screen up, so 0° is up and
  // the angle grows clockwise, which is exactly CSS rotate's convention.
  const aimDeg = controls.charging ? (player.aimYawNow * 180) / Math.PI : null;
  button.update(controls.chargeLevel, player.cooldownT / TUNING.charge.cooldown, aimDeg);
  if (player.chargeLost) banners.show("CHARGE LOST", "#ff8a5c");
  onboarding.setHidden(titleScreen.open);
  if (!titleScreen.open) onboarding.update(rawDt, controls.steerAmount, controls.released && player.attacking);
  controls.endFrame();

  overlay.extra =
    `authority ${player.authority.toFixed(2)}  charge ${player.chargeLevel.toFixed(2)}  ` +
    `speed ${player.vehicle.planarSpeed.toFixed(1)}`;
  overlay.update(rawDt, {
    stepMs: world.stepMs,
    bodies: world.bodyCount,
    state: player.attacking ? "ATTACK" : charging ? "charging" : "drive",
  });
}

// Test harness surface (§1.3 step 4 / §6.15). Lets automated checks drive the real
// simulation rather than a reimplementation of it.
(window as unknown as Record<string, unknown>).CARBOY = {
  app,
  world,
  arena,
  player,
  controls,
  enemies,
  combat,
  overlay,
  effects,
  environment,
  grass,
  zones,
  terrain,
  combo,
  banners,
  titleScreen,
  audio,
  progress,
  upgradeScreen,
  drift,
  pickups,
  props,
  onboarding,
  drama,
  TUNING,
  spawnEnemy,
  onFallCommitted,
  step: (dt: number, frames = 1) => {
    for (let i = 0; i < frames; i++) frameUpdate(dt);
  },
  pause: () => app.engine.stopRenderLoop(),
  resume: () => app.run(frameUpdate),
  /** Deterministic screenshot staging, so round-to-round frames are comparable. */
  pose: (name: PoseName) => {
    app.engine.stopRenderLoop();
    // Particles advance off engine delta, which never updates outside a real render
    // loop; pin it so a stepped frame behaves like a 60fps frame.
    app.engine.getDeltaTime = () => 16.67;
    poseScene(
      {
        scene: app.scene,
        world,
        arena,
        player,
        enemies,
        combat,
        controls,
        grass,
        step: frameUpdate,
        render: () => app.scene.render(),
      },
      name
    );
  },
  bench: () => {
    app.engine.stopRenderLoop();
    const deps: BenchDeps = {
      world,
      arena,
      player,
      enemies,
      combat,
      controls,
      step: (dt, frames = 1) => {
        for (let i = 0; i < frames; i++) frameUpdate(dt);
      },
      knockouts: () => overlay.knockouts,
    };
    const impacts = impactBench(deps);
    const frameRate = frameRateBench(deps);
    app.run(frameUpdate);
    return { impacts, frameRate };
  },
};

/**
 * Between-days flow. The render loop keeps running underneath so the island stays
 * live behind the panel — stopping the world entirely makes the pause feel like a
 * crash rather than a breather.
 */
async function endOfDay(): Promise<void> {
  const coins = pickups.collected - dayCoinsStart;
  progress.carried = coins;
  progress.bankCarried();
  audio.knockout();

  const chosen = await upgradeScreen.show(
    progress.day,
    { knockouts: dayKills, coins, stash: progress.stash, bestCombo },
    progress.offer()
  );
  progress.take(chosen.id);
  // Mass is a live body property, so the pick has to be pushed into the solver.
  player.vehicle.setMass(TUNING.player.mass);
  player.rig.setScale(progress.visualScale);

  progress.day++;
  dayKills = 0;
  bestCombo = 0;
  dayCoinsStart = pickups.collected;
  respawnT = 0.8;
  dayPaused = false;
  audio.music.playDay(progress.day);
  banners.show(`DAY ${progress.day}`, "#7fe0a0", 1.6);
}

gameReady = true;
if (startRequested) beginCountdown();
app.run(frameUpdate);
