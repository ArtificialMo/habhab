/**
 * Data layer (§3.2). Every number that decides how the game *feels* lives here so
 * it can be swapped at runtime from the dev overlay without touching gameplay code.
 * Gameplay code must read from `TUNING` — never inline a feel constant.
 *
 * Units: 1 = 1 metre, 1 = 1 second, mass in kg.
 */

export interface Tuning {
  world: {
    gravity: number;
    /** Radius of the flat play surface. */
    islandRadius: number;
    islandTop: number;
    /** Below this Y a vehicle is considered committed to the fall (§2.9). */
    knockoutY: number;
    fixedTimeStep: number;
  };

  player: {
    size: { l: number; w: number; h: number };
    mass: number;
    /** Top speed under drag steering. */
    maxSpeed: number;
    /** How hard the car pulls itself toward the drag target velocity. */
    accel: number;
    /** Yaw follow rate, rad/s per rad of error. */
    steerRate: number;
    /**
     * Heading error beyond which the car pivots instantly instead of arcing round.
     * Swinging a full reversal through the steering controller takes most of a
     * second and reads as the car ignoring you; anything up to a right-angle still
     * turns normally. Radians.
     */
    snapYawThreshold: number;
    /** Fraction of existing speed kept through a snap pivot. */
    snapSpeedKeep: number;
    linearDamping: number;
    angularDamping: number;
    restitution: number;
    friction: number;
    /** Centre of mass offset below geometric centre — keeps the car from tipping. */
    comY: number;
    /** Lateral grip, 1/s. High = the car goes where it points instead of sliding. */
    grip: number;
  };

  enemy: {
    size: { l: number; w: number; h: number };
    mass: number;
    maxSpeed: number;
    accel: number;
    steerRate: number;
    linearDamping: number;
    angularDamping: number;
    restitution: number;
    friction: number;
    comY: number;
    /** Lateral grip, 1/s. */
    grip: number;
    /** Distance from the rim at which the AI starts steering inward. */
    edgeFear: number;
    /** How far past the player an enemy aims, to shove them outward. 0 = pure chase. */
    aggression: number;
    /** How far inland of the player a hunter sets up before charging through. */
    attackStandoff: number;
    /** Inside this range a hunter aims every frame instead of holding a heading. */
    trackRange: number;
    /** Seconds an enemy holds a heading before re-aiming at the player. */
    commitTime: number;
    /** How fast it drifts toward the player inside that commitment. */
    commitTrack: number;
    /** Range at which an enemy commits its own shove. */
    lungeRange: number;
    /** Lunge strength, in m/s of Δv applied to itself. */
    lungeImpulse: number;
    lungeCooldown: number;
  };

  charge: {
    /** Seconds of hold to reach full charge. */
    timeToFull: number;
    /** Launch impulse at zero charge / full charge (N·s). */
    impulseMin: number;
    impulseMax: number;
    cooldown: number;
    /** Seconds after release during which a contact counts as an attack. */
    attackWindow: number;
    /** Steering authority retained during the lunge. Near zero, or it self-brakes. */
    lungeAuthority: number;
    /** Yaw rate multiplier while charging — aiming must feel immediate. */
    aimRate: number;
  };

  collision: {
    /** Approach speed below which a contact is treated as a graze rather than a hit. */
    minApproachSpeed: number;
    /**
     * Δv applied to a graze or a resting contact. There is no state in which two
     * cars touch and nothing happens — they always part.
     */
    touchSeparation: number;
    /**
     * Supplemental response is authored in Δv, not impulse. Havok's own response
     * already conserves momentum — which pushes the *lighter* car back harder,
     * the opposite of what §2.7 wants. Expressing the arcade layer as a target
     * velocity change makes the asymmetry explicit and mass-independent.
     * Enemy Δv = approachSpeed × transferRatio × multipliers, clamped.
     */
    transferRatio: number;
    deltaVMin: number;
    deltaVMax: number;
    /** Multiplier applied while the player is inside the attack window. */
    attackMultiplier: number;
    /** Extra multiplier scaled by charge level at release (0..1 → 1..1+this). */
    chargeScaling: number;
    /** dot(hitDir, enemyForward) above this counts as a rear hit (§2.7). */
    rearDot: number;
    rearMultiplier: number;
    /** Tighter cone than `rearDot` — squarely up the tail, where the tank is. */
    gasTankDot: number;
    /** Multiplier for a clean tank hit. Turns any contact into a full ram. */
    gasTankMultiplier: number;
    /** Car Boy's Δv as a fraction of the enemy's when *he* rams. <1 (§2.7). */
    playerRecoilFactor: number;
    /** The enemy's rebound when *it* rams Car Boy — the same idea, other end. */
    enemyRecoilFactor: number;
    /** How far up the contact point is allowed to sit — limits nose-dive torque. */
    torqueLeverClamp: number;
    /** Seconds the player's steering authority is suppressed after a hit. */
    recoilLock: number;
    /** Added to the lock per m/s of Δv delivered, so big hits read longer. */
    recoilLockPerDeltaV: number;
    /** Ceiling on the lock — §2.7 step 10 still wants control back quickly. */
    recoilLockMax: number;
    /** Seconds to ramp steering authority from 0 back to 1 after the lock. */
    recoilRecover: number;
    /** Hard cap on angular speed so nothing spins unreadably (§2.7). */
    maxAngularSpeed: number;
    /** Same pair cannot fire a supplemental impulse twice inside this window. */
    pairCooldown: number;
  };

