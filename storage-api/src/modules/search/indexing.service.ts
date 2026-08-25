import { Injectable, Logger } from '@nestjs/common';
import { File } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentParserService } from './document-parser.service';
import { AiService } from './ai.service';

const MAX_INDEX_BYTES = 100 * 1024 * 1024; // bỏ qua file > 100MB

// Ảnh: index qua Gemini vision auto-caption (mục 8.E).
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
};
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // giới hạn ảnh gửi lên vision

/**
 * Lập chỉ mục FTS: trích text -> chunk -> lưu DocumentChunk.content (embedding để
 * null; sẽ điền khi bật nhánh AI). Chạy nền như thumbnail/HLS.
 */
@Injectable()
export class IndexingService {
  private readonly log = new Logger(IndexingService.name);
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly parser: DocumentParserService,
    private readonly ai: AiService,
  ) {}

  private isImage(extension: string): boolean {
    return extension.toLowerCase() in IMAGE_MIME;
  }

  supports(extension: string): boolean {
    // Ảnh chỉ index được khi có AI (vision caption); tài liệu/text luôn index (FTS).
    return this.parser.supports(extension) || (this.isImage(extension) && this.ai.enabled());
  }

  indexInBackground(file: Pick<File, 'id' | 'r2Key' | 'extension' | 'size'>): void {
    if (this.inProgress.has(file.id)) return;
    this.inProgress.add(file.id);
    void this.index(file)
      .catch((err) => this.log.warn(`Index ${file.id} lỗi: ${(err as Error).message}`))
      .finally(() => this.inProgress.delete(file.id));
  }

  async index(file: Pick<File, 'id' | 'r2Key' | 'extension' | 'size'>): Promise<void> {
    if (!this.supports(file.extension) || Number(file.size) > MAX_INDEX_BYTES) return;
    const ext = file.extension.toLowerCase();

    let chunks: string[];
    if (this.isImage(ext)) {
      // Ảnh -> caption (OCR + mô tả + từ khoá) bằng Gemini vision.
      if (Number(file.size) > MAX_IMAGE_BYTES) return;
      const buffer = await this.storage.getObjectBuffer(file.r2Key);
      const caption = await this.ai.captionImage(buffer, IMAGE_MIME[ext]);
      chunks = this.parser.chunk(caption);
    } else {
      const buffer = await this.storage.getObjectBuffer(file.r2Key);
      const text = await this.parser.extractText(buffer, ext);
      chunks = this.parser.chunk(text);
    }

    // Ghi đè chỉ mục cũ.
    await this.prisma.documentChunk.deleteMany({ where: { fileId: file.id } });
    if (chunks.length === 0) return;

    // Nhánh dense: embed chunk bằng Gemini (nếu có key). Lỗi/không key -> chỉ FTS.
    const vectors = await this.ai.embed(chunks);
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const vec = vectors?.[i];
      if (vec) {
        const lit = `[${vec.join(',')}]`;
        await this.prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "fileId", content, "chunkIndex", embedding)
          VALUES (gen_random_uuid(), ${file.id}, ${content}, ${i}, ${lit}::vector)`;
      } else {
        await this.prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "fileId", content, "chunkIndex")
          VALUES (gen_random_uuid(), ${file.id}, ${content}, ${i})`;
      }
    }
    this.log.log(`Đã index ${file.id}: ${chunks.length} chunk${vectors ? ' (+embedding)' : ''}`);
  }

  /** Backfill: index mọi file text của user chưa có chunk (chạy nền). */
  async reindexUser(userId: string): Promise<number> {
    const files = await this.prisma.file.findMany({
      where: { userId, deletedAt: null, status: 'ready', chunks: { none: {} } },
      select: { id: true, r2Key: true, extension: true, size: true },
    });
    let n = 0;
    for (const f of files) {
      if (this.supports(f.extension)) {
        this.indexInBackground(f);
        n++;
      }
    }
    return n;
  }
}
