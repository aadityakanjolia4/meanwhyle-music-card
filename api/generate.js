import { initializeFonts, Bloom } from 'musicard';

(async () => {
    let input = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', async () => {
        try {
            const params = JSON.parse(input);

            initializeFonts();

            const musicard = await Bloom({
                trackName: params.trackName || "Unknown Track",
                artistName: params.artistName || "Unknown Artist",
                albumArt: params.albumArt || "",
                isExplicit: params.isExplicit || false,
                timeAdjust: {
                    timeStart: params.timeStart || "0:00",
                    timeEnd: params.timeEnd || "0:00",
                },
                progressBar: params.progressBar ?? 0,
                volumeBar: params.volumeBar ?? 50,
            });

            process.stdout.write(musicard);
        } catch (err) {
            process.stderr.write(err.message);
            process.exit(1);
        }
    });
})();
