import { Router } from 'express';
import mbgl from '@maplibre/maplibre-gl-native';
import sharp from 'sharp';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// ─── Logging ─────────────────────────────────────────────────────────────────

mbgl.on('message', (msg) => {
    const level = msg.severity === 'ERROR' ? 'error' : 'log';
    console[level](`[MapLibre] [${msg.class}] ${msg.text}`);
});

// ─── Style ───────────────────────────────────────────────────────────────────

let DEFAULT_STYLE;

function loadStyle() {
    const stylePath = process.env.MAPLIBRE_STYLE_PATH
        || join(__dirname, '..', 'styles', 'basic.json');

    if (existsSync(stylePath)) {
        DEFAULT_STYLE = JSON.parse(readFileSync(stylePath, 'utf8'));
        console.log(`[config] Loaded style from ${stylePath}`);
    } else {
        DEFAULT_STYLE = {
            version: 8,
            name: 'OSM Raster',
            sources: {
                'osm-raster': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                }
            },
            layers: [
                {
                    id: 'osm-raster',
                    type: 'raster',
                    source: 'osm-raster',
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        };
        console.log('[config] Using built-in OSM raster style');
    }
}

loadStyle();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function parseCenter(raw) {
    if (!raw) return [0, 0];
    const parts = raw.split(',').map(Number);
    if (parts.length !== 2 || parts.some(isNaN)) {
        throw new Error('center must be "lat,lon" (e.g. "28.6139,77.2090")');
    }
    const [lat, lon] = parts;
    return [lon, lat];
}

function resolveCenter({ lat, lon, center }) {
    if (lat !== undefined && lon !== undefined) {
        return [parseFloat(lon), parseFloat(lat)];
    }
    return parseCenter(center);
}

// ─── Core render function ─────────────────────────────────────────────────────

function createMap() {
    return new mbgl.Map({
        request(req, callback) {
            fetch(req.url, {
                headers: { 'User-Agent': 'maplibre-render-service/1.0' }
            })
                .then(async (res) => {
                    if (res.status === 204 || res.status === 404) return callback();
                    if (!res.ok) return callback(new Error(`HTTP ${res.status} for ${req.url}`));

                    const data = Buffer.from(await res.arrayBuffer());
                    const response = { data };

                    if (res.headers.get('last-modified')) response.modified = new Date(res.headers.get('last-modified'));
                    if (res.headers.get('expires'))       response.expires  = new Date(res.headers.get('expires'));
                    if (res.headers.get('etag'))          response.etag     = res.headers.get('etag');

                    callback(null, response);
                })
                .catch((err) => callback(err));
        },
        ratio: 1
    });
}

function renderMap(options, style = null) {
    return new Promise((resolve, reject) => {
        const map = createMap();
        map.load(style || DEFAULT_STYLE);
        map.render(options, (err, buffer) => {
            map.release();
            if (err) return reject(err);
            resolve(buffer);
        });
    });
}

// ─── Terrain style builders ───────────────────────────────────────────────────

async function fetchBaseStyle() {
    const resp = await fetch('https://tiles.openfreemap.org/styles/bright');
    if (!resp.ok) throw new Error(`Failed to fetch OpenFreeMap bright style: HTTP ${resp.status}`);
    const style = await resp.json();

    style.sources = {
        ...style.sources,
        terrainSource:   { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json' },
        hillshadeSource: { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json' }
    };

    return style;
}

async function buildTerrainStyle(exaggeration = 1) {
    const style = await fetchBaseStyle();
    style.terrain = { source: 'terrainSource', exaggeration };
    style.sky = { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 2, 0] };
    style.layers.push({
        id: 'hills', type: 'hillshade', source: 'hillshadeSource',
        layout: { visibility: 'visible' },
        paint: { 'hillshade-shadow-color': '#473B24' }
    });
    return style;
}

async function buildSatelliteTerrainStyle(exaggeration = 1) {
    const style = await fetchBaseStyle();

    style.sources.satelliteSource = {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics'
    };

    style.terrain = { source: 'terrainSource', exaggeration };
    style.sky = { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 2, 0] };
    style.layers.push({
        id: 'hills', type: 'hillshade', source: 'hillshadeSource',
        layout: { visibility: 'visible' },
        paint: { 'hillshade-shadow-color': '#473B24' }
    });

    const satelliteLayer = {
        id: 'satellite', type: 'raster', source: 'satelliteSource',
        layout: { visibility: 'visible' },
        paint: { 'raster-opacity': 1 }
    };
    const firstNonFillIdx = style.layers.findIndex(
        (l) => l.type !== 'fill' && l.type !== 'background'
    );
    if (firstNonFillIdx === -1) {
        style.layers.unshift(satelliteLayer);
    } else {
        style.layers.splice(firstNonFillIdx, 0, satelliteLayer);
    }

    return style;
}

// ─── Shared terrain render handler ───────────────────────────────────────────

async function handleTerrainRender(req, res, styleFn) {
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);
        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: 'lat and lon query params are required' });
        }

        const zoom         = clamp(parseFloat(req.query.zoom         ?? 10),  0,   22);
        const width        = clamp(parseInt (req.query.width         ?? 512), 32, 4096);
        const height       = clamp(parseInt (req.query.height        ?? 512), 32, 4096);
        const bearing      = parseFloat(req.query.bearing ?? 0);
        const pitch        = clamp(parseFloat(req.query.pitch        ?? 60),  0,   85);
        const exaggeration = clamp(parseFloat(req.query.exaggeration ?? 1),   0,   10);
        const format       = ['png', 'jpeg'].includes(req.query.format) ? req.query.format : 'png';
        const quality      = clamp(parseInt(req.query.quality ?? 85), 1, 100);

        const style  = await styleFn(exaggeration);
        const buffer = await renderMap({ zoom, width, height, center: [lon, lat], bearing, pitch }, style);

        const image = sharp(buffer, { raw: { width, height, channels: 4 } });
        if (format === 'jpeg') {
            res.set('Content-Type', 'image/jpeg');
            res.set('Cache-Control', 'public, max-age=300');
            res.send(await image.jpeg({ quality }).toBuffer());
        } else {
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=300');
            res.send(await image.png().toBuffer());
        }
    } catch (err) {
        console.error(`[${req.path} error]`, err);
        res.status(500).json({ error: err.message });
    }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

