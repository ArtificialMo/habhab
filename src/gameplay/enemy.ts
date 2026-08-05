import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { TUNING } from "../data/tuning";
import type { PhysicsWorld } from "../core/physics";
import { Vehicle } from "./vehicle";
import { VehicleRig } from "../render/vehicleRig";
import { enemyStyle } from "../render/carModels";
import { ENEMY_TIERS } from "../render/style";

/**
 * §3.5 hook 2 — enemy behaviour sits behind a strategy interface even though only
 * one behaviour ships in the MVP.
 */
export interface EnemyContext {
  self: Enemy;
  playerPosition: Vector3;
  /** Metres of solid ground beyond a point; negative means over water. */
  margin: (x: number, z: number) => number;
  islandRadius: number;
}

export interface EnemyIntent {
  /** Desired planar velocity. */
  velocity: Vector3;
  /** Yaw to face, or null to face travel direction. */
  yaw: number | null;
}

export interface EnemyBehaviour {
  readonly id: string;
  update(ctx: EnemyContext, dt: number): EnemyIntent;
}

/**
 * The hunter.
 *
 * Two jobs, in strict priority: do not fall off, and shove the player off. It does
 * the second by *positioning* — it works its way to the inland side of the player
 * and then drives through them outward, so its momentum carries them toward the
 * water rather than merely bumping them.
 *
 * Everything here asks the arena where the ground actually is. Earlier versions
 * measured "distance from the world origin" against the arena radius, which was
 * fine for one island at the centre and became suicidal the moment there were
 * several: out on an outlying isle, every enemy believed it was far past the rim
 * and drove "inward" — straight off its own island and into the sea.
 */
export class DirectChargerBehaviour implements EnemyBehaviour {
  readonly id = "direct-charger";
  private readonly out = { velocity: new Vector3(), yaw: null as number | null };
  private readonly committed = new Vector3(0, 0, 1);
  private commitLeft = 0;
  private readonly desired = new Vector3();

  /**
   * Direction of increasing ground margin — i.e. which way is safety. Sampled
   * rather than derived, so it works for islands, bridges and any future shape.
   */
  private safety(ctx: EnemyContext, x: number, z: number, out: Vector3): number {
    const h = 1.6;
    const m = ctx.margin(x, z);
    const gx = ctx.margin(x + h, z) - ctx.margin(x - h, z);
    const gz = ctx.margin(x, z + h) - ctx.margin(x, z - h);
    const len = Math.hypot(gx, gz);
    if (len < 0.0001) out.set(0, 0, 0);
    else out.set(gx / len, 0, gz / len);
    return m;
  }

  update(ctx: EnemyContext, dt: number): EnemyIntent {
    const pos = ctx.self.vehicle.position;
    const t = TUNING.enemy;

    // --- 1. self-preservation ------------------------------------------------
    const inward = new Vector3();
    const myMargin = this.safety(ctx, pos.x, pos.z, inward);

    this.desired.set(ctx.playerPosition.x - pos.x, 0, ctx.playerPosition.z - pos.z);
    const dist = Math.hypot(this.desired.x, this.desired.z) || 1;
    this.desired.x /= dist;
    this.desired.z /= dist;

    // --- 2. attack station: the inland side of the player ---------------------
    // Standing between the player and the middle of their island means the shove,
    // when it lands, carries them outward. This is the whole tactic.
    const playerSafety = new Vector3();
    this.safety(ctx, ctx.playerPosition.x, ctx.playerPosition.z, playerSafety);
    const standoff = t.attackStandoff;
    const stationX = ctx.playerPosition.x + playerSafety.x * standoff;
    const stationZ = ctx.playerPosition.z + playerSafety.z * standoff;

    const toStationX = stationX - pos.x;
    const toStationZ = stationZ - pos.z;
    const stationDist = Math.hypot(toStationX, toStationZ) || 1;

    // Lined up once it is roughly on the station and pointing across the player.
    const lined = stationDist < t.attackStandoff * 0.9;
    if (lined) {
      // Drive through the player and out the far side.
      this.desired.x = ctx.playerPosition.x + -playerSafety.x * 6 - pos.x;
      this.desired.z = ctx.playerPosition.z + -playerSafety.z * 6 - pos.z;
    } else {
      // Move to the station, but only if the station is on solid ground — chasing a
      // station out over water is how a hunter drowns itself.
      const stationSafe = ctx.margin(stationX, stationZ) > 1;
      this.desired.x = stationSafe ? toStationX : ctx.playerPosition.x - pos.x;
      this.desired.z = stationSafe ? toStationZ : ctx.playerPosition.z - pos.z;
    }
    const dl = Math.hypot(this.desired.x, this.desired.z) || 1;
    this.desired.x /= dl;
    this.desired.z /= dl;

    // --- 3. edge fear overrides everything -----------------------------------
    // Blended in by how little ground is left, and it wins outright at the brink.
    if (myMargin < t.edgeFear) {
      const fear = Math.min(1, 1 - Math.max(0, myMargin) / t.edgeFear);
      const strength = fear * fear * 1.6;
      this.desired.x += inward.x * strength;
      this.desired.z += inward.z * strength;
      const fl = Math.hypot(this.desired.x, this.desired.z) || 1;
      this.desired.x /= fl;
      this.desired.z /= fl;
    }

    // --- 4. heading commitment -----------------------------------------------
    // A car that re-aims every frame is a homing missile with no rear to hit.
    this.commitLeft -= dt;
    // Commitment exists to open a flanking window at range. Inside striking
    // distance it does the opposite: at 16 m/s a 0.85 s commitment is 13 m of
    // travel, further than the gap, so the car sails past on every pass and
    // orbits instead of connecting. Close in, it aims properly.
    const closing = dist < t.trackRange;
    if (this.commitLeft <= 0 || myMargin < t.edgeFear || closing) {
      // Danger re-aims immediately; nothing is worth committing to off a cliff.
      this.commitLeft = t.commitTime;
      this.committed.copyFrom(this.desired);
    } else {
      const k = Math.min(1, dt * t.commitTrack);
      this.committed.x += (this.desired.x - this.committed.x) * k;
      this.committed.z += (this.desired.z - this.committed.z) * k;
      const len = Math.hypot(this.committed.x, this.committed.z) || 1;
      this.committed.x /= len;
      this.committed.z /= len;
    }

    // Ease off only when genuinely cornered, so a hunter never stalls in the open.
    const speed = t.maxSpeed * (myMargin < 1.2 ? 0.55 : 1);
    this.out.velocity.set(this.committed.x * speed, 0, this.committed.z * speed);
    this.out.yaw = null;
    return this.out;
  }
}

