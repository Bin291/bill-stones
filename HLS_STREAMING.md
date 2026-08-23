# HLS Video Streaming

Phát video kiểu YouTube (streaming + ABR tự động + tua + chọn chất lượng) trên nền
storage private (Cloudflare R2). Đã triển khai & test end-to-end.

## Kiến trúc

```
Upload video ──► R2: {userId}/{fileId}                (file gốc)
     └─► (fire-and-forget, như thumbnail) HlsTranscodeService
             ffmpeg-static → HLS 1080/720/480 (không upscale)
             ▼
         R2: {userId}/{fileId}/hls/{master.m3u8, <res>/index.m3u8, <res>/seg_*.ts}
             File.hlsStatus = 'ready'

Angular (hls.js)
  GET /videos/:id/hls/master.m3u8        (backend, JWT) → master (URI biến thể tương đối)
  GET /videos/:id/hls/:variant/index.m3u8(backend, JWT) → playlist, segment = presigned R2
  GET https://<r2>/...seg.ts?X-Amz...     (thẳng R2: free egress + CDN + Range=tua)
```

**Vì sao playlist qua backend, segment thẳng R2:** bucket private nên phải gác cổng
bằng JWT + `assertOwned` ở playlist; còn `.ts` để R2 phục vụ trực tiếp (R2 **miễn phí
egress** + CDN Cloudflare) thay vì proxy tốn băng thông API.

## Backend (đã có trong repo)

- `modules/hls/hls-transcode.service.ts` — transcode (spawn `ffmpeg-static`), upload cây HLS lên R2, set `hlsStatus`. Chạy nền, dedupe, bỏ biến thể lớn hơn nguồn.
- `modules/hls/hls.controller.ts` — `GET /videos/:id/hls/status`, `POST .../generate`, `GET .../master.m3u8`, `GET .../:variant/index.m3u8` (rewrite segment → presigned TTL 6h).
- Cột `File.hlsStatus` (`processing|ready|failed|null`).
- Kích hoạt ở `UploadsService.complete` cho video; dọn cây `hls/` ở permanent-delete.

### FFmpeg (đa độ phân giải, keyframe thẳng hàng để ABR mượt)

Điểm mấu chốt: `-g 48 -keyint_min 48 -sc_threshold 0` (GOP cố định, bội số `hls_time`)
+ `-hls_flags independent_segments`, và **`scale=...:force_divisible_by=2`** (libx264
bắt buộc kích thước chẵn — nếu thiếu sẽ lỗi `width not divisible by 2`).

## Frontend (đã có trong repo)

- `features/video-player/video-player.ts` — hls.js: ABR tự động, quality selector, fullscreen, tua bằng thanh gốc `<video controls>`. Nếu chưa transcode xong → gọi `generate` + poll.
- Đính JWT qua `xhrSetup` **chỉ cho request tới backend** (playlist); KHÔNG đính cho R2 presigned (kèm `Authorization` sẽ bị R2 từ chối).
- `file-explorer.openFile`: bấm file video → mở player HLS.

## Cấu hình cần làm khi lên production

1. **R2 bucket CORS** (segment tải thẳng từ R2 cross-origin, cần `Range`):
   ```json
   [{ "AllowedOrigins": ["https://your-web"], "AllowedMethods": ["GET","HEAD"],
      "AllowedHeaders": ["Range","Content-Type"],
      "ExposeHeaders": ["Content-Length","Content-Range","Accept-Ranges","ETag"],
      "MaxAgeSeconds": 3600 }]
   ```
   `wrangler r2 bucket cors put <BUCKET> --rules cors.json`
2. **Backend CORS** (`main.ts`): expose `Content-Range/Accept-Ranges`, allow `Range` header (đã có Authorization).
3. **Redis + BullMQ** (khuyến nghị thay fire-and-forget): transcode nặng → giới hạn concurrency 1–2, retry backoff. Hiện dùng in-process cho đơn giản.

## Điểm mù & rủi ro

| Vấn đề | Xử lý |
|---|---|
| **CORS** segment/Range bị chặn | Cấu hình R2 bucket CORS (trên). Không đính `Authorization` vào request R2. |
| **Egress cost** | R2 miễn phí egress — để R2 phục vụ `.ts`, KHÔNG proxy qua backend. |
| **CDN caching** | `.ts` bất biến → `Cache-Control: public, max-age=31536000, immutable` (đã set). `.m3u8` → `no-store` (chứa presigned có hạn). |
| **Presigned hết hạn** giữa chừng | TTL 6h; hls.js `NETWORK_ERROR` fatal → `startLoad()` nạp lại playlist (ký presigned mới). |
| **Transcode lag** | Chạy nền + `hlsStatus`; không chặn upload. `-preset veryfast`. Giới hạn/queue với video dài. |
| **libx264 even dims** | `force_divisible_by=2` (đã fix). |
| **Safari/iOS** | Phát HLS native, không chạy `xhrSetup` → cần token qua query cho route HLS nếu muốn hỗ trợ. |
| **Storage bloat** | HLS nhân dung lượng; chỉ transcode ≤ nguồn; xoá cây `hls/` khi xoá file (đã làm). |

## Test

`node scripts/e2e-hls-test.js` — tạo user + video test → upload → transcode → kiểm
master/variant/segment presigned + Range (206). Đã pass.
