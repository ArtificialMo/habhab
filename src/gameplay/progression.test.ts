import { afterEach, describe, expect, it } from "vitest";

import { TUNING } from "../data/tuning";
import { Progression } from "./progression";

const base = {
  maxSpeed: TUNING.player.maxSpeed,
  mass: TUNING.player.mass,
  transferRatio: TUNING.collision.transferRatio,
  impulseMax: TUNING.charge.impulseMax,
  grip: TUNING.player.grip,
  chargeTime: TUNING.charge.timeToFull,
  recoil: TUNING.collision.playerRecoilFactor,
};

afterEach(() => {
  TUNING.player.maxSpeed = base.maxSpeed;
  TUNING.player.mass = base.mass;
  TUNING.collision.transferRatio = base.transferRatio;
  TUNING.charge.impulseMax = base.impulseMax;
  TUNING.player.grip = base.grip;
  TUNING.charge.timeToFull = base.chargeTime;
  TUNING.collision.playerRecoilFactor = base.recoil;
});

describe("Progression", () => {
  it("grows the coin magnet range for each magnet pick", () => {
    const progress = new Progression();

    expect(progress.magnetRadius).toBeCloseTo(5.5);
    progress.take("magnet");
    expect(progress.magnetRadius).toBeCloseTo(5.5 * 1.35);
  });

  it("offers three distinct upgrade cards", () => {
    const progress = new Progression();
    const offers = progress.offer();

    expect(offers).toHaveLength(3);
    expect(new Set(offers.map((offer) => offer.id)).size).toBe(3);
  });
});
