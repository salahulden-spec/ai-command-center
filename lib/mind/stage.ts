import { separate, type Body, type Placed, type Sector } from "./spatial";
import type { EntityKind } from "./universe";

/**
 * The Mind View's renderer.
 *
 * Deliberately not a React component. Positions are sprung toward their targets
 * and separated as boxes every frame, then written straight to
 * `element.style.transform` — sixty times a second, with no re-render. Putting
 * that inside a component would mean either mutating refs during render (which
 * the compiler correctly forbids) or re-rendering the whole map every frame.
 *
 * React owns *what* is on screen. This owns *where* it is.
 */

export type Lod = "far" | "near" | "detail";

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
/**
 * The auto-fit will not go below this, even if that means the outer ring runs
 * off the edges — which it is meant to. Fitting everything on screen is how the
 * map ends up at a third of scale with nothing readable on it; a card you can
 * read and a space that continues past the frame is the better trade. Zooming
 * out by hand still goes all the way to MIN_ZOOM.
 */
const READABLE_ZOOM = 0.62;
/** Card padding used for box separation and for trimming edges, in world units. */
const CARD_PAD = 14;
/**
 * Separation passes for the opening frame. The loop would converge over many
 * frames; a first paint has one shot at it.
 */
const SETTLE_PASSES = 8;
/** One speck per this many square pixels of stage. */
const DUST_DENSITY = 14000;
/** Energy packets alive at once along lit connections. */
const MAX_PACKETS = 12;

/**
 * The ref *objects*, not their contents. Handing over accessor closures would
 * mean reading `.current` inside the component, which is a render-phase ref
 * access however late the closure actually runs — the stage does the reading.
 */
export interface StageRefs {
  world: { current: HTMLDivElement | null };
  canvas: { current: HTMLCanvasElement | null };
  zoomLabel: { current: HTMLElement | null };
  lodLabel: { current: HTMLElement | null };
}

export interface StageFrame {
  placed: Placed[];
  sectors: Sector[];
  /** Pairs of entity ids, both of which are on screen. */
  edges: [string, string][];
  /** Entity id → the colour it is drawn in, urgency already applied. */
  colors: Map<string, string>;
  sectorStyle: Record<EntityKind, { color: string; label: string }>;
  extent: number;
}

interface Speck {
  x: number;
  y: number;
  /** Depth, 0..1. Nearer specks are brighter and parallax further. */
  z: number;
  r: number;
  phase: number;
}

interface Packet {
  a: string;
  b: string;
  t: number;
  speed: number;
  color: string;
}

interface NodeBody extends Body {
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  depth: number;
}

function lodFor(k: number): Lod {
  if (k < 0.58) return "far";
  if (k < 1.02) return "near";
  return "detail";
}

/** Splits a quadratic curve in half so each side can carry its own colour. */
function halves(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number
): [number[], number[]] {
  const ax = (x0 + cx) / 2;
  const ay = (y0 + cy) / 2;
  const bx = (cx + x1) / 2;
  const by = (cy + y1) / 2;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  return [
    [x0, y0, ax, ay, mx, my],
    [mx, my, bx, by, x1, y1],
  ];
}

export class MindStage {
  private els = new Map<string, HTMLElement>();
  private bodies = new Map<string, NodeBody>();
  private frame: StageFrame | null = null;
  /**
   * Hover and the attention run live beside the frame, not inside it: they
   * change on every pointer move, and folding them into the layout would mean
   * re-measuring every card just because the cursor moved.
   */
  private highlight: Set<string> | null = null;
  private attention: Set<string> | null = null;
  private cam = { x: 0, y: 0, k: 1, tx: 0, ty: 0, tk: 1 };
  private lod: Lod = "near";
  private started = false;
  /** True once the loop has actually run a frame, which a hidden tab never does. */
  private ticked = false;
  private raf = 0;
  private reduced = false;
  private lastW = 0;
  private lastH = 0;
  private dust: Speck[] = [];
  private packets: Packet[] = [];
  private clock = 0;

  constructor(private refs: StageRefs) {}

  /** Called from each node's ref callback; the stage keeps its own index. */
  bindNode(id: string, el: HTMLElement | null): void {
    if (el) this.els.set(id, el);
    else this.els.delete(id);
  }

