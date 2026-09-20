// Renders an arc-journey scene: one base map render, then per-frame Ken Burns
// crop + arc overlay + photo pins, piped into ffmpeg as raw RGBA.

import { spawn } from 'child_process';
import { once } from 'events';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import sharp from 'sharp';

import { renderMap, buildMarker, loadImageSource } from './map.js';
import { cameraAt, sliceArc, EASING, clamp } from './arc.js';

// ─── Base map ────────────────────────────────────────────────────────────────

// Flat (pitch 0, bearing 0) so the Mercator projection in arc.js is exact.
export async function renderBase(scene, styleObj) {
    const { width, height, center, zoom } = scene.base;
    return renderMap(
        { width, height, zoom, center: [center.lon, center.lat], bearing: 0, pitch: 0 },
        styleObj,
    );
}

// ─── Photo pins ──────────────────────────────────────────────────────────────

export async function prepareMarkers(scene) {
    const size = scene.style.marker.size;
    return Promise.all(scene.points.map(async (p) => {
        const img = await loadImageSource(p.image);
        if (!img) return null;
        try {
            return await buildMarker(img, size);
        } catch (err) {
            console.warn(`[arc] marker ${p.index} failed: ${err.message} — skipping`);
            return null;
        }
    }));
}

// Trim a pin that hangs off the canvas; sharp refuses to composite past the edge.
async function clipToCanvas(buf, w, h, left, top, W, H) {
    const cropLeft = clamp(Math.max(0, -left), 0, w - 1);
    const cropTop  = clamp(Math.max(0, -top),  0, h - 1);
    const visW = Math.min(w - cropLeft, W - Math.max(0, left));
    const visH = Math.min(h - cropTop,  H - Math.max(0, top));
    if (visW <= 0 || visH <= 0) return null;

    const input = (cropLeft || cropTop || visW < w || visH < h)
        ? await sharp(buf).extract({ left: cropLeft, top: cropTop, width: visW, height: visH }).png().toBuffer()
        : buf;

    return { input, left: Math.max(0, left), top: Math.max(0, top) };
}

// ─── Arc overlay ─────────────────────────────────────────────────────────────