export class Enemy {
  readonly vehicle: Vehicle;
  readonly behaviour: EnemyBehaviour;
  readonly rig: VehicleRig;
  /** Strength tier, 0..4, driving the colour gradient in §2.12. */
  readonly tier: number;
  readonly displayName: string;

  private lockT = 0;
  private recoverT = 0;
  private steerInput = 0;
  /** Seconds until this enemy may lunge again. */
  private lungeCooldown = 0;

  constructor(
    scene: Scene,
    world: PhysicsWorld,
    spawn: Vector3,
    behaviour: EnemyBehaviour,
    tier = 2,
    displayName = "ENEMY"
  ) {
    this.vehicle = new Vehicle(scene, world, TUNING.enemy, spawn);
    this.behaviour = behaviour;
    this.tier = Math.max(0, Math.min(ENEMY_TIERS.length - 1, tier));
    this.displayName = displayName;
    this.rig = new VehicleRig(scene, this.vehicle, enemyStyle(ENEMY_TIERS[this.tier]), `enemy${this.vehicle.id}`);
  }

  /**
   * Authority is zero while the car is being thrown. This is what makes a big hit
   * land: a knocked-back enemy cannot simply drive back from the brink.
   */
  get authority(): number {
    if (this.lockT > 0) return 0;
    if (this.vehicle.planarSpeed > TUNING.enemy.maxSpeed * 1.35) return 0;
    if (this.recoverT > 0) return 1 - this.recoverT / 0.5;
    return 1;
  }

  onHit(strength: number): void {
    // Bigger hits take the wheel away for longer, so the slide is committed.
    this.lockT = Math.min(0.85, 0.18 + strength * 0.02);
    this.recoverT = 0.5;
    this.rig.onHit(strength);
  }

  update(
    dt: number,
    playerPosition: Vector3,
    islandRadius: number,
    margin: (x: number, z: number) => number
  ): void {
    this.lockT = Math.max(0, this.lockT - dt);
    if (this.lockT === 0) this.recoverT = Math.max(0, this.recoverT - dt);
    this.lungeCooldown = Math.max(0, this.lungeCooldown - dt);

    const authority = this.authority;

    // A short shove of its own when it gets close, so being hit by an enemy is a
    // ram rather than a bump. Top speed alone is not enough approach speed to
    // register as an attack.
    // Gated on the AI actually being enabled: the impact bench disables enemy
    // driving to measure the collision model in isolation, and a lunge firing
    // during it would silently change the numbers the tuning is judged on.
    if (authority > 0.6 && this.lungeCooldown === 0 && TUNING.enemy.maxSpeed > 0) {
      const dx = playerPosition.x - this.vehicle.position.x;
      const dz = playerPosition.z - this.vehicle.position.z;
      const d = Math.hypot(dx, dz);
      if (d < TUNING.enemy.lungeRange && d > 0.001) {
        this.vehicle.applyPlanarImpulse(
          new Vector3(dx / d, 0, dz / d),
          TUNING.enemy.lungeImpulse * this.vehicle.config.mass
        );
        this.lungeCooldown = TUNING.enemy.lungeCooldown;
        this.rig.onPivot();
      }
    }
    const intent = this.behaviour.update({ self: this, playerPosition, islandRadius, margin }, dt);
    this.vehicle.driveToward(intent.velocity, dt, authority);

    const v = this.vehicle.velocity;
    const targetYaw = intent.yaw ?? (this.vehicle.planarSpeed > 0.8 ? Math.atan2(v.x, v.z) : null);
    if (targetYaw !== null) {
      this.vehicle.steerTo(targetYaw, authority);
      let err = targetYaw - this.vehicle.yaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      this.steerInput += (Math.max(-1, Math.min(1, err * 1.4)) - this.steerInput) * Math.min(1, dt * 10);
    }

    this.vehicle.clampAngular(TUNING.collision.maxAngularSpeed);
  }

  /** Cosmetics run after the physics step (§3.3). */
  updateVisuals(dt: number): void {
    this.rig.update(dt, { charge: 0, charging: false, steer: this.steerInput });
  }

  dispose(): void {
    this.rig.dispose();
    this.vehicle.dispose();
  }
}
