// Pure scene helpers — no framework, no dependencies.
//
// These mirror api/arc.js exactly; a parity test compares them against the
// server's own functions. Port these to Kotlin/Swift/Dart as-is if you are not
// on React Native — they are the whole algorithm.

export type Vec2 = [number, number];

export interface Scene {
  version: number;
  duration: number;
  canvas: { width: number; height: number; fps: number };
  timing: { arc: number; pop: number; hold: number; tail: number };
  base: { url: string; width: number; height: number; scale: number;
          center: { lat: number; lon: number }; zoom: number };
  points: ScenePoint[];
  arcs: SceneArc[];
  camera: { easing: 'easeInOutCubic'; keyframes: Keyframe[] };
  style: SceneStyle;
  image_geo_data?: GeoEntry[];
}

export interface ScenePoint {
  index: number; id: string | number;
  lat: number; lon: number;
  x: number; y: number;              // base-image pixels, the pin's anchor
  image: string; label: string | null;
  appearAt: number; popDuration: number; popEasing: 'easeOutBack';
}

export interface SceneArc {
  from: number; to: number;
  startAt: number; duration: number;
  points: Vec2[];                    // base-image pixels
  cumulative: number[];              // running length at each sample
  length: number; km: number;
  control: { x: number; y: number };
  svgPath: string;
}

export interface Keyframe { t: number; x: number; y: number; w: number; h: number }
export type Rect = { x: number; y: number; w: number; h: number };

export interface SceneStyle {
  arc: { color: string; width: number; dash: [number, number]; shadow: boolean;
         head: { radius: number; glow: number } };
  marker: { size: number; height: number; aspect: number; border: number; radius: number;
            pointer: number; anchor: 'bottom-center'; color: string; pointerInner: string };
}

export interface GeoEntry {
  id: string | number; name: string | null; display_name: string | null;
  city: string | null; state: string | null; country: string | null; postcode: string | null;
}

// ─── Easing ──────────────────────────────────────────────────────────────────

export function easeInOutCubic(t: number): number {
  'worklet';
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Overshoots past 1 and settles back — that overshoot is the pop. Do not clamp.
export function easeOutBack(t: number): number {
  'worklet';
  return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
}

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(Math.max(v, lo), hi);
};

// ─── Camera ──────────────────────────────────────────────────────────────────

export function cameraAt(scene: Scene, t: number): Rect {
  'worklet';
  const k = scene.camera.keyframes;
  if (t <= k[0].t) return k[0];
  if (t >= k[k.length - 1].t) return k[k.length - 1];

  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const a = k[i], b = k[i + 1];
  const f = easeInOutCubic((t - a.t) / (b.t - a.t || 1));

  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    w: a.w + (b.w - a.w) * f,
    h: a.h + (b.h - a.h) * f,
  };
}

// Maps base-image pixels onto the canvas for the current camera rect.
export function makeTransform(scene: Scene, cam: Rect) {
  'worklet';
  const sx = scene.canvas.width / cam.w;
  const sy = scene.canvas.height / cam.h;
  return {
    sx, sy,
    toCanvas: (bx: number, by: number): Vec2 => {
      'worklet';
      return [(bx - cam.x) * sx, (by - cam.y) * sy];
    },
  };
}

// ─── Arcs ────────────────────────────────────────────────────────────────────

// The drawn portion of an arc at progress 0..1, using the cumulative lengths
// so no arc-length math happens on device.
export function sliceArc(arc: SceneArc, progress: number): Vec2[] {
  'worklet';
  const target = arc.length * clamp(progress, 0, 1);
  const out: Vec2[] = [arc.points[0]];

  for (let i = 1; i < arc.points.length; i++) {
    if (arc.cumulative[i] < target) { out.push(arc.points[i]); continue; }
    const seg = arc.cumulative[i] - arc.cumulative[i - 1] || 1;
    const f = (target - arc.cumulative[i - 1]) / seg;
    const [px, py] = arc.points[i - 1];
    const [qx, qy] = arc.points[i];
    out.push([px + (qx - px) * f, py + (qy - py) * f]);
    break;
  }
  return out;
}

export interface ArcState { arc: SceneArc; progress: number; points: Vec2[] }

// Arcs that have started by time t, with their drawn portion already sliced.
export function arcsAt(scene: Scene, t: number): ArcState[] {
  'worklet';
  const out: ArcState[] = [];
  for (const arc of scene.arcs) {
    if (t < arc.startAt) continue;
    const progress = clamp((t - arc.startAt) / arc.duration, 0, 1);
    out.push({ arc, progress, points: progress >= 1 ? arc.points : sliceArc(arc, progress) });
  }
  return out;
}

// ─── Pins ────────────────────────────────────────────────────────────────────

export interface PinState { point: ScenePoint; scale: number }

// Points that have appeared by time t, with their pop scale.
export function pinsAt(scene: Scene, t: number): PinState[] {
  'worklet';
  const out: PinState[] = [];
  for (const point of scene.points) {
    if (t < point.appearAt) continue;
    const age = t - point.appearAt;
    const scale = age >= point.popDuration ? 1 : easeOutBack(age / point.popDuration);
    if (scale < 0.05) continue;
    out.push({ point, scale });
  }
  return out;
}

// Pin box geometry, matching buildMarker() in api/map.js. The anchor is the
// pointer tip: place (cx, total) on the projected point.
export function pinGeometry(style: SceneStyle, scale = 1) {
  'worklet';
  const S = style.marker;
  const width = S.size * scale;
  const total = S.height * scale;
  const pointer = S.pointer * scale;
  const bodyH = total - pointer;
  const border = S.border * scale;

  return {
    width, total, bodyH, border,
    radius: S.radius * scale,
    photo: {
      x: border, y: border,
      width: width - border * 2,
      height: bodyH - border * 2,
      radius: (S.radius - S.border) * scale,
    },
    pointerOuter: [
      [width / 2 - 12 * scale, bodyH], [width / 2 + 12 * scale, bodyH], [width / 2, total],
    ] as Vec2[],
    pointerInner: [
      [width / 2 - 9 * scale, bodyH], [width / 2 + 9 * scale, bodyH], [width / 2, bodyH + 12 * scale],
    ] as Vec2[],
  };
}
