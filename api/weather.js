// Weather per photo, via WeatherAPI.com.
//
// A photo that carries `taken_at` gets the conditions for the hour it was taken
// (History API); one without it falls back to current conditions (Realtime API).
// Each photo gets its own call, so one bad coordinate or date can only null that
// photo's weather, never its neighbours'.

import { describeNetworkError } from './netError.js';

const BASE_URL   = (process.env.WEATHERAPI_BASE_URL || 'https://api.weatherapi.com/v1').replace(/\/+$/, '');
const API_KEY    = (process.env.WEATHERAPI_KEY || '').trim();
const TIMEOUT_MS = parseInt(process.env.WEATHERAPI_TIMEOUT_MS || '10000', 10);
const TTL_MS     = parseInt(process.env.WEATHERAPI_TTL_MS || '600000', 10);   // 10 min
// History is a paid feature on some plans; set WEATHERAPI_HISTORY=0 to always
// ask for current conditions instead, even when a photo has taken_at.
const USE_HISTORY = !['0', 'false', 'no', 'off'].includes((process.env.WEATHERAPI_HISTORY ?? '').trim().toLowerCase());
// Every call is logged. On unless WEATHERAPI_DEBUG says otherwise:
// 1/true/yes/on enable it, 0/false/no/off quiet it, unset defaults to on.
const DEBUG      = ['1', 'true', 'yes', 'on'].includes(
    (process.env.WEATHERAPI_DEBUG ?? 'true').trim().toLowerCase());
const CACHE_MAX  = 5000;

export const EMPTY_WEATHER = {
    basis: null, time: null, temperature: null, apparent_temperature: null,
    relative_humidity: null, precipitation: null,
    weather_code: null, description: null, wind_speed: null,
};

// ~110 m — weather does not vary below that. The hour bucket keeps a photo's
// historical reading distinct from the same spot's current one.
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
const toIso = (epochSeconds) => (epochSeconds == null ? null : new Date(epochSeconds * 1000).toISOString());

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

// WeatherAPI reports the same measures under its own names on both endpoints.
function shape(block, basis) {
    if (!block) return null;
    return {
        basis,
        time:                 toIso(block.time_epoch ?? block.last_updated_epoch),
        temperature:          block.temp_c ?? null,
        apparent_temperature: block.feelslike_c ?? null,
        relative_humidity:    block.humidity ?? null,
        precipitation:        block.precip_mm ?? null,
        weather_code:         block.condition?.code ?? null,
        description:          block.condition?.text ?? null,
        wind_speed:           block.wind_kph ?? null,
    };
}

async function call(path, params) {
    const url = new URL(`${BASE_URL}/${path}`);
    url.searchParams.set('key', API_KEY);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    // The key is a secret — never let it reach a log.
    const safeUrl = String(url).replace(encodeURIComponent(API_KEY), '***').replace(API_KEY, '***');
    if (DEBUG) console.log(`[weather] GET ${safeUrl}`);

    const started = Date.now();
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - started;

    if (!res.ok) {
        // WeatherAPI explains itself as {"error":{"code":1006,"message":"…"}}.
        const body = await res.text().catch(() => '');
        let reason = body.trim();
        try { reason = JSON.parse(body).error?.message ?? reason; } catch { /* not JSON */ }

        let code = null;
        try { code = JSON.parse(body).error?.code ?? null; } catch { /* not JSON */ }

        const err = new Error(`HTTP ${res.status} ${res.statusText}` + (reason ? ` — ${reason.slice(0, 300)}` : ''));
        err.status = res.status;
        err.notFound = code === 1006 || /no matching location/i.test(reason);
        err.url = safeUrl;
        throw err;
    }

    const json = await res.json();
    if (DEBUG) {
        const raw = JSON.stringify(json);
        console.log(`[weather] ${res.status} in ${ms}ms — raw: ${raw.length > 2000 ? `${raw.slice(0, 2000)}… (${raw.length} chars)` : raw}`);
    }
    return json;
}

// One photo, one call. Returns its weather, or null when it cannot be resolved.
export async function fetchWeatherOne(entry) {
    const lat = parseFloat(entry?.lat);
    const lon = parseFloat(entry?.lon);
    if (!isFinite(lat) || !isFinite(lon)) {
        console.warn(`[weather] NOT FETCHED ${entry?.lat},${entry?.lon} — lat/lon is missing or not a number`);
        return null;
    }

    if (!API_KEY) {
        console.warn(`[weather] NOT FETCHED ${lat},${lon} — WEATHERAPI_KEY is not set`);
        return null;
    }

    const hourMs = USE_HISTORY ? parseTakenAt(entry?.taken_at) : null;
    const key = cacheKey(lat, lon, hourMs);
    const hit = cacheGet(key);
    if (hit !== undefined) {
        console.log(`[weather] FETCHED ${key} from cache — ${hit ? `${hit.temperature}°C ${hit.description}` : 'no data'}`);
        return hit;
    }

    const startedAll = Date.now();
    const q = `${lat},${lon}`;

    try {
        let weather;
        if (hourMs === null) {
            const json = await call('current.json', { q, aqi: 'no' });
            weather = shape(json?.current, 'current');
        } else {
            // `dt`/`hour` are local to the queried place, and taken_at is absolute,
            // so ask for the whole UTC day and match on the absolute epoch instead.
            const dt = new Date(hourMs).toISOString().slice(0, 10);
            const json = await call('history.json', { q, dt });
            const hours = json?.forecast?.forecastday?.[0]?.hour ?? [];
            const want = hourMs / 1000;
            let block = hours.find((h) => h.time_epoch === want);
            if (!block && hours.length) {
                // Local and UTC days can disagree at the edges; take the nearest hour.
                block = hours.reduce((a, b) => (Math.abs(a.time_epoch - want) <= Math.abs(b.time_epoch - want) ? a : b));
                if (DEBUG) console.log(`[weather] exact hour not in ${dt}; nearest is ${toIso(block.time_epoch)}`);
            }
            weather = shape(block, 'taken_at');
        }

        const took = Date.now() - startedAll;
        if (weather) {
            cacheSet(key, weather);
            console.log(`[weather] FETCHED ${key} (${weather.basis}) in ${took}ms — ${weather.temperature}°C, feels ${weather.apparent_temperature}°C, ${weather.description}, humidity ${weather.relative_humidity}%, wind ${weather.wind_speed}km/h`);
            if (DEBUG) console.log(`[weather]   mapped: ${JSON.stringify(weather)}`);
        } else {
            console.log(`[weather] no reading for ${key} (${took}ms) — leaving it blank`);
        }
        return weather;
    } catch (err) {
        const took = Date.now() - startedAll;
        if (err.notFound) {
            // Not a fault: the service simply has nothing for this coordinate.
            console.log(`[weather] no reading for ${key} (${took}ms) — leaving it blank`);
            return null;
        }
        console.warn(`[weather] NOT FETCHED ${key} (${hourMs === null ? 'current' : 'history'}) in ${took}ms — ${err.message}`);
        if (err.url) console.warn(`[weather]   url:   ${err.url}`);
        if (!err.status) console.warn(`[weather]   cause: ${describeNetworkError(err)}`);
        return null;   // one photo's weather, not the whole render
    }
}

// Resolves weather for a list of {lat, lon, taken_at?}, aligned with the input.
// One call per photo, in order.
export async function fetchWeather(entries = []) {
    const list = Array.isArray(entries) ? entries : [];
    const out = [];
    for (const entry of list) out.push(await fetchWeatherOne(entry));
    return out;
}
