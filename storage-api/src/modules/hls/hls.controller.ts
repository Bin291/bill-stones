import {
  ConflictException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';
import { StorageService } from '../storage/storage.service';
import { HlsTranscodeService } from './hls-transcode.service';

/**
 * Phục vụ HLS cho video (streaming + ABR + tua). Playlist đi qua backend (JWT),
 * segment .ts được rewrite thành presigned R2 URL ⇒ trình duyệt tải thẳng từ R2
 * (free egress + CDN + Range). Xem HLS_STREAMING.md.
 */
@Controller('videos')
export class HlsController {
  constructor(
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly hls: HlsTranscodeService,
  ) {}

  private prefix(userId: string, fileId: string): string {
    return this.hls.hlsPrefix(userId, fileId);
  }

  /** Trạng thái HLS (frontend poll để biết khi nào phát được). */
  @Get(':id/hls/status')
  async status(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const file = await this.files.assertOwned(id, userId);
    // Tự phục hồi: nếu kẹt ở 'processing' mà không có job đang chạy (VD backend
    // restart làm transcode chết giữa chừng) thì kích hoạt lại — tránh treo mãi.
    if (
      file.hlsStatus === 'processing' &&
      this.hls.supports(file.extension) &&
      !this.hls.isInProgress(id)
    ) {
      this.hls.transcodeInBackground(file);
    }
    return { hlsStatus: file.hlsStatus ?? null };
  }

  /** Kích hoạt (hoặc tạo lại) HLS cho video đã upload. */
  @Post(':id/hls/generate')
  async generate(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const file = await this.files.assertOwned(id, userId);
    if (!this.hls.supports(file.extension)) {
      throw new ConflictException('Không phải video hỗ trợ HLS');
    }
    // transcodeInBackground tự dedupe (bỏ qua nếu đang chạy trong process này).
    this.hls.transcodeInBackground(file);
    return { hlsStatus: 'processing' };
  }

  /** Master playlist (URI biến thể tương đối). Tự kích hoạt transcode nếu chưa có. */
  @Get(':id/hls/master.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'no-store')
  async master(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<string> {
    const file = await this.files.assertOwned(id, userId);
    if (file.hlsStatus === 'ready') {
      const raw = (
        await this.storage.getObjectBuffer(`${this.prefix(userId, id)}/master.m3u8`)
      ).toString();
      // ffmpeg trên Windows ghi URI biến thể bằng backslash -> chuẩn hoá về '/'.
      return raw.replace(/\\/g, '/');
    }
    // Chưa sẵn sàng: kích hoạt nền (tự dedupe). Bao gồm trường hợp kẹt 'processing'
    // sau khi backend restart — transcodeInBackground sẽ chạy lại nếu không có job.
    if (this.hls.supports(file.extension)) {
      this.hls.transcodeInBackground(file);
    }
    throw new ConflictException('Video đang xử lý');
  }

  /**
   * Variant playlist — rewrite mỗi dòng segment .ts thành presigned R2 URL (TTL 6h).
   */
  @Get(':id/hls/:variant/index.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'no-store')
  async variant(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('variant') variant: string,
  ): Promise<string> {
    const file = await this.files.assertOwned(id, userId);
    if (file.hlsStatus !== 'ready') throw new ConflictException('Video chưa sẵn sàng');
    if (!/^\d{3,4}p$/.test(variant)) throw new NotFoundException(); // chống path traversal

    const prefix = this.prefix(userId, id);
    const raw = (await this.storage.getObjectBuffer(`${prefix}/${variant}/index.m3u8`)).toString();

    const lines = raw.split('\n');
    const out: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (t && !t.startsWith('#') && t.endsWith('.ts')) {
        out.push(await this.storage.presignGet(`${prefix}/${variant}/${t}`, { expiresIn: 6 * 3600 }));
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }
}
