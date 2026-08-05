/**
 * Spatial index for terrain interaction zones.
 *
 * The island is bucketed into a uniform grid once at build time. Queries return only
 * the zones in the buckets a point actually touches, so per-frame work scales with
 * how many zones are *near a car*, not with how many exist on the island. Nothing
 * here ever iterates the full zone list during gameplay.
 */

export type ZoneKind = "grass" | "puddle" | "flowers";

export interface Zone {
  kind: ZoneKind;
  x: number;
  z: number;
  radius: number;
  /** Set true while any car is inside; drives "animate only nearby patches". */
  active: boolean;
  /** Seconds since a car was last inside. Used to stop animating stale zones. */
  idle: number;
}

export class ZoneGrid {
  private readonly cell: number;
  private readonly buckets = new Map<number, Zone[]>();
  readonly all: Zone[] = [];

  constructor(cellSize = 6) {
    this.cell = cellSize;
  }

  private key(cx: number, cz: number): number {
    // Cantor-ish pack; island coordinates are small so this never collides.
    return (cx + 512) * 1024 + (cz + 512);
  }

  add(zone: Zone): void {
    this.all.push(zone);
    // Register into every bucket the zone's disc overlaps, so a query only has to
    // look at the bucket under the query point plus its radius spill.
    const minX = Math.floor((zone.x - zone.radius) / this.cell);
    const maxX = Math.floor((zone.x + zone.radius) / this.cell);
    const minZ = Math.floor((zone.z - zone.radius) / this.cell);
    const maxZ = Math.floor((zone.z + zone.radius) / this.cell);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = this.key(cx, cz);
        let list = this.buckets.get(k);
        if (!list) {
          list = [];
          this.buckets.set(k, list);
        }
        list.push(zone);
      }
    }
  }

  /** Zones containing the point, appended to `out`. Allocation-free. */
  queryPoint(x: number, z: number, out: Zone[]): Zone[] {
    out.length = 0;
    const list = this.buckets.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return out;
    for (const zone of list) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      if (dx * dx + dz * dz <= zone.radius * zone.radius) out.push(zone);
    }
    return out;
  }

  /** First zone of a given kind containing the point, or null. */
  kindAt(x: number, z: number, kind: ZoneKind): Zone | null {
    const list = this.buckets.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return null;
    for (const zone of list) {
      if (zone.kind !== kind) continue;
      const dx = x - zone.x;
      const dz = z - zone.z;
      if (dx * dx + dz * dz <= zone.radius * zone.radius) return zone;
    }
    return null;
  }

  /**
   * Marks zones near the given points active and ages the rest. Only the buckets
   * around each point are touched; the `idle` counter on everything else is left
   * alone precisely so that stale zones cost nothing.
   */
  refresh(points: { x: number; z: number }[], dt: number, reach: number): void {
    for (const zone of this.all) zone.idle += dt;
    const scratch: Zone[] = [];
    for (const p of points) {
      // Sample the point plus four offsets at `reach`, which covers the
      // neighbouring buckets without a full radius sweep.
      for (const [ox, oz] of OFFSETS) {
        this.queryPointLoose(p.x + ox * reach, p.z + oz * reach, reach, scratch);
        for (const zone of scratch) {
          zone.idle = 0;
          zone.active = true;
        }
      }
    }
    for (const zone of this.all) {
      if (zone.idle > 0.5) zone.active = false;
    }
  }

  private queryPointLoose(x: number, z: number, pad: number, out: Zone[]): void {
    out.length = 0;
    const list = this.buckets.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return;
    for (const zone of list) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      const r = zone.radius + pad;
      if (dx * dx + dz * dz <= r * r) out.push(zone);
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const zone of this.all) if (zone.active) n++;
    return n;
  }
}

const OFFSETS: [number, number][] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