router.get('/render', async (req, res) => {
    try {
        const zoom    = clamp(parseFloat(req.query.zoom    ?? 0),   0,    22);
        const width   = clamp(parseInt (req.query.width   ?? 512),  32, 4096);
        const height  = clamp(parseInt (req.query.height  ?? 512),  32, 4096);
        const bearing = parseFloat(req.query.bearing ?? 0);
        const pitch   = clamp(parseFloat(req.query.pitch   ?? 0),   0,    60);
        const center  = resolveCenter(req.query);
        const format  = ['png', 'jpeg'].includes(req.query.format) ? req.query.format : 'png';
        const quality = clamp(parseInt(req.query.quality ?? 80), 1, 100);

        const buffer = await renderMap({ zoom, width, height, bearing, pitch, center });
        const image  = sharp(buffer, { raw: { width, height, channels: 4 } });

        if (format === 'jpeg') {
            res.set('Content-Type', 'image/jpeg');
            res.set('Cache-Control', 'public, max-age=60');
            res.send(await image.jpeg({ quality }).toBuffer());
        } else {
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=60');
            res.send(await image.png().toBuffer());
        }
    } catch (err) {
        console.error('[render error]', err);
        res.status(400).json({ error: err.message });
    }
});

router.post('/render', async (req, res) => {
    try {
        const body    = req.body || {};
        const zoom    = clamp(parseFloat(body.zoom    ?? 0),   0,    22);
        const width   = clamp(parseInt (body.width   ?? 512),  32, 4096);
        const height  = clamp(parseInt (body.height  ?? 512),  32, 4096);
        const bearing = parseFloat(body.bearing ?? 0);
        const pitch   = clamp(parseFloat(body.pitch   ?? 0),   0,    60);
        const style   = body.style || null;

        let center;
        if (body.lat !== undefined && body.lon !== undefined) {
            center = [parseFloat(body.lon), parseFloat(body.lat)];
        } else if (Array.isArray(body.center)) {
            center = [body.center[1], body.center[0]];
        } else {
            center = parseCenter(body.center);
        }

        const buffer = await renderMap({ zoom, width, height, bearing, pitch, center }, style);
        const png    = await sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();

        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        res.send(png);
    } catch (err) {
        console.error('[render error]', err);
        res.status(400).json({ error: err.message });
    }
});

router.get('/style', (_req, res) => res.json(DEFAULT_STYLE));

router.get('/terrain',           (req, res) => handleTerrainRender(req, res, buildTerrainStyle));
router.get('/terrain/style',     async (req, res) => {
    try { res.json(await buildTerrainStyle(clamp(parseFloat(req.query.exaggeration ?? 1), 0, 10))); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/satellite-terrain', (req, res) => handleTerrainRender(req, res, buildSatelliteTerrainStyle));
router.get('/satellite-terrain/style', async (req, res) => {
    try { res.json(await buildSatelliteTerrainStyle(clamp(parseFloat(req.query.exaggeration ?? 1), 0, 10))); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
