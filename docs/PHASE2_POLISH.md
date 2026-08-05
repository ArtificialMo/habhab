# Phase 2/5 — Presentation, game feel and charge anticipation

Built on top of the phase 1 gate. The physics was already tuned and measured, so
everything here is layered strictly above it: §3.3 requires cosmetic animation never
to change a collision outcome, and that is verified rather than assumed — see
"Regression" below.

## Charge anticipation

The requested wind-up, on four channels at once:

- **Body vibration.** The visual root buzzes on two incommensurate frequencies so it
  reads as a rattle, not a sine wave sliding the car around. Amplitude scales with
  charge *squared*, so the last third of the wind-up is where it visibly strains.
- **Posture.** The car squats onto its suspension and lifts its nose as the charge
  builds, so it is physically coiled before it fires.
- **Headlights.** Brighten and widen toward white at full charge.
- **Camera tremble, audio and haptics.** A continuous low shake, a rising tone whose
  tremolo rate climbs with the charge, and haptic pulses that quicken from 160 ms to
  50 ms apart. The tremolo and the visual buzz run at the same rate, so the thing you
  see and the thing you hear are the same vibration.

Measured across a full wind-up: amplitude 0.003 → 0.017 → 0.033 → 0.066 m, body
squat to −0.092 m, nose pitch to −0.075 rad, all rising monotonically, and all back
to exactly zero on release.

## Visual pass

- **Cel shader** with two hard bands plus a soft third, a warm bounce term from
  below, and a rim light. Shadow tones are pushed toward cool blue rather than
  toward black — neutral-darkened shadows are what make stylised work look muddy.
- **Bold outlines**, weighted so gameplay objects carry a heavier line than scenery
  and pop out of it.
- **Real cars.** The player is a faceted rounded bubble that sits low; the enemy is a
  slab with a roof rack, spoiler and chrome teeth that stands over it. That size and
  shape contrast is doing more work than colour — it is the thing the art reference
  says to preserve.
- **Faces from headlights and grille**, never windshield eyes (§2.15). A single
  `menace` value swings the brow angle and grille width from wide-eyed to hostile,
  so both cars come out of one builder.
- **Environment**: faceted cliff, warm stone deck, waterline foam, rocks, animated
  sea swell, drifting clouds, circling gulls, and — across the water — the villa,
  cypresses, flower pots and sailboat from the reference.
- **Cosmetic rig**: spring-driven suspension squat, body roll into corners, pitch
  under braking, wheels that steer and spin at ground speed, a three-segment antenna
  that streams back and whips on impact, and a ground blob that stays flat and
  spreads as the car leaves the deck.

**The play surface is deliberately bare.** §4.5 defers island elements, and anything
standing on the deck becomes a collision obstacle whether it was meant to be one or
not. The scale anchors the reference calls for live on background land instead, and
the arena is decorated with paving and colour. The visible deck radius matches the
collider exactly, so a car goes over the edge exactly when it looks like it should.

## Impact feedback (§2.8)

Tiered by Δv, with one code path deciding the tier so small taps and big charges feel
like the same language at different volumes:

| | Small | Medium (Δv ≥ 9) | Major (Δv ≥ 17) |
|---|---|---|---|
| Camera shake | floor 0.06, never zero | scaled | up to 0.85 |
| Hit-stop | brief | brief | up to 75 ms |
| Sparks | 6–20 | 20–35 | up to 44 |
| Debris | — | yes | yes |
| Comic word | rear hits only | yes | yes |
| Shock ring | — | — | yes |
| Screen flash | — | — | up to 0.42 |
| Haptic | 12 ms | 12 ms | 32 ms |

Rear hits also burn a hotter spark colour and add a bright ring to the impact sound,
so the positional bonus is legible on three channels rather than only as distance.

Hit-stop scales gameplay time only — the camera, scenery and UI keep running, which
is what makes the freeze read as impact rather than as a dropped frame.

## Audio

Fully procedural (§2.16), no assets. Impacts layer a rubber thud for weight, a
metallic transient for sharpness and a bandpassed noise burst for bite; the charge is
a rising saw with a tremolo; there is a speed-tracking engine bed, a release whoosh, a
splash and a knockout sting. It stays dormant until the first gesture, so it is
silent rather than broken before then.

## Bugs found in this pass

**Charge vibration was aliasing.** It ran at up to 42 Hz. On a 60 fps display
anything past ~30 Hz is beyond Nyquist, so the "fast buzz" would have rendered as a
slow wobble drifting in a random direction — the exact opposite of the intended
effect, and something that looks like a physics bug rather than a tuning error. Now
capped at 23 Hz.

**Camera shake frequency was mislabelled.** The phase advanced by `dt × frequency`
while the field was documented as Hz, making the real shake ~5 Hz instead of the
intended rate. Now advances by `dt × Hz × 2π` with the unit explicit.

**The bench could be silently voided by a stray car.** With more than one enemy alive,
a non-target enemy could wander into a measurement. It now parks the others clear of
the test axis — caught because a case reported a hit that never happened.

## Regression and performance

The impact bench is byte-identical to the pre-polish baseline:

| Case | Δv | Travel (m) | Separation (m) | Recoil (m/s) |
|---|---|---|---|---|
| Rear, full charge | 26.2 | 11.92 | 14.86 | 8.42 |
| Front, full charge | 16.4 | 6.50 | 7.81 | 5.27 |
| Rear, half charge | 14.0 | 5.42 | 6.67 | 4.53 |
| Front, half charge | 8.8 | 2.83 | 3.33 | 2.85 |
| Glancing, full charge | 14.3 | 5.27 | 6.27 | 4.10 |
| Drive-in, no charge | 2.2 | 0.29 | 0.32 | 0.71 |

