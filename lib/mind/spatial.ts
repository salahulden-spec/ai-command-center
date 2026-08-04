import type { Entity, EntityKind, RelationGroup, Universe } from "./universe";

/**
 * Where the Mind View puts things.
 *
 * `universe.ts` says what is connected to what. This says where it goes, and it
 * answers three questions the old ring layout could not:
 *
 * 1. **How far out?** Not a fixed radius. Every record has a *gravity* — how
 *    much it should be pulling at you right now — and the ring radius is
 *    `base + (1 - gravity) * spread`. An overdue task sits nearer the centre
 *    than a finished one, so the picture ranks itself.
 * 2. **What else is out there?** A second ring of neighbours-of-neighbours,
 *    fanned around the parent that owns them. That is what makes selecting a
 *    project show its tasks *and* hint at what those tasks touch.
 * 3. **What if two cards land on top of each other?** `separate()` — the nodes
 *    are cards now, not dots, so overlap is resolved as boxes rather than
 *    prevented by keeping a minimum arc.
 *
 * Everything here is pure. The page feeds it live listener data and drives the
 * result with a spring, so a Firestore change re-derives the picture.
 */

/**
 * How many cards the first ring will show at once.
 *
 * The old view drew dots, and forty dots on a circle is merely busy. These are
 * cards: at ~200 world units wide, twenty-six of them need more arc than any
 * readable radius provides, and the camera has to zoom out until nothing can be
 * read. So the ring shows the heaviest records and the sector caption states
 * how many it is standing in for — the inspector still lists every one.
 */
const RING_1_BUDGET = 14;
/** Never fewer than this from a type that is present at all. */
const MIN_PER_SECTOR = 2;
/** Arc each card needs, world units. Drives the ring radius. */
const MIN_ARC = 180;
/** Nearest a ring ever sits to the centre. */
const BASE_RADIUS = 250;
/** Extra distance for each ring further out. */
const RING_STEP = 170;
/** More than this in one sector and it spills onto another ring. */
const PER_RING = 8;
/** How much gravity may pull a record in or out within its own ring. */
const GRAVITY_PULL = 46;
const RING_2 = 178;
const RING_2_SPREAD = 64;
/** Angular gap between type sectors, so groups read as groups. */
const SECTOR_GAP = 0.16;
/** Second-ring items shown per first-ring parent. */
const PER_PARENT = 4;
/** Total second-ring items, so a hub record cannot flood the frame. */
const RING_2_CAP = 18;
/** Room for the card and its caption when framing the camera. */
const FRAME_PAD = 96;

const TAU = Math.PI * 2;

export type Depth = 0 | 1 | 2;

export interface Placed {
  entity: Entity;
  depth: Depth;
  /** A gap the workspace noticed, not a record. Drawn dashed. */
  proposed?: boolean;
  /** Which first-ring record this hangs off, for second-ring items. */
  parentId: string | null;
  x: number;
  y: number;
  angle: number;
  gravity: number;
}

export interface Sector {
  kind: EntityKind;
  angle: number;
  radius: number;
  /** How many of this type are on screen. */
  shown: number;
  /** How many there are in total, which may be more. */
  count: number;
}

export interface Spatial {
  placed: Placed[];
  sectors: Sector[];
  /** Half-width of the immediate neighbourhood, for fitting the camera. */
  extent: number;
}

/**
 * Hands each type a slice of the ring budget in proportion to how many records
 * it has, but never fewer than two — a type that exists should always be
 * visible as a type, even when another one dominates the workspace.
 */
function shareOut(sizes: number[], budget: number): number[] {
  const total = sizes.reduce((n, s) => n + s, 0);
  if (total <= budget) return [...sizes];

  const shares = sizes.map((size) => Math.min(size, Math.max(MIN_PER_SECTOR, Math.round((budget * size) / total))));
  let sum = shares.reduce((n, s) => n + s, 0);

  // Round-off and the floor can both overshoot; take back from the largest.
  while (sum > budget) {
    let index = -1;
    let largest = MIN_PER_SECTOR;
    for (let i = 0; i < shares.length; i++) {
      if (shares[i] > largest) {
        largest = shares[i];
        index = i;
      }
    }
    if (index === -1) break;
    shares[index]--;
    sum--;
  }
  return shares;
}

export interface SpatialOptions {
  showDone: boolean;
  hidden: Set<EntityKind>;
  /**
   * Something the workspace noticed about the focal record, shown as a dashed
   * card in whatever arc is emptiest so it never fights a real one.
   */
  proposal?: Entity | null;
}

/**
 * How hard a record pulls, 0..1. Urgency dominates, recency modulates, and
 * finished work sinks — which is what stops a closed task from sitting in the
 * same place it occupied while it still mattered.
 */
