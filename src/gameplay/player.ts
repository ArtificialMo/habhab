import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { TUNING } from "../data/tuning";
import type { Controls } from "../input/controls";
import { Vehicle } from "./vehicle";
import type { PhysicsWorld } from "../core/physics";
import { AimIndicator } from "../render/aimIndicator";
import { AimArrow } from "../render/aimArrow";
import { VehicleRig } from "../render/vehicleRig";
import { PLAYER_STYLE } from "../render/carModels";

/**
 * Car Boy. Charge is a brace-and-release: holding the button stops the car and
 * locks the aim, which is where the anticipation in §2.6 comes from — a charge
 * you can drive through has no tension.
 */
export class Player {
  readonly vehicle: Vehicle;
  readonly rig: VehicleRig;

  chargeT = 0;
  cooldownT = 0;
  /** Remaining seconds in which a contact counts as an attack (§2.7). */
  attackT = 0;
  /** Charge level at the moment of release, 0..1. */
  attackPower = 0;
  /** True on the frame a charge is released, for audio and VFX. */
  justLaunched = false;

  private lockT = 0;
  private recoverT = 0;
  private steerInput = 0;
  private snapCooldown = 0;
  private readonly aim: AimIndicator;
  private readonly arrow: AimArrow;
  /** Aim heading this frame, for the button's direction indicator. */
  aimYawNow = 0;
  private readonly target = new Vector3();

  constructor(
    scene: Scene,
    private readonly world: PhysicsWorld,
    spawn: Vector3
  ) {
    this.vehicle = new Vehicle(scene, world, TUNING.player, spawn);
    this.rig = new VehicleRig(scene, this.vehicle, PLAYER_STYLE, "carboy");
    this.aim = new AimIndicator(scene, this.vehicle.mesh, TUNING.player.size.l * 0.5);
    this.arrow = new AimArrow(scene, this.vehicle.mesh);
  }

  get chargeLevel(): number {
    return this.chargeT / TUNING.charge.timeToFull;
  }

  /** 0 during the recoil lock, ramping back to 1 — §2.7 step 10. */
  get authority(): number {
    if (this.lockT > 0) return 0;
    if (this.recoverT > 0) return 1 - this.recoverT / TUNING.collision.recoilRecover;
    return 1;
  }

  get attacking(): boolean {
    return this.attackT > 0;
  }

  /**
   * `strength` is the Δv delivered to the enemy. The lock scales with it because
   * the drive controller targets a velocity, and with no finger on the screen that
   * target is zero — at full authority it brakes the recoil away within a frame or
   * two and the bounce never reads. Bigger hit, longer readable bounce.
   */
  /** True for one frame when a wind-up is destroyed by taking a hit. */
  chargeLost = false;

  onHit(strength: number): void {
    const c = TUNING.collision;
    // Losing a two-second wind-up to a shove has to be legible, or it just reads as
    // the button not working.
    if (this.chargeT > TUNING.charge.timeToFull * 0.15) this.chargeLost = true;
    this.chargeT = 0;
    this.lockT = Math.min(c.recoilLockMax, c.recoilLock + strength * c.recoilLockPerDeltaV);
    this.recoverT = c.recoilRecover;
    this.rig.onHit(strength);
  }

