// Hands each photo's place and weather to the meanwhyle backend, which stores
// it against the photo's media asset. This service keeps no database of its own.
//
// Only photos that arrived with a media id are sent: without one there is no
// row to attach the data to. Like the lookups themselves, a failed hand-off is
// logged and never fails the render.

const BASE_URL   = (process.env.MEANWHYLE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const TOKEN      = (process.env.MEANWHYLE_SERVICE_TOKEN || '').trim();
const TIMEOUT_MS = parseInt(process.env.MEANWHYLE_TIMEOUT_MS || '8000', 10);

// A point's media id: `media_id`, else `id` / `image_id` when the caller sent
// one. Never the array index — that would attach data to an unrelated photo,
// so a point already parsed to `media_id: null` stays null.
export function mediaIdOf(point) {
    if (!point) return null;
    const raw = 'media_id' in point ? point.media_id : (point.id ?? point.image_id);
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// points: the request's photos ({lat, lon, taken_at, media_id|id}); geo: the
// matching buildImageGeoData() entries, same order. Resolves to the number of
// rows meanwhyle saved, or null when nothing was sent or the call failed.
export async function saveGeoData({ userId, postId, source, points = [], geo = [] }) {
    if (!BASE_URL || !TOKEN) return null;   // not configured: rendering still works

    const items = [];
    points.forEach((p, i) => {
        const mediaId = mediaIdOf(p);
        if (mediaId === null || !geo[i]) return;
        const { id: _id, ...place } = geo[i];
        items.push({
            media_id: mediaId,
            lat: parseFloat(p.lat),
            lon: parseFloat(p.lon),
            taken_at: p.taken_at ?? null,
            ...place,
        });
    });
    if (!items.length) return null;

    try {
        const res = await fetch(`${BASE_URL}/api/media/internal/geo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${TOKEN}`,
            },
            // Placeholder post ids ("000") are sent as null rather than stored as 0.
            body: JSON.stringify({ user_id: Number(userId), post_id: Number(postId) > 0 ? Number(postId) : null, source, items }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`meanwhyle responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const json = await res.json();
        return json.saved ?? null;
    } catch (err) {
        console.warn(`[meanwhyle] geo save failed for user ${userId} post ${postId}: ${err.message}`);
        return null;
    }
}
