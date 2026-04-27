import express from 'express';
import sharp from 'sharp';
import { initializeFonts, Bloom } from 'musicard';
import mapRouter, { buildTerrainStyle, buildSatelliteTerrainStyle, renderMap, clamp } from './map.js';
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

// ─── Composite: music card overlaid on map ────────────────────────────────────

async function handleCompositePost(req, res, styleFn) {
    const { user_id, post_id } = req.params;
    const {
        trackName, artistName, albumArt, isExplicit,
        timeStart, timeEnd, progressBar, volumeBar,
        lat, lon,
        zoom, pitch, bearing, width, height, exaggeration,
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

        const mapPng = await sharp(mapRaw, { raw: { width: mapWidth, height: mapHeight, channels: 4 } }).png().toBuffer();

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

// Map routes
app.use(mapRouter);

// 404 fallback
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not found',
        endpoints: [
            'POST /user/:user_id/post/:post_id',
            'POST /user/:user_id/post/:post_id/terrain',
            'POST /user/:user_id/post/:post_id/satellite-terrain',
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
