import express from 'express';
import { initializeFonts, Bloom } from 'musicard';

const app = express();
app.use(express.json());

initializeFonts();

app.post('/generate', async (req, res) => {
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
        res.send(image);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default app;
