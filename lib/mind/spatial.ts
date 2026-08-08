import type { Entity, EntityKind, RelationGroup, Universe } from "./universe";

/**
 * Where the Mind View puts things.
 *
 * `universe.ts` says what is connected to what. This says where it goes.
 *
 * The arrangement is **zonal, not radial**. A ring sorted by type reads as a
 * wheel: every card is the same distance out, so the eye has nowhere to start
 * and the type groupings only exist as arcs you have to trace. Instead each type
 * owns a fixed region of the field — projects above the core, tasks to the
 * right, people to the left, reminders below, knowledge in a quieter corner —
 * and the composition is the same shape every time you open it. You learn where
 * to look once.
 *
 * Three things follow from that choice:
 *
 * 1. **Relationships are edges, not distance.** A task sits in the Tasks column
 *    whether it belongs to a project or stands alone; the line to its project
 *    says which. So the same record is always in the same place.
 * 2. **Lines bundle.** Within a zone, records are ordered by the project they
 *    hang off, so a project's four tasks are four adjacent rows and their edges
 *    run as a bundle instead of crossing the field independently.
 * 3. **The targets never overlap.** Layout resolves its own collisions here
 *    (`separate`, below) rather than leaving them to the render loop. A loop
 *    that has to keep pushing cards apart is a loop that never settles, and a
 *    simulation that never settles is one you can see shivering.
 *
 * Everything here is pure. The page feeds it live listener data and drives the
 * result with a spring, so a Firestore change re-derives the picture.
 */

/**
 * Half-width and half-height of each card in world units, breathing room
 * included. Layout needs card sizes to resolve collisions, and it cannot read
 * the DOM — so the numbers live here, next to the geometry that depends on
 * them, and the stage re-measures the real elements once they exist.
 */
export const CARD_EXTENT: Record<EntityKind, [number, number]> = {
  owner: [88, 88],
  project: [123, 58],
  task: [109, 44],
  person: [114, 38],
  reminder: [106, 48],
  knowledge: [116, 58],
};

/** A region of the field belonging to one type. */
interface ZoneSpec {
  kind: EntityKind;
  /** Unit direction from the core. */
  dx: number;
  dy: number;
  /** Core to the first row/column, along that direction. */
  gap: number;
  /** Which way the cards run: a row (`x`) or a column (`y`). */
  axis: "x" | "y";
  /** Spacing along the flow axis. */
  step: number;
  /** Cards before the zone wraps to another row/column. */
  perLine: number;
  /** Spacing between those rows/columns, along the direction. */
  lineStep: number;
  /** Most this zone will ever show. The header says what it stands for. */
  cap: number;
  /** Put the heaviest card in the middle of the line rather than at one end. */
  centred?: boolean;
}

/**
 * The composition. Projects are nearest the core because they are the
 * structural records — everything else is filed under one. Knowledge sits
 * furthest out and off-axis: it is reference material, not work in flight.
 */
const ZONES: ZoneSpec[] = [
  { kind: "project", dx: 0, dy: -1, gap: 292, axis: "x", step: 262, perLine: 3, lineStep: 140, cap: 6, centred: true },
  { kind: "task", dx: 1, dy: 0, gap: 470, axis: "y", step: 112, perLine: 4, lineStep: 236, cap: 8 },
  { kind: "person", dx: -1, dy: 0, gap: 430, axis: "y", step: 86, perLine: 4, lineStep: 240, cap: 8 },
  { kind: "reminder", dx: 0, dy: 1, gap: 276, axis: "x", step: 224, perLine: 4, lineStep: 122, cap: 6 },
  // Low and far out on the left rather than straight down: the stage is much
  // wider than it is tall, so the bottom of the field is the scarce direction
  // and the quietest zone is the one that should not be spending it.
  { kind: "knowledge", dx: -0.92, dy: 0.39, gap: 620, axis: "x", step: 240, perLine: 2, lineStep: 118, cap: 4 },
];

/** Distance from a zone's nearest edge to its caption. */
const HEADER_LIFT = 44;
/** Room around the composition when framing the camera. */
const FRAME_PAD = 90;
/** A direct neighbour outranks a distant one of the same weight. */
const DEPTH_BONUS = 0.12;
/** Enough passes that the composition is genuinely resolved before it is drawn. */
const LAYOUT_PASSES = 14;

export type Depth = 0 | 1 | 2;

export interface Placed {
  entity: Entity;
  depth: Depth;
  /** Which on-screen record this hangs off, for anything past the first hop. */
  parentId: string | null;
  x: number;
  y: number;
  gravity: number;
}

/** A zone's caption, positioned above the cards it belongs to. */
export interface ZoneLabel {
  kind: EntityKind;
  x: number;
  y: number;
  /** How many of this type are on screen. */
  shown: number;
  /** How many there are in total, which may be more. */
  count: number;
}

export interface Spatial {
  placed: Placed[];
  zones: ZoneLabel[];
  /** Half-width and half-height of the composition, for fitting the camera. */
  extentX: number;
  extentY: number;
}

