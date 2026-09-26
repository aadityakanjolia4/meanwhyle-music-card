// Arc-journey scene geometry: camera fit, great-circle arcs, timeline, Ken Burns keyframes.
//
// Pure math, no rendering and no I/O. Both the server-side MP4 renderer and the
// /arc-journey/scene endpoint build from this, so a phone rendering the scene
// itself draws exactly what the video shows.
//
// Coordinate contract: points and arcs live in BASE-IMAGE pixels. The camera
// rect maps base pixels onto the canvas. Stroke widths and marker sizes are
// CANVAS pixels and never scale with the camera.

const MAX_LAT = 85.05112878;
const TILE    = 512;

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

// ─── Web Mercator ────────────────────────────────────────────────────────────

export function mercX(lon) { return (lon + 180) / 360; }
export function mercY(lat) {
    const s = Math.sin(toRad(clamp(lat, -MAX_LAT, MAX_LAT)));
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
const invMercX = (x) => x * 360 - 180;
const invMercY = (y) => toDeg(Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y)));

// Fit a view (center + zoom) that holds every point inside width x height,
// leaving `padding` pixels of margin on each side.
export function fitView(points, width, height, padding = 0, maxZoom = 16) {
    const xs = points.map((p) => mercX(p.lon));
    const ys = points.map((p) => mercY(p.lat));
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);

    // Never let padding consume the frame — at 50% per side the fit collapses
    // to zoom 0 and renders the whole world.
    const padX = Math.min(padding, width  * 0.35);
    const padY = Math.min(padding, height * 0.35);
    const availW = Math.max(width  - padX * 2, 1);
    const availH = Math.max(height - padY * 2, 1);

    const worldSize = Math.min(availW / spanX, availH / spanY);
    const zoom = clamp(Math.log2(worldSize / TILE), 0, maxZoom);

    return {
        center: { lon: invMercX((minX + maxX) / 2), lat: invMercY((minY + maxY) / 2) },
        zoom,
    };
}

export function projectPoint(lat, lon, view, width, height) {
    const world = TILE * 2 ** view.zoom;
    return {
        x: width  / 2 + (mercX(lon) - mercX(view.center.lon)) * world,
        y: height / 2 + (mercY(lat) - mercY(view.center.lat)) * world,
    };
}

export function haversineKm(a, b) {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ─── Arc geometry ────────────────────────────────────────────────────────────

// Interpolate n points along the great circle from a to b.
function greatCircle(a, b, n) {
    const p1 = toRad(a.lat), l1 = toRad(a.lon);
    const p2 = toRad(b.lat), l2 = toRad(b.lon);
    const hav = Math.sin((p2 - p1) / 2) ** 2
        + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
    const d = 2 * Math.asin(Math.min(1, Math.sqrt(hav)));

    const out = [];
    for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        if (d < 1e-9) {
            out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
            continue;
        }
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
        const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
        const z = A * Math.sin(p1) + B * Math.sin(p2);
        out.push({ lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lon: toDeg(Math.atan2(y, x)) });
    }
    return out;
}

