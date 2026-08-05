import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";

import { TUNING } from "../data/tuning";
import type { PhysicsWorld } from "../core/physics";
import type { Player } from "./player";
import type { Enemy } from "./enemy";
import type { Vehicle } from "./vehicle";

export interface HitEvent {
  /** The Δv delivered to the enemy — the single number all feedback scales from. */
  strength: number;
  rear: boolean;
  charged: boolean;
  point: Vector3;
  /** True for a clean tank shot — the caller detonates rather than sparks. */
  gasTank: boolean;
  /** Unit push direction, player → enemy. Sparks spray along it. */
  normal: Vector3;
}

/**
 * The Part 0 system. Havok resolves the contact; this layer adds the arcade
 * asymmetry on top (§2.7 steps 5–8): the enemy is launched far, Car Boy is pushed
 * back modestly, and the offset of the contact from the enemy's centre becomes
 * spin. Nothing here teleports or animates a vehicle — every metre of gameplay
 * motion comes out of the solver.
 */
export class Combat {
  private time = 0;
  /** enemyId → last supplemental hit time, for the anti-micro-bounce gate. */
  private readonly lastHit = new Map<number, number>();
  private readonly enemiesByBody = new Map<PhysicsBody, Enemy>();

  /** Diagnostics for the dev overlay and the physics review (§1.8). */
  lastReport = "";
  hitCount = 0;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly player: Player,
    private readonly onHit: (e: HitEvent) => void
  ) {
    this.world.onContact(this.player.vehicle.body, (other, contact) => {
      const enemy = this.enemiesByBody.get(other);
      if (enemy) this.resolve(enemy, contact.point);
    });
  }

  register(enemy: Enemy): void {
    this.enemiesByBody.set(enemy.vehicle.body, enemy);
  }

  unregister(enemy: Enemy): void {
    this.enemiesByBody.delete(enemy.vehicle.body);
    this.lastHit.delete(enemy.vehicle.id);
  }

  tick(dt: number): void {
    this.time += dt;
  }

  private resolve(enemy: Enemy, point: Vector3): void {
    const last = this.lastHit.get(enemy.vehicle.id) ?? -99;
    if (this.time - last < TUNING.collision.pairCooldown) return;

    const p = this.player.vehicle;
    const e = enemy.vehicle;

    // Direction is taken centre-to-centre rather than from the solver normal:
    // box corners produce normals that flip between frames, and an unpredictable
    // push direction is the fastest way to make a bounce feel random (§1.8).
    const n = new Vector3(e.position.x - p.position.x, 0, e.position.z - p.position.z);
    const len = n.length();
    if (len < 0.001) return;
    n.scaleInPlace(1 / len);

    // Velocities cached before the physics step, so this is the true approach
    // speed rather than the already-resolved post-collision one.
    const pv = p.lastVelocity;
    const ev = e.lastVelocity;
    const approach = (pv.x - ev.x) * n.x + (pv.z - ev.z) * n.z;
    const c = TUNING.collision;

    // Contact with no meaningful approach speed — a graze, a nudge, or two cars
    // resting together. It still separates them: there is no state in which two
    // cars are touching and nothing happens.
    if (approach < c.minApproachSpeed) {
      this.separate(p, e, n, c.touchSeparation);
      enemy.onHit(c.touchSeparation);
      this.player.onHit(c.touchSeparation);
      this.lastHit.set(e.id, this.time);
      this.hitCount++;
      this.lastReport = `touch separate dV=${c.touchSeparation.toFixed(1)}`;
      this.onHit({
        strength: c.touchSeparation,
        rear: false,
        gasTank: false,
        charged: false,
        point: point.clone(),
        normal: n.clone(),
      });
      return;
    }

    // Who is doing the ramming? n points player → enemy, so the player is closing
    // when pv·n is positive and the enemy is closing when ev·n is negative. The car
    // driving *into* the other one is the aggressor and delivers the push; the one
    // being hit takes it. Without this the arcade layer always treated Car Boy as
    // the attacker, so an enemy slamming into him barely moved him — every contact
    // has two ends and both of them should feel like a ram.
    const playerClosing = pv.x * n.x + pv.z * n.z;
    const enemyClosing = -(ev.x * n.x + ev.z * n.z);
    const playerAttacks = playerClosing >= enemyClosing;

    let mult = 1;
    const charged = playerAttacks && this.player.attacking;
    if (charged) mult *= c.attackMultiplier * (1 + c.chargeScaling * this.player.attackPower);

    // Rear bonus goes to whoever was hit from behind.
    const rearDot = playerAttacks
      ? n.x * e.forward.x + n.z * e.forward.z
      : -(n.x * p.forward.x + n.z * p.forward.z);
    const rear = rearDot > c.rearDot;

    // Gas tank: a much tighter cone than a general rear hit, and only when Car Boy
    // is the one attacking. Squarely up the back is a different, better shot than
    // merely catching a rear corner — this is the skill ceiling on positioning.
    // It *replaces* the rear bonus rather than stacking with it, so the three tiers
    // stay distinguishable instead of all pinning to the cap.
    const gasTank = playerAttacks && rearDot > c.gasTankDot;
    if (gasTank) mult *= c.gasTankMultiplier;
    else if (rear) mult *= c.rearMultiplier;

    const deltaV = Math.min(c.deltaVMax, Math.max(c.deltaVMin, approach * c.transferRatio * mult));

    // The supplemental impulse targets a *departure velocity* rather than adding a
    // fixed amount on top of the solver. Havok's own response to a box-on-box
    // contact varies a lot with penetration depth and contact count, so "add 16
    // m/s" produced a different bounce every time — and it cancelled against the
    // solver almost exactly, leaving the struck car stopped dead instead of bounced
    // back. Making the outcome explicit is what keeps a hit predictable.
    if (playerAttacks) {
      this.push(e, n, deltaV, point, c.torqueLeverClamp);
      this.push(p, n, -deltaV * c.playerRecoilFactor, null, 0);
    } else {
      // Enemy is the aggressor: Car Boy takes the full shove, the enemy rebounds.
      this.push(p, n, -deltaV, point, c.torqueLeverClamp);
      this.push(e, n, deltaV * c.enemyRecoilFactor, null, 0);
    }

    enemy.onHit(deltaV);
    this.player.onHit(deltaV);
    this.lastHit.set(e.id, this.time);
    this.hitCount++;

    this.lastReport = `${playerAttacks ? "you→them" : "them→you"} ${gasTank ? "GASTANK" : rear ? "REAR" : "front"} ${charged ? "charged" : "tap"} approach=${approach.toFixed(1)} dV=${deltaV.toFixed(1)}`;
    this.onHit({
      strength: deltaV,
      rear: rear || gasTank,
      gasTank,
      charged,
      point: point.clone(),
      normal: n.clone(),
    });
  }

  /**
   * Drives one car to a target departure velocity along `n`. A negative `deltaV`
   * sends it along -n. `at` gives the contact point when the hit should also impart
   * spin; pass null to push through the centre of mass so the car is shoved, not
   * spun — that is what keeps control readable on the car taking the hit.
   */
  private push(
    v: Vehicle,
    n: Vector3,
    deltaV: number,
    at: Vector3 | null,
    leverClamp: number
  ): void {
    const along = dot(v.body.getLinearVelocity(), n);
    // Never slow a car that is already leaving faster than the target.
    if (deltaV >= 0 ? deltaV <= along : deltaV >= along) return;
    const j = (deltaV - along) * v.config.mass;

    let point = v.position;
    if (at && leverClamp > 0) {
      const off = new Vector3(at.x - v.position.x, 0, at.z - v.position.z);
      const maxOff = leverClamp * Math.max(v.config.size.w, v.config.size.l);
      const offLen = off.length();
      if (offLen > maxOff) off.scaleInPlace(maxOff / offLen);
      point = new Vector3(v.position.x + off.x, v.position.y, v.position.z + off.z);
    }
    v.body.applyImpulse(new Vector3(n.x * j, 0, n.z * j), point);
  }

  /**
   * Pushes the pair apart along the contact normal — the enemy along +n, Car Boy
   * along -n, always directly opposed. Used for grazes and resting contacts, where
   * there is no approach speed to scale from but the cars must still part.
   */
  private separate(p: Vehicle, e: Vehicle, n: Vector3, deltaV: number): void {
    const enemyAlong = dot(e.body.getLinearVelocity(), n);
    if (deltaV > enemyAlong) {
      const j = (deltaV - enemyAlong) * e.config.mass;
      e.body.applyImpulse(new Vector3(n.x * j, 0, n.z * j), e.position);
    }
    const target = -deltaV * TUNING.collision.playerRecoilFactor;
    const playerAlong = dot(p.body.getLinearVelocity(), n);
    if (playerAlong > target) {
      const j = (playerAlong - target) * p.config.mass;
      p.body.applyImpulse(new Vector3(-n.x * j, 0, -n.z * j), p.position);
    }
  }
}

/** Planar dot product against a unit XZ normal. */
function dot(v: Vector3, n: Vector3): number {
  return v.x * n.x + v.z * n.z;
}
