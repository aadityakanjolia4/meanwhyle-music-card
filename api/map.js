import { Router } from 'express';
import { isS3Url, getFromS3 } from './s3.js';
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
                .catch(() => callback());
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

async function build3dTerrainStyle(exaggeration = 1, isEox = false) {
    const baseSource = isEox
        ? {
            type: 'raster',
            tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'],
            tileSize: 256,
            attribution: '&copy; EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)',
            maxzoom: 15
          }
        : {
            type: 'raster',
            tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap Contributors',
            maxzoom: 19
          };

    return {
        version: 8,
        sources: {
            osm: baseSource,
            terrainSource:   { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json' },
            hillshadeSource: { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json' }
        },
        layers: [
            { id: 'osm',  type: 'raster',     source: 'osm' },
            {
                id: 'hills', type: 'hillshade', source: 'hillshadeSource',
                layout: { visibility: 'visible' },
                paint:  { 'hillshade-shadow-color': '#473B24' }
            }
        ],
        terrain: { source: 'terrainSource', exaggeration },
        sky: {}
    };
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

// ─── Marker helpers ───────────────────────────────────────────────────────────

function latLonToPixel(lat, lon, centerLat, centerLon, zoom, width, height) {
    const scale = 512 * Math.pow(2, zoom);
    const mercX = (l) => (l + 180) / 360;
    const mercY = (l) => {
        const sin = Math.sin(l * Math.PI / 180);
        return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    };
    return {
        x: Math.round(width  / 2 + (mercX(lon) - mercX(centerLon)) * scale),
        y: Math.round(height / 2 + (mercY(lat) - mercY(centerLat)) * scale),
    };
}

async function buildMarker(imageBuf, markerWidth = 120) {
    const markerHeight = Math.round(markerWidth * 4 / 3); // 3:4 ratio
    const border       = 3;
    const radius       = 6;
    const pointerH     = 15;
    const totalHeight  = markerHeight + pointerH;
    const innerW       = markerWidth  - border * 2;
    const innerH       = markerHeight - border * 2;
    const cx           = markerWidth  / 2;

    // Clip image to inner rounded rectangle
    const maskPng = await sharp(Buffer.from(
        `<svg width="${innerW}" height="${innerH}" xmlns="http://www.w3.org/2000/svg"><rect width="${innerW}" height="${innerH}" rx="${radius - border}" fill="white"/></svg>`
    )).png().toBuffer();

    const clipped = await sharp(imageBuf)
        .resize(innerW, innerH, { fit: 'cover' })
        .ensureAlpha()
        .composite([{ input: maskPng, blend: 'dest-in' }])
        .png()
        .toBuffer();

    // SVG frame: red border rect + hollow pointer triangle
    const framePng = await sharp(Buffer.from(
        `<svg width="${markerWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
            <rect x="1.5" y="1.5" width="${markerWidth - 3}" height="${markerHeight - 3}"
                  rx="${radius}" fill="none" stroke="red" stroke-width="3"/>
            <polygon points="${cx - 12},${markerHeight} ${cx + 12},${markerHeight} ${cx},${totalHeight}" fill="red"/>
            <polygon points="${cx - 9},${markerHeight} ${cx + 9},${markerHeight} ${cx},${markerHeight + 12}" fill="white"/>
        </svg>`
    )).png().toBuffer();

    const buf = await sharp({
        create: { width: markerWidth, height: totalHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
    .composite([
        { input: clipped,   left: border, top: border },
        { input: framePng,  left: 0,      top: 0      },
    ])
    .png()
    .toBuffer();

    return { buf, width: markerWidth, height: totalHeight };
}

export async function compositeMarkers(mapPng, markers, { lat: centerLat, lon: centerLon, zoom, width, height }) {
    if (!markers || markers.length === 0) return mapPng;

    const composites = [];

    for (const marker of markers) {
        if (!marker || typeof marker.image !== 'string') continue;

        const { x, y } = latLonToPixel(
            parseFloat(marker.lat), parseFloat(marker.lon),
            centerLat, centerLon, zoom, width, height,
        );

        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        let imageBuf;
        try {
            if (isS3Url(marker.image)) {
                imageBuf = await getFromS3(marker.image);
            } else if (marker.image.startsWith('http')) {
                const resp = await fetch(marker.image);
                if (!resp.ok) {
                    console.warn(`[marker] HTTP ${resp.status} for ${marker.image} — skipping`);
                    continue;
                }
                const ct = resp.headers.get('content-type') || '';
                if (!ct.startsWith('image/')) {
                    console.warn(`[marker] Non-image content-type "${ct}" for ${marker.image} — skipping`);
                    continue;
                }
                imageBuf = Buffer.from(await resp.arrayBuffer());
            } else {
                const b64 = marker.image.includes(',') ? marker.image.split(',')[1] : marker.image;
                imageBuf = Buffer.from(b64, 'base64');
            }
        } catch (err) {
            console.warn(`[marker] Failed to fetch image: ${err.message} — skipping`);
            continue;
        }

        let markerBuf, mw, mh;
        try {
            ({ buf: markerBuf, width: mw, height: mh } = await buildMarker(imageBuf, marker.size ?? 80));
        } catch (err) {
            console.warn(`[marker] Failed to build marker (unsupported format?): ${err.message} — skipping`);
            continue;
        }

        composites.push({
            input: markerBuf,
            left:  Math.max(0, x - Math.floor(mw / 2)),
            top:   Math.max(0, y - mh),
        });
    }

    if (composites.length === 0) return mapPng;
    return sharp(mapPng).composite(composites).png().toBuffer();
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

// ─── POST terrain handler (with markers) ─────────────────────────────────────

async function handleTerrainPost(req, res, styleFn) {
    try {
        const body = req.body || {};
        const lat  = parseFloat(body.lat);
        const lon  = parseFloat(body.lon);
        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: 'lat and lon are required' });
        }

        const zoom         = clamp(parseFloat(body.zoom         ?? 10),  0,   22);
        const width        = clamp(parseInt (body.width         ?? 512), 32, 4096);
        const height       = clamp(parseInt (body.height        ?? 512), 32, 4096);
        const bearing      = parseFloat(body.bearing ?? 0);
        const pitch        = clamp(parseFloat(body.pitch        ?? 60),  0,   85);
        const exaggeration = clamp(parseFloat(body.exaggeration ?? 1),   0,   10);
        const markers      = Array.isArray(body.markers) ? body.markers.flat() : [];

        const style  = await styleFn(exaggeration);
        const buffer = await renderMap({ zoom, width, height, center: [lon, lat], bearing, pitch }, style);

        let mapPng = await sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
        mapPng = await compositeMarkers(mapPng, markers, { lat, lon, zoom, width, height });

        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=300');
        res.send(mapPng);
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
router.post('/terrain',          (req, res) => handleTerrainPost(req, res, buildTerrainStyle));
router.get('/terrain/style',     async (req, res) => {
    try { res.json(await buildTerrainStyle(clamp(parseFloat(req.query.exaggeration ?? 1), 0, 10))); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/satellite-terrain',  (req, res) => handleTerrainRender(req, res, buildSatelliteTerrainStyle));
router.post('/satellite-terrain', (req, res) => handleTerrainPost(req, res, buildSatelliteTerrainStyle));
router.get('/satellite-terrain/style', async (req, res) => {
    try { res.json(await buildSatelliteTerrainStyle(clamp(parseFloat(req.query.exaggeration ?? 1), 0, 10))); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

export { buildTerrainStyle, buildSatelliteTerrainStyle, build3dTerrainStyle, renderMap, clamp };
export default router;