// Project the great circle to base pixels, then bow it perpendicular to the
// chord by curvature x chord-length. Always arches upward on screen.
export function buildArcGeometry(a, b, { view, width, height, curvature, samples }) {
    const projected = greatCircle(a, b, samples)
        .map((g) => projectPoint(g.lat, g.lon, view, width, height));

    const first = projected[0];
    const last  = projected[projected.length - 1];
    const dx = last.x - first.x, dy = last.y - first.y;
    const chord = Math.hypot(dx, dy) || 1;

    let nx = dy / chord, ny = -dx / chord;
    if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }

    const bow = curvature * chord;
    const pts = projected.map((p, i) => {
        const k = Math.sin(Math.PI * (i / (samples - 1))) * bow;
        return { x: p.x + nx * k, y: p.y + ny * k };
    });

    // Cumulative arc length, used to slice the path at a progress value.
    const cumulative = [0];
    for (let i = 1; i < pts.length; i++) {
        cumulative.push(cumulative[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }

    // Quadratic control point matching the same mid-path displacement.
    const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const control = { x: round(mid.x + nx * bow * 2), y: round(mid.y + ny * bow * 2) };

    const coords = pts.map((p) => [round(p.x), round(p.y)]);
    const svgPath = 'M' + coords.map(([x, y]) => `${x},${y}`).join('L');

    // Round the running lengths and take `length` from the last of them. A
    // rounded length over raw cumulative values would leave the final slice
    // interpolating toward a target that never quite reaches the end point.
    const rounded = cumulative.map((v) => round(v));

    return { points: coords, cumulative: rounded, length: rounded[rounded.length - 1], control, svgPath };
}

// Slice a sampled path at progress t (0..1 of its length).
export function sliceArc(arc, t) {
    const target = arc.length * clamp(t, 0, 1);
    const pts = arc.points;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
        if (arc.cumulative[i] < target) { out.push(pts[i]); continue; }
        const segment = arc.cumulative[i] - arc.cumulative[i - 1] || 1;
        const f = (target - arc.cumulative[i - 1]) / segment;
        out.push([
            pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
            pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f,
        ]);
        break;
    }
    return out;
}

// ─── Easing ──────────────────────────────────────────────────────────────────
// Named rather than cubic-bezier so a client can reimplement them in one line.

export const EASING = {
    linear:         (t) => t,
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    easeOutBack:    (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

// ─── Timeline ────────────────────────────────────────────────────────────────

// Point 1 pops first, then each arc draws and lands its photo on completion.
export function buildTimeline(count, timing) {
    const points = [{ appearAt: 0, popDuration: timing.pop }];
    const arcs = [];
    let t = timing.pop;

    for (let i = 0; i < count - 1; i++) {
        arcs.push({ from: i, to: i + 1, startAt: round(t, 3), duration: timing.arc });
        t += timing.arc;
        points.push({ appearAt: round(t, 3), popDuration: timing.pop });
        t += timing.pop + timing.hold;
    }

    return { points, arcs, duration: round(t + timing.tail, 3) };
}

// ─── Ken Burns camera ────────────────────────────────────────────────────────

// A camera rect covering `subset`, aspect-locked to the canvas, never smaller
// than the canvas (which would upscale the base) and always inside the base.
function rectFor(subset, opts) {
    const { canvasW, canvasH, baseW, baseH, padding, zoomOut = 1, pinW = 0, pinH = 0 } = opts;
    const aspect = canvasW / canvasH;

    const minX = Math.min(...subset.map((p) => p.x));
    const maxX = Math.max(...subset.map((p) => p.x));
    const minY = Math.min(...subset.map((p) => p.y));
    const maxY = Math.max(...subset.map((p) => p.y));

    // A pin is drawn at a fixed canvas size, anchored on its point and rising
    // above it, so its footprint in base pixels is (pin / canvas) * rect — it
    // grows as the camera pulls back. Solving w >= spanX + fx*w + 2*padding for
    // w (and likewise h) gives a rect that still contains the pins once scaled.
    const fx = clamp(pinW / canvasW, 0, 0.9);
    const fy = clamp(pinH / canvasH, 0, 0.9);

    let w = (((maxX - minX) + padding * 2) / (1 - fx)) * zoomOut;
    let h = (((maxY - minY) + padding * 2) / (1 - fy)) * zoomOut;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;

    if (w < canvasW) { w = canvasW; h = canvasH; }
    if (w > baseW)   { w = baseW;  h = baseW / aspect; }
    if (h > baseH)   { h = baseH;  w = baseH * aspect; }

    // Pins extend sideways symmetrically but only upward, so the rect sits
    // half a pin height above the anchors' midpoint.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2 - (fy * h) / 2;

    return {
        x: round(clamp(cx - w / 2, 0, Math.max(0, baseW - w))),
        y: round(clamp(cy - h / 2, 0, Math.max(0, baseH - h))),
        w: round(w),
        h: round(h),
    };
}

// Tight on the departure point, widen to hold the hop while its arc draws,
// settle on the arrival, and at the end pull back to the whole route.
function buildCamera(pixels, timeline, opts) {
    const close = { ...opts, zoomOut: 1 };
    const wide  = { ...opts, zoomOut: 1.15 };
    const keyframes = [{ t: 0, ...rectFor([pixels[0]], close) }];

    timeline.arcs.forEach((arc, i) => {
        keyframes.push({ t: arc.startAt, ...rectFor([pixels[i]], close) });
        keyframes.push({ t: round(arc.startAt + arc.duration, 3), ...rectFor([pixels[i], pixels[i + 1]], wide) });
        const settled = timeline.points[i + 1];
        keyframes.push({ t: round(settled.appearAt + settled.popDuration, 3), ...rectFor([pixels[i + 1]], close) });
    });

    keyframes.push({ t: timeline.duration, ...rectFor(pixels, wide) });

    // Keep times strictly increasing; a later keyframe at the same instant wins.
    const deduped = [];
    for (const kf of keyframes) {
        if (deduped.length && kf.t <= deduped[deduped.length - 1].t) deduped[deduped.length - 1] = kf;
        else deduped.push(kf);
    }
    return { easing: 'easeInOutCubic', keyframes: deduped };
}

export function cameraAt(camera, t) {
    const kfs = camera.keyframes;
    if (t <= kfs[0].t) return kfs[0];
    if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1];

    let i = 0;
    while (i < kfs.length - 2 && kfs[i + 1].t <= t) i++;
    const a = kfs[i], b = kfs[i + 1];
    const ease = EASING[camera.easing] || EASING.linear;
    const f = ease((t - a.t) / (b.t - a.t || 1));

    return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        w: a.w + (b.w - a.w) * f,
        h: a.h + (b.h - a.h) * f,
    };
}

