# Car Boy — Initial Assessment (Part 1.1)

Written before implementation, per §1.1. Section references are to `CAR_BOY_BUILD_COMBINED.md`.

## 1. The intended experience, in my words

You are a small, twitchy car defending your home. You line up on a bigger, heavier
car, wind up a shove, and let go. The hit lands with weight, both cars kick apart,
and the big one skids toward a cliff it is now uncomfortably close to. You chase it
down and hit it again. Sometimes it stops with a wheel over the edge and you swear.
Sometimes it goes over, and the game briefly loses its mind about it.

The game is a rally, not a shooting gallery. The pleasure is positional: getting
*behind* the thing before you commit. Everything else — coins, days, upgrades — is
scaffolding around that one shove.

## 2. Contradictions and unnecessary complexity found

**a. The gate forbids what the gate needs.** §0.2 says build collisions "as
untextured primitives on a grey plane. No shading, no particles, no UI, no audio."
But the charge attack is a core part of the interaction being judged, and §2.6
specifies it as an on-screen button with a visible aim arrow. A gate build with no
UI cannot test the charge; a gate build that tests the charge is not UI-free.
*Resolution:* built the minimum control surface — one flat grey button, one
primitive aim marker — and nothing else. No shading, particles, audio, coins,
progression or slow motion. Camera shake and hit-stop exist but are **off** by
default so the bounce is judged raw, as §0.2 intends.

**b. "High restitution" conflicts with the required asymmetry.** §2.7 asks for
high restitution *and* for Car Boy to recoil far less than the enemy. Those pull in
opposite directions: in a momentum-conserving collision the *lighter* body always
takes the larger velocity change, and Car Boy is the lighter body. Raising
restitution makes him bounce back **more**, not less.
*Resolution:* moderate material restitution, with the asymmetry supplied by the
supplemental arcade layer §2.7 step 5 already licenses. Documented in `combat.ts`.

**c. "One in three slow-motion moments ends in a save" (§2.9, Part 5) is not
directly implementable.** It is an outcome of a physics simulation the brief also
insists must not be faked ("the physics outcome remains authentic"). You cannot
both let the outcome emerge naturally *and* guarantee a ratio. The honest reading is
that the ratio is a **tuning target for the trigger threshold** — trigger slow
motion early enough that a meaningful share of triggers are recoverable — not a
scripted quota. Phase 3 will report the measured ratio and tune the threshold, not
force the result.

**d. Rage mode is specified but absent from the MVP list.** §2.6 details
double-tap rage mode; §0.3's MVP scope does not include it. §0.3 says the MVP
contains "**only**" its list. Treating rage mode as **out of MVP scope**. Flagging
rather than silently dropping it.

**e. "Camera shake on every single hit — never zero" (§2.8) vs. "shake must never
make steering unreadable"** is a tuning constraint, not a contradiction, but it is
worth stating that the floor must be genuinely tiny — a 1-pixel impulse — or a
rally of six contacts becomes nauseating.

## 3. Highest-risk technical systems

Ranked by how much they can quietly ruin the game:

1. **Collision feel.** Not "does it collide" — Havok handles that — but whether the
   arcade layer on top produces *predictable* results. An unpredictable bounce is
   indistinguishable from a broken one to a player. This is the whole gate.
2. **Edge prediction (§2.9).** Trigger too eagerly and slow motion fires constantly;
   too late and it fires after the outcome is decided. Needs hysteresis, cooldown,
   and a real probability estimate. Highest risk *after* the gate.
3. **Control authority vs. physics authority.** Every frame, something must decide
   whether the player or the solver owns the car. Get this wrong and either recoil
   is invisible (controller cancels it) or control feels lost. Already bit us twice
   during phase 1 — see the gate report.
4. **Slow-motion stepping stability.** §3.3 requires the step size stay fixed while
   the time budget scales. Cheap to get wrong in a way that only shows up as
   occasional tunnelling.
5. **Mobile frame pacing** with particles and multiple bodies, once phase 4 lands.

## 4. Phased plan

