import express from 'express';
import { initializeFonts, Bloom } from 'musicard';

const app = express();
app.use(express.json());

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

export default app;
