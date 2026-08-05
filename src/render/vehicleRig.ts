import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { TUNING } from "../data/tuning";
import type { Vehicle } from "../gameplay/vehicle";
import { buildCar, type CarParts, type CarStyle } from "./carModels";
import { PALETTE, SUN_DIRECTION } from "./style";

// Ground-plane direction the sun pushes shadows, normalised once.
const SHADOW_LEN = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z);
const SHADOW_DIR_X = SUN_DIRECTION.x / SHADOW_LEN;
const SHADOW_DIR_Z = SUN_DIRECTION.z / SHADOW_LEN;

/**
 * A critically-ish damped spring, used for every soft cosmetic response on the car.
 * One implementation so suspension, hop and antenna all settle with the same
 * character — mixed spring behaviours are what make a rig feel incoherent.
 */
class Spring {
  value = 0;
  velocity = 0;
  constructor(
    private readonly stiffness: number,
    private readonly damping: number
  ) {}

  step(target: number, dt: number): number {
    const accel = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  kick(amount: number): void {
    this.velocity += amount;
  }
}

export interface RigState {
  /** 0..1 charge level; drives the wind-up vibration. */
  charge: number;
  charging: boolean;
  /** Steering input, -1..1, for turning the front wheels. */
  steer: number;
}

/**
 * Cosmetic vehicle animation (§3.3). Every transform here is presentation only —
 * it is applied to a visual root parented under the physics mesh and can never
 * change a collision outcome.
 */
export class VehicleRig {
  readonly parts: CarParts;

  private readonly squat = new Spring(TUNING.feel.suspensionStiffness, TUNING.feel.suspensionDamping);
  private readonly roll = new Spring(TUNING.feel.suspensionStiffness * 0.7, TUNING.feel.suspensionDamping * 0.9);
  private readonly pitch = new Spring(TUNING.feel.suspensionStiffness * 0.7, TUNING.feel.suspensionDamping * 0.9);
  private readonly hop = new Spring(TUNING.feel.suspensionStiffness * 0.85, TUNING.feel.suspensionDamping * 0.75);
  /** Impact squash. Kicked on a hit, springs back through an overshoot. */
  private readonly squash = new Spring(150, 11);
  private readonly antennaX = new Spring(TUNING.feel.antennaStiffness, TUNING.feel.antennaDamping);
  private readonly antennaZ = new Spring(TUNING.feel.antennaStiffness, TUNING.feel.antennaDamping);

  private readonly prevVelocity = new Vector3();
  private readonly accel = new Vector3();
  private flash = 0;
  private wheelSpin = 0;
  private vibrationPhase = 0;
  private readonly baseLightColour: Color3;

  constructor(
    scene: Scene,
    private readonly vehicle: Vehicle,
    style: CarStyle,
    name: string
  ) {
    this.parts = buildCar(scene, style, name);
    // Parented to the physics mesh, so position and body rotation come for free
    // and everything this class does is a local offset on top of them.
    this.parts.root.parent = vehicle.mesh;
    this.baseLightColour = PALETTE.headlight.clone();
  }

  /** Overall size of the visible car. Cosmetic only — the collider is unchanged. */
  setScale(scale: number): void {
    this.parts.root.scaling.setAll(scale);
  }

  /** A hard reversal pivot: rock the body and whip the antenna so it reads. */
  onPivot(): void {
    this.roll.kick(5.5);
    this.antennaZ.kick(7);
    this.antennaX.kick(-4);
  }

  /** §2.8 — the white flash on being hit, scaled by hit strength. */
  onHit(strength: number): void {
    // Squash and stretch: the car pancakes on the blow and springs back past its
    // rest shape. Cosmetic only — the collider never changes size.
    this.squash.kick(Math.min(26, 4 + strength * 0.55));
    this.flash = Math.min(1, 0.35 + strength * 0.035);
    this.hop.kick(Math.min(TUNING.feel.impactHopMax, strength * TUNING.feel.impactHop) * 22);
    this.antennaX.kick((Math.random() * 2 - 1) * 9);
    this.antennaZ.kick(6 + strength * 0.25);
  }

