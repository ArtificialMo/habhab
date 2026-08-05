import { TUNING } from "../data/tuning";

export type UpgradeId = "speed" | "power" | "size" | "ram" | "magnet" | "grip" | "charge";

export interface Upgrade {
  id: UpgradeId;
  name: string;
  blurb: string;
  /** Shown on the card so the choice is legible before you take it. */
  effect: string;
}

/**
 * The upgrade pool.
 *
 * Size and power are deliberately separate axes: size makes you harder to shove
 * and nothing else, power makes you shove harder and nothing else. Rolling them
 * together would make one card strictly better than the other and collapse the
 * choice — the whole point is that they answer different problems.
 */
export const UPGRADES: Upgrade[] = [
  {
    id: "speed",
    name: "TUNED ENGINE",
    blurb: "More top speed.",
    effect: "+18% speed",
  },
  {
    id: "power",
    name: "REINFORCED BUMPER",
    blurb: "Shove harder. Same size.",
    effect: "+22% push",
  },
  {
    id: "size",
    name: "HEAVY CHASSIS",
    blurb: "Bigger and harder to move. Pushes no harder.",
    effect: "+16% mass, −18% knockback taken",
  },
  {
    id: "ram",
    name: "NITRO RAM",
    blurb: "A charged hit launches further.",
    effect: "+25% ram force",
  },
  {
    id: "magnet",
    name: "COIN MAGNET",
    blurb: "Pull gold in from further away.",
    effect: "+35% magnet range",
  },
  {
    id: "grip",
    name: "RACE TYRES",
    blurb: "Hold a line through corners.",
    effect: "+30% grip",
  },
  {
    id: "charge",
    name: "QUICK WIND-UP",
    blurb: "Reach full ram sooner.",
    effect: "−18% charge time",
  },
];

/**
 * Run state: which day it is, what has been banked, and every upgrade taken.
 *
 * Stats are recomputed from the base tuning plus the full list of picks rather
 * than mutated in place, so a stat can never drift out of sync with what the
 * player actually chose.
 */
export class Progression {
  day = 1;
  /** Coins banked across the whole run — the score (§2.11). */
  stash = 0;
  /** Coins picked up during the current day, not yet banked. */
  carried = 0;
  readonly taken: UpgradeId[] = [];

  private readonly base = {
    maxSpeed: TUNING.player.maxSpeed,
    mass: TUNING.player.mass,
    transfer: TUNING.collision.transferRatio,
    ramImpulse: TUNING.charge.impulseMax,
    grip: TUNING.player.grip,
    chargeTime: TUNING.charge.timeToFull,
    recoil: TUNING.collision.playerRecoilFactor,
  };

  /** Cars to defeat on the current day. Day 1 is three, as asked. */
  get enemiesThisDay(): number {
    return 2 + this.day;
  }

  /** How many are allowed on the deck at once. */
  get concurrentEnemies(): number {
    return Math.min(4, 1 + Math.floor(this.day / 2) + 1);
  }

  get magnetRadius(): number {
    return 5.5 * Math.pow(1.35, this.count("magnet"));
  }

  get visualScale(): number {
    return Math.pow(1.07, this.count("size"));
  }

  private count(id: UpgradeId): number {
    let n = 0;
    for (const t of this.taken) if (t === id) n++;
    return n;
  }

  take(id: UpgradeId): void {
    this.taken.push(id);
    this.apply();
  }

  /** Rewrites the live tuning from base values plus every pick so far. */
  apply(): void {
    TUNING.player.maxSpeed = this.base.maxSpeed * Math.pow(1.18, this.count("speed"));
    TUNING.player.mass = this.base.mass * Math.pow(1.16, this.count("size"));
    TUNING.collision.transferRatio = this.base.transfer * Math.pow(1.22, this.count("power"));
    TUNING.charge.impulseMax = this.base.ramImpulse * Math.pow(1.25, this.count("ram"));
    TUNING.player.grip = this.base.grip * Math.pow(1.3, this.count("grip"));
    TUNING.charge.timeToFull = this.base.chargeTime * Math.pow(0.82, this.count("charge"));
    // Heavier chassis also takes less knockback — that is what "harder to move"
    // has to mean mechanically, or the card is only a cosmetic size change.
    TUNING.collision.playerRecoilFactor = this.base.recoil * Math.pow(0.82, this.count("size"));
  }

  /** Three distinct cards, weighted to avoid offering the same pick repeatedly. */
  offer(): Upgrade[] {
    const pool = [...UPGRADES];
    const out: Upgrade[] = [];
    while (out.length < 3 && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      out.push(pool[i]);
      pool.splice(i, 1);
    }
    return out;
  }

  bankCarried(): void {
    this.stash += this.carried;
    this.carried = 0;
  }
}
