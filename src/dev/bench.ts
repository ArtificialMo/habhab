import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

import { TUNING } from "../data/tuning";
import type { PhysicsWorld } from "../core/physics";
import type { Arena } from "../gameplay/arena";
import type { Player } from "../gameplay/player";
import type { Enemy } from "../gameplay/enemy";
import type { Combat } from "../gameplay/combat";
import type { Controls } from "../input/controls";

export interface BenchDeps {
  world: PhysicsWorld;
  arena: Arena;
  player: Player;
  enemies: Enemy[];
  combat: Combat;
  controls: Controls;
  step: (dt: number, frames?: number) => void;
  knockouts: () => number;
}

export interface ImpactResult {
  label: string;
  chargeLevel: number;
  /** Player speed at the instant of launch. */
  launchSpeed: number;
  approachSpeed: number;
  /** Peak speed the enemy reached after contact — the "how far will it fly" number. */
  peakEnemySpeed: number;
  /** Ground distance the enemy covered from the contact point. */
  enemyTravel: number;
  /**
   * Centre-to-centre distance gained between the closest point of the impact and
   * the widest point after it. Part 5: "every impact visibly separates the cars".
   */
  separation: number;
  /** Car Boy's peak speed *away* from the enemy after contact. §2.7 wants this readable but modest. */
  playerRecoilSpeed: number;
  knockedOff: boolean;
  report: string;
}

const FACE_POS_Z = Quaternion.Identity();
const FACE_NEG_Z = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.PI);

/**
 * Head-on / rear / glancing impact bench (§1.8). Runs the real systems at a fixed
 * dt with the enemy AI disabled, so the numbers describe the collision model
 * rather than a fight.
 */
export function impactBench(d: BenchDeps): ImpactResult[] {
  const savedSpeed = TUNING.enemy.maxSpeed;
  const savedAccel = TUNING.enemy.accel;
  TUNING.enemy.maxSpeed = 0;
  TUNING.enemy.accel = 0;
  try {
    return [
      // Gap is set per case to the range that charge level can actually cross —
      // a weak charge tested from maximum range measures nothing but friction.
      impact(d, { label: "rear, full charge", rear: true, charge: 1, gap: 7 }),
      impact(d, { label: "front, full charge", rear: false, charge: 1, gap: 7 }),
      impact(d, { label: "rear, half charge", rear: true, charge: 0.5, gap: 5 }),
      impact(d, { label: "front, half charge", rear: false, charge: 0.5, gap: 5 }),
      impact(d, { label: "front, no charge (drive-in)", rear: false, charge: 0, gap: 4 }),
      impact(d, { label: "glancing, full charge", rear: false, charge: 1, gap: 7, lateral: 1.5 }),
    ];
  } finally {
    TUNING.enemy.maxSpeed = savedSpeed;
    TUNING.enemy.accel = savedAccel;
  }
}

