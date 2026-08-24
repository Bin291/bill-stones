/* eslint-disable */
// Bật CORS cho bucket R2 để trình duyệt tải .ts (HLS) + Range trực tiếp.
const fs = require('fs');
const path = require('path');
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';

const origins = get('WEB_ORIGIN')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Thêm sẵn cổng dev hay dùng.
for (const o of ['http://localhost:4200', 'http://localhost:4321']) {
  if (!origins.includes(o)) origins.push(o);
}

const client = new S3Client({
  region: 'auto',
  endpoint: get('R2_ENDPOINT'),
  credentials: { accessKeyId: get('R2_ACCESS_KEY_ID'), secretAccessKey: get('R2_SECRET_ACCESS_KEY') },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
const Bucket = get('R2_BUCKET');

(async () => {
  await client.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ['GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log('Đã set CORS cho bucket:', Bucket);
  console.log('AllowedOrigins:', origins.join(', '));
  const check = await client.send(new GetBucketCorsCommand({ Bucket }));
  console.log('Xác nhận:', JSON.stringify(check.CORSRules));
})().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
