import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AiService } from './ai.service';

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
}

const RRF_K = 60; // hằng số Reciprocal Rank Fusion (mục 8.E)
const RERANK_TOP = 20; // số ứng viên đưa vào reranker
// Ngưỡng khoảng cách cosine tối đa cho nhánh dense: chỉ giữ mục ĐỦ liên quan.
// Đo với embedding bất đối xứng (RETRIEVAL_QUERY vs RETRIEVAL_DOCUMENT): mục liên
// quan ~0.29–0.40, không liên quan ~0.44+. Chỉnh qua env nếu muốn nới/siết.
const DENSE_MAX_DIST = Number(process.env.SEARCH_DENSE_MAX_DIST ?? '0.42');

/**
 * Hybrid Search (mục 8.E): fuse nhánh **FTS** (accent-insensitive, không cần key)
 * với nhánh **dense** (Gemini embedding + pgvector cosine) bằng **RRF**, rồi
 * **rerank** bằng cross-encoder HF (fail-soft). Ảnh tìm được nhờ vision caption
 * đã index (mục IndexingService). Không có key -> chỉ FTS.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
  ) {}

  async search(userId: string, query: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (q.length < 2) return []; // chặn query quá ngắn (mục 8.E)

    // Nhánh 1: FTS (luôn chạy).
    const ftsRows = await this.ftsSearch(userId, q);

    // Nhánh 2: dense (nếu có key). Fuse RRF.
    let ranked: RawRow[];
    const qvec = this.ai.enabled() ? await this.ai.embedQuery(q) : null;
    if (qvec) {
      const denseRows = await this.denseSearch(userId, qvec);
      ranked = this.rrfFuse(ftsRows, denseRows);
    } else {
      ranked = ftsRows;
    }

    // Rerank cross-encoder trên top ứng viên (fail-soft).
    ranked = await this.maybeRerank(q, ranked);

    // Ký presigned thumbnail cho kết quả cuối.
    const top = ranked.slice(0, 50);
    const results: SearchResult[] = [];
    for (const r of top) {
      let thumb: string | null = null;
      if (r.thumbnailUrl) thumb = await this.storage.presignGet(r.thumbnailUrl, { expiresIn: 3600 });
      results.push({ ...r, thumbnailUrl: thumb, snippet: r.snippet?.trim() || null });
    }
    return results;
  }

  /** FTS accent-insensitive trên tên file + nội dung/caption đã index. */
  private ftsSearch(userId: string, q: string): Promise<RawRow[]> {
    return this.prisma.$queryRaw<RawRow[]>`
      SELECT id, name, extension, size, "thumbnailUrl", "folderId", "hlsStatus", snippet
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
  }

  /** Dense: cosine gần nhất theo embedding (pgvector). */
  private denseSearch(userId: string, qvec: number[]): Promise<RawRow[]> {
    const lit = `[${qvec.join(',')}]`;
    return this.prisma.$queryRaw<RawRow[]>`
      SELECT id, name, extension, size, "thumbnailUrl", "folderId", "hlsStatus", snippet
      FROM (
        SELECT DISTINCT ON (f.id)
          f.id, f.name, f.extension, f.size::text AS size,
          f."thumbnailUrl", f."folderId", f."hlsStatus",
          left(dc.content, 220) AS snippet,
          (dc.embedding <=> ${lit}::vector) AS dist
        FROM "File" f
        JOIN "DocumentChunk" dc ON dc."fileId" = f.id
        WHERE f."userId" = ${userId}
          AND f."deletedAt" IS NULL
          AND f.status = 'ready'
          AND dc.embedding IS NOT NULL
          AND (dc.embedding <=> ${lit}::vector) < ${DENSE_MAX_DIST}
        ORDER BY f.id, dist ASC
      ) t
      ORDER BY t.dist ASC
      LIMIT 30
    `;
  }

  /** Reciprocal Rank Fusion 2 danh sách đã xếp hạng theo file id. */
  private rrfFuse(fts: RawRow[], dense: RawRow[]): RawRow[] {
    const meta = new Map<string, RawRow>();
    const score = new Map<string, number>();
    const add = (rows: RawRow[]) => {
      rows.forEach((r, i) => {
        if (!meta.has(r.id)) meta.set(r.id, r);
        score.set(r.id, (score.get(r.id) ?? 0) + 1 / (RRF_K + i + 1));
      });
    };
    add(fts);
    add(dense);
    return [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => meta.get(id)!)
      .filter(Boolean);
  }

  /** Rerank cross-encoder trên top ứng viên; lỗi thì giữ nguyên thứ tự. */
  private async maybeRerank(q: string, ranked: RawRow[]): Promise<RawRow[]> {
    if (ranked.length < 2) return ranked;
    const head = ranked.slice(0, RERANK_TOP);
    const docs = head.map((r) => `${r.name}. ${r.snippet ?? ''}`);
    const scores = await this.ai.rerank(q, docs);
    if (!scores || scores.length !== head.length) return ranked;
    const rerankedHead = head
      .map((r, i) => ({ r, s: scores[i] }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
    return [...rerankedHead, ...ranked.slice(RERANK_TOP)];
  }
}
