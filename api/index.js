import { initializeFonts, Bloom } from 'musicard';
import fs from 'node:fs';

(async () => {
    initializeFonts();

    const musicard = await Bloom({
        trackName: "Blinding Lights",
        artistName: "The Weeknd",
        albumArt: "https://i.scdn.co/image/ab67616d0000b2737569cbe3695608074d9fd389", // Image Path/URL
        isExplicit: true,
        timeAdjust: {
            timeStart: "0:00",
            timeEnd: "2:54",
        },
        progressBar: 10,
        volumeBar: 70,
    });

    fs.writeFileSync('example.png', musicard);
    console.log('✅-> example.png');
})();