import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { File } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentParserService } from './document-parser.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { HfInferenceService } from './hf-inference.service';

const MAX_INDEX_BYTES = 100 * 1024 * 1024; // bỏ qua file > 100MB
const EMBED_BATCH = 32;

/**
 * Pipeline AI cho hybrid search (mục 8.E): trích text (ảnh -> vision auto-
 * caption) -> chunk -> embed dense (BazaarLink/Gemini 768d, bắt buộc) + BGE-M3
 * (HF 1024d, best-effort) -> lưu DocumentChunk. Chạy nền như thumbnail/HLS.
 *
 * Best-effort cho BGE-M3: nếu HF lỗi/tắt/hết quota, cột "embeddingBge" để
 * null cho chunk đó — nhánh dense + FTS trong SearchService vẫn hoạt động.
 */
@Injectable()
export class IndexingService {
  private readonly log = new Logger(IndexingService.name);
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly parser: DocumentParserService,
    private readonly embedder: AiEmbeddingService,
    private readonly hf: HfInferenceService,
  ) {}

  supports(extension: string): boolean {
    return this.parser.supports(extension);
  }

  indexInBackground(
    file: Pick<File, 'id' | 'r2Key' | 'extension' | 'size' | 'mimeType'>,
  ): void {
    if (this.inProgress.has(file.id)) return;
    this.inProgress.add(file.id);
    void this.index(file)
      .catch((err) => this.log.warn(`Index ${file.id} lỗi: ${(err as Error).message}`))
      .finally(() => this.inProgress.delete(file.id));
  }

  async index(
    file: Pick<File, 'id' | 'r2Key' | 'extension' | 'size' | 'mimeType'>,
  ): Promise<void> {
    if (!this.supports(file.extension) || Number(file.size) > MAX_INDEX_BYTES) return;

    const buffer = await this.storage.getObjectBuffer(file.r2Key);
    const text = await this.parser.extractText(buffer, file.extension, file.mimeType);
    const chunks = this.parser.chunk(text);

    // Ghi đè chỉ mục cũ (idempotent — reindex chạy lại thoải mái).
    await this.prisma.documentChunk.deleteMany({ where: { fileId: file.id } });
    if (chunks.length === 0) return;

    if (!this.embedder.enabled) {
      // Không có key nào (BazaarLink/Gemini) -> vẫn lưu content thô để nhánh
      // FTS (không cần key) tìm được theo từ khoá, chỉ mất phần semantic.
      await this.prisma.documentChunk.createMany({
        data: chunks.map((content, chunkIndex) => ({ fileId: file.id, content, chunkIndex })),
      });
      this.log.warn(
        `File ${file.id}: không có AI key khả dụng — chỉ lưu FTS, bỏ qua embedding.`,
      );
      return;
    }

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);

      // Dense (bắt buộc — nếu cả batch lỗi thì các chunk này không có vector,
      // vẫn giữ content để FTS tìm được).
      let denseVectors: number[][];
      try {
        denseVectors = await this.embedder.generateEmbeddings(batch);
      } catch (err) {
        this.log.warn(`Dense embed lỗi (file ${file.id}): ${(err as Error).message}`);
        denseVectors = batch.map(() => []);
      }

      // BGE-M3 tuần tự từng chunk (HF không đảm bảo batch cho feature-extraction).
      // Best-effort — không throw, chunk lỗi chỉ mất nhánh bge.
      const bgeVectors = await this.embedBgeBestEffort(batch);

      for (let j = 0; j < batch.length; j++) {
        const dense = denseVectors[j];
        const bge = bgeVectors[j];
        const denseLiteral = dense && dense.length > 0 ? `[${dense.join(',')}]` : null;
        const bgeLiteral = bge && bge.length > 0 ? `[${bge.join(',')}]` : null;

        // Prisma không hỗ trợ type vector -> insert raw, cast ::vector.
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk"
             (id, "fileId", content, "chunkIndex", embedding, "embeddingBge")
           VALUES ($1, $2, $3, $4, $5::vector, $6::vector)`,
          randomUUID(),
          file.id,
          batch[j],
          i + j,
          denseLiteral,
          bgeLiteral,
        );
      }
    }
    this.log.log(`Đã index ${file.id}: ${chunks.length} chunk`);
  }

  /** BGE-M3 lần lượt từng chunk. Không throw — trả null cho phần tử lỗi. */
  private async embedBgeBestEffort(chunks: string[]): Promise<(number[] | null)[]> {
    if (!this.hf.bgeEnabled) return chunks.map(() => null);
    const out: (number[] | null)[] = [];
    for (const c of chunks) {
      try {
        out.push(await this.hf.embedTextBge(c));
      } catch (err) {
        this.log.warn(`BGE-M3 embed lỗi: ${(err as Error).message}`);
        out.push(null);
      }
    }
    return out;
  }

  /**
   * Backfill: index lại file hỗ trợ (tài liệu + ảnh) của user mà CHƯA có chunk
   * nào, HOẶC có chunk nhưng thiếu vector (dữ liệu cũ từ trước khi bật hybrid
   * search — cột "embedding"/"embeddingBge" đều null, chỉ có content thô).
   * Cột vector là Unsupported() với Prisma nên phải lọc bằng raw SQL.
   */
  async reindexUser(userId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { id: string; r2Key: string; extension: string; size: bigint; mimeType: string }[]
    >`
      SELECT f.id, f."r2Key", f.extension, f.size, f."mimeType"
      FROM "File" f
      WHERE f."userId" = ${userId}
        AND f."deletedAt" IS NULL
        AND f.status = 'ready'
        AND NOT EXISTS (
          SELECT 1 FROM "DocumentChunk" dc
          WHERE dc."fileId" = f.id AND dc.embedding IS NOT NULL
        )
    `;
    let n = 0;
    for (const f of rows) {
      if (this.supports(f.extension)) {
        this.indexInBackground(f);
        n++;
      }
    }
    return n;
  }
}