  camera: {
    /** Elevated three-quarter framing (§2.3). */
    height: number;
    distance: number;
    /** Camera lag toward the player, per second. */
    follow: number;
    fov: number;
    /** Set false to evaluate the raw bounce with no screen feedback (§0.2). */
    shakeEnabled: boolean;
    /** Shake amplitude per m/s of Δv delivered. */
    shakePerDeltaV: number;
    /** Floor, so even the lightest tap moves the screen — §2.8 "never zero". */
    shakeMin: number;
    shakeMax: number;
    shakeDecay: number;
    /**
     * Shake oscillation rate, Hz. Same Nyquist ceiling as the charge vibration —
     * a 34 Hz shake on a 60 Hz display is indistinguishable from random jitter.
     */
    shakeFrequency: number;
    hitStopEnabled: boolean;
    hitStopPerDeltaV: number;
    hitStopMax: number;
    /** FOV punch on impact, radians per m/s of Δv. */
    zoomPerDeltaV: number;
    zoomMax: number;
    zoomRecover: number;
    /** Camera drift toward the player's heading, so you see where you are going. */
    lead: number;
  };

  /** Cosmetic rig (§3.3) — none of this may change a collision outcome. */
  feel: {
    /** Suspension travel under acceleration/cornering, metres. */
    suspensionTravel: number;
    /** Spring and damping of the visual suspension. */
    suspensionStiffness: number;
    suspensionDamping: number;
    /** Body roll into corners, radians per m/s² of lateral acceleration. */
    bodyRoll: number;
    /** Body pitch under acceleration, radians per m/s². */
    bodyPitch: number;
    maxRoll: number;
    maxPitch: number;
    /** Vertical kick on impact, metres per m/s of Δv. */
    impactHop: number;
    impactHopMax: number;
    /** Antenna springiness. */
    antennaStiffness: number;
    antennaDamping: number;
    antennaDrag: number;
    /** White flash on being hit: peak intensity and decay rate. */
    hitFlashDecay: number;
    /** Wheel radius, used to derive roll rate from ground speed. */
    wheelRadius: number;
    /** Sideways-motion fraction above which the car is considered drifting. */
    driftSlipThreshold: number;
    driftMinSpeed: number;
  };

  /** Charge anticipation (§2.6) — the wind-up before the shove. */
  chargeFeel: {
    /** Body vibration amplitude at full charge, metres. */
    vibrationAmplitude: number;
    /**
     * Vibration rate at zero and full charge, Hz. Rising rate reads as strain.
     * Must stay under ~30 Hz: at 60 fps anything faster is past Nyquist and
     * aliases into a slow random wobble — the opposite of a tight buzz.
     */
    vibrationHzMin: number;
    vibrationHzMax: number;
    /** How much the car squats onto its suspension while winding up. */
    squat: number;
    /** Nose lift as the charge builds. */
    rear: number;
    /** Screen shake while charging, at full charge. */
    cameraTremble: number;
    /** Device haptic pulse interval at full charge, seconds (where supported). */
    hapticIntervalMin: number;
    hapticIntervalMax: number;
  };

  /** Edge suspense (§2.9) — the slow-motion moment before a car goes over. */
  drama: {
    /** Gameplay time scale at full intensity. */
    timeScale: number;
    blendIn: number;
    blendOut: number;
    /** How close to the rim a car must be before it is even considered. */
    dangerBand: number;
    minSpeed: number;
    /** Minimum outward velocity component, m/s. Sliding along the rim does not count. */
    minOutward: number;
    /** Projected overshoot past the rim required to trigger. */
    overshoot: number;
    /** Below this speed a car near the rim is treated as having survived. */
    settledSpeed: number;
    maxDuration: number;
    /** Absolute wall-clock ceiling on one sequence, seconds. Nothing overrides it. */
    hardCap: number;
    /** Extra seconds to hold the shot once it is actually falling. */
    fallHold: number;
    cooldown: number;
    /** Camera pull-in at full intensity, as a fraction of normal distance. */
    zoom: number;
  };

  vfx: {
    /** Δv above which a hit counts as medium / major (§2.8 tiers). */
    mediumThreshold: number;
    majorThreshold: number;
    sparkCountPerDeltaV: number;
    sparkCountMax: number;
    /** Full-screen flash alpha on a major hit. */
    screenFlashMax: number;
    screenFlashDecay: number;
    /** Speed above which a sliding car throws dust. */
    dustSpeed: number;
  };
}