export function gravityOf(entity: Entity): number {
  if (entity.kind === "owner") return 1;
  let g = 0.28 + entity.heat * 0.34;
  if (entity.urgent) g += 0.4;
  if (entity.done) g -= 0.32;
  if (entity.kind === "project") g += 0.1;
  return Math.min(1, Math.max(0.05, g));
}

/**
 * `relations` is the focal record's neighbours as `relationsOf` returns them.
 * It is passed in rather than derived so this module needs nothing from
 * `universe.ts` at runtime — only its types, which vanish at compile time.
 */
export function layoutNeighbourhood(
  universe: Universe,
  focal: Entity,
  relations: RelationGroup[],
  options: SpatialOptions
): Spatial {
  const visible = (entity: Entity) =>
    !options.hidden.has(entity.kind) && (options.showDone || !entity.done);

  const groups = relations
    .map((group) => ({ kind: group.kind, items: group.items.filter(visible) }))
    .filter((group) => group.items.length > 0);

  const placed: Placed[] = [
    { entity: focal, depth: 0, parentId: null, x: 0, y: 0, angle: 0, gravity: 1 },
  ];
  const sectors: Spatial["sectors"] = [];

  if (!groups.length) return { placed, sectors, extent: BASE_RADIUS };

  // Each sector shows its heaviest records, up to its share of the budget.
  const shares = shareOut(
    groups.map((group) => group.items.length),
    RING_1_BUDGET
  );
  const shown = groups.map((group, i) => ({
    kind: group.kind,
    total: group.items.length,
    items: [...group.items].sort((a, b) => gravityOf(b) - gravityOf(a)).slice(0, shares[i]),
  }));

  const ring1 = shown.flatMap((group) => group.items);
  if (!ring1.length) return { placed, sectors, extent: BASE_RADIUS };

  // Which ring each card lands on, worked out first so a ring's radius can be
  // derived from everything sharing it rather than from one sector alone.
  const plan = shown.map((group) => {
    const rings = Math.max(1, Math.ceil(group.items.length / PER_RING));
    // Spread evenly: ten across two rings is 5 and 5, never 8 and 2.
    return { group, perRing: Math.ceil(group.items.length / rings) };
  });

  const perRingCount = new Map<number, number>();
  for (const { group, perRing } of plan) {
    group.items.forEach((_, i) => {
      const ring = Math.floor(i / perRing);
      perRingCount.set(ring, (perRingCount.get(ring) ?? 0) + 1);
    });
  }

  // A ring is as wide as its contents demand. This is the property the old
  // fixed-radius layout lacked: crowding becomes geometrically impossible,
  // because a busier ring is simply a wider one.
  const ringRadius = new Map<number, number>();
  let previous = 0;
  for (const ring of [...perRingCount.keys()].sort((a, b) => a - b)) {
    const needed = ((perRingCount.get(ring) ?? 0) * MIN_ARC) / TAU;
    const radius = Math.max(BASE_RADIUS + ring * RING_STEP, needed, previous + RING_STEP);
    ringRadius.set(ring, radius);
    previous = radius;
  }

  const usable = TAU - SECTOR_GAP * groups.length;
  const angleOf = new Map<string, number>();
  const radiusOf = new Map<string, number>();

  // Centred on the top of the circle, so the arrangement reads as deliberate
  // rather than as a wheel that happens to start somewhere.
  let cursor = -Math.PI / 2 - usable / 2;

  for (const { group, perRing } of plan) {
    const span = usable * (group.items.length / ring1.length);
    let nearest = Infinity;

    group.items.forEach((entity, i) => {
      const gravity = gravityOf(entity);
      const ring = Math.floor(i / perRing);
      const indexInRing = i % perRing;
      const inThisRing = Math.min(perRing, group.items.length - ring * perRing);
      const step = inThisRing > 1 ? span / (inThisRing - 1) : 0;
      // Odd rings are nudged half a step round, so an outer card never sits
      // directly behind an inner one.
      const stagger = ring % 2 === 1 ? step / 2 : 0;
      const angle =
        inThisRing > 1 ? cursor + step * indexInRing + stagger : cursor + span / 2;
      // Gravity moves a record within its ring rather than setting the ring:
      // the ranking survives, but it can never reintroduce crowding.
      const radius = (ringRadius.get(ring) ?? BASE_RADIUS) - (gravity - 0.5) * GRAVITY_PULL;

      nearest = Math.min(nearest, radius);
      angleOf.set(entity.id, angle);
      radiusOf.set(entity.id, radius);
      placed.push({
        entity,
        depth: 1,
        parentId: focal.id,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle,
        gravity,
      });
    });

    sectors.push({
      kind: group.kind,
      angle: cursor + span / 2,
      radius: nearest - 62,
      shown: group.items.length,
      count: group.total,
    });
    cursor += span + SECTOR_GAP;
  }

  // --- second ring -------------------------------------------------------
  const seen = new Set<string>([focal.id, ...ring1.map((e) => e.id)]);
  // Anything the budget left off the ring is not a parent for the second ring
  // either — it would draw an edge to a card that is not on screen.
  const children: { entity: Entity; parentId: string }[] = [];

  for (const parent of ring1) {
    const kids = [...(universe.edges.get(parent.id) ?? [])]
      .map((id) => universe.byId.get(id))
      .filter((e): e is Entity => !!e && !seen.has(e.id) && visible(e))
      .sort((a, b) => gravityOf(b) - gravityOf(a))
      .slice(0, PER_PARENT);
    for (const kid of kids) {
      seen.add(kid.id);
      children.push({ entity: kid, parentId: parent.id });
    }
  }

  children.sort((a, b) => gravityOf(b.entity) - gravityOf(a.entity));
  const byParent = new Map<string, Entity[]>();
  for (const { entity, parentId } of children.slice(0, RING_2_CAP)) {
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(entity);
  }

  for (const [parentId, kids] of byParent) {
    const base = angleOf.get(parentId) ?? 0;
    const parentRadius = radiusOf.get(parentId) ?? BASE_RADIUS;
    // Wide enough that the cards do not start on top of each other: the arc
    // between siblings has to cover a card, and arc = angle × radius.
    const spacingRadius = parentRadius + RING_2;
    const fan = Math.min(1.25, ((kids.length - 1) * MIN_ARC) / spacingRadius);
    kids.forEach((entity, i) => {
      const gravity = gravityOf(entity);
      const angle = base + (kids.length === 1 ? 0 : fan * (i / (kids.length - 1) - 0.5));
      const radius = parentRadius + RING_2 + (1 - gravity) * RING_2_SPREAD;
      placed.push({
        entity,
        depth: 2,
        parentId,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle,
        gravity,
      });
    });
  }

  // The proposal goes in the widest gap between real cards.
  if (options.proposal) {
    const used = [...angleOf.values()].sort((a, b) => a - b);
    let best = -Math.PI / 2;
    let widest = -1;
    for (let i = 0; i < used.length; i++) {
      const from = used[i];
      const to = i === used.length - 1 ? used[0] + TAU : used[i + 1];
      if (to - from > widest) {
        widest = to - from;
        best = (from + to) / 2;
      }
    }
    const radius = BASE_RADIUS + 30;
    placed.push({
      entity: options.proposal,
      depth: 1,
      proposed: true,
      parentId: focal.id,
      x: Math.cos(best) * radius,
      y: Math.sin(best) * radius,
      angle: best,
      gravity: 0.5,
    });
  }

  // Only the immediate neighbourhood is framed. The second ring is meant to
  // run off the edges — that is what makes the space read as continuing.
  let extent = BASE_RADIUS;
  for (const p of placed) {
    if (p.depth > 1) continue;
    extent = Math.max(extent, Math.hypot(p.x, p.y) + FRAME_PAD);
  }

  return { placed, sectors, extent };
}

