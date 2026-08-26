import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { HfInferenceService } from './hf-inference.service';

export type SearchBranch = 'dense' | 'bge' | 'fts';

export interface SearchResult {
  id: string;
  name: string;
  extension: string;
  size: string;
  thumbnailUrl: string | null;
  folderId: string | null;
  hlsStatus: string | null;
  snippet: string | null;
  similarity: number; // 0..1, ý nghĩa tuyệt đối (không normalize theo top batch)
  matchedBy: SearchBranch[]; // hiển thị badge "ngữ nghĩa" / "từ khoá" trong UI
}

// --- Row types nhận từ RPC --------------------------------------------------
interface DenseRow {
  file_id: string;
  file_name: string;
  content: string;
  similarity: number;
}
interface BgeRow {
  file_id: string;
  file_name: string;
  chunk_id: string | null;
  content: string;
  similarity: number;
}
interface FtsRow {
  file_id: string;
  file_name: string;
  chunk_id: string | null;
  content: string;
  rank: number;
}

const RRF_K = 60; // chuẩn Cormack et al. 2009
const PER_BRANCH_TOP_K = 20;
const FINAL_TOP_K = 20;

// Ngưỡng cosine để coi 1 item là "đủ liên quan" — dưới ngưỡng thì bỏ, kể cả
// RRF có xếp nó vào top-K. Item được GIỮ khi:
//   - FTS hit (từ khoá/tên file xuất hiện — tín hiệu rất tin cậy), HOẶC
//   - Cả 2 branch text ĐỒNG THUẬN vượt ngưỡng thấp, HOẶC
//   - Một branch vượt ngưỡng CAO (rất tự tin)
const MIN_DENSE_STRONG = 0.6;
const MIN_BGE_STRONG = 0.65;
const MIN_DENSE_JOINT = 0.45;
const MIN_BGE_JOINT = 0.55;
// Cross-encoder trả gần 0 = KHÔNG liên quan. Ngưỡng thấp để giữ borderline,
// loại rác chắc chắn (~1e-4).
const MIN_RERANK_SIM = 0.05;

// Query < 2 ký tự không đủ tín hiệu semantic + dễ trúng "false FTS" (1 chữ
// cái trùng ngẫu nhiên trong nội dung dài) — trả rỗng luôn.
const MIN_QUERY_LENGTH = 2;

// Leet-speak: thay số-thành-chữ PHỔ BIẾN. Nếu query có ký tự này, sinh thêm 1
// variant "denumberified" và search PARALLEL với bản gốc, lấy max cosine/rank
// per file. CHỈ thay trong TOKEN có TRỘN chữ+số (vd "s0", "h0a", "g4rn4cho")
// — token toàn số (vd "7", "49") giữ nguyên vì đó là số THẬT (số áo, mã sản
// phẩm, năm): thay mù trên toàn chuỗi sẽ biến "s0 7" thành "so t" (sai) thay
// vì "so 7" (đúng, khớp unaccent("số 7") = "so 7").
const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a',
};
const PURE_DIGITS_RE = /^[0-9]+$/;
function normalizeLeet(q: string): string {
  return q
    .toLowerCase()
    .replace(/[a-z0-9@]+/g, (token) =>
      PURE_DIGITS_RE.test(token)
        ? token
        : token.replace(/[013457@]/g, (c) => LEET_MAP[c] ?? c),
    );
}

