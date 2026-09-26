// Weather per photo, via Open-Meteo.
//
// A photo that carries `taken_at` gets the hourly conditions for the hour it
// was taken; one without it falls back to the current conditions. Open-Meteo
// accepts comma-separated coordinates and answers with one result per
// location, so each group of photos resolves in a single call.
//
// Recent hours come from the forecast API (it keeps ~3 months of past data);
// anything older goes to the historical archive (ERA5), which lags by ~5 days
// and so cannot serve the recent window itself.

const BASE_URL    = (process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com/v1/forecast').replace(/\/+$/, '');
const ARCHIVE_URL = (process.env.OPEN_METEO_ARCHIVE_URL || 'https://archive-api.open-meteo.com/v1/archive').replace(/\/+$/, '');
const RECENT_DAYS = parseInt(process.env.OPEN_METEO_RECENT_DAYS || '85', 10);   // forecast API keeps 92
const TIMEOUT_MS = parseInt(process.env.OPEN_METEO_TIMEOUT_MS || '10000', 10);
const TTL_MS     = parseInt(process.env.OPEN_METEO_TTL_MS || '600000', 10);   // 10 min
// Every outgoing call is logged. On unless OPEN_METEO_DEBUG says otherwise:
// 1/true/yes/on enable it, 0/false/no/off quiet it, unset defaults to on.
const DEBUG      = ['1', 'true', 'yes', 'on'].includes(
    (process.env.OPEN_METEO_DEBUG ?? 'true').trim().toLowerCase());
const BATCH_MAX  = 50;                                                        // keep the query string sane
const CACHE_MAX  = 5000;

const FIELDS = [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
];

// WMO weather interpretation codes.
const WMO = {
    0: 'Clear sky',
    1: 'Mainly clear',           2: 'Partly cloudy',            3: 'Overcast',
    45: 'Fog',                   48: 'Depositing rime fog',
    51: 'Light drizzle',         53: 'Moderate drizzle',        55: 'Dense drizzle',
    56: 'Light freezing drizzle',57: 'Dense freezing drizzle',
    61: 'Slight rain',           63: 'Moderate rain',           65: 'Heavy rain',
    66: 'Light freezing rain',   67: 'Heavy freezing rain',
    71: 'Slight snow fall',      73: 'Moderate snow fall',      75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',   81: 'Moderate rain showers',   82: 'Violent rain showers',
    85: 'Slight snow showers',   86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
};

export const EMPTY_WEATHER = {
    basis: null, time: null, temperature: null, apparent_temperature: null,
    relative_humidity: null, precipitation: null,
    weather_code: null, description: null, wind_speed: null,
};

// ~110 m — weather does not vary below that. Historical entries also key on the hour.
const cacheKey = (lat, lon, hour = null) => `${lat.toFixed(3)},${lon.toFixed(3)}${hour === null ? '' : `@${hour}`}`;
const cache = new Map();

function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return undefined; }
    return hit.value;
}

