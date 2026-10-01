import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

// The key stops at '?', so a pre-signed URL parses to the same object.
const S3_URL_RE = /https?:\/\/([^.]+)\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com\/([^?]+)/;

// SigV4 with IAM user keys caps a pre-signed URL at 7 days.
const MAX_TTL    = 7 * 24 * 60 * 60;
const SIGNED_TTL = Math.min(parseInt(process.env.S3_URL_TTL ?? MAX_TTL) || MAX_TTL, MAX_TTL);

export function isS3Url(url) {
    return url.startsWith('s3://') || S3_URL_RE.test(url);
}

export async function getFromS3(url) {
    let bucket, key;

    if (url.startsWith('s3://')) {
        const path  = url.slice(5);
        const slash = path.indexOf('/');
        bucket = path.slice(0, slash);
        key    = path.slice(slash + 1);
    } else {
        const match = url.match(S3_URL_RE);
        if (!match) throw new Error(`Cannot parse S3 URL: ${url}`);
        [, bucket, key] = match;
        key = decodeURIComponent(key);
    }

    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await resp.Body.transformToByteArray();
    return Buffer.from(bytes);
}

const EXTENSIONS = {
    'image/png':  'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif':  'gif',
    'video/mp4':  'mp4',
};

export async function uploadToS3(buffer, userId, contentType = 'image/png') {
    const ext = EXTENSIONS[contentType] ?? 'bin';
    const key = `${FOLDER}/${userId}/${randomUUID()}.${ext}`;
    await s3.send(new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         key,
        Body:        buffer,
        ContentType: contentType,
    }));
    return `https://${BUCKET}.s3.amazonaws.com/${key}`;
}

// A time-limited GET link for a private object; the plain URL stays the
// canonical one to store.
export async function signS3Url(url) {
    const match = url.match(S3_URL_RE);
    if (!match) throw new Error(`Cannot parse S3 URL: ${url}`);
    const [, bucket, key] = match;
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: decodeURIComponent(key) }), { expiresIn: SIGNED_TTL });
}

// Next to every http(s) S3 URL in a response, adds `<field>_signed` with a
// pre-signed version. Walks nested objects and arrays; mutates and returns obj.
export async function addSignedUrls(obj) {
    const jobs = [];
    const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        for (const [field, value] of Object.entries(node)) {
            if (typeof value === 'string' && S3_URL_RE.test(value)) {
                jobs.push(signS3Url(value).then((signed) => { node[`${field}_signed`] = signed; }));
            } else {
                walk(value);
            }
        }
    };
    walk(obj);
    await Promise.all(jobs);
    return obj;
}