  /**
   * Reconciles the simulation with a new layout. New records grow out of
   * whatever they hang off rather than appearing at their final position.
   */
  sync(frame: StageFrame): void {
    this.frame = frame;

    const next = new Map<string, NodeBody>();
    for (const p of frame.placed) {
      const existing = this.bodies.get(p.entity.id);
      const parent = p.parentId ? this.bodies.get(p.parentId) : undefined;
      const body: NodeBody = existing ?? {
        x: parent?.x ?? 0,
        y: parent?.y ?? 0,
        vx: 0,
        vy: 0,
        tx: p.x,
        ty: p.y,
        rx: 90,
        ry: 40,
        fixed: p.depth === 0,
        depth: p.depth,
      };
      body.tx = p.x;
      body.ty = p.y;
      body.depth = p.depth;
      body.fixed = p.depth === 0;
      if (p.depth === 0) {
        body.x = 0;
        body.y = 0;
      }
      next.set(p.entity.id, body);
    }
    this.bodies = next;

    this.measure();
    this.fit();

    // Records arrive from Firestore over several snapshots, and a body that
    // appears later starts on whatever it hangs off so it can grow outward.
    // That is the animation — but only if there are frames to animate in. Until
    // one has run, jump straight to the laid-out picture instead.
    if (!this.ticked && this.hostSize()[0] > 0) this.snap();
    this.paint();
  }

  /** Cheap update for hover and attention, which change without a re-layout. */
  setOverlay(highlight: Set<string> | null, attention: Set<string> | null): void {
    this.highlight = highlight;
    this.attention = attention;
    this.paint();
  }

