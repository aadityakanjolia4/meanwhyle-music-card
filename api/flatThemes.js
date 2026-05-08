import sharp from 'sharp';
import { Bloom, Calm, Drift, Haze, Melt, Ease } from 'musicard';

function flatten(themeFn) {
    return async (options) => {
        const rounded = await themeFn(options);
        return sharp(rounded)
            .flatten({ background: options.backgroundColor || '#000000' })
            .png()
            .toBuffer();
    };
}

export const FlatBloom = flatten(Bloom);
export const FlatCalm  = flatten(Calm);
export const FlatDrift = flatten(Drift);
export const FlatHaze  = flatten(Haze);
export const FlatMelt  = flatten(Melt);
export const FlatEase  = flatten(Ease);