| Phase | Contains | Exit criterion |
|---|---|---|
| **1 — The Gate** | Havok, one player, one enemy, drag steering, charge, elastic collision, rear-hit bonus, edge fall, respawn. Grey primitives. | §0.2: ramming an enemy off the edge is fun with grey boxes. |
| 2 — Feel | Camera shake, hit-stop, zoom impulse, suspension/antenna cosmetics, comic words, impact SFX. | §2.8 tiers readable and distinct; no discomfort over a 3-minute session. |
| 3 — Suspense | Edge prediction, slow motion, near-miss recovery, fall confirmation, knockout celebration, name generator. | Part 5 "Edge Suspense" + "Knockout" all pass; measured save rate reported. |
| 4 — Economy | Coins, magnet, carry/deposit, stash growth, day loop, one upgrade, failure/restart. | Part 5 "Readability" + core loop enjoyable with no monetization. |
| 5 — Look | Cel shading, outlines, palette, island dressing, opening sequence. | §1.7 visual review passes against named references (§1.5). |
| 6 — Integration | Full-loop gauntlet, performance pass, device testing. | Part 5 in full. |

Phases 2–5 are the fan-out point (§1.2). Nothing fans out until phase 1 clears.

## 5. Measurable acceptance criteria — phase 1

Measured by `src/dev/bench.ts`, which drives the real systems at a fixed timestep.

| # | Criterion | Target |
|---|---|---|
| P1-1 | Every impact separates the cars | separation > 0 for all six bench cases |
| P1-2 | Rear hits clearly stronger | rear travel ≥ 1.5× front at equal charge |
| P1-3 | Car Boy recoils less than the enemy | recoil speed < 40% of enemy Δv |
| P1-4 | Response is monotonic in charge | travel strictly increases with charge level |
| P1-5 | Frame-rate independent | enemy travel spread < 10% across dt 1/120…1/20 |
| P1-6 | No sticking or tunnelling | no centre gap < 1.5 m; no body below deck inside the rim |
| P1-7 | No unreadable spin | angular speed never exceeds the clamp |
| P1-8 | Control returns quickly | full authority restored < 0.6 s after any hit |
| P1-9 | Loop closes | scripted play reaches a knockout, repeatably |
| P1-10 | No leaks over repeated rounds | mesh and body counts flat across knockouts |

## 6. Stack confirmation

Confirmed and in use: **Babylon.js 8.56** for rendering, camera, input and
presentation; **Havok via Babylon Physics V2** (`@babylonjs/havok` 1.3.14) as the
sole authority for rigid-body motion, contacts, impulses and queries. No Three.js,
Cannon, Ammo, Oimo, or custom rigid-body code. Layer separation per §3.2 is in
place: `data/` (tuning), `core/` (engine + physics), `gameplay/`, `input/`, `dev/`.

Two notes on the stack:

- Physics stepping has been taken out of `scene.render()` and is driven explicitly
  (`PhysicsWorld.advance`). Babylon otherwise steps physics inside the render call,
  which means the simulation stops whenever the browser stops painting, and the
  frame delta is not ours to scale. Owning the step is what makes §3.3's
  "slow motion scales the time budget, not the step size" implementable at all.
- Substepping is fixed at 1/120 s with an accumulator, so behaviour is stable
  across frame rates. Verified: see P1-5.

## 7. Deferred past MVP — explicit list

**Out of scope entirely** (§0.4 cut list, restated so it cannot creep back):
tower-defence / buildable island, enemies recollecting coins, enemy power-ups,
story cutscenes.

**Deferred to Part 4, not built:** enemy roster beyond one behaviour, bosses, the
upgrade tree beyond one post-day choice, power-ups, island elements.

**Deferred past the MVP by my own reading, flagged for you:**

- **Rage mode** (§2.6) — specified in controls but absent from §0.3's MVP list.
  Not built. Say the word if you want it in.
- **The opening sequence** (§2.14) — belongs to phase 5; the MVP list does not
  include it and it cannot be judged before the island exists.
- **Multi-enemy tactics.** §0.3 asks for "increasing enemy count" only. Count
  scaling is trivial; coordinated behaviour is Part 4 and stays there.

**Deliberately not abstracted**, per §3.5's instruction to implement five hooks and
nothing more: no entity-component system, no event bus, no scene-graph
abstraction, no serialization layer, no plugin architecture.