// ─── Scene ───────────────────────────────────────────────────────────────────

export function planScene(opts) {
    const { points, canvas, timing, style, baseScale, padding, curvature, samples, maxZoom } = opts;


    // Integer base dimensions — sharp and MapLibre both need whole pixels.
    const baseW = Math.round(canvas.width  * baseScale);
    const baseH = Math.round(canvas.height * baseScale);
    const basePad = padding * baseScale;

    const pinPad = (Math.max(style.marker.size, style.marker.height) * baseScale) / 2;
    const view   = fitView(points, baseW, baseH, basePad + pinPad, maxZoom);
    const pixels = points.map((p) => projectPoint(p.lat, p.lon, view, baseW, baseH));
    const timeline = buildTimeline(points.length, timing);

    const arcs = [];
    for (let i = 0; i < points.length - 1; i++) {
        const geom = buildArcGeometry(points[i], points[i + 1], {
            view, width: baseW, height: baseH, curvature, samples,
        });
        arcs.push({ ...timeline.arcs[i], ...geom, km: round(haversineKm(points[i], points[i + 1]), 1) });
    }

    const camera = buildCamera(pixels, timeline, {
        canvasW: canvas.width, canvasH: canvas.height, baseW, baseH, padding: basePad,
        pinW: style.marker.size, pinH: style.marker.height,
    });

    return {
        version: 1,
        duration: timeline.duration,
        canvas,
        timing,
        base: { width: baseW, height: baseH, center: view.center, zoom: round(view.zoom, 4), scale: baseScale },
        points: points.map((p, i) => ({
            index: i,
            id: p.id ?? i,
            lat: p.lat,
            lon: p.lon,
            x: round(pixels[i].x),
            y: round(pixels[i].y),
            image: p.image,
            label: p.label,
            appearAt: timeline.points[i].appearAt,
            popDuration: timeline.points[i].popDuration,
            popEasing: 'easeOutBack',
        })),
        arcs,
        camera,
        style,
    };
}
