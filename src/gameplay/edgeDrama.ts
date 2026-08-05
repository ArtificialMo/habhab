import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { TUNING } from "../data/tuning";
import type { Enemy } from "./enemy";
import type { Arena } from "./arena";

export type DramaPhase = "idle" | "suspense" | "resolve";

/**
 * Edge suspense (§2.9).
 *
 * Watches every enemy for a trajectory that plausibly carries it off the island,
 * and when one is committed enough to be interesting, slows the world down and
 * points the camera at it. The simulation is never faked: time is scaled and the
 * outcome is whatever Havok produces, so a car can and often does scrape back on.
 *
 * The trigger is deliberately conservative. A slow-motion cut that fires on every
 * shove stops being an event, and one that fires *after* the outcome is decided is
 * just a slow replay.
 */
export class EdgeDrama {
  phase: DramaPhase = "idle";
  /** The car the camera is watching, if any. */
  focus: Enemy | null = null;
  /** 0..1 blend into the effect, for the camera and the speed lines. */
  intensity = 0;

  private hold = 0;
  private cooldown = 0;
  /**
   * Real seconds this sequence has been running. A hard wall clock, checked before
   * anything else: every other exit is conditional on the car's state, and if those
   * conditions misread the world the shot can run forever. This cannot.
   */
  private elapsed = 0;
  /** Set when the focused car actually goes over, so the payoff can differ. */
  lastOutcome: "fell" | "saved" | null = null;

  private readonly predicted = new Vector3();

  /**
   * @returns the factor gameplay time should be scaled by this frame
   */
  update(dt: number, enemies: Enemy[], arena: Arena): number {
    const t = TUNING.drama;
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.phase === "idle") {
      if (this.cooldown === 0) {
        const candidate = this.findCandidate(enemies, arena);
        if (candidate) {
          this.focus = candidate;
          this.phase = "suspense";
          this.hold = t.maxDuration;
          this.elapsed = 0;
          this.lastOutcome = null;
        }
      }
      this.intensity = Math.max(0, this.intensity - dt / t.blendOut);
      return this.scaleFrom(this.intensity);
    }

    // --- suspense ---------------------------------------------------------
    const focus = this.focus;
    this.hold -= dt;
    // `dt` here is real time, not scaled time, so this is a true wall clock.
    this.elapsed += dt;
    if (this.elapsed >= t.hardCap) {
      return this.end(this.lastOutcome ?? "saved");
    }

    if (!focus || !focus.vehicle.alive) {
      return this.end("fell");
    }

    const p = focus.vehicle.position;
    // Committed: below the deck and outside the rim. The knockout system confirms
    // the fall itself; this only decides when to stop holding the shot.
    if (p.y < -1.5) {
      this.lastOutcome = "fell";
      this.intensity = Math.min(1, this.intensity + dt / t.blendIn);
      // Keep holding through the fall — that is the payoff.
      if (this.hold <= -t.fallHold) return this.end("fell");
      return this.scaleFrom(this.intensity);
    }

    // Margin to the nearest ground, not distance from the world origin. With an
    // archipelago, origin-distance is meaningless: a car fighting for its life on an
    // outer isle is always "past the arena radius", which pinned the hold open and
    // ran the slow-motion indefinitely.
    const margin = arena.marginAt(p.x, p.z);
    const settled = focus.vehicle.planarSpeed < t.settledSpeed;
    // It got away with it: safely back inside solid ground and no longer sliding.
    if (margin > t.dangerBand * 1.6 || (settled && margin > 0.4)) {
      return this.end("saved");
    }
    // Once it is actually off the ground, hold the shot through the drop — but only
    // up to the fall hold, never re-armed each frame.
    if (margin < 0) {
      this.hold = Math.min(this.hold <= 0 ? t.fallHold : this.hold, t.fallHold);
      if (this.hold <= 0) return this.end("saved");
    } else if (this.hold <= 0) {
      return this.end("saved");
    }

    this.intensity = Math.min(1, this.intensity + dt / t.blendIn);
    return this.scaleFrom(this.intensity);
  }

  private end(outcome: "fell" | "saved"): number {
    this.lastOutcome = outcome;
    this.phase = "idle";
    this.focus = null;
    this.cooldown = TUNING.drama.cooldown;
    return this.scaleFrom(this.intensity);
  }

  private scaleFrom(intensity: number): number {
    const t = TUNING.drama;
    return 1 - (1 - t.timeScale) * intensity;
  }

  /**
   * Cheap forward projection: where will this car be in `lookahead` seconds if it
   * keeps doing what it is doing? Damping is folded in so a car that is already
   * bleeding speed is not treated as though it will coast forever.
   */
  private findCandidate(enemies: Enemy[], arena: Arena): Enemy | null {
    const t = TUNING.drama;
    let best: Enemy | null = null;
    let bestScore = 0;

    for (const e of enemies) {
      const p = e.vehicle.position;
      if (p.y < -0.5) continue;

      // Distance to the nearest *edge of solid ground*, not to the world origin.
      // Origin-distance is meaningless across an archipelago: a car happily driving
      // around an outer isle is tens of metres from the centre and looked, to this
      // test, exactly like one about to go over the arena rim. That fired the
      // slow-motion almost continuously.
      const margin = arena.marginAt(p.x, p.z);
      if (margin > t.dangerBand) continue;

      const v = e.vehicle.velocity;
      const speed = Math.hypot(v.x, v.z);
      if (speed < t.minSpeed) continue;

      // Distance it will cover before damping kills it, projected along travel.
      const reach = speed / (TUNING.enemy.linearDamping + 0.6);
      this.predicted.set(p.x + (v.x / speed) * reach, 0, p.z + (v.z / speed) * reach);
      const predictedMargin = arena.marginAt(this.predicted.x, this.predicted.z);
      // Only interesting if it is heading *off*, and by a clear distance.
      if (predictedMargin > -t.overshoot) continue;
      // How fast the ground is running out under it, in m/s — the same units the
      // threshold was tuned in. `reach` is covered in 1/(damping+0.6) seconds, so
      // dividing the margin lost by that time gives a closing speed on the edge.
      const outward = (margin - predictedMargin) * (TUNING.enemy.linearDamping + 0.6);
      if (outward < t.minOutward) continue;

      const score = -predictedMargin + outward * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }
}