Frame-rate independence unchanged (11.91 / 11.92 / 12.02 / 12.13 m across dt 1/120 →
1/20). The presentation layer is genuinely non-invasive.

Cost, three enemies, desktop RTX 5060 Ti: **3.02 ms/frame** combined step + render,
physics 0.4 ms. Freezing static scenery cut this from 4.39 ms. No leaks across four
knockouts — meshes, materials and body count all return to baseline, which matters
more now that each car is ~33 meshes and ~16 materials.

## Visual verification pass

The Browser pane became available, so everything below was found by looking at
rendered frames rather than by reading code. Every one of these passed typecheck,
reported healthy state through instrumentation, and was wrong on screen.

1. **Both cars lay flat on their sides.** `body.rotation.x += pitchV` accumulated a
   target angle every frame instead of assigning it. The charging branch assigned
   `rotation.x`; the driving branch never did — so enemies, which never charge,
   rolled over from the first frame. The physics boxes were upright the whole time,
   which is why no instrumentation caught it. Now assigned, and measured bounded at
   13° pitch / 18° roll across 40 s and 5 knockouts.
2. **Comic words covered the player.** At Δv 24 the word spanned ~43% of screen
   width and sat on top of Car Boy, against §2.17's "UI never obscures collisions".
   Halved the plane, halved the scale curve, offset it along the hit normal so it
   lands over the car that was *hit*, and added a 0.24 s floor between words — a
   rally was stacking two on top of each other.
3. **Comic words were occluded by the cars.** "THWACK" rendered as "WACK". Now drawn
   in rendering group 1 with depth write off.
4. **The aim arrow was nearly invisible.** It ramped from near-white, on warm stone
   paving — the one surface it always sits on. Now saturated gold → hot red with
   roughly double the alpha.
5. **Sea rocks were brown slabs.** Flattened octahedra render as clean diamond
   plates. Now irregular 3-segment spheres, smaller and partly submerged.
6. **The deck's outline swallowed everything on the ground.** Babylon draws outlines
   as a shell offset along the normals, so a 0.1-unit outline on a 40 m disc floats
   a surface 0.1 above it, hiding the paving rings, the grass mats and part of the
   aim arrow. The deck's silhouette against the sea already reads; outline removed.
7. **Driving dust built into a smoke plume.** Emitted every 0.05 s at full size, a
   car going in a straight line trailed continuous white smoke. Sparser, smaller,
   and less opaque.

## Interactive grass

Patches of grass on the deck that part as you drive through them.

- **One draw call.** Every blade is a thin instance of a single two-triangle mesh —
  1275 blades across 15 patches, ~2550 triangles.
- **Interaction runs on the GPU.** Car positions go in as a 6-slot `vec4` uniform
  array; the vertex shader bends each blade away from them and presses it down. The
  CPU never touches a blade. The alternative — rewriting instance matrices as cars
  move — would mean touching thousands of matrices per frame to animate decoration.
- **Bending is per-blade, not per-vertex.** Each blade is displaced by where its
  *base* sits, so it lays over as a unit; testing each vertex shears it instead.
  `h²` weighting keeps roots planted while tips move.
- **Purely cosmetic — no colliders.** Grass is something you drive *through*, so it
  must never become an obstacle. The deck stays clear (§4.5).
- Fast cars crossing a patch throw torn blades, via a pooled particle system.

Cost is below measurement noise (±1 ms run to run, one draw call), so I can say it
is not measurably expensive rather than quoting a number I can't resolve.

Two bugs here were also invisible to instrumentation:

- **Thin instances need `@babylonjs/core/Meshes/thinInstanceMesh` imported** for its
  side effect in the tree-shaken build, or `thinInstanceSetBuffer` does not exist.
- **A missing `world` uniform silently drew nothing.** Under `THIN_INSTANCES`
  Babylon's `instancesVertex` chunk computes `finalWorld = world * finalWorld`. I had
  not listed `world` in the material's uniforms, so it bound as an all-zero matrix
  and collapsed every blade to a degenerate point. The material compiled, reported
  ready, and appeared in the active mesh list — and rendered nothing. Similarly, the
  `#include` chunks need their own side-effect imports or the shader never compiles
  at all, with no error raised.

A tinted mat under each patch was built and then removed — it never resolved above
the deck however it was ordered, and the tufts read fine on bare paving.

## Open risks

- **Mobile draw calls.** 139 active meshes, and outlines double the pass on
  everything that has one. Fine on desktop; unmeasured on a mid-range phone, and it
  is the first thing I would profile. Merging same-material scenery and dropping
  outlines on distant objects are the obvious levers.
- **Seen in stills, not in motion.** The frames above were posed and rendered one at
  a time through the harness. Nobody has watched this run at 60 fps, so anything
  whose failure is temporal — shake frequency, hit-stop duration, whether the charge
  buzz reads as strain or as jitter — is still unverified.
- **Car Boy is small on screen.** Roughly 35 px against the enemy's 70. The size
  contrast is deliberate (§2.15) but it pushes against §2.17's "Car Boy remains
  visible at all times", and it is the next thing I would look at.
- **Juice may now be masking the bounce.** The gate was meant to be judged raw. The
  `tune` panel has a **raw bounce (no juice)** switch that strips shake and hit-stop,
  so that judgement is still available.