export const TUNING: Tuning = {
  world: {
    gravity: -38,
    islandRadius: 20,
    islandTop: 0,
    knockoutY: -6,
    fixedTimeStep: 1 / 120,
  },

  player: {
    size: { l: 2.2, w: 1.4, h: 1.0 },
    mass: 520,
    maxSpeed: 19,
    accel: 62,
    steerRate: 9,
    // ~131°. Below this the car steers; above it, it whips round.
    snapYawThreshold: 2.3,
    snapSpeedKeep: 0.35,
    linearDamping: 0.4,
    angularDamping: 2.2,
    restitution: 0.35,
    // Low deliberately: ground friction is what eats a charge, and a lunge that
    // stops in three metres cannot be aimed at anything.
    friction: 0.32,
    comY: -0.35,
    grip: 4.2,
  },

  enemy: {
    size: { l: 3.0, w: 1.8, h: 1.5 },
    mass: 900,
    maxSpeed: 16,
    // Must exceed friction × gravity (below) or the car cannot overcome its own
    // ground drag and never moves at all, however much force the AI asks for.
    accel: 44,
    steerRate: 4.2,
    // Braking is carried by damping rather than friction: damping is proportional
    // to speed, so a launched enemy is slowed hard while a driving one is not.
    // Coulomb friction high enough to stop a 26 m/s launch would also pin it.
    linearDamping: 1.5,
    angularDamping: 1.6,
    restitution: 0.35,
    friction: 0.3,
    comY: -0.45,
    grip: 3.6,
    edgeFear: 5.0,
    aggression: 0.7,
    attackStandoff: 6.5,
    trackRange: 11,
    commitTime: 0.85,
    commitTrack: 1.8,
    lungeRange: 5.5,
    lungeImpulse: 10.5,
    lungeCooldown: 2.2,
  },

  charge: {
    timeToFull: 2.0,
    impulseMin: 6000,
    impulseMax: 25000,
    cooldown: 0.45,
    attackWindow: 0.5,
    lungeAuthority: 0.12,
    aimRate: 4.5,
  },

  collision: {
    minApproachSpeed: 1.6,
    touchSeparation: 4.5,
    transferRatio: 1.6,
    deltaVMin: 9.5,
    // Headroom above the best clean rear charge (~26), so hitting an enemy that is
    // driving at you still reads as harder than hitting a parked one. The cap only
    // catches genuine outliers.
    deltaVMax: 115,
    attackMultiplier: 1.8,
    chargeScaling: 0.7,
    rearDot: 0.45,
    rearMultiplier: 1.6,
    gasTankDot: 0.86,
    gasTankMultiplier: 2.7,
    playerRecoilFactor: 0.32,
    enemyRecoilFactor: 0.38,
    torqueLeverClamp: 0.35,
    recoilLock: 0.1,
    recoilLockPerDeltaV: 0.006,
    recoilLockMax: 0.28,
    recoilRecover: 0.28,
    maxAngularSpeed: 7,
    pairCooldown: 0.08,
  },

  camera: {
    // Portrait 9:16 with Babylon's vertical-fixed FOV: the horizontal view is only
    // 9/16 of the vertical one, so a camera framed for landscape shows a sliver of
    // the island. These values give ~24m of horizontal ground coverage.
    height: 41,
    distance: 29,
    follow: 4.5,
    fov: 0.8,
    shakeEnabled: true,
    shakePerDeltaV: 0.036,
    shakeMin: 0.06,
    shakeMax: 0.95,
    shakeDecay: 9,
    shakeFrequency: 14,
    hitStopEnabled: true,
    hitStopPerDeltaV: 0.0028,
    hitStopMax: 0.085,
    zoomPerDeltaV: 0.0022,
    zoomMax: 0.06,
    zoomRecover: 3.5,
    lead: 2.6,
  },

  feel: {
    suspensionTravel: 0.16,
    suspensionStiffness: 150,
    suspensionDamping: 15,
    bodyRoll: 0.02,
    bodyPitch: 0.014,
    maxRoll: 0.3,
    maxPitch: 0.22,
    impactHop: 0.012,
    impactHopMax: 0.28,
    antennaStiffness: 130,
    antennaDamping: 8.5,
    antennaDrag: 0.055,
    hitFlashDecay: 4.5,
    wheelRadius: 0.33,
    driftSlipThreshold: 0.15,
    driftMinSpeed: 5,
  },

  chargeFeel: {
    vibrationAmplitude: 0.062,
    vibrationHzMin: 11,
    vibrationHzMax: 23,
    squat: 0.1,
    rear: 0.075,
    cameraTremble: 0.075,
    hapticIntervalMin: 0.16,
    hapticIntervalMax: 0.05,
  },

  drama: {
    timeScale: 0.22,
    blendIn: 0.14,
    blendOut: 0.3,
    dangerBand: 5.5,
    minSpeed: 5,
    minOutward: 3.2,
    overshoot: 1.2,
    settledSpeed: 2.2,
    maxDuration: 1.4,
    hardCap: 2,
    fallHold: 0.55,
    cooldown: 5,
    zoom: 0.42,
  },

  vfx: {
    mediumThreshold: 9,
    majorThreshold: 17,
    sparkCountPerDeltaV: 1.5,
    sparkCountMax: 52,
    screenFlashMax: 0.5,
    screenFlashDecay: 6.5,
    dustSpeed: 7,
  },
};
