/**
 * The island layout.
 *
 * One definition, consumed by three systems that must agree exactly: the physics
 * colliders (Arena), the visible geometry (Environment) and the grass distribution.
 * If any of them derived its own layout the edge you can see would stop being the
 * edge you fall off, which is the one thing the whole game rests on.
 */

export interface IslandDef {
  x: number;
  z: number;
  radius: number;
  /** Cottages are placed on the outer isles, never on the arena itself. */
  cottages: number;
}

export interface BridgeDef {
  from: number;
  to: number;
  width: number;
}

export interface Archipelago {
  islands: IslandDef[];
  bridges: BridgeDef[];
}

/**
 * Main arena at the origin, three satellites around it, each joined by a bridge.
 *
 * Satellites are deliberately placed so the bridge spans are short — a long plank
 * over open water is a corridor you can be trapped on, and the fight needs the
 * option to break away rather than a duel on a beam.
 */
export function buildArchipelago(mainRadius: number): Archipelago {
  const islands: IslandDef[] = [
    { x: 0, z: 0, radius: mainRadius, cottages: 0 },
    { x: mainRadius + 17, z: -6, radius: 9.5, cottages: 1 },
    { x: -mainRadius - 14, z: 9, radius: 8, cottages: 1 },
    { x: 4, z: mainRadius + 16, radius: 10.5, cottages: 2 },
  ];
  const bridges: BridgeDef[] = [
    { from: 0, to: 1, width: 4.6 },
    { from: 0, to: 2, width: 4.2 },
    { from: 0, to: 3, width: 5 },
  ];
  return { islands, bridges };
}

/** Endpoints of a bridge, trimmed to sit just inside each island's rim. */
export function bridgeSpan(
  a: IslandDef,
  b: IslandDef
): { x1: number; z1: number; x2: number; z2: number; length: number; angle: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  // Overlap the rims slightly so there is no seam to catch a wheel on.
  const startR = a.radius - 0.8;
  const endR = b.radius - 0.8;
  return {
    x1: a.x + ux * startR,
    z1: a.z + uz * startR,
    x2: b.x - ux * endR,
    z2: b.z - uz * endR,
    length: d - startR - endR,
    angle: Math.atan2(ux, uz),
  };
}

/**
 * How far inside solid ground a point is, in metres. Negative means over water.
 * Takes the best of every island and bridge, so standing on a bridge counts as
 * supported even though it is nowhere near an island centre.
 */
export function groundMargin(world: Archipelago, x: number, z: number): number {
  let best = -Infinity;
  for (const isle of world.islands) {
    const m = isle.radius - Math.hypot(x - isle.x, z - isle.z);
    if (m > best) best = m;
  }
  for (const b of world.bridges) {
    const span = bridgeSpan(world.islands[b.from], world.islands[b.to]);
    const m = halfWidthMargin(span, b.width, x, z);
    if (m > best) best = m;
  }
  return best;
}

/** Margin inside a bridge's rectangle: positive on the planks, negative off them. */
function halfWidthMargin(
  span: { x1: number; z1: number; x2: number; z2: number },
  width: number,
  x: number,
  z: number
): number {
  const dx = span.x2 - span.x1;
  const dz = span.z2 - span.z1;
  const len2 = dx * dx + dz * dz;
  if (len2 < 0.0001) return -Infinity;
  // Project onto the span, clamped to its ends.
  let t = ((x - span.x1) * dx + (z - span.z1) * dz) / len2;
  if (t < 0 || t > 1) return -Infinity;
  const px = span.x1 + dx * t;
  const pz = span.z1 + dz * t;
  return width * 0.5 - Math.hypot(x - px, z - pz);
}
