import express from 'express';
import sharp from 'sharp';
import { initializeFonts, Bloom, Calm, Drift, Haze, Ease, Melt, BloomPortrait, CalmPortrait, DriftPortrait, HazePortrait, EasePortrait, MeltPortrait } from 'musicard';
import mapRouter, { buildTerrainStyle, buildSatelliteTerrainStyle, build3dTerrainStyle, renderMap, clamp, compositeMarkers } from './map.js';
import { uploadToS3 } from './s3.js';

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

        const uploads = await Promise.all([
            uploadToS3(mapPng, user_id),
            cardBuffer ? uploadToS3(cardBuffer, user_id) : null,
        ]);

        const response = { user_id, post_id, map: uploads[0] };
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

        const uploads = await Promise.all([
            uploadToS3(mapPng, user_id),
            cardBuffer ? uploadToS3(cardBuffer, user_id) : null,
        ]);

        const response = { user_id, post_id, map: uploads[0], card_theme: theme };
        if (uploads[1]) response.card = uploads[1];
        res.json(response);
    } catch (err) {
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
