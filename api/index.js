import express from 'express';
import { initializeFonts, Bloom } from 'musicard';
import mapRouter from './map.js';

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

// Map routes
app.use(mapRouter);

// 404 fallback
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not found',
        endpoints: [
            'POST /user/:user_id/post/:post_id',
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