  update(dt: number, controls: Controls): void {
    this.justLaunched = false;
    this.chargeLost = false;
    this.cooldownT = Math.max(0, this.cooldownT - dt);
    this.attackT = Math.max(0, this.attackT - dt);
    this.lockT = Math.max(0, this.lockT - dt);
    if (this.lockT === 0) this.recoverT = Math.max(0, this.recoverT - dt);

    const v = this.vehicle;
    const authority = this.authority;
    // While winding up, the ram button doubles as the aim stick — that is the only
    // control a mouse user has free, since their one cursor is already held down
    // on the button.
    const aimYaw = controls.aiming
      ? Math.atan2(controls.aimDir.x, controls.aimDir.z)
      : controls.steerAmount > 0
        ? Math.atan2(controls.steerDir.x, controls.steerDir.z)
        : v.yaw;

    const charging = controls.charging && this.cooldownT === 0;

    // Reversal pivot. Ordinary turns — anything up to about a right angle — still
    // arc round on the steering controller, which is what keeps the car feeling
    // like a vehicle. Only a near-180 whips instantly, because arcing through one
    // takes most of a second and reads as lost input rather than as momentum.
    this.snapCooldown = Math.max(0, this.snapCooldown - dt);
    // Only from near-standstill. At speed a car must actually turn — or reverse
    // out — which is what makes an edge recovery a manoeuvre rather than a pivot.
    if (
      controls.steerAmount > 0.35 &&
      this.snapCooldown === 0 &&
      authority > 0.5 &&
      v.planarSpeed < 3.5
    ) {
      let err = aimYaw - v.yaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      if (Math.abs(err) >= TUNING.player.snapYawThreshold) {
        this.world.setYaw(v.body, aimYaw);
        // Carry a little speed through the pivot along the new heading, so the car
        // does not keep sliding backwards out from under itself.
        const speed = v.planarSpeed * TUNING.player.snapSpeedKeep;
        v.body.setLinearVelocity(
          new Vector3(Math.sin(aimYaw) * speed, v.velocity.y, Math.cos(aimYaw) * speed)
        );
        this.snapCooldown = 0.28;
        this.rig.onPivot();
      }
    }

    if (charging) {
      this.chargeT = Math.min(TUNING.charge.timeToFull, this.chargeT + dt);
      // Brace: bleed off speed while aiming.
      this.target.setAll(0);
      v.driveToward(this.target, dt, authority);
      // Aiming while wound up is instant in any direction. The car is braked and
      // stationary here, so there is nothing to fight: the nose is set straight to
      // the swipe rather than arcing round to it under the angular-velocity clamp,
      // which capped large turns at ~7 rad/s and made a half-turn feel unresponsive.
      if ((controls.aiming || controls.steerAmount > 0.05) && authority > 0.4) {
        this.world.setYaw(v.body, aimYaw);
      } else {
        v.steerTo(aimYaw, authority, TUNING.charge.aimRate);
      }
    } else {
      if (controls.released && this.chargeT > 0 && this.cooldownT === 0) this.launch();
      const top = TUNING.player.maxSpeed;
      this.target.set(
        controls.steerDir.x * top * controls.steerAmount,
        0,
        controls.steerDir.z * top * controls.steerAmount
      );
      // During the lunge the controller must get out of the way. It targets a
      // velocity, and the lunge is far above top speed, so at full authority it
      // reads the charge as "too fast" and brakes — the attack died before it
      // reached the enemy. Steering stays live so the lunge is still aimable.
      v.driveToward(this.target, dt, this.attacking ? authority * TUNING.charge.lungeAuthority : authority);
      if (controls.steerAmount > 0) v.steerTo(aimYaw, authority);
      else if (v.planarSpeed > 1.5) v.steerTo(Math.atan2(v.velocity.x, v.velocity.z), authority * 0.6);
    }

    // Signed steering error, for turning the front wheels the right way.
    let err = aimYaw - v.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const steerTarget = controls.steerAmount > 0 ? clamp(err * 1.6, -1, 1) : 0;
    this.steerInput += (steerTarget - this.steerInput) * Math.min(1, dt * 12);

    v.clampAngular(TUNING.collision.maxAngularSpeed);
    this.aimYawNow = aimYaw;
    this.aim.update(dt, this.chargeLevel, charging);
    this.arrow.update(dt, charging, aimYaw, this.chargeLevel, TUNING.player.size.h);
    controls.chargeLevel = this.cooldownT > 0 ? 0 : this.chargeLevel;
  }

  /** Cosmetics run after the physics step, so they read this frame's real state. */
  updateVisuals(dt: number, controls: Controls): void {
    this.rig.update(dt, {
      charge: this.chargeLevel,
      charging: controls.charging && this.cooldownT === 0,
      steer: this.steerInput,
    });
  }

  private launch(): void {
    const level = this.chargeLevel;
    const impulse =
      TUNING.charge.impulseMin + level * (TUNING.charge.impulseMax - TUNING.charge.impulseMin);
    this.vehicle.applyPlanarImpulse(this.vehicle.forward, impulse);
    this.attackT = TUNING.charge.attackWindow;
    this.attackPower = level;
    this.cooldownT = TUNING.charge.cooldown;
    this.chargeT = 0;
    this.justLaunched = true;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