/**
 * Hybrid search (mục 8.E) — 3 nhánh chạy song song, hợp nhất bằng RRF:
 *
 *   dense : BazaarLink/Gemini text-embedding (768d) — semantic tổng quát
 *   bge   : BGE-M3 qua HF (1024d) — semantic đa ngôn ngữ, tiếng Việt tốt
 *   fts   : Postgres tsvector + unaccent — từ khoá chính xác + TÊN FILE
 *
 * Reciprocal Rank Fusion: score(doc) = Σ 1/(k + rank_branch). Nhánh nào chết
 * (thiếu API key, HF hết quota) tự đóng góp 0 — các nhánh còn lại vẫn ra kết
 * quả (zero-downtime khi 1 provider degrade).
 *
 * Ảnh: không có nhánh riêng — được DocumentParserService mô tả bằng vision
 * (OCR + mô tả + từ khoá) thành text, chunk/embed như tài liệu thường nên tự
 * động lọt vào cả 3 nhánh trên.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly embedder: AiEmbeddingService,
    private readonly hf: HfInferenceService,
  ) {}

  async search(userId: string, query: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) return [];

    const qNormalized = normalizeLeet(q);
    const useVariant = qNormalized !== q.toLowerCase() && qNormalized.length >= MIN_QUERY_LENGTH;

    // 1) Embedding cho query (bản gốc + variant leet nếu có), song song.
    //    Fallback null nếu provider tắt/lỗi — RRF vẫn chạy được.
    const embedTasks: Promise<number[] | null>[] = [
      this.embedder.enabled
        ? this.safe('dense query', () => this.embedder.generateEmbedding(q))
        : Promise.resolve(null),
      this.hf.bgeEnabled
        ? this.safe('bge query', () => this.hf.embedTextBge(q))
        : Promise.resolve(null),
    ];
    if (useVariant) {
      embedTasks.push(
        this.embedder.enabled
          ? this.safe('dense query (variant)', () => this.embedder.generateEmbedding(qNormalized))
          : Promise.resolve(null),
        this.hf.bgeEnabled
          ? this.safe('bge query (variant)', () => this.hf.embedTextBge(qNormalized))
          : Promise.resolve(null),
      );
    }
    const [denseVec, bgeVec, denseVecV, bgeVecV] = await Promise.all(embedTasks);

    // 2) RPC song song. Với variant, gộp bằng MAX similarity/rank per file.
    const rpcTasks: Promise<unknown>[] = [
      denseVec ? this.rpcDense(denseVec, userId) : Promise.resolve<DenseRow[]>([]),
      bgeVec ? this.rpcBge(bgeVec, userId) : Promise.resolve<BgeRow[]>([]),
      this.rpcFts(q, userId),
    ];
    if (useVariant) {
      rpcTasks.push(
        denseVecV ? this.rpcDense(denseVecV, userId) : Promise.resolve<DenseRow[]>([]),
        bgeVecV ? this.rpcBge(bgeVecV, userId) : Promise.resolve<BgeRow[]>([]),
        this.rpcFts(qNormalized, userId),
      );
    }
    const rpcResults = await Promise.all(rpcTasks);
    let dense = rpcResults[0] as DenseRow[];
    let bge = rpcResults[1] as BgeRow[];
    let fts = rpcResults[2] as FtsRow[];
    if (useVariant) {
      dense = this.mergeMax(dense, rpcResults[3] as DenseRow[], (r) => r.similarity);
      bge = this.mergeMax(bge, rpcResults[4] as BgeRow[], (r) => r.similarity);
      fts = this.mergeMax(fts, rpcResults[5] as FtsRow[], (r) => r.rank);
    }

    // 3) Fuse RRF (chỉ dùng để XẾP HẠNG). % hiển thị lấy trực tiếp từ cosine
    //    cao nhất — có ý nghĩa tuyệt đối (0.7 = rất liên quan) thay vì tỉ lệ
    //    tương đối kiểu "top nào cũng 100%".
    type Acc = {
      fileId: string;
      rrfScore: number;
      denseSim: number;
      bgeSim: number;
      ftsHit: boolean;
      matchedBy: Set<SearchBranch>;
      snippets: string[];
      seenSnippets: Set<string>;
      rerankSim?: number;
    };
    const acc = new Map<string, Acc>();
    const getOrInit = (fileId: string): Acc => {
      let a = acc.get(fileId);
      if (!a) {
        a = {
          fileId, rrfScore: 0, denseSim: 0, bgeSim: 0, ftsHit: false,
          matchedBy: new Set(), snippets: [], seenSnippets: new Set(),
        };
        acc.set(fileId, a);
      }
      return a;
    };
    const pushSnippet = (a: Acc, snippet: string) => {
      const key = snippet.replace(/\s+/g, ' ').slice(0, 120);
      if (!key || a.seenSnippets.has(key) || a.snippets.length >= 2) return;
      a.snippets.push(snippet);
      a.seenSnippets.add(key);
    };

    dense.forEach((r, i) => {
      const a = getOrInit(r.file_id);
      a.rrfScore += 1 / (RRF_K + i);
      a.matchedBy.add('dense');
      a.denseSim = Math.max(a.denseSim, r.similarity);
      pushSnippet(a, r.content);
    });
    bge.forEach((r, i) => {
      const a = getOrInit(r.file_id);
      a.rrfScore += 1 / (RRF_K + i);
      a.matchedBy.add('bge');
      a.bgeSim = Math.max(a.bgeSim, r.similarity);
      pushSnippet(a, r.content);
    });
    fts.forEach((r, i) => {
      const a = getOrInit(r.file_id);
      a.rrfScore += 1 / (RRF_K + i);
      a.matchedBy.add('fts');
      a.ftsHit = true;
      pushSnippet(a, r.content);
    });

    // 4) LỌC: FTS luôn qua; ngoài ra cần "đồng thuận 2 branch" hoặc "1 branch
    //    rất cao" — giảm false positive kiểu match ngữ nghĩa lỏng lẻo.
    const filtered = [...acc.values()].filter((a) => {
      if (a.ftsHit) return true;
      const strong = a.denseSim >= MIN_DENSE_STRONG || a.bgeSim >= MIN_BGE_STRONG;
      const joint = a.denseSim >= MIN_DENSE_JOINT && a.bgeSim >= MIN_BGE_JOINT;
      return strong || joint;
    });
    let list = filtered.sort((a, b) => b.rrfScore - a.rrfScore).slice(0, FINAL_TOP_K);

    // 4b) RERANK cross-encoder (BGE-reranker-v2-m3) — chấm điểm cặp (query,
    //     doc) chính xác hơn dense/bge khi 2 kết quả gần giống nhau (VD "áo
    //     số 7" giữa 2 ảnh cầu thủ khác số áo). Best-effort.
    const rerankable = list.filter((a) => a.snippets.length > 0);
    if (this.hf.rerankerEnabled && rerankable.length > 1) {
      try {
        const docs = rerankable.map((a) => a.snippets[0].slice(0, 1024));
        const scores = await this.hf.rerankPairs(q, docs);
        const rerankScore = new Map<string, number>();
        for (let i = 0; i < rerankable.length; i++) {
          rerankScore.set(rerankable[i].fileId, scores[i] ?? 0);
        }
        list = list.filter((a) => {
          const s = rerankScore.get(a.fileId);
          return s === undefined || s >= MIN_RERANK_SIM;
        });
        list.sort((a, b) => {
          const ra = rerankScore.get(a.fileId);
          const rb = rerankScore.get(b.fileId);
          if (ra === undefined && rb === undefined) return b.rrfScore - a.rrfScore;
          if (ra === undefined) return 1;
          if (rb === undefined) return -1;
          return rb - ra;
        });
        list = list.map((a) => {
          const s = rerankScore.get(a.fileId);
          return s !== undefined ? { ...a, rerankSim: s } : a;
        });
      } catch (err) {
        this.logger.warn(`Rerank lỗi: ${(err as Error).message} — giữ thứ tự RRF.`);
      }
    }

    // 5) Enrich metadata cho UI (1 truy vấn IN, không N+1) + presign thumbnail.
    const files = await this.prisma.file.findMany({
      where: { id: { in: list.map((a) => a.fileId) } },
      select: {
        id: true, name: true, extension: true, size: true,
        thumbnailUrl: true, folderId: true, hlsStatus: true,
      },
    });
    const meta = new Map(files.map((f) => [f.id, f]));

    const results: SearchResult[] = [];
    for (const a of list) {
      const m = meta.get(a.fileId);
      if (!m) continue; // file bị xoá giữa lúc search — bỏ qua
      let thumb: string | null = null;
      if (m.thumbnailUrl) {
        thumb = await this.storage.presignGet(m.thumbnailUrl, { expiresIn: 3600 });
      }
      // % hiển thị: ưu tiên reranker (chính xác nhất) -> cosine cao nhất ->
      // 0.85 nếu chỉ có FTS (không có điểm số liên tục).
      const bestSim = Math.max(a.denseSim, a.bgeSim);
      const displaySim = a.rerankSim ?? (bestSim > 0 ? bestSim : a.ftsHit ? 0.85 : 0);
      results.push({
        id: m.id,
        name: m.name,
        extension: m.extension,
        size: m.size.toString(),
        thumbnailUrl: thumb,
        folderId: m.folderId,
        hlsStatus: m.hlsStatus,
        snippet: a.snippets[0]?.trim() || null,
        similarity: Math.min(1, displaySim),
        matchedBy: [...a.matchedBy],
      });
    }
    return results;
  }

  // --- Merge variant: gộp 2 result set theo file_id, giữ MAX theo `scoreOf`. ---
  private mergeMax<T extends { file_id: string }>(
    a: T[],
    b: T[],
    scoreOf: (r: T) => number,
  ): T[] {
    const m = new Map<string, T>();
    for (const r of [...a, ...b]) {
      const prev = m.get(r.file_id);
      if (!prev || scoreOf(r) > scoreOf(prev)) m.set(r.file_id, r);
    }
    return [...m.values()]
      .sort((x, y) => scoreOf(y) - scoreOf(x))
      .slice(0, PER_BRANCH_TOP_K);
  }

  // --- RPC wrappers -------------------------------------------------------

  private rpcDense(vec: number[], userId: string): Promise<DenseRow[]> {
    return this.prisma
      .$queryRawUnsafe<DenseRow[]>(
        `SELECT * FROM match_document_chunks($1::vector, $2::uuid, $3::int)`,
        `[${vec.join(',')}]`,
        userId,
        PER_BRANCH_TOP_K,
      )
      .catch((err) => {
        this.logger.warn(`RPC dense lỗi: ${(err as Error).message}`);
        return [];
      });
  }

  private rpcBge(vec: number[], userId: string): Promise<BgeRow[]> {
    return this.prisma
      .$queryRawUnsafe<BgeRow[]>(
        `SELECT * FROM match_document_chunks_bge($1::vector, $2::uuid, $3::int)`,
        `[${vec.join(',')}]`,
        userId,
        PER_BRANCH_TOP_K,
      )
      .catch((err) => {
        this.logger.warn(`RPC bge lỗi (có thể chưa migrate): ${err.message}`);
        return [];
      });
  }

  private rpcFts(text: string, userId: string): Promise<FtsRow[]> {
    return this.prisma
      .$queryRawUnsafe<FtsRow[]>(
        `SELECT * FROM match_document_chunks_fts($1::text, $2::uuid, $3::int)`,
        text,
        userId,
        PER_BRANCH_TOP_K,
      )
      .catch((err) => {
        this.logger.warn(`RPC fts lỗi (có thể chưa migrate): ${err.message}`);
        return [];
      });
  }

  // Gọi hàm async, nuốt lỗi, log rồi trả null — dùng cho các nhánh embed query.
  private async safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Search ${label} lỗi: ${(err as Error).message}`);
      return null;
    }
  }
}
