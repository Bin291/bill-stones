import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface SearchResult {
  id: string;
  name: string;
  extension: string;
  size: string;
  thumbnailUrl: string | null;
  folderId: string | null;
  hlsStatus: string | null;
  snippet: string | null;
}

interface RawRow {
  id: string;
  name: string;
  extension: string;
  size: string;
  thumbnailUrl: string | null;
  folderId: string | null;
  hlsStatus: string | null;
  snippet: string | null;
  score: number;
}

/**
 * FTS branch của Hybrid Search (mục 8.E) — chạy KHÔNG cần API key.
 * Tìm accent-insensitive (unaccent) trên tên file + nội dung đã trích (DocumentChunk).
 * Nhánh dense/BGE/vision + rerank sẽ thêm khi có key.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async search(userId: string, query: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (q.length < 2) return []; // chặn query quá ngắn (mục 8.E)

    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT id, name, extension, size, "thumbnailUrl", "folderId", "hlsStatus", snippet, score
      FROM (
        SELECT DISTINCT ON (f.id)
          f.id, f.name, f.extension, f.size::text AS size,
          f."thumbnailUrl", f."folderId", f."hlsStatus",
          CASE WHEN unaccent(f.name) ILIKE '%' || unaccent(${q}) || '%'
                 OR to_tsvector('simple', unaccent(regexp_replace(f.name, '[^[:alnum:]]+', ' ', 'g')))
                    @@ plainto_tsquery('simple', unaccent(${q}))
               THEN 2 ELSE 1 END AS score,
          left(coalesce(dc.content, ''), 220) AS snippet
        FROM "File" f
        LEFT JOIN "DocumentChunk" dc ON dc."fileId" = f.id
        WHERE f."userId" = ${userId}
          AND f."deletedAt" IS NULL
          AND f.status = 'ready'
          AND (
            unaccent(f.name) ILIKE '%' || unaccent(${q}) || '%'
            OR to_tsvector('simple', unaccent(regexp_replace(f.name, '[^[:alnum:]]+', ' ', 'g')))
               @@ plainto_tsquery('simple', unaccent(${q}))
            OR to_tsvector('simple', unaccent(coalesce(dc.content, '')))
               @@ plainto_tsquery('simple', unaccent(${q}))
          )
        ORDER BY f.id, score DESC
      ) t
      ORDER BY t.score DESC, t.name ASC
      LIMIT 50
    `;

    // Ký presigned URL cho thumbnail (như FilesService).
    const results: SearchResult[] = [];
    for (const r of rows) {
      let thumb: string | null = null;
      if (r.thumbnailUrl) {
        thumb = await this.storage.presignGet(r.thumbnailUrl, { expiresIn: 3600 });
      }
      results.push({
        id: r.id,
        name: r.name,
        extension: r.extension,
        size: r.size,
        thumbnailUrl: thumb,
        folderId: r.folderId,
        hlsStatus: r.hlsStatus,
        snippet: r.snippet && r.snippet.trim() ? r.snippet.trim() : null,
      });
    }
    return results;
  }
}