  update(dt: number, state: RigState): void {
    if (dt <= 0) return;
    const f = TUNING.feel;
    const cf = TUNING.chargeFeel;
    const v = this.vehicle.velocity;

    // Acceleration in the car's own frame: +Z is forward, +X is right.
    this.accel.set((v.x - this.prevVelocity.x) / dt, 0, (v.z - this.prevVelocity.z) / dt);
    this.prevVelocity.copyFrom(v);
    const fwd = this.vehicle.forward;
    const rightX = fwd.z;
    const rightZ = -fwd.x;
    const accelFwd = this.accel.x * fwd.x + this.accel.z * fwd.z;
    const accelLat = this.accel.x * rightX + this.accel.z * rightZ;

    // ---- suspension ------------------------------------------------------
    // Braking pitches the nose down, acceleration lifts it, cornering rolls it out.
    const pitchTarget = clamp(-accelFwd * f.bodyPitch, -f.maxPitch, f.maxPitch);
    const rollTarget = clamp(accelLat * f.bodyRoll, -f.maxRoll, f.maxRoll);
    let squatTarget = clamp(Math.abs(accelFwd) * 0.004, 0, f.suspensionTravel);

    // ---- charge wind-up --------------------------------------------------
    // The car hunkers down, the nose lifts, and the whole body buzzes faster and
    // harder as the charge builds. This is the anticipation: by the time it is at
    // full charge the car is visibly straining against itself.
    let vibrateX = 0;
    let vibrateZ = 0;
    let vibrateY = 0;
    let chargePitch = 0;
    if (state.charging && state.charge > 0) {
      const c = state.charge;
      const hz = cf.vibrationHzMin + (cf.vibrationHzMax - cf.vibrationHzMin) * c;
      this.vibrationPhase += dt * hz * Math.PI * 2;
      // Two incommensurate frequencies, so it reads as a rattle rather than a
      // clean sine wave sliding the car around.
      const amp = cf.vibrationAmplitude * c * c;
      vibrateX = Math.sin(this.vibrationPhase) * amp;
      vibrateZ = Math.sin(this.vibrationPhase * 1.618 + 1.1) * amp * 0.7;
      vibrateY = Math.abs(Math.sin(this.vibrationPhase * 2.1)) * amp * 0.45;
      squatTarget += cf.squat * c;
      chargePitch = -cf.rear * c;
      // Headlights brighten and widen as it winds up.
      this.parts.lightMaterial.setColor3(
        "baseColor",
        Color3.Lerp(this.baseLightColour, new Color3(1, 1, 1), c * 0.85)
      );
      for (const lamp of this.parts.headlights) lamp.scaling.y = 1 + c * 0.18;
    } else {
      this.vibrationPhase = 0;
      this.parts.lightMaterial.setColor3("baseColor", this.baseLightColour);
      for (const lamp of this.parts.headlights) lamp.scaling.y = 1;
    }

    const squat = this.squat.step(squatTarget, dt);
    const roll = this.roll.step(rollTarget, dt);
    const pitchV = this.pitch.step(pitchTarget, dt);
    const hop = this.hop.step(0, dt);

    this.parts.body.position.set(0, -squat + hop, 0);
    // Assigned, never accumulated. `rotation.x += pitchV` integrates a target angle
    // into an unbounded one: the body rolls over within a couple of seconds and the
    // car ends up lying on its side while the physics box is still upright.
    this.parts.body.rotation.set(chargePitch + pitchV, 0, roll);

    // Volume-preserving-ish: flatten vertically, bulge horizontally, and vice versa
    // on the rebound. Clamped so a huge hit cannot invert the car.
    const sq = clamp(this.squash.step(0, dt) * 0.02, -0.42, 0.42);
    this.parts.body.scaling.set(1 + sq * 0.55, 1 - sq, 1 + sq * 0.75);

    this.parts.root.position.set(vibrateX, vibrateY, vibrateZ);

    // ---- wheels ----------------------------------------------------------
    const speed = this.vehicle.planarSpeed;
    const goingForward = v.x * fwd.x + v.z * fwd.z >= 0 ? 1 : -1;
    this.wheelSpin += (speed / f.wheelRadius) * dt * goingForward;
    const steerAngle = clamp(state.steer, -1, 1) * 0.5;
    for (const w of this.parts.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = steerAngle;
      // Wheels ride the suspension inversely to the body, so the car visibly
      // compresses onto them rather than the whole thing sinking.
      w.pivot.position.y = w.restY + squat * 0.35 + hop * 0.4;
    }

    // ---- antenna ---------------------------------------------------------
    // Driven by acceleration and by speed drag, so it streams backwards when
    // moving and whips when hit.
    const antTargetX = clamp(-accelFwd * 0.012 - speed * f.antennaDrag * 0.1, -0.9, 0.9);
    const antTargetZ = clamp(accelLat * 0.012, -0.9, 0.9);
    const ax = this.antennaX.step(antTargetX, dt);
    const az = this.antennaZ.step(antTargetZ, dt);
    for (let i = 0; i < this.parts.antenna.length; i++) {
      // Each segment takes a share, so the whole thing curves instead of hinging.
      const share = (i + 1) / this.parts.antenna.length;
      this.parts.antenna[i].rotation.x = ax * share * 0.6;
      this.parts.antenna[i].rotation.z = az * share * 0.6;
    }

    // ---- flash -----------------------------------------------------------
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - f.hitFlashDecay * dt);
      for (const m of this.parts.materials) m.setFloat("flash", this.flash);
    }

    // ---- ground blob -----------------------------------------------------
    // Kept in world space and flat: it must not roll with the body or lift with
    // the hop, or it stops reading as contact with the ground.
    const p = this.vehicle.position;
    const height = Math.max(0, p.y - this.vehicle.config.size.h * 0.5);
    // Displaced along the sun's ground direction and further as the car rises, so
    // it reads as a shadow being cast rather than a decal painted on the chassis.
    const lift = 0.35 + height * 0.9;
    this.parts.shadow.position.set(
      p.x + SHADOW_DIR_X * lift,
      0.03,
      p.z + SHADOW_DIR_Z * lift
    );
    this.parts.shadow.rotation.y = this.vehicle.yaw;
    const spread = 1 + height * 0.35;
    const w = this.vehicle.config.size.w * 0.66 * spread;
    const l = this.vehicle.config.size.l * 0.62 * spread;
    this.parts.shadow.scaling.set(w, l, 1);
    this.parts.shadow.visibility = Math.max(0, 1 - height * 0.45);
  }

  dispose(): void {
    this.parts.shadow.dispose();
    this.parts.root.dispose(false, true);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