function cacheSet(key, value) {
    cache.set(key, { at: Date.now(), value });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const HOUR_MS = 3600 * 1000;

const toIso = (unixSeconds) => (unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString());

function describe(code) {
    return WMO[code] ?? null;
}

// `current` block of a response. Times are requested as unix seconds in UTC.
function shapeCurrent(result) {
    const c = result?.current;
    if (!c) return null;
    return {
        basis:                'current',
        time:                 toIso(c.time),
        temperature:          c.temperature_2m ?? null,
        apparent_temperature: c.apparent_temperature ?? null,
        relative_humidity:    c.relative_humidity_2m ?? null,
        precipitation:        c.precipitation ?? null,
        weather_code:         c.weather_code ?? null,
        description:          describe(c.weather_code),
        wind_speed:           c.wind_speed_10m ?? null,
    };
}

// One hour out of an `hourly` block — the slot that starts at `hourMs`.
function shapeHour(result, hourMs) {
    const h = result?.hourly;
    if (!h || !Array.isArray(h.time)) return null;
    const idx = h.time.indexOf(hourMs / 1000);
    if (idx < 0) return null;
    const at = (field) => (Array.isArray(h[field]) ? h[field][idx] ?? null : null);
    if (at('temperature_2m') === null && at('weather_code') === null) return null;   // archive not filled in yet
    return {
        basis:                'taken_at',
        time:                 toIso(h.time[idx]),
        temperature:          at('temperature_2m'),
        apparent_temperature: at('apparent_temperature'),
        relative_humidity:    at('relative_humidity_2m'),
        precipitation:        at('precipitation'),
        weather_code:         at('weather_code'),
        description:          describe(at('weather_code')),
        wind_speed:           at('wind_speed_10m'),
    };
}

// taken_at may be an ISO string or unix time (seconds or milliseconds).
// Returns the start of that UTC hour in ms, or null when absent/unparseable.
function parseTakenAt(value) {
    if (value === undefined || value === null || value === '') return null;
    let ms;
    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
        const n = Number(value);
        ms = n < 1e12 ? n * 1000 : n;
    } else {
        ms = Date.parse(String(value));
    }
    if (!isFinite(ms)) return null;
    return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

// One call for up to BATCH_MAX coordinates; returns results in request order.
// `range` switches from current conditions to the hourly series of one UTC day.
async function fetchBatch(coords, range = null) {
    const url = new URL(range ? range.baseUrl : BASE_URL);
    url.searchParams.set('latitude',  coords.map((c) => c.lat).join(','));
    url.searchParams.set('longitude', coords.map((c) => c.lon).join(','));
    if (range) {
        url.searchParams.set('hourly', FIELDS.join(','));
        url.searchParams.set('start_date', range.date);
        url.searchParams.set('end_date', range.date);
    } else {
        url.searchParams.set('current', FIELDS.join(','));
    }
    // UTC throughout, so `time` means the same thing for every photo and the
    // requested day is the UTC day the hour falls in.
    url.searchParams.set('timezone', 'GMT');
    url.searchParams.set('timeformat', 'unixtime');

    if (DEBUG) console.log(`[weather] GET ${url}`);

    const started = Date.now();
    const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
        // Open-Meteo explains itself in the body ({"error":true,"reason":"…"});
        // the status alone rarely says which parameter it objected to.
        const body = await res.text().catch(() => '');
        let reason = body.trim();
        try { reason = JSON.parse(body).reason ?? reason; } catch { /* not JSON */ }

        const retryAfter = res.headers.get('retry-after');
        const err = new Error(
            `HTTP ${res.status} ${res.statusText}`
            + (reason ? ` — ${reason.slice(0, 300)}` : '')
            + (retryAfter ? ` (retry-after: ${retryAfter})` : '')
        );
        err.status = res.status;
        err.url = String(url);
        throw err;
    }

    const json = await res.json();
    if (DEBUG) console.log(`[weather] ${res.status} in ${Date.now() - started}ms for ${coords.length} location(s)`);
    // A single coordinate comes back as an object, several as an array.
    return Array.isArray(json) ? json : [json];
}

// Resolves weather for a list of {lat, lon, taken_at?}, aligned with the input.
// Entries that cannot be resolved come back as null.
export async function fetchWeather(entries = []) {
    const list = Array.isArray(entries) ? entries : [];
    const out = new Array(list.length).fill(null);

    // Group what the cache cannot answer by the request that will fetch it:
    // "current", or one (API, UTC day) pair per distinct day of photos.
    const groups = new Map();
    list.forEach((e, i) => {
        const lat = parseFloat(e?.lat);
        const lon = parseFloat(e?.lon);
        if (!isFinite(lat) || !isFinite(lon)) return;

        const hourMs = parseTakenAt(e?.taken_at);
        const key = cacheKey(lat, lon, hourMs);
        const hit = cacheGet(key);
        if (hit !== undefined) { out[i] = hit; return; }

        let groupKey = 'current';
        let range = null;
        if (hourMs !== null) {
            const date = new Date(hourMs).toISOString().slice(0, 10);
            const recent = Date.now() - hourMs < RECENT_DAYS * 24 * HOUR_MS;
            range = { date, baseUrl: recent ? BASE_URL : ARCHIVE_URL };
            groupKey = `${range.baseUrl}|${date}`;
        }
        if (!groups.has(groupKey)) groups.set(groupKey, { range, byKey: new Map() });

        // Distinct coordinates only — repeated locations share one slot in the call.
        const byKey = groups.get(groupKey).byKey;
        if (!byKey.has(key)) byKey.set(key, { lat, lon, hourMs, targets: [] });
        byKey.get(key).targets.push(i);
    });

    await Promise.all([...groups.values()].map(async ({ range, byKey }) => {
        const unique = [...byKey.entries()];
        for (let start = 0; start < unique.length; start += BATCH_MAX) {
            const chunk = unique.slice(start, start + BATCH_MAX);
            try {
                const results = await fetchBatch(chunk.map(([, v]) => v), range);
                chunk.forEach(([key, v], n) => {
                    const weather = range ? shapeHour(results[n], v.hourMs) : shapeCurrent(results[n]);
                    if (weather) cacheSet(key, weather);
                    v.targets.forEach((i) => { out[i] = weather; });
                });
            } catch (err) {
                const what = range ? `${range.date} (${range.baseUrl.includes('archive') ? 'archive' : 'forecast'})` : 'current';
                const where = chunk.map(([, v]) => `${v.lat},${v.lon}`).join(' ');
                console.warn(`[weather] ${what} lookup failed for ${chunk.length} location(s): ${err.message}`);
                console.warn(`[weather]   coords: ${where}`);
                if (err.url) console.warn(`[weather]   url:    ${err.url}`);
                if (!err.status) console.warn(`[weather]   cause:  ${err.name}: ${err.cause?.message ?? err.message}`);
                // leave those entries null; the render must not fail over weather
            }
        }
    }));

    return out;
}
