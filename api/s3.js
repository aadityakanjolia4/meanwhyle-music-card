import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const BUCKET = 'meanwhyl';
const FOLDER = 'uploads';

export function isS3Url(url) {
    return url.startsWith('s3://') || /https?:\/\/[^.]+\.s3[^.]*\.amazonaws\.com\//.test(url);
}

export async function getFromS3(url) {
    let bucket, key;

    if (url.startsWith('s3://')) {
        // s3://bucket/key
        const path = url.slice(5);
        const slash = path.indexOf('/');
        bucket = path.slice(0, slash);
        key    = path.slice(slash + 1);
    } else {
        // https://bucket.s3.amazonaws.com/key
        const match = url.match(/https?:\/\/([^.]+)\.s3[^.]*\.amazonaws\.com\/(.+)/);
        if (!match) throw new Error(`Cannot parse S3 URL: ${url}`);
        [, bucket, key] = match;
        key = decodeURIComponent(key);
    }

    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await resp.Body.transformToByteArray();
    return Buffer.from(bytes);
}

export async function uploadToS3(buffer, userId, contentType = 'image/png') {
    const key = `${FOLDER}/${userId}/${randomUUID()}.png`;
    await s3.send(new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         key,
        Body:        buffer,
        ContentType: contentType,
    }));
    return `https://${BUCKET}.s3.amazonaws.com/${key}`;
}
