import express from 'express';
import sharp from 'sharp';
import { initializeFonts, Bloom, Calm, Drift, Haze, Ease, Melt, BloomPortrait, CalmPortrait, DriftPortrait, HazePortrait, EasePortrait, MeltPortrait } from 'musicard';
import mapRouter, { buildTerrainStyle, buildSatelliteTerrainStyle, build3dTerrainStyle, renderMap, clamp, compositeMarkers, resolveMapStyle, loadImageSource, MAP_STYLES } from './map.js';
import { planScene } from './arc.js';
import { renderArcJourney, renderBase } from './arcVideo.js';
import { uploadToS3 } from './s3.js';
import { buildImageGeoData } from './geo.js';
import { saveGeoData, mediaIdOf } from './meanwhyle.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Request logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

initializeFonts();

// POST /user/:user_id/post/:post_id
app.post('/user/:user_id/post/:post_id', async (req, res) => {
    const { user_id, post_id } = req.params;
    const {
        trackName,
        artistName,
        albumArt,
        isExplicit,
        timeStart,
        timeEnd,
        progressBar,
        volumeBar,
    } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await Bloom({
            trackName,
            artistName,
            albumArt: albumArt || '',
            isExplicit: isExplicit || false,
            timeAdjust: {
                timeStart: timeStart || '0:00',
                timeEnd: timeEnd || '0:00',
            },
            progressBar: progressBar ?? 0,
            volumeBar: volumeBar ?? 50,
        });

        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/portrait
app.post('/user/:user_id/post/:post_id/portrait', async (req, res) => {
    const { user_id, post_id } = req.params;
    const {
        trackName,
        artistName,
        albumArt,
        isExplicit,
        timeStart,
        timeEnd,
        progressBar,
    } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await BloomPortrait({
            trackName,
            artistName,
            albumArt: albumArt || '',
            isExplicit: isExplicit || false,
            timeAdjust: {
                timeStart: timeStart || '0:00',
                timeEnd: timeEnd || '0:00',
            },
            progressBar: progressBar ?? 0,
        });

        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/portraitcard.png  (alias for /portrait)
app.post('/user/:user_id/post/:post_id/portraitcard.png', async (req, res) => {
    const { user_id, post_id } = req.params;
    const {
        trackName,
        artistName,
        albumArt,
        isExplicit,
        timeStart,
        timeEnd,
        progressBar,
    } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await BloomPortrait({
            trackName,
            artistName,
            albumArt: albumArt || '',
            isExplicit: isExplicit || false,
            timeAdjust: {
                timeStart: timeStart || '0:00',
                timeEnd: timeEnd || '0:00',
            },
            progressBar: progressBar ?? 0,
        });

        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/calm-portrait
app.post('/user/:user_id/post/:post_id/calm-portrait', async (req, res) => {
    const { user_id, post_id } = req.params;
    const { trackName, artistName, albumArt, timeStart, timeEnd, progressBar } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await CalmPortrait({
            trackName,
            artistName,
            albumArt: albumArt || '',
            timeAdjust: { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
            progressBar: progressBar ?? 0,
        });
        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/drift-portrait
app.post('/user/:user_id/post/:post_id/drift-portrait', async (req, res) => {
    const { user_id, post_id } = req.params;
    const { trackName, artistName, albumArt, isExplicit, timeStart, timeEnd, progressBar } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await DriftPortrait({
            trackName,
            artistName,
            albumArt: albumArt || '',
            isExplicit: isExplicit || false,
            timeAdjust: { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
            progressBar: progressBar ?? 0,
        });
        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/haze-portrait
app.post('/user/:user_id/post/:post_id/haze-portrait', async (req, res) => {
    const { user_id, post_id } = req.params;
    const { trackName, artistName, albumArt, isExplicit, timeStart, timeEnd, progressBar } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await HazePortrait({
            trackName,
            artistName,
            albumArt: albumArt || '',
            isExplicit: isExplicit || false,
            timeAdjust: { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
            progressBar: progressBar ?? 0,
        });
        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/ease-portrait
app.post('/user/:user_id/post/:post_id/ease-portrait', async (req, res) => {
    const { user_id, post_id } = req.params;
    const { trackName, artistName, albumArt, isExplicit, timeStart, timeEnd, progressBar, volumeBar } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await EasePortrait({
            trackName,
            artistName,
            albumArt: albumArt || '',
            isExplicit: isExplicit || false,
            timeAdjust: { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
            progressBar: progressBar ?? 0,
            volumeBar: volumeBar ?? 50,
        });
        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/melt-portrait
app.post('/user/:user_id/post/:post_id/melt-portrait', async (req, res) => {
    const { user_id, post_id } = req.params;
    const { trackName, artistName, albumArt, isExplicit, timeStart, timeEnd, progressBar, volumeBar } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }

    try {
        const image = await MeltPortrait({
            trackName,
            artistName,
            albumArt: albumArt || '',
            isExplicit: isExplicit || false,
            timeAdjust: { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
            progressBar: progressBar ?? 0,
            volumeBar: volumeBar ?? 50,
        });
        res.set('Content-Type', 'image/png');
        res.set('X-User-Id', user_id);
        res.set('X-Post-Id', post_id);
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Theme helpers ───────────────────────────────────────────────────────────

const CARD_THEME_MAP = {
    bloom:          (o) => Bloom(o),
    bloom_portrait: (o) => BloomPortrait(o),
    calm:           (o) => Calm(o),
    calm_portrait:  (o) => CalmPortrait(o),
    drift:          (o) => Drift(o),
    drift_portrait: (o) => DriftPortrait(o),
    haze:           (o) => Haze(o),
    haze_portrait:  (o) => HazePortrait(o),
    ease:           (o) => Ease(o),
    ease_portrait:  (o) => EasePortrait(o),
    melt:           (o) => Melt(o),
    melt_portrait:  (o) => MeltPortrait(o),
};

function generateCard(cardTheme = 'bloom', { trackName, artistName, albumArt, isExplicit, timeStart, timeEnd, progressBar, volumeBar }) {
    const opts = {
        trackName,
        artistName,
        albumArt:    albumArt   || '',
        isExplicit:  isExplicit || false,
        timeAdjust:  { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
        progressBar: progressBar ?? 0,
        volumeBar:   volumeBar   ?? 50,
    };
    const fn = CARD_THEME_MAP[cardTheme] ?? CARD_THEME_MAP.bloom;
    return fn(opts);
}


// ─── Composite: music card overlaid on map ────────────────────────────────────

async function handleCompositePost(req, res, styleFn) {
    const { user_id, post_id } = req.params;
    const {
        trackName, artistName, albumArt, isExplicit,
        timeStart, timeEnd, progressBar, volumeBar,
        lat, lon,
        zoom, pitch, bearing, width, height, exaggeration,
        markers,
    } = req.body;

    if (!trackName || !artistName) {
        return res.status(400).json({ error: 'trackName and artistName are required' });
    }
    if (lat === undefined || lon === undefined) {
        return res.status(400).json({ error: 'lat and lon are required' });
    }

    const mapWidth   = clamp(parseInt (width        ?? 800),  32, 4096);
    const mapHeight  = clamp(parseInt (height       ?? 600),  32, 4096);
    const mapZoom    = clamp(parseFloat(zoom        ?? 10),    0,   22);
    const mapPitch   = clamp(parseFloat(pitch       ?? 60),    0,   85);
    const mapBearing = parseFloat(bearing ?? 0);
    const mapExagg   = clamp(parseFloat(exaggeration ?? 1),    0,   10);

    try {
        const [style, cardBuffer] = await Promise.all([
            styleFn(mapExagg),
            Bloom({
                trackName,
                artistName,
                albumArt:    albumArt    || '',
                isExplicit:  isExplicit  || false,
                timeAdjust:  { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
                progressBar: progressBar ?? 0,
                volumeBar:   volumeBar   ?? 50,
            }),
        ]);

        const mapRaw = await renderMap(
            { zoom: mapZoom, width: mapWidth, height: mapHeight, center: [parseFloat(lon), parseFloat(lat)], bearing: mapBearing, pitch: mapPitch },
            style,
        );

        let mapPng = await sharp(mapRaw, { raw: { width: mapWidth, height: mapHeight, channels: 4 } }).png().toBuffer();
        mapPng = await compositeMarkers(mapPng, Array.isArray(markers) ? markers : [], { lat: parseFloat(lat), lon: parseFloat(lon), zoom: mapZoom, width: mapWidth, height: mapHeight });

        const [mapUrl, cardUrl] = await Promise.all([
            uploadToS3(mapPng, user_id),
            uploadToS3(cardBuffer, user_id),
        ]);

        res.json({
            user_id,
            post_id,
            map:  mapUrl,
            card: cardUrl,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

app.post('/user/:user_id/post/:post_id/terrain',           (req, res) => handleCompositePost(req, res, buildTerrainStyle));
app.post('/user/:user_id/post/:post_id/satellite-terrain', (req, res) => handleCompositePost(req, res, buildSatelliteTerrainStyle));

async function handleTerrainMarkerPost(req, res, styleFn) {
    const { user_id, post_id } = req.params;
    const {
        lat, lon,
        zoom, pitch, bearing, width, height, exaggeration,
        markers,
        trackName, artistName, albumArt, isExplicit,
        timeStart, timeEnd, progressBar, volumeBar,
    } = req.body;

    if (lat === undefined || lon === undefined) {
        return res.status(400).json({ error: 'lat and lon are required' });
    }

    const mapWidth   = clamp(parseInt (width        ?? 800),  32, 4096);
    const mapHeight  = clamp(parseInt (height       ?? 600),  32, 4096);
    const mapZoom    = clamp(parseFloat(zoom        ?? 10),    0,   22);
    const mapPitch   = clamp(parseFloat(pitch       ?? 60),    0,   85);
    const mapBearing = parseFloat(bearing ?? 0);
    const mapExagg   = clamp(parseFloat(exaggeration ?? 1),    0,   10);

    try {
        const hasCard = trackName && artistName;

        const [style, cardBuffer] = await Promise.all([
            styleFn(mapExagg),
            hasCard ? Bloom({
                trackName,
                artistName,
                albumArt:    albumArt   || '',
                isExplicit:  isExplicit || false,
                timeAdjust:  { timeStart: timeStart || '0:00', timeEnd: timeEnd || '0:00' },
                progressBar: progressBar ?? 0,
                volumeBar:   volumeBar   ?? 50,
            }) : null,
        ]);

        const mapRaw = await renderMap(
            { zoom: mapZoom, width: mapWidth, height: mapHeight, center: [parseFloat(lon), parseFloat(lat)], bearing: mapBearing, pitch: mapPitch },
            style,
        );

        let mapPng = await sharp(mapRaw, { raw: { width: mapWidth, height: mapHeight, channels: 4 } }).png().toBuffer();
        mapPng = await compositeMarkers(mapPng, Array.isArray(markers) ? markers : [], { lat: parseFloat(lat), lon: parseFloat(lon), zoom: mapZoom, width: mapWidth, height: mapHeight });

        const markerList = Array.isArray(markers) ? markers : [];
        const [uploads, imageGeoData] = await Promise.all([
            Promise.all([
                uploadToS3(mapPng, user_id),
                cardBuffer ? uploadToS3(cardBuffer, user_id) : null,
            ]),
            buildImageGeoData(markerList)
                .then((geo) => saveGeoData({ userId: user_id, postId: post_id, source: 'terrain_marker', points: markerList, geo }).then(() => geo)),
        ]);

        const response = { user_id, post_id, map: uploads[0], image_geo_data: imageGeoData };
        if (uploads[1]) response.card = uploads[1];

        res.json(response);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

app.post('/user/:user_id/post/:post_id/terrain-marker',           (req, res) => handleTerrainMarkerPost(req, res, buildTerrainStyle));
app.post('/user/:user_id/post/:post_id/satellite-terrain-marker', (req, res) => handleTerrainMarkerPost(req, res, buildSatelliteTerrainStyle));
app.post('/user/:user_id/post/:post_id/3d-terrain-marker', async (req, res) => {
    const { user_id, post_id } = req.params;
    const {
        lat, lon,
        zoom, pitch, bearing, width, height, exaggeration,
        markers,
        trackName, artistName, albumArt, isExplicit,
        timeStart, timeEnd, progressBar, volumeBar,
        is_eox,
        card_theme,
        collage_type,
    } = req.body;

    if (lat === undefined || lon === undefined) {
        return res.status(400).json({ error: 'lat and lon are required' });
    }

    const mapWidth   = clamp(parseInt (width        ?? 800),  32, 4096);
    const mapHeight  = clamp(parseInt (height       ?? 600),  32, 4096);
    const mapZoom    = clamp(parseFloat(zoom        ?? 10),    0,   22);
    const mapPitch   = clamp(parseFloat(pitch       ?? 60),    0,   85);
    const mapBearing = parseFloat(bearing ?? 0);
    const mapExagg   = clamp(parseFloat(exaggeration ?? 1),    0,   10);
    const isEox      = is_eox === true;
    const theme      = card_theme || 'bloom';

    try {
        const hasCard = trackName && artistName;

        const [style, cardBuffer] = await Promise.all([
            build3dTerrainStyle(mapExagg, isEox),
            hasCard ? generateCard(theme, { trackName, artistName, albumArt, isExplicit, timeStart, timeEnd, progressBar, volumeBar }) : null,
        ]);

        const mapRaw = await renderMap(
            { zoom: mapZoom, width: mapWidth, height: mapHeight, center: [parseFloat(lon), parseFloat(lat)], bearing: mapBearing, pitch: mapPitch },
            style,
        );

        let mapPng = await sharp(mapRaw, { raw: { width: mapWidth, height: mapHeight, channels: 4 } }).png().toBuffer();
        mapPng = await compositeMarkers(mapPng, Array.isArray(markers) ? markers : [], { lat: parseFloat(lat), lon: parseFloat(lon), zoom: mapZoom, width: mapWidth, height: mapHeight });

        const markerList = Array.isArray(markers) ? markers : [];
        const [uploads, imageGeoData] = await Promise.all([
            Promise.all([
                uploadToS3(mapPng, user_id),
                cardBuffer ? uploadToS3(cardBuffer, user_id) : null,
            ]),
            buildImageGeoData(markerList)
                .then((geo) => saveGeoData({ userId: user_id, postId: post_id, source: 'terrain_marker', points: markerList, geo }).then(() => geo)),
        ]);

        const response = { user_id, post_id, map: uploads[0], card_theme: theme, image_geo_data: imageGeoData };
        if (uploads[1]) response.card = uploads[1];
        res.json(response);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Arc journey: animated hops between photo locations ──────────────────────

class ArcError extends Error {}

// buildMarker() in map.js draws a 3:4 photo in a rounded red frame with a
// pointer below it. A client rendering the scene itself needs those numbers.
const MARKER_BORDER  = 3;
const MARKER_RADIUS  = 6;
// 15px at the 96px default; proportional so a scaled-up request (an export at
// twice the preview's size) is the same pin, not a differently shaped one.
const MARKER_POINTER_RATIO = 15 / 96;
const MARKER_COLOR         = '#FF0000';
const MARKER_POINTER_INNER = '#FFFFFF';

function parseArcRequest(body = {}) {
    const raw = Array.isArray(body.points) ? body.points : [];
    if (raw.length < 2)  throw new ArcError('points must contain at least 2 entries');
    if (raw.length > 25) throw new ArcError('points is limited to 25 entries');

    const points = raw.map((p, i) => {
        const lat = parseFloat(p?.lat);
        const lon = parseFloat(p?.lon);
        if (!isFinite(lat) || !isFinite(lon))          throw new ArcError(`points[${i}] needs numeric lat and lon`);
        if (lat < -90 || lat > 90)                     throw new ArcError(`points[${i}].lat must be between -90 and 90`);
        if (lon < -180 || lon > 180)                   throw new ArcError(`points[${i}].lon must be between -180 and 180`);
        if (typeof p.image !== 'string' || !p.image)   throw new ArcError(`points[${i}] needs an image (url, s3:// or base64)`);
        return {
            lat, lon, image: p.image, label: p.label ?? null,
            id: p.id ?? p.image_id ?? i,
            media_id: mediaIdOf(p),
            // When the photo was taken, so its weather is for that hour.
            taken_at: p.taken_at ?? null,
        };
    });

    const mapStyle = body.map_style;
    if (!MAP_STYLES.includes(mapStyle)) {
        throw new ArcError(`map_style is required and must be one of: ${MAP_STYLES.join(', ')}`);
    }

    // yuv420p needs even dimensions.
    const even = (n) => (n % 2 === 0 ? n : n - 1);
    const canvas = {
        width:  even(clamp(parseInt(body.width  ?? 1080), 160, 1920)),
        height: even(clamp(parseInt(body.height ?? 1350), 160, 1920)),
        fps:    clamp(parseInt(body.fps ?? 30), 10, 60),
    };

    const t = body.timing || {};
    const timing = {
        arc:  clamp(parseFloat(t.arc  ?? 1.2),  0.2, 10),
        pop:  clamp(parseFloat(t.pop  ?? 0.35), 0.1, 5),
        hold: clamp(parseFloat(t.hold ?? 0.5),  0,   10),
        tail: clamp(parseFloat(t.tail ?? 1.0),  0,   10),
    };

    const markerSize    = clamp(parseInt(body.marker_size ?? 96), 24, 400);
    const markerPointer = Math.max(4, Math.round(markerSize * MARKER_POINTER_RATIO));

    const a = body.arc || {};
    const style = {
        arc: {
            color:  typeof a.color === 'string' ? a.color : '#E2574C',
            width:  clamp(parseFloat(a.width ?? 4), 1, 24),
            dash:   Array.isArray(a.dash) && a.dash.length === 2
                ? a.dash.map((n) => clamp(parseFloat(n) || 1, 1, 100))
                : [12, 9],
            shadow: a.shadow !== false,
            head: {
                radius: clamp(parseFloat(a.head?.radius ?? 6),  1, 40),
                glow:   clamp(parseFloat(a.head?.glow   ?? 14), 1, 80),
            },
        },
        marker: {
            size:    markerSize,
            aspect:  0.75,
            border:  MARKER_BORDER,
            radius:  MARKER_RADIUS,
            pointer: markerPointer,
            anchor:  'bottom-center',
            color:        MARKER_COLOR,
            pointerInner: MARKER_POINTER_INNER,
        },
    };
    style.marker.height = Math.round(style.marker.size * 4 / 3) + markerPointer;

    // Base map is rendered larger than the canvas so Ken Burns crops stay sharp.
    let baseScale = clamp(parseFloat(body.base_scale ?? 1.5), 1, 3);
    baseScale = Math.min(baseScale, 4096 / canvas.width, 4096 / canvas.height);

    const scene = planScene({
        points, canvas, timing, style, baseScale,
        padding:   clamp(parseFloat(body.padding   ?? 90),   0, 600),
        curvature: clamp(parseFloat(body.curvature ?? 0.25), 0, 0.8),
        samples:   clamp(parseInt(body.samples     ?? 128),  16, 512),
        maxZoom:   clamp(parseFloat(body.max_zoom  ?? 16),   1, 22),
    });

    return {
        scene,
        points,
        mapStyle,
        exaggeration: clamp(parseFloat(body.exaggeration ?? 1), 0, 10),
        isEox: body.is_eox === true,
        inline: body.inline === true,
    };
}

// Place + weather per point (weather for each point's taken_at), stored in
// meanwhyle against its media id. Resolves to image_geo_data; never rejects
// over the save.
function geoAndSave(points, userId, postId) {
    return buildImageGeoData(points).then(async (geo) => {
        await saveGeoData({ userId, postId, source: 'arc_journey', points, geo });
        return geo;
    });
}

// POST /user/:user_id/post/:post_id/arc-journey — server-rendered MP4
app.post('/user/:user_id/post/:post_id/arc-journey', async (req, res) => {
    const { user_id, post_id } = req.params;

    let parsed;
    try {
        parsed = parseArcRequest(req.body);
    } catch (err) {
        if (err instanceof ArcError) return res.status(400).json({ error: err.message });
        throw err;
    }

    try {
        const { scene, points, mapStyle, exaggeration, isEox, inline } = parsed;
        const geoPromise = geoAndSave(points, user_id, post_id);
        const styleObj = await resolveMapStyle(mapStyle, { exaggeration, isEox });
        const { video, poster, frames } = await renderArcJourney(scene, styleObj);

        if (inline) {
            await geoPromise;   // an inline caller never sees the geo data, but meanwhyle still stores it
            res.set('Content-Type', 'video/mp4');
            res.set('Content-Disposition', `inline; filename="arc-${post_id}.mp4"`);
            return res.send(video);
        }

        const [videoUrl, posterUrl, imageGeoData] = await Promise.all([
            uploadToS3(video, user_id, 'video/mp4'),
            uploadToS3(poster, user_id),
            geoPromise,
        ]);

        res.json({
            user_id, post_id,
            arc_journey_data: {
                video: videoUrl,
                poster: posterUrl,
                duration: scene.duration,
                frames,
                map_style: mapStyle,
            },
            image_geo_data: imageGeoData,
        });
    } catch (err) {
        console.error('[arc-journey error]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /user/:user_id/post/:post_id/arc-journey/scene — scene for on-device rendering
app.post('/user/:user_id/post/:post_id/arc-journey/scene', async (req, res) => {
    const { user_id, post_id } = req.params;

    let parsed;
    try {
        parsed = parseArcRequest(req.body);
    } catch (err) {
        if (err instanceof ArcError) return res.status(400).json({ error: err.message });
        throw err;
    }

    try {
        const { scene, points, mapStyle, exaggeration, isEox, inline } = parsed;
        const geoPromise = geoAndSave(points, user_id, post_id);
        const styleObj = await resolveMapStyle(mapStyle, { exaggeration, isEox });

        const baseRaw = await renderBase(scene, styleObj);
        const baseJpeg = await sharp(baseRaw, {
            raw: { width: scene.base.width, height: scene.base.height, channels: 4 },
        }).jpeg({ quality: 82 }).toBuffer();

        // A phone can only fetch http(s); anything else (s3://, base64) gets
        // republished so the scene is self-contained.
        const images = await Promise.all(scene.points.map(async (p) => {
            if (p.image.startsWith('http')) return p.image;
            const buf = await loadImageSource(p.image);
            if (!buf) return null;
            return uploadToS3(await sharp(buf).png().toBuffer(), user_id);
        }));

        scene.points.forEach((p, i) => { p.image = images[i]; });

        scene.base.url = inline
            ? `data:image/jpeg;base64,${baseJpeg.toString('base64')}`
            : await uploadToS3(baseJpeg, user_id, 'image/jpeg');

        res.json({
            user_id, post_id,
            arc_journey_data: { map_style: mapStyle, ...scene },
            image_geo_data: await geoPromise,
        });
    } catch (err) {
        console.error('[arc-journey/scene error]', err);
        res.status(500).json({ error: err.message });
    }
});

// Map routes
app.use(mapRouter);

// 404 fallback
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not found',
        endpoints: [
            'POST /user/:user_id/post/:post_id',
            'POST /user/:user_id/post/:post_id/portrait',
            'POST /user/:user_id/post/:post_id/portraitcard.png',
            'POST /user/:user_id/post/:post_id/calm-portrait',
            'POST /user/:user_id/post/:post_id/drift-portrait',
            'POST /user/:user_id/post/:post_id/haze-portrait',
            'POST /user/:user_id/post/:post_id/ease-portrait',
            'POST /user/:user_id/post/:post_id/melt-portrait',
            'POST /user/:user_id/post/:post_id/terrain',
            'POST /user/:user_id/post/:post_id/satellite-terrain',
            'POST /user/:user_id/post/:post_id/terrain-marker',
            'POST /user/:user_id/post/:post_id/satellite-terrain-marker',
            'POST /user/:user_id/post/:post_id/3d-terrain-marker',
            'POST /user/:user_id/post/:post_id/arc-journey        (MP4 of arcs hopping between photo locations)',
            'POST /user/:user_id/post/:post_id/arc-journey/scene  (same scene as JSON, for on-device rendering)',
            'GET  /health',
            'GET  /render?lat=&lon=&zoom=&width=&height=&bearing=&pitch=&format=&quality=',
            'POST /render  (JSON body with same params + optional style)',
            'GET  /style',
            'GET  /terrain?lat=&lon=&zoom=&pitch=&exaggeration=&width=&height=&format=',
            'GET  /terrain/style',
            'GET  /satellite-terrain?lat=&lon=&zoom=&pitch=&exaggeration=&width=&height=&format=',
            'GET  /satellite-terrain/style',
        ]
    });
});

export default app;