function impact(
  d: BenchDeps,
  opts: { label: string; rear: boolean; charge: number; gap: number; lateral?: number }
): ImpactResult {
  // Wait out any pending respawn from the previous case.
  for (let i = 0; i < 240 && d.enemies.length === 0; i++) d.step(1 / 60);
  const enemy = d.enemies[0].vehicle;
  const player = d.player.vehicle;
  const koBefore = d.knockouts();

  // Park any other enemies well clear of the test axis. Their AI is disabled for
  // the run so they stay put — but left where they were, a stray car wanders into
  // the measurement and silently voids a case.
  for (let i = 1; i < d.enemies.length; i++) {
    const angle = (i / d.enemies.length) * Math.PI * 2;
    const r = d.arena.radius * 0.8;
    d.world.teleport(
      d.enemies[i].vehicle.body,
      new Vector3(Math.cos(angle) * r, 0.75, Math.sin(angle) * r),
      FACE_POS_Z
    );
  }

  // Enemy parked at the origin facing +Z. Player 7 m away on the axis, facing it:
  // from -Z he is behind it (rear hit), from +Z he meets it head-on.
  d.world.teleport(enemy.body, new Vector3(0, 0.75, 0), FACE_POS_Z);
  const startZ = opts.rear ? -opts.gap : opts.gap;
  const lateral = opts.lateral ?? 0;
  d.world.teleport(
    player.body,
    new Vector3(lateral, 0.5, startZ),
    opts.rear ? FACE_POS_Z : FACE_NEG_Z
  );
  d.step(1 / 60, 12);

  d.controls.charging = true;
  const chargeFrames = Math.round((opts.charge * TUNING.charge.timeToFull) / (1 / 60));
  d.step(1 / 60, Math.max(1, chargeFrames));
  const chargeLevel = d.player.chargeLevel;
  d.controls.charging = false;
  d.controls.released = true;
  d.step(1 / 60);
  d.controls.released = false;
  const launchSpeed = player.planarSpeed;

  let peakEnemySpeed = 0;
  let enemyTravel = 0;
  let minGap = Infinity;
  let maxGapAfter = 0;
  let playerRecoilSpeed = 0;
  let report = "";
  let knockedOff = false;
  d.combat.lastReport = "";

  for (let i = 0; i < 180; i++) {
    d.step(1 / 60);
    if (d.knockouts() > koBefore) {
      knockedOff = true;
      break;
    }
    if (d.enemies.length === 0 || d.enemies[0].vehicle !== enemy) break;
    peakEnemySpeed = Math.max(peakEnemySpeed, enemy.planarSpeed);
    enemyTravel = Math.max(enemyTravel, Math.hypot(enemy.position.x, enemy.position.z));
    if (!d.combat.lastReport) continue;
    report = d.combat.lastReport;

    const dx = enemy.position.x - player.position.x;
    const dz = enemy.position.z - player.position.z;
    const gap = Math.hypot(dx, dz) || 1;
    minGap = Math.min(minGap, gap);
    maxGapAfter = Math.max(maxGapAfter, gap);
    // Component of Car Boy's velocity pointing away from the enemy.
    const pv = player.velocity;
    playerRecoilSpeed = Math.max(playerRecoilSpeed, -(pv.x * dx + pv.z * dz) / gap);
  }

  const approach = Number(/approach=([\d.]+)/.exec(report)?.[1] ?? 0);

  return {
    label: opts.label,
    chargeLevel: round(chargeLevel),
    launchSpeed: round(launchSpeed),
    approachSpeed: approach,
    peakEnemySpeed: round(peakEnemySpeed),
    enemyTravel: round(enemyTravel),
    separation: round(minGap === Infinity ? 0 : maxGapAfter - minGap),
    playerRecoilSpeed: round(playerRecoilSpeed),
    knockedOff,
    report,
  };
}

/**
 * Frame-rate independence (§1.8 / Part 5 "impacts remain stable across frame
 * rates"): the same charged hit is run at several dt values and the resulting
 * enemy travel compared.
 */
export function frameRateBench(d: BenchDeps): { dt: number; travel: number; peak: number }[] {
  const savedSpeed = TUNING.enemy.maxSpeed;
  const savedAccel = TUNING.enemy.accel;
  TUNING.enemy.maxSpeed = 0;
  TUNING.enemy.accel = 0;
  const results: { dt: number; travel: number; peak: number }[] = [];
  try {
    for (const dt of [1 / 120, 1 / 60, 1 / 30, 1 / 20]) {
      for (let i = 0; i < 240 && d.enemies.length === 0; i++) d.step(1 / 60);
      const enemy = d.enemies[0].vehicle;
      const player = d.player.vehicle;
      const koBefore = d.knockouts();

      d.world.teleport(enemy.body, new Vector3(0, 0.75, 0), FACE_POS_Z);
      d.world.teleport(player.body, new Vector3(0, 0.5, -7), FACE_POS_Z);
      d.step(dt, Math.ceil(0.2 / dt));

      d.controls.charging = true;
      d.step(dt, Math.ceil(TUNING.charge.timeToFull / dt));
      d.controls.charging = false;
      d.controls.released = true;
      d.step(dt);
      d.controls.released = false;

      let travel = 0;
      let peak = 0;
      for (let i = 0; i < Math.ceil(3 / dt); i++) {
        d.step(dt);
        if (d.knockouts() > koBefore) break;
        if (d.enemies.length === 0 || d.enemies[0].vehicle !== enemy) break;
        travel = Math.max(travel, Math.hypot(enemy.position.x, enemy.position.z));
        peak = Math.max(peak, enemy.planarSpeed);
      }
      results.push({ dt: round(dt), travel: round(travel), peak: round(peak) });
    }
  } finally {
    TUNING.enemy.maxSpeed = savedSpeed;
    TUNING.enemy.accel = savedAccel;
  }
  return results;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
