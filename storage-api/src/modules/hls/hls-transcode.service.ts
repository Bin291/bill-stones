import { Injectable, Logger } from '@nestjs/common';
import { File } from '@prisma/client';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const execFileP = promisify(execFile);

interface Rendition {
  name: string;
  w: number;
  h: number;
  vb: string;
  max: string;
  buf: string;
}

// Thang bậc chất lượng: 144p → 1080p (không có 720p theo yêu cầu). Chỉ tạo các mức
// ≤ độ cao nguồn (không upscale). Player tự liệt kê đúng các mức đã tạo.
const LADDER: Rendition[] = [
  { name: '1080p', w: 1920, h: 1080, vb: '5000k', max: '5350k', buf: '7500k' },
  { name: '480p', w: 854, h: 480, vb: '1400k', max: '1498k', buf: '2100k' },
  { name: '360p', w: 640, h: 360, vb: '800k', max: '856k', buf: '1200k' },
  { name: '240p', w: 426, h: 240, vb: '400k', max: '428k', buf: '600k' },
  { name: '144p', w: 256, h: 144, vb: '150k', max: '160k', buf: '225k' },
];

const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi']);
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * Transcode video -> HLS đa độ phân giải (mục streaming). Chạy nền (fire-and-forget)
 * như ThumbnailService — không cần Redis. Lưu cây HLS lên R2 tại
 * `{userId}/{fileId}/hls/`, set File.hlsStatus = 'ready'.
 */
@Injectable()
export class HlsTranscodeService {
  private readonly log = new Logger(HlsTranscodeService.name);
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  supports(extension: string): boolean {
    return VIDEO_EXT.has(extension.toLowerCase());
  }

  /** Có job transcode đang chạy trong process này không (để tự phục hồi khi kẹt). */
  isInProgress(fileId: string): boolean {
    return this.inProgress.has(fileId);
  }

  hlsPrefix(userId: string, fileId: string): string {
    return `${userId}/${fileId}/hls`;
  }

  /** Đẩy transcode chạy nền, nuốt lỗi, dedupe theo fileId. */
  transcodeInBackground(file: Pick<File, 'id' | 'userId' | 'r2Key' | 'extension' | 'size'>): void {
    if (this.inProgress.has(file.id)) return;
    this.inProgress.add(file.id);
    void this.transcode(file)
      .catch((err) => this.log.warn(`HLS ${file.id} lỗi: ${(err as Error).message}`))
      .finally(() => this.inProgress.delete(file.id));
  }

  async transcode(
    file: Pick<File, 'id' | 'userId' | 'r2Key' | 'extension' | 'size'>,
  ): Promise<void> {
    if (!this.supports(file.extension) || Number(file.size) > MAX_BYTES) return;

    const work = await fs.mkdtemp(join(tmpdir(), `hls-${file.id}-`));
    const src = join(work, 'src.input');
    try {
      await this.prisma.file.update({ where: { id: file.id }, data: { hlsStatus: 'processing' } });
      await this.storage.downloadToFile(file.r2Key, src);

      const srcH = await this.probeHeight(src);
      const ladder = LADDER.filter((r) => r.h <= srcH + 8);
      if (ladder.length === 0) ladder.push(LADDER[LADDER.length - 1]);

      await this.runFfmpeg(src, work, ladder);
      await this.uploadTree(work, this.hlsPrefix(file.userId, file.id), work);

      await this.prisma.file.update({ where: { id: file.id }, data: { hlsStatus: 'ready' } });
      this.log.log(`HLS ready: ${file.id} (${ladder.map((r) => r.name).join(',')})`);
    } catch (err) {
      await this.prisma.file
        .update({ where: { id: file.id }, data: { hlsStatus: 'failed' } })
        .catch(() => undefined);
      throw err;
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async probeHeight(src: string): Promise<number> {
    try {
      const { stdout } = await execFileP(ffprobeStatic.path, [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=height', '-of', 'csv=p=0', src,
      ]);
      return parseInt(stdout.trim(), 10) || 720;
    } catch {
      return 720;
    }
  }

  private async runFfmpeg(src: string, out: string, ladder: Rendition[]): Promise<void> {
    await Promise.all(ladder.map((r) => fs.mkdir(join(out, r.name), { recursive: true })));

    const split = `[0:v]split=${ladder.length}` + ladder.map((_, i) => `[v${i}]`).join('') + ';';
    const scales = ladder
      .map(
        (r, i) =>
          // force_divisible_by=2: libx264/yuv420p bắt buộc kích thước chẵn.
          `[v${i}]scale=w=${r.w}:h=${r.h}:force_original_aspect_ratio=decrease:force_divisible_by=2[v${i}out]`,
      )
      .join('; ');

    const args: string[] = ['-y', '-i', src, '-filter_complex', split + scales];
    ladder.forEach((r, i) => {
      args.push(
        '-map', `[v${i}out]`,
        `-c:v:${i}`, 'libx264', `-b:v:${i}`, r.vb, `-maxrate:v:${i}`, r.max, `-bufsize:v:${i}`, r.buf,
      );
    });
    // Map audio nếu có (giữ nhánh audio cho từng biến thể).
    ladder.forEach(() => args.push('-map', 'a:0?'));
    args.push(
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-preset', 'veryfast', '-sc_threshold', '0', '-g', '48', '-keyint_min', '48',
      '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
      '-hls_segment_type', 'mpegts', '-master_pl_name', 'master.m3u8',
      '-hls_segment_filename', join(out, '%v', 'seg_%03d.ts'),
      '-var_stream_map', ladder.map((r, i) => `v:${i},a:${i},name:${r.name}`).join(' '),
      join(out, '%v', 'index.m3u8'),
    );

    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegStatic as unknown as string, args);
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('error', reject);
      p.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-600)}`)),
      );
    });
  }

  private async uploadTree(dir: string, prefix: string, base: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await this.uploadTree(full, prefix, base);
      } else if (e.name.startsWith('src.')) {
        continue;
      } else {
        const rel = full.slice(base.length + 1).replace(/\\/g, '/');
        const key = `${prefix}/${rel}`;
        const isTs = e.name.endsWith('.ts');
        const ct = e.name.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : isTs
            ? 'video/mp2t'
            : 'application/octet-stream';
        // .ts bất biến -> cache dài; .m3u8 để backend kiểm soát cache.
        const cache = isTs ? 'public, max-age=31536000, immutable' : undefined;
        await this.storage.putObject(key, await fs.readFile(full), ct, cache);
      }
    }
  }
}
