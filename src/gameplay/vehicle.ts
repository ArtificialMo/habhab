import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";

import type { PhysicsWorld } from "../core/physics";

export interface VehicleConfig {
  size: { l: number; w: number; h: number };
  mass: number;
  comY: number;
  restitution: number;
  friction: number;
  linearDamping: number;
  angularDamping: number;
  maxSpeed: number;
  accel: number;
  steerRate: number;
}

let nextId = 1;

/**
 * Gameplay-layer vehicle. Owns exactly one authoritative Havok body (§3.3); the
 * mesh is a visual root synchronized to it and never drives collision outcomes.
 */
export class Vehicle {
  readonly id = nextId++;
  readonly mesh: Mesh;
  readonly body: PhysicsBody;
  readonly config: VehicleConfig;
  alive = true;

  /**
   * Velocity sampled at the top of the frame, before the physics step. Collision
   * callbacks fire after the solver has already reversed the real velocities, so
   * approach speed must be measured from this snapshot, not from the live body.
   */
  readonly lastVelocity = new Vector3();

  private readonly tmp = new Vector3();

  constructor(scene: Scene, world: PhysicsWorld, config: VehicleConfig, spawn: Vector3) {
    this.config = config;
    const { l, w, h } = config.size;

    // The physics mesh is never drawn. It defines the collision box and acts as the
    // transform every cosmetic part hangs off — keeping the simple, stable shape
    // §3.3 asks for while the visible car is free to be any shape at all.
    this.mesh = MeshBuilder.CreateBox("vehicle", { width: w, height: h, depth: l }, scene);
    this.mesh.position.copyFrom(spawn);
    this.mesh.rotationQuaternion = Quaternion.Identity();
    this.mesh.isVisible = false;
    this.mesh.isPickable = false;

    this.body = world.createVehicleBody(this.mesh, config);
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  get velocity(): Vector3 {
    return this.body.getLinearVelocity();
  }

  /** World-space forward (+Z local). */
  get forward(): Vector3 {
    return this.mesh.forward;
  }

  get yaw(): number {
    const f = this.mesh.forward;
    return Math.atan2(f.x, f.z);
  }

  /** Live mass edit from the tuning panel; inertia is rescaled with it. */
  setMass(mass: number): void {
    const props = this.body.getMassProperties();
    const scale = mass / this.config.mass;
    this.config.mass = mass;
    this.body.setMassProperties({
      mass,
      centerOfMass: props.centerOfMass,
      inertia: props.inertia ? props.inertia.scale(scale) : undefined,
    });
  }

  /** Must be called once per frame, before the physics step. */
  cacheVelocity(): void {
    this.lastVelocity.copyFrom(this.body.getLinearVelocity());
  }

  /**
   * Pull the mesh's world matrix up to date after the physics step. The plugin
   * writes position and rotation into the mesh, but `forward` is derived from the
   * world matrix, which Babylon only recomputes during a render. Without this the
   * heading used for aiming, rear-hit tests and steering is a frame stale — and in
   * a headless step, never updated at all.
   */
  syncTransform(): void {
    this.mesh.computeWorldMatrix(true);
  }

  get planarSpeed(): number {
    const v = this.velocity;
    return Math.hypot(v.x, v.z);
  }

  /**
   * Tyre grip. Removes the sideways component of velocity so a car goes where its
   * nose points instead of sliding around like a hovercraft. Applied regardless of
   * driver authority — rubber grips whether or not anyone is steering — but only
   * partially, so a hard corner still scrubs and leaves a drift mark.
   */
  applyGrip(dt: number, grip: number): void {
    const v = this.body.getLinearVelocity();
    const f = this.mesh.forward;
    // Lateral basis in the ground plane, perpendicular to the nose.
    const rx = f.z;
    const rz = -f.x;
    const lat = v.x * rx + v.z * rz;
    if (Math.abs(lat) < 0.02) return;
    const k = Math.min(1, grip * dt);
    this.tmp.set(-rx * lat * k * this.config.mass, 0, -rz * lat * k * this.config.mass);
    this.body.applyImpulse(this.tmp, this.position);
  }

  /**
   * Car-like motion. `targetVelocity` is read as a desired *direction* plus a
   * throttle; the car drives along its own nose and turns by rotating.
   *
   * When the target lies behind it the car reverses rather than pivoting in place.
   * That is what forces a real correction — or a three-point turn — when a car finds
   * itself nose-first at a cliff edge, instead of simply strafing away from it.
   */
  driveToward(targetVelocity: Vector3, dt: number, authority: number): void {
    if (authority <= 0) return;
    const want = Math.hypot(targetVelocity.x, targetVelocity.z);
    const f = this.mesh.forward;
    // A heading with no horizontal component cannot be driven along. Bodies are
    // yaw-locked so this should be unreachable, but thrusting along a zero vector
    // silently freezes the car, which is far too expensive a failure to risk.
    if (Math.abs(f.x) + Math.abs(f.z) < 0.01) return;
    const v = this.velocity;
    const along = v.x * f.x + v.z * f.z;

    if (want < 0.01) {
      // No input: engine braking along the nose only, never sideways.
      const brake = Math.min(Math.abs(along), this.config.accel * dt) * Math.sign(along);
      this.tmp.set(-f.x * brake * this.config.mass, 0, -f.z * brake * this.config.mass);
      this.body.applyImpulse(this.tmp, this.position);
      return;
    }

    const align = (targetVelocity.x / want) * f.x + (targetVelocity.z / want) * f.z;
    const reversing = align < -0.4;
    const sign = reversing ? -1 : 1;

    // Thrust scales with how well the nose is already pointed where you asked, so
    // the car has to finish its turn before it accelerates away.
    const facing = Math.abs(align) ** 0.7;
    const targetAlong = sign * want * (reversing ? 0.5 : 1);
    let accel = (targetAlong - along) * 8;
    const cap = this.config.accel;
    if (accel > cap) accel = cap;
    else if (accel < -cap) accel = -cap;

    const j = accel * this.config.mass * dt * authority * (0.3 + facing * 0.7);
    this.tmp.set(f.x * j, 0, f.z * j);
    this.body.applyImpulse(this.tmp, this.position);
  }

  /** Steers the nose toward `targetYaw`, blended by control authority. */
  steerTo(targetYaw: number, authority: number, rateScale = 1): void {
    if (authority <= 0) return;
    let err = targetYaw - this.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const ang = this.body.getAngularVelocity();
    const desired = err * this.config.steerRate * rateScale;
    ang.y += (desired - ang.y) * authority;
    this.body.setAngularVelocity(ang);
  }

  /** §2.7 — nothing may spin unreadably. */
  clampAngular(max: number): void {
    const a = this.body.getAngularVelocity();
    const mag = a.length();
    if (mag > max) {
      a.scaleInPlace(max / mag);
      this.body.setAngularVelocity(a);
    }
  }

  applyPlanarImpulse(dir: Vector3, magnitude: number, at?: Vector3): void {
    this.tmp.set(dir.x, 0, dir.z);
    this.tmp.normalize().scaleInPlace(magnitude);
    this.body.applyImpulse(this.tmp, at ?? this.position);
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.dispose(false, true);
  }
}