  zoomBy(factor: number): void {
    this.cam.tk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.tk * factor));
  }

  zoomTo(k: number): void {
    this.cam.tk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
  }

  get zoom(): number {
    return this.cam.tk;
  }

  /** Where the camera was when a drag began, so panning is absolute. */
  panOrigin(): { x: number; y: number } {
    return { x: this.cam.tx, y: this.cam.ty };
  }

  panTo(origin: { x: number; y: number }, dx: number, dy: number): void {
    this.cam.tx = origin.x - dx / this.cam.k;
    this.cam.ty = origin.y - dy / this.cam.k;
    this.cam.x = this.cam.tx;
    this.cam.y = this.cam.ty;
  }

  recentre(): void {
    this.cam.tx = 0;
    this.cam.ty = 0;
    this.fit();
  }

  start(): () => void {
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(3, Math.max(0.2, (now - last) / 16.67));
      last = now;
      this.ticked = true;
      this.step(dt);
      this.paint();
      this.raf = requestAnimationFrame(tick);
    };

    this.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(this.raf);
  }

  // --- internals ---------------------------------------------------------

  /**
   * Jumps straight to the laid-out picture instead of animating into it.
   *
   * Used for the opening frame, because a browser that never hands us one — a
   * background tab, a paused animation clock — still has to show the map rather
   * than every card stacked on the origin.
   */
  private snap(): void {
    this.cam.k = this.cam.tk;
    this.cam.x = this.cam.tx;
    this.cam.y = this.cam.ty;
    for (const body of this.bodies.values()) {
      if (body.fixed) continue;
      body.x = body.tx;
      body.y = body.ty;
    }
    // Several passes, because nothing may run the loop before this is seen.
    separate([...this.bodies.values()], SETTLE_PASSES);
    this.started = true;
  }

  /**
   * A field of slow specks behind everything.
   *
   * It is not decoration for its own sake: without something at a different
   * depth, panning has no parallax and the map reads as a flat diagram rather
   * than a space you are moving through.
   */
  private seedDust(w: number, h: number): void {
    if (this.reduced) {
      this.dust = [];
      return;
    }
    const count = Math.round((w * h) / DUST_DENSITY);
    this.dust = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: 0.3 + Math.random() * 0.9,
      r: 0.4 + Math.random() * 1.3,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  /** Sends a pulse along a connection, if one is on screen. */
  private emitPacket(): void {
    const frame = this.frame;
    if (!frame || this.reduced || this.packets.length >= MAX_PACKETS) return;
    const live = frame.edges.filter(([a, b]) => this.bodies.has(a) && this.bodies.has(b));
    if (!live.length) return;
    const [a, b] = live[Math.floor(Math.random() * live.length)];
    this.packets.push({
      a,
      b,
      t: 0,
      speed: 0.005 + Math.random() * 0.006,
      color: frame.colors.get(a) ?? "oklch(0.85 0.17 195)",
    });
  }

  private step(dt: number): void {
    this.clock += dt;
    if (!this.reduced && Math.random() < 0.012) this.emitPacket();
    this.packets = this.packets.filter((p) => {
      p.t += p.speed * dt;
      return p.t <= 1 && this.bodies.has(p.a) && this.bodies.has(p.b);
    });

    const c = this.cam;
    const ease = this.reduced ? 1 : 0.12;
    c.k += (c.tk - c.k) * ease;
    c.x += (c.tx - c.x) * ease;
    c.y += (c.ty - c.y) * ease;

    for (const body of this.bodies.values()) {
      if (body.fixed) {
        body.x = 0;
        body.y = 0;
        continue;
      }
      body.vx = (body.vx + (body.tx - body.x) * 0.09) * 0.78;
      body.vy = (body.vy + (body.ty - body.y) * 0.09) * 0.78;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
    }
    separate([...this.bodies.values()]);
  }

  /** Cards change size with the detail level, so their boxes are re-read. */
  private measure(): void {
    for (const [id, body] of this.bodies) {
      const card = this.els.get(id)?.querySelector<HTMLElement>(".mv-card");
      if (!card) continue;
      body.rx = card.offsetWidth / 2 + CARD_PAD;
      body.ry = card.offsetHeight / 2 + CARD_PAD;
    }
  }

  /**
   * The live size of the element the world sits in. Read from the DOM rather
   * than from a ResizeObserver: observer callbacks are delivered on the
   * rendering lifecycle, so a hidden tab reports nothing and the map would fit
   * itself to a zero-sized box.
   */
  private hostSize(): [number, number] {
    const host = this.refs.world.current?.parentElement;
    return [host?.clientWidth ?? 0, host?.clientHeight ?? 0];
  }

  private fit(): void {
    const [w, h] = this.hostSize();
    if (!w || !h || !this.frame) return;
    const pad = w < 640 ? 24 : 52;
    this.cam.tk = Math.min(
      MAX_ZOOM,
      Math.max(READABLE_ZOOM, Math.min(w - pad * 2, h - pad * 2) / (this.frame.extent * 2))
    );
  }

  private paint(): void {
    const world = this.refs.world.current;
    if (!world) return;
    const c = this.cam;
    const [w, h] = this.hostSize();

    // The box we live in changed. This is the only reliable place to notice:
    // a ResizeObserver reports on the rendering lifecycle, so a tab that was
    // hidden when the map mounted never hears about its own size. Re-fitting
    // here means the picture is right the moment the browser lays it out.
    if (w && h && (w !== this.lastW || h !== this.lastH)) {
      this.lastW = w;
      this.lastH = h;
      this.seedDust(w, h);
      this.fit();
      if (!this.started) this.snap();
    }

    const ox = w / 2 - c.x * c.k;
    const oy = h / 2 - c.y * c.k;

    world.style.transform = `translate(${ox}px, ${oy}px) scale(${c.k})`;

    const nextLod = lodFor(c.k);
    if (nextLod !== this.lod) {
      this.lod = nextLod;
      world.dataset.lod = nextLod;
      const label = this.refs.lodLabel.current;
      if (label) {
        label.textContent =
          nextLod === "far" ? "Constellation" : nextLod === "near" ? "Cards" : "Detail";
      }
      this.measure();
    }
    const zoom = this.refs.zoomLabel.current;
    if (zoom) zoom.textContent = `${c.k.toFixed(2)}×`;

    for (const [id, body] of this.bodies) {
      const el = this.els.get(id);
      if (el) el.style.transform = `translate(${body.x}px, ${body.y}px)`;
    }

    this.draw(ox, oy, c.k, w, h);
  }

  private draw(ox: number, oy: number, k: number, w: number, h: number): void {
    const canvas = this.refs.canvas.current;
    const ctx = canvas?.getContext("2d");
    const frame = this.frame;
    if (!canvas || !ctx || !frame || !w || !h) return;

    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    /** Screen-space control points, so a packet follows the drawn curve. */
    const curves = new Map<string, number[]>();

    // Depth, drawn first. Specks drift with the camera at a fraction of its
    // speed, which is what gives panning any sense of parallax.
    for (const speck of this.dust) {
      const px = (((speck.x - this.cam.x * speck.z * 0.06) % w) + w) % w;
      const py = (((speck.y - this.cam.y * speck.z * 0.06) % h) + h) % h;
      ctx.globalAlpha = (0.1 + 0.16 * (Math.sin(this.clock * 0.02 + speck.phase) * 0.5 + 0.5)) * speck.z;
      ctx.fillStyle = "oklch(0.85 0.06 240)";
      ctx.beginPath();
      ctx.arc(px, py, speck.r * speck.z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const [a, b] of frame.edges) {
      const pa = this.bodies.get(a);
      const pb = this.bodies.get(b);
      if (!pa || !pb) continue;

      const lit = this.highlight ? this.highlight.has(a) && this.highlight.has(b) : false;
      const onAttention = this.attention
        ? this.attention.has(a) && this.attention.has(b)
        : false;
      let alpha = pa.depth === 2 || pb.depth === 2 ? 0.12 : 0.22;
      if (lit) alpha = 0.7;
      if (this.attention) alpha = onAttention ? 0.85 : 0.05;

      // Trim the line to each card's edge so it never runs under a label.
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const cut = (p: NodeBody, sx: number, sy: number): [number, number] => {
        const t = Math.min(
          Math.abs(sx) ? (p.rx - CARD_PAD) / Math.abs(sx) : 1e9,
          Math.abs(sy) ? (p.ry - CARD_PAD) / Math.abs(sy) : 1e9
        );
        return [p.x + sx * t, p.y + sy * t];
      };
      const [x1, y1] = cut(pa, dx, dy);
      const [x2, y2] = cut(pb, -dx, -dy);
      const sx1 = ox + x1 * k;
      const sy1 = oy + y1 * k;
      const sx2 = ox + x2 * k;
      const sy2 = oy + y2 * k;

      // A slight bow, so parallel spokes don't read as a wiring diagram.
      const nx = -(sy2 - sy1);
      const ny = sx2 - sx1;
      const len = Math.hypot(nx, ny) || 1;
      const bow = Math.min(24, len * 0.05) * (pa.depth === 2 || pb.depth === 2 ? 1.4 : 0.6);
      const cx = (sx1 + sx2) / 2 + (nx / len) * bow;
      const cy = (sy1 + sy2) / 2 + (ny / len) * bow;

      curves.set(a < b ? `${a}|${b}` : `${b}|${a}`, [sx1, sy1, cx, cy, sx2, sy2]);

      const [first, second] = halves(sx1, sy1, cx, cy, sx2, sy2);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lit || onAttention ? 1.8 : 1;
      for (const [seg, id] of [
        [first, a],
        [second, b],
      ] as const) {
        ctx.strokeStyle = frame.colors.get(id) ?? "oklch(0.7 0 0)";
        ctx.beginPath();
        ctx.moveTo(seg[0], seg[1]);
        ctx.quadraticCurveTo(seg[2], seg[3], seg[4], seg[5]);
        ctx.stroke();
      }

      // A connection you are looking at is drawn as flowing, not merely lit.
      if ((lit || onAttention) && !this.reduced) {
        ctx.save();
        ctx.setLineDash([3, 9]);
        ctx.lineDashOffset = -(this.clock * 0.75) % 12;
        ctx.globalAlpha = onAttention ? 0.5 : 0.34;
        ctx.strokeStyle = "oklch(0.98 0.01 220)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.quadraticCurveTo(cx, cy, sx2, sy2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Packets ride the curve their connection was drawn on.
    for (const packet of this.packets) {
      const curve = curves.get(
        packet.a < packet.b ? `${packet.a}|${packet.b}` : `${packet.b}|${packet.a}`
      );
      if (!curve) continue;
      const [x0, y0, qx, qy, x1c, y1c] = curve;
      const t = packet.t;
      const inv = 1 - t;
      const px = inv * inv * x0 + 2 * inv * t * qx + t * t * x1c;
      const py = inv * inv * y0 + 2 * inv * t * qy + t * t * y1c;
      const fade = Math.sin(t * Math.PI);

      ctx.fillStyle = packet.color;
      ctx.globalAlpha = 0.85 * fade;
      ctx.beginPath();
      ctx.arc(px, py, 2.2 * k + 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.16 * fade;
      ctx.beginPath();
      ctx.arc(px, py, 8 * k + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Sector captions sit just inside the first ring.
    ctx.globalAlpha = this.attention ? 0.2 : 0.62;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const s of frame.sectors) {
      if (s.radius <= 0) continue;
      const style = frame.sectorStyle[s.kind];
      ctx.fillStyle = style.color;
      ctx.fillText(
        s.shown < s.count
          ? `${style.label.toUpperCase()} · ${s.shown} OF ${s.count}`
          : `${style.label.toUpperCase()} · ${s.count}`,
        ox + Math.cos(s.angle) * s.radius * k,
        oy + Math.sin(s.angle) * s.radius * k
      );
    }
    ctx.globalAlpha = 1;
  }
}