export interface SpatialOptions {
  showDone: boolean;
  hidden: Set<EntityKind>;
}

/**
 * How hard a record pulls, 0..1. Urgency dominates, recency modulates, and
 * finished work sinks — which is what decides who gets a place when a zone has
 * more records than it can show, and what order they read in.
 */
export function gravityOf(entity: Entity): number {
  if (entity.kind === "owner") return 1;
  let g = 0.28 + entity.heat * 0.34;
  if (entity.urgent) g += 0.4;
  if (entity.done) g -= 0.32;
  if (entity.kind === "project") g += 0.1;
  return Math.min(1, Math.max(0.05, g));
}

/** Reorders a line so the first item lands in the middle and the rest alternate. */
function centreOut<T>(items: T[]): T[] {
  const out = new Array<T>(items.length);
  let left = Math.floor((items.length - 1) / 2);
  let right = left + 1;
  items.forEach((item, i) => {
    if (i % 2 === 0) out[left--] = item;
    else out[right++] = item;
  });
  return out;
}

interface Candidate {
  entity: Entity;
  depth: Depth;
  parentId: string | null;
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

  const placed: Placed[] = [
    { entity: focal, depth: 0, parentId: null, x: 0, y: 0, gravity: 1 },
  ];
  const zones: ZoneLabel[] = [];

  // --- gather ------------------------------------------------------------
  // Everything within two hops, minus you. The owner is the core when you are
  // standing on it and is otherwise left out entirely: a card for yourself on
  // every project's map is the thing that made the old view read as being about
  // you rather than about the work.
  const pool = new Map<string, Candidate>();
  for (const group of relations) {
    if (group.kind === "owner") continue;
    for (const entity of group.items) {
      if (visible(entity)) pool.set(entity.id, { entity, depth: 1, parentId: focal.id });
    }
  }
  for (const [id, entry] of [...pool]) {
    if (entry.depth !== 1) continue;
    for (const otherId of universe.edges.get(id) ?? []) {
      if (otherId === focal.id || pool.has(otherId)) continue;
      const other = universe.byId.get(otherId);
      if (!other || other.kind === "owner" || !visible(other)) continue;
      pool.set(otherId, { entity: other, depth: 2, parentId: id });
    }
  }

  const buckets = new Map<EntityKind, Candidate[]>();
  for (const candidate of pool.values()) {
    const list = buckets.get(candidate.entity.kind);
    if (list) list.push(candidate);
    else buckets.set(candidate.entity.kind, [candidate]);
  }

  const weigh = (c: Candidate) => gravityOf(c.entity) + (c.depth === 1 ? DEPTH_BONUS : 0);

  // Projects are resolved first because every other zone orders itself by which
  // project its records belong to — that is what turns a scatter of edges into
  // a few bundles.
  const projectRank = new Map<string, number>();

  for (const spec of ZONES) {
    const bucket = buckets.get(spec.kind);
    if (!bucket?.length) continue;

    const ranked = [...bucket].sort((a, b) => weigh(b) - weigh(a)).slice(0, spec.cap);

    if (spec.kind === "project") {
      ranked.forEach((c, i) => projectRank.set(c.entity.id, i));
    } else {
      // Group by the project each record hangs off, keeping the heaviest group
      // first and the heaviest record inside each group first.
      const anchorOf = (c: Candidate) => {
        let best = Number.MAX_SAFE_INTEGER;
        for (const other of universe.edges.get(c.entity.id) ?? []) {
          const rank = projectRank.get(other);
          if (rank !== undefined && rank < best) best = rank;
        }
        return best;
      };
      const anchors = new Map(ranked.map((c) => [c.entity.id, anchorOf(c)]));
      ranked.sort((a, b) => {
        const byAnchor = anchors.get(a.entity.id)! - anchors.get(b.entity.id)!;
        return byAnchor !== 0 ? byAnchor : weigh(b) - weigh(a);
      });
    }

    const lines = Math.max(1, Math.ceil(ranked.length / spec.perLine));
    // Spread evenly: six across two lines is 3 and 3, never 4 and 2.
    const perLine = Math.ceil(ranked.length / lines);
    const [halfW, halfH] = CARD_EXTENT[spec.kind];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;

    for (let line = 0; line < lines; line++) {
      const row = ranked.slice(line * perLine, (line + 1) * perLine);
      const ordered = spec.centred ? centreOut(row) : row;
      const distance = spec.gap + line * spec.lineStep;

      ordered.forEach((candidate, i) => {
        const offset = (i - (ordered.length - 1) / 2) * spec.step;
        const x = spec.dx * distance + (spec.axis === "x" ? offset : 0);
        const y = spec.dy * distance + (spec.axis === "y" ? offset : 0);
        minX = Math.min(minX, x - halfW);
        maxX = Math.max(maxX, x + halfW);
        minY = Math.min(minY, y - halfH);
        placed.push({
          entity: candidate.entity,
          depth: candidate.depth,
          parentId: candidate.parentId,
          x,
          y,
          gravity: gravityOf(candidate.entity),
        });
      });
    }

    zones.push({
      kind: spec.kind,
      x: (minX + maxX) / 2,
      y: minY - HEADER_LIFT,
      shown: ranked.length,
      count: bucket.length,
    });
  }

  // Zones are sized for the common case, so their corners can just touch when
  // several are full at once. Resolving that here rather than in the render
  // loop is what lets the loop stop running (see stage.ts): the targets it
  // springs toward are already a legal arrangement.
  const bodies: Body[] = placed.map((p) => {
    const [rx, ry] = CARD_EXTENT[p.entity.kind];
    return { x: p.x, y: p.y, rx, ry, fixed: p.depth === 0 };
  });
  separate(bodies, LAYOUT_PASSES);
  placed.forEach((p, i) => {
    p.x = bodies[i].x;
    p.y = bodies[i].y;
  });

  let extentX = CARD_EXTENT.owner[0] + FRAME_PAD;
  let extentY = CARD_EXTENT.owner[1] + FRAME_PAD;
  for (const p of placed) {
    const [rx, ry] = CARD_EXTENT[p.entity.kind];
    extentX = Math.max(extentX, Math.abs(p.x) + rx + FRAME_PAD);
    extentY = Math.max(extentY, Math.abs(p.y) + ry + FRAME_PAD);
  }
  for (const zone of zones) {
    extentY = Math.max(extentY, Math.abs(zone.y) + FRAME_PAD);
  }

  return { placed, zones, extentX, extentY };
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
 * A hair more than the overlap, so a resolved pair is resolved.
 *
 * Without it two cards wedged between others converge on exactly touching and
 * never quite clear, which reads as a permanent overlap however long the loop
 * runs.
 */
const SEPARATION_SLOP = 0.5;

/**
 * Pushes overlapping cards apart along their shallowest axis.
 *
 * Boxes rather than circles because the nodes are cards: two wide cards side by
 * side barely overlap vertically, and separating them on the short axis moves
 * them a fraction of what a radius-based push would. A `fixed` body (the focal
 * record) absorbs none of the correction, so the centre never drifts.
 */
export function separate(bodies: Body[], passes = 2): void {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
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
        moved = true;

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
    // Nothing was touching, so no later pass can find anything either.
    if (!moved) return;
  }
}

/** A card on its way to where layout put it. */
export interface SpringBody extends Body {
  vx: number;
  vy: number;
  /** Where it is heading. */
  tx: number;
  ty: number;
  /** Arrived. Skipped by the integrator until something moves it again. */
  asleep: boolean;
}

const SPRING = 0.11;
const DAMPING = 0.76;
/** Under this much left to travel, a body simply arrives. */
const REST_DISTANCE = 0.08;
const REST_SPEED = 0.05;

/**
 * Advances every card one step of `dt` 60Hz frames, and says whether any of
 * them are still in flight.
 *
 * This is the whole reason the Mind View stopped shimmering, so it lives here
 * beside the layout it is chasing rather than inside the renderer — the
 * renderer needs a DOM, and this needs to be provable without one.
 *
 * Two rules do the work:
 *
 * - **Arrive, don't approach.** A spring closes on its target asymptotically
 *   and never reaches it, so every card drifted by a fraction of a pixel
 *   forever. Inside a twentieth of a pixel, a body is simply placed on its
 *   target and put to sleep.
 * - **Nothing but the spring.** There used to be a collision pass here too,
 *   pushing overlapping cards apart on every frame. It cannot converge: it
 *   pushes a pair slightly further apart than they overlap and the spring
 *   pulls them straight back, so cards crowded together in transit deadlock
 *   between the two forces and the map shivers indefinitely. Layout resolves
 *   collisions once, in `layoutNeighbourhood`, and hands over targets that do
 *   not overlap — which makes a plain damped spring both sufficient and
 *   provably convergent. Cards may briefly cross during the flight out from
 *   the centre; that lasts a few hundred milliseconds and costs nothing.
 *
 * Time-scaled rather than per-frame, so a 120Hz display eases at the same rate
 * as a 60Hz one instead of twice as fast.
 */
export function integrate(bodies: SpringBody[], dt: number): boolean {
  let flying = false;
  const damp = Math.pow(DAMPING, dt);

  for (const body of bodies) {
    if (body.fixed) {
      body.x = 0;
      body.y = 0;
      continue;
    }
    if (body.asleep) continue;

    const dx = body.tx - body.x;
    const dy = body.ty - body.y;
    if (
      Math.abs(dx) < REST_DISTANCE &&
      Math.abs(dy) < REST_DISTANCE &&
      Math.hypot(body.vx, body.vy) < REST_SPEED
    ) {
      body.x = body.tx;
      body.y = body.ty;
      body.vx = 0;
      body.vy = 0;
      body.asleep = true;
      continue;
    }

    body.vx = (body.vx + dx * SPRING * dt) * damp;
    body.vy = (body.vy + dy * SPRING * dt) * damp;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    flying = true;
  }
  return flying;
}