function arcOverlaySvg(scene, t, toCanvas) {
    const { width: W, height: H } = scene.canvas;
    const a = scene.style.arc;
    const dash = a.dash.join(' ');
    const parts = [];

    for (const arc of scene.arcs) {
        if (t < arc.startAt) continue;
        const progress = clamp((t - arc.startAt) / arc.duration, 0, 1);
        const pts = progress >= 1 ? arc.points : sliceArc(arc, progress);
        if (pts.length < 2) continue;

        const coords = pts.map(([x, y]) => {
            const [cx, cy] = toCanvas(x, y);
            return `${cx.toFixed(1)},${cy.toFixed(1)}`;
        }).join(' ');

        if (a.shadow) {
            parts.push(`<polyline points="${coords}" fill="none" stroke="#000" stroke-opacity="0.28" `
                + `stroke-width="${a.width + 2}" stroke-dasharray="${dash}" stroke-linecap="round" `
                + `transform="translate(0,1.5)"/>`);
        }
        parts.push(`<polyline points="${coords}" fill="none" stroke="${a.color}" `
            + `stroke-width="${a.width}" stroke-dasharray="${dash}" stroke-linecap="round"/>`);

        // Travelling head, only while the arc is still drawing.
        if (progress < 1) {
            const [hx, hy] = toCanvas(...pts[pts.length - 1]);
            const { radius, glow } = a.head;
            parts.push(`<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${glow}" fill="${a.color}" opacity="0.22"/>`
                + `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${radius}" fill="#fff"/>`
                + `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${Math.max(1, radius - 1.8)}" fill="${a.color}"/>`);
        }
    }

    if (parts.length === 0) return null;
    return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`);
}

// ─── Frames ──────────────────────────────────────────────────────────────────

export async function renderFrame(t, ctx) {
    const { scene, baseRaw, markers, markerCache } = ctx;
    const { width: W, height: H } = scene.canvas;
    const { width: baseW, height: baseH } = scene.base;

    // Integer crop rect, and a transform derived from that same rect so the
    // overlay lines up with the pixels we actually cropped.
    const cam  = cameraAt(scene.camera, t);
    const left = clamp(Math.round(cam.x), 0, baseW - 1);
    const top  = clamp(Math.round(cam.y), 0, baseH - 1);
    const cw   = clamp(Math.round(cam.w), 1, baseW - left);
    const ch   = clamp(Math.round(cam.h), 1, baseH - top);
    const sx = W / cw, sy = H / ch;
    const toCanvas = (bx, by) => [(bx - left) * sx, (by - top) * sy];

    const composites = [];

    const overlay = arcOverlaySvg(scene, t, toCanvas);
    if (overlay) composites.push({ input: overlay, left: 0, top: 0 });

    for (const point of scene.points) {
        const pin = markers[point.index];
        if (!pin || t < point.appearAt) continue;

        const age = t - point.appearAt;
        const scale = age >= point.popDuration ? 1 : EASING.easeOutBack(age / point.popDuration);
        if (scale < 0.05) continue;

        // Height is derived from the rounded width, not from the scale, so the
        // cache key determines both dimensions exactly. Rounding them apart lets
        // two scales share a width but not a height, and the cached buffer then
        // no longer matches the size clipToCanvas extracts with.
        const mw = Math.max(2, Math.round(pin.width * scale));
        const mh = Math.max(2, Math.round((mw * pin.height) / pin.width));

        const key = `${point.index}:${mw}`;
        let buf = markerCache.get(key);
        if (!buf) {
            buf = (mw === pin.width && mh === pin.height)
                ? pin.buf
                : await sharp(pin.buf).resize(mw, mh).png().toBuffer();
            markerCache.set(key, buf);
        }

        const [cx, cy] = toCanvas(point.x, point.y);
        const placed = await clipToCanvas(buf, mw, mh, Math.round(cx - mw / 2), Math.round(cy - mh), W, H);
        if (placed) composites.push(placed);
    }

    let frame = sharp(baseRaw, { raw: { width: baseW, height: baseH, channels: 4 } })
        .extract({ left, top, width: cw, height: ch })
        .resize(W, H, { fit: 'fill' });

    if (composites.length) frame = frame.composite(composites);
    return frame.removeAlpha().raw().toBuffer();   // rgb24 for the encoder
}

// ─── Encoding ────────────────────────────────────────────────────────────────

async function writeFrame(stream, buf) {
    if (!stream.write(buf)) await once(stream, 'drain');
}

export async function encodeMp4(ctx) {
    const { scene } = ctx;
    const { width: W, height: H, fps } = scene.canvas;
    const outPath = join(tmpdir(), `arc-${randomUUID()}.mp4`);
    const total = Math.max(1, Math.round(scene.duration * fps));

    const ff = spawn('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0',
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath,
    ]);

    const spawnFailed = new Promise((_, reject) => ff.on('error', (err) => reject(
        err.code === 'ENOENT'
            ? new Error('ffmpeg not found on PATH — required to encode arc-journey video')
            : err,
    )));

    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d.toString(); });
    ff.stdin.on('error', () => {});   // ffmpeg exiting early surfaces via 'close'

    const closed = Promise.race([
        once(ff, 'close').then(([code]) => code),
        spawnFailed,
    ]);

    let poster = null;
    const posterAt = Math.max(0, scene.duration - scene.timing.tail * 0.5);

    try {
        for (let i = 0; i < total; i++) {
            const t = i / fps;
            const frame = await renderFrame(t, ctx);
            if (poster === null && t >= posterAt) poster = frame;
            await writeFrame(ff.stdin, frame);
        }
        ff.stdin.end();
    } catch (err) {
        ff.kill('SIGKILL');
        throw err;
    }

    const code = await closed;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.trim().slice(0, 500)}`);

    const video = await readFile(outPath);
    await unlink(outPath).catch(() => {});

    const posterPng = await sharp(poster ?? await renderFrame(scene.duration, ctx),
        { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();

    return { video, poster: posterPng, frames: total };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function renderArcJourney(scene, styleObj) {
    const started = Date.now();

    const [baseRaw, markers] = await Promise.all([
        renderBase(scene, styleObj),
        prepareMarkers(scene),
    ]);
    const baseMs = Date.now() - started;

    const ctx = { scene, baseRaw, markers, markerCache: new Map() };
    const { video, poster, frames } = await encodeMp4(ctx);

    console.log(`[arc] ${frames} frames in ${Date.now() - started}ms (base map ${baseMs}ms)`);
    return { video, poster, frames, baseRaw };
}
