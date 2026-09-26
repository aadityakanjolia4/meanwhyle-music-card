// Reverse geocoding via Nominatim (OpenStreetMap).
//
// Nominatim's usage policy caps anonymous clients at 1 request/second and
// requires a real User-Agent, so every live lookup goes through a serialized
// queue and results are cached by rounded coordinate. A failed lookup yields
// null for that photo rather than failing the whole render.

import { fetchWeather, EMPTY_WEATHER } from './weather.js';

const BASE_URL   = (process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'music_card/1.0 (+https://meanwhyle-music-card.onrender.com)';
const MIN_GAP_MS = parseInt(process.env.NOMINATIM_MIN_GAP_MS || '1100', 10);
const TIMEOUT_MS = parseInt(process.env.NOMINATIM_TIMEOUT_MS || '10000', 10);
const CACHE_MAX  = 5000;

// ~1.1 m of precision — fine enough that two photos of the same spot share an entry.
const cacheKey = (lat, lon) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

const cache = new Map();

function cacheGet(key) {
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    cache.delete(key);       // re-insert so the Map stays LRU-ordered
    cache.set(key, value);
    return value;
}

function cacheSet(key, value) {
    cache.set(key, value);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Serializes live requests and spaces them MIN_GAP_MS apart.
let queue = Promise.resolve();
let lastCallAt = 0;

function schedule(task) {
    const run = queue.then(async () => {
        const wait = lastCallAt + MIN_GAP_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastCallAt = Date.now();
        return task();
    });
    queue = run.catch(() => {});   // one failure must not poison the queue
    return run;
}

async function fetchNominatim(lat, lon, { poi }) {
    const url = new URL(`${BASE_URL}/reverse`);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('format', 'jsonv2');
    if (poi) url.searchParams.set('layer', 'poi');

    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);

    const json = await res.json();
    return json && json.error ? null : json;
}

// Nominatim returns the flat address parts under different keys depending on
// how the place is administered — a village has no `city`, a metro has no `town`.
function pickCity(address = {}) {
    return address.city
        || address.town
        || address.village
        || address.municipality
        || address.suburb
        || address.county
        || null;
}

function shape(json) {
    if (!json) return null;
    const address = json.address || {};
    return {
        name:         json.name || null,
        display_name: json.display_name || null,
        city:         pickCity(address),
        state:        address.state || address.state_district || null,
        country:      address.country || null,
        postcode:     address.postcode || null,
    };
}

// Resolves one coordinate to a place, or null when it cannot be geocoded.
export async function reverseGeocode(lat, lon) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (!isFinite(latNum) || !isFinite(lonNum)) return null;

    const key = cacheKey(latNum, lonNum);
    const hit = cacheGet(key);
    if (hit !== undefined) return hit;

    const pending = schedule(async () => {
        // layer=poi gives the nearest named place, but returns nothing away from
        // one — fall back to the plain lookup so rural photos still get an address.
        let json = await fetchNominatim(latNum, lonNum, { poi: true });
        if (!json) json = await fetchNominatim(latNum, lonNum, { poi: false });
        return shape(json);
    }).catch((err) => {
        console.warn(`[geo] reverse lookup failed for ${key}: ${err.message}`);
        cache.delete(key);   // transient failure — let the next request retry
        return null;
    });

    cacheSet(key, pending);
    const result = await pending;
    if (cacheGet(key) !== undefined) cacheSet(key, result);
    return result;
}

const EMPTY_PLACE = {
    name: null, display_name: null, city: null,
    state: null, country: null, postcode: null,
};

// Builds image_geo_data: one entry per photo, in input order, each carrying the
// photo's `id` alongside its place and current weather. A photo that cannot be
// resolved still gets an entry with null fields, so the list always lines up
// with the input.
export async function buildImageGeoData(entries = []) {
    const list = Array.isArray(entries) ? entries : [];

    // Geocoding is serialized at 1 req/s; weather is one batched call. Run both
    // families concurrently so the slower one sets the pace.
    const [places, weather] = await Promise.all([
        Promise.all(list.map((e) => reverseGeocode(e?.lat, e?.lon))),
        fetchWeather(list),
    ]);

    return list.map((entry, i) => ({
        id: entry?.id ?? i,
        ...(places[i] || EMPTY_PLACE),
        weather: weather[i] || EMPTY_WEATHER,
    }));
}
