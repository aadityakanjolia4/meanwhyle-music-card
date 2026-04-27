import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
