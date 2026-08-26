import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Wrapper mỏng cho HuggingFace Inference Providers (mục 8.E — hybrid search).
 *
 * Chỉ 2 việc:
 *   - embedTextBge(text)      -> vector 1024d (BAAI/bge-m3, dense đa ngôn ngữ)
 *   - rerankPairs(query, docs) -> cross-encoder BAAI/bge-reranker-v2-m3, chấm
 *     điểm CHÍNH XÁC hơn dense/bge cho từng cặp (query, doc)
 *
 * Không có nhánh ảnh (SigLIP/CLIP): đã thử — HF Inference Providers 2025 không
 * host serverless model nào trong nhóm này ("Model not supported by provider
 * hf-inference"). Ảnh được xử lý bằng Gemini vision auto-caption (xem
 * DocumentParserService) rồi chảy vào pipeline text bình thường.
 */
@Injectable()
export class HfInferenceService {
  private readonly logger = new Logger(HfInferenceService.name);
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly bgeModel: string;
  private readonly bgeDim: number;
  private readonly rerankerModel: string;
  private readonly timeoutMs: number;
  readonly bgeEnabled: boolean;
  readonly rerankerEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('ai.hfApiKey') ?? '';
    this.baseUrl = this.config.get<string>(
      'ai.hfBaseUrl',
      'https://router.huggingface.co',
    );
    this.bgeModel = this.config.get<string>('ai.hfBgeModel', 'BAAI/bge-m3');
    this.bgeDim = this.config.get<number>('ai.hfBgeDimensions', 1024);
    this.rerankerModel = this.config.get<string>(
      'ai.hfRerankerModel',
      'BAAI/bge-reranker-v2-m3',
    );
    this.timeoutMs = this.config.get<number>('ai.hfTimeoutMs', 45000);
    this.bgeEnabled = this.config.get<boolean>('ai.hfEnableBge', true) && this.token.length > 0;
    this.rerankerEnabled =
      this.config.get<boolean>('ai.hfEnableReranker', true) && this.token.length > 0;

    if (!this.token) {
      this.logger.warn('HF_API_KEY trống — nhánh BGE-M3 và reranker sẽ bị bỏ qua.');
    }
  }

  get bgeDimensions(): number {
    return this.bgeDim;
  }

  /** BAAI/bge-m3 dense — 1024 chiều, chuẩn hoá L2 để so cosine bằng dot. */
  async embedTextBge(text: string): Promise<number[]> {
    const raw = await this.request(this.bgeModel, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
    });
    return this.finalize(raw, this.bgeDim, 'bge-m3');
  }

  /**
   * BGE reranker — cross-encoder. Trả điểm 0..1 cho MỖI cặp (query, doc).
   * Chính xác hơn dense/bge (bi-encoder) vì nhìn đồng thời cả 2 text.
   * 1 request batch cho toàn bộ docs -> giảm latency so với gọi lần lượt.
   */
  async rerankPairs(query: string, docs: string[]): Promise<number[]> {
    if (docs.length === 0) return [];
    const inputs = docs.map((d) => ({ text: query, text_pair: d }));
    const raw = await this.request(this.rerankerModel, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs, options: { wait_for_model: true } }),
      pipeline: 'text-classification',
    });
    // HF trả về 1 trong 2 shape (thấy cả 2 khi test thực tế):
    //   A. [[obj0, obj1, ..., objN-1]]  — outer 1 phần tử, inner có N kết quả
    //   B. [obj0, obj1, ..., objN-1]    — flat N kết quả
    if (!Array.isArray(raw)) throw new Error('reranker: response không phải mảng');
    let flat: unknown[] = raw as unknown[];
    if (
      flat.length === 1 &&
      Array.isArray(flat[0]) &&
      (flat[0] as unknown[]).length === docs.length
    ) {
      flat = flat[0] as unknown[];
    }
    if (flat.length !== docs.length) {
      throw new Error(
        `reranker: nhận ${flat.length} kết quả cho ${docs.length} cặp — shape lạ`,
      );
    }
    return flat.map((cell) => {
      const s = (cell as { score?: number } | undefined)?.score;
      return typeof s === 'number' ? s : 0;
    });
  }

  // --- internal ---

  private async request(
    model: string,
    init: { headers: Record<string, string>; body: string; pipeline?: string },
  ): Promise<unknown> {
    if (!this.token) throw new Error('HF_API_KEY chưa cấu hình');
    // HF gộp Inference API cũ (api-inference.huggingface.co — đã ngừng DNS) vào
    // Inference Providers 2025 (router.huggingface.co/hf-inference/models/<id>/pipeline/<task>).
    const pipeline = init.pipeline ?? 'feature-extraction';
    const url = this.baseUrl.includes('router.huggingface.co')
      ? `${this.baseUrl}/hf-inference/models/${model}/pipeline/${pipeline}`
      : `${this.baseUrl}/models/${model}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, ...init.headers },
        body: init.body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HF ${res.status} @ ${model}: ${body.slice(0, 300) || res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`HF timeout ${this.timeoutMs}ms @ ${model}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * HF trả về nhiều shape: [f, f, ...], [[f, f, ...]], hoặc {embedding: [...]}.
   * Gom về mảng phẳng, kiểm tra chiều, chuẩn hoá L2 (để cosine = dot).
   */
  private finalize(raw: unknown, expectedDim: number, label: string): number[] {
    const vec = this.normalizeVector(raw);
    if (vec.length === 0) throw new Error(`HF ${label}: response rỗng`);
    if (vec.length !== expectedDim) {
      this.logger.warn(
        `HF ${label}: nhận ${vec.length} chiều nhưng cấu hình ${expectedDim}. ` +
          `Kiểm tra HF_BGE_MODEL / HF_BGE_DIMENSIONS + cột vector trong schema.prisma.`,
      );
    }
    return this.l2Normalize(vec);
  }

  private normalizeVector(raw: unknown): number[] {
    if (Array.isArray(raw)) {
      let cur: unknown = raw;
      while (Array.isArray(cur) && cur.length > 0 && Array.isArray(cur[0])) {
        cur = cur[0];
      }
      if (Array.isArray(cur) && cur.every((x) => typeof x === 'number')) {
        return cur as number[];
      }
      // Token-level embedding chưa pool -> mean-pool trên trục thời gian.
      if (
        Array.isArray(raw[0]) &&
        Array.isArray((raw as number[][])[0]) &&
        typeof (raw as number[][])[0][0] === 'number'
      ) {
        const tokens = raw as number[][];
        const dim = tokens[0].length;
        const out = new Array<number>(dim).fill(0);
        for (const t of tokens) for (let i = 0; i < dim; i++) out[i] += t[i];
        for (let i = 0; i < dim; i++) out[i] /= tokens.length;
        return out;
      }
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.embedding)) return this.normalizeVector(obj.embedding);
      if (Array.isArray(obj.embeddings)) return this.normalizeVector(obj.embeddings);
    }
    return [];
  }

  private l2Normalize(v: number[]): number[] {
    let sum = 0;
    for (const x of v) sum += x * x;
    const n = Math.sqrt(sum);
    if (n === 0 || !isFinite(n)) return v;
    return v.map((x) => x / n);
  }
}
