import { Injectable, Logger } from '@nestjs/common';
import { File } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentParserService } from './document-parser.service';

const MAX_INDEX_BYTES = 100 * 1024 * 1024; // bỏ qua file > 100MB

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
  ) {}

  supports(extension: string): boolean {
    return this.parser.supports(extension);
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

    const buffer = await this.storage.getObjectBuffer(file.r2Key);
    const text = await this.parser.extractText(buffer, file.extension);
    const chunks = this.parser.chunk(text);

    // Ghi đè chỉ mục cũ.
    await this.prisma.documentChunk.deleteMany({ where: { fileId: file.id } });
    if (chunks.length === 0) return;

    await this.prisma.documentChunk.createMany({
      data: chunks.map((content, chunkIndex) => ({ fileId: file.id, content, chunkIndex })),
    });
    this.log.log(`Đã index ${file.id}: ${chunks.length} chunk`);
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