export interface Body {
  x: number;
  y: number;
  /** Half-width and half-height, including the breathing room you want. */
  rx: number;
  ry: number;
  fixed: boolean;
}

/**
 * Pushes overlapping cards apart along their shallowest axis.
 *
 * Boxes rather than circles because the nodes are cards: two wide cards side by
 * side barely overlap vertically, and separating them on the short axis moves
 * them a fraction of what a radius-based push would. A `fixed` body (the focal
 * record) absorbs none of the correction, so the centre never drifts.
 */
/**
 * A hair more than the overlap, so a resolved pair is resolved.
 *
 * Without it two cards wedged between others converge on exactly touching and
 * never quite clear, which reads as a permanent overlap however long the loop
 * runs.
 */
const SEPARATION_SLOP = 0.5;

export function separate(bodies: Body[], passes = 2): void {
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.fixed && b.fixed) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = a.rx + b.rx - Math.abs(dx);
        const overlapY = a.ry + b.ry - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        if (overlapX < overlapY) {
          const shift = (dx < 0 ? -1 : 1) * (overlapX * 0.5 + SEPARATION_SLOP);
          if (a.fixed) b.x += shift * 2;
          else if (b.fixed) a.x -= shift * 2;
          else {
            b.x += shift;
            a.x -= shift;
          }
        } else {
          const shift = (dy < 0 ? -1 : 1) * (overlapY * 0.5 + SEPARATION_SLOP);
          if (a.fixed) b.y += shift * 2;
          else if (b.fixed) a.y -= shift * 2;
          else {
            b.y += shift;
            a.y -= shift;
          }
        }
      }
    }
  }
}
