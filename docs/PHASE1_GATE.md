# Phase 1 — The Part 0 Gate: status and evidence

**Status: built and measured. Not passed.** The gate criterion in §0.2 is a human
judgement — "a gameplay critic who has never seen the brief plays it and wants to do
it again immediately" — and nobody has played it yet. Everything below is the
evidence that it is *ready* to be played, not a claim that it cleared.

## What was built

Untextured primitives on a grey disc, per §0.2. One grey player box, one larger
grey enemy box, a nose marker on each so facing is visible, a flat charge button and
a primitive aim bar. No shading, particles, audio, coins, progression, or slow
motion. Camera shake and hit-stop are implemented but **default off**, so the bounce
is judged raw.

Run it:

```bash
npm run dev
```

Drag anywhere to steer (or WASD). Hold the button bottom-right to charge, release to
lunge (or Space). `tune` opens live sliders for the collision constants.

## Measured results

`src/dev/bench.ts`, run via `window.CARBOY.bench()`. Enemy AI disabled, fixed
timestep, real systems throughout — no reimplementation of the physics.

Δv is the departure speed given to the enemy; travel is the ground distance it
covers; separation is centre-to-centre distance gained between the closest point of
the impact and the widest point after it; recoil is Car Boy's peak speed away from
the contact.

| Case | Δv (m/s) | Enemy travel (m) | Separation (m) | Car Boy recoil (m/s) |
|---|---|---|---|---|
| Rear, full charge | 26.2 | 11.92 | 14.82 | 8.42 |
| Front, full charge | 16.4 | 6.50 | 7.82 | 5.27 |
| Rear, half charge | 14.0 | 5.42 | 6.69 | 4.53 |
| Front, half charge | 8.8 | 2.83 | 3.33 | 2.85 |
| Glancing, full charge | 14.3 | 5.27 | 6.28 | 4.10 |
| Drive-in, no charge | 2.2 | 0.29 | 0.32 | 0.71 |

Frame-rate independence, identical charged rear hit:

| dt | 1/120 | 1/60 | 1/30 | 1/20 |
|---|---|---|---|---|
| Enemy travel (m) | 11.91 | 11.92 | 12.02 | 12.13 |

### Against the phase-1 criteria

| # | Criterion | Result |
|---|---|---|
| P1-1 | Every impact separates the cars | **Pass** — 0.32 m at the weakest, 14.82 m at the strongest |
| P1-2 | Rear ≥ 1.5× front | **Pass** — 1.83× at full charge, 1.92× at half |
| P1-3 | Car Boy recoils less than the enemy | **Pass** — recoil is 32% of enemy Δv by construction; travel ratio ~4:1 |
| P1-4 | Monotonic in charge | **Pass** — 0.29 → 2.83 → 6.50 m front; 5.42 → 11.92 m rear |
| P1-5 | Frame-rate independent | **Pass** — 1.8% spread across a 6× range of dt |
| P1-6 | No sticking or tunnelling | **Pass** — 40 s, 3 enemies, 44 contacts: min centre gap 1.93 m, zero frames below deck |
| P1-7 | No unreadable spin | **Pass** — angular speed never exceeds 7 rad/s |
| P1-8 | Control returns quickly | **Pass** — lock 0.10–0.28 s by hit strength, plus a 0.28 s ramp |
| P1-9 | Loop closes | **Pass** — 8/8 scripted runs reached a knockout in 2–3 charges, 3–6 contacts, 5.7–9.3 s |
| P1-10 | No leaks | **Pass** — mesh count 7 and body count 3 flat across repeated knockouts |

Physics step cost: 0.10–0.20 ms with 3 bodies.

That a kill takes **2–3 charges and several contacts** is the number I care about
most. §2.7 asks for a rally, not a shot, and the loop lands there without being told
to.

## Bugs found and fixed while measuring

Each of these was invisible to code inspection and would have been read as "the
bounce feels bad" rather than as a defect. This is the §1.3 argument for measuring
rather than eyeballing.

1. **Teleport gave bodies momentum.** `setTargetTransform` on a dynamic body makes
   the solver *reach* the pose by inventing the velocity to cover the gap in one
   substep — a 6 m respawn came out at several hundred m/s.
2. **Teleport rotation never took effect.** Mutating `rotationQuaternion` in place
   does not mark the transform dirty, so `mesh.forward` kept the old heading and a
   respawned car charged in whatever direction it used to face.
3. **The drive controller braked the charge.** It targets a velocity; the lunge is
   far above top speed, so at full authority it read the charge as "too fast" and
   killed it before it reached anything. Lunges now run at 12% authority.
4. **Approach speed was sampled before the charge impulse.** A charge released while
   already touching an enemy measured zero approach and did nothing — and that is
   the *common* case, since the enemy drives at you while you charge.
5. **Havok slept the bodies.** A car at rest deactivates, and an impulse does not
   wake it. A parked enemy silently stopped responding to being rammed — precisely
   the "immovable without visual justification" failure §2.7 forbids.
6. **The enemy could not move at all.** Its drive acceleration (9 m/s²) was below
   its own friction deceleration (13.2 m/s²), so it was pinned to the ground
   regardless of what the AI asked for. Braking now comes from velocity-proportional
   damping instead.
7. **World matrices were never recomputed** outside a render, so heading-derived
   logic — aiming, rear-hit detection, steering — ran on stale data.
8. **Angular clamp applied only pre-step**, letting a post-contact spin spike
   through for a frame.

## What the numbers cannot tell you

The gate is about whether it is *fun*, and these are all proxies:

- **Recoil may be too strong.** A full rear charge sends Car Boy back at 8.4 m/s.
  The brief says "modest". It is one slider (`playerRecoil`) and I would rather you
  feel it than have me guess.
- **The kill may be too easy.** A naive scripted attacker converts in ~7 s every
  time. Against a human that is probably right for one enemy on an empty island, but
  it is untested.
- **The charge brace may be annoying.** Holding to charge stops the car dead. That
  creates the anticipation §2.6 asks for, but it also means you cannot charge while
  repositioning, which is a real cost.
- **Nothing here has been seen in motion by anyone.** See below.

## Blocker

I have not been able to view a running frame. The Browser pane is not displayed in
this environment, so the page never composites and screenshot capture fails. I
worked around it for *measurement* by driving the simulation headlessly, and
verified framing by projecting world points to screen space — the play area covers
about 22 m across the portrait canvas with the player centred and the rim visible —
but that is geometry, not appearance.

**To unblock:** open the Browser pane (the dev server is already running on
port 5178), or run `npm run dev` and open it yourself. Then the gate can actually be
played, which is the only thing that clears it.
