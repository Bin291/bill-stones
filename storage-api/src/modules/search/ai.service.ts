import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_DIM = 768; // khớp cột DocumentChunk.embedding vector(768)
const EMBED_BATCH = 50;

/**
 * Lớp AI cho Hybrid Search (mục 8.E):
 *  - embed(): Gemini `gemini-embedding-001` (dense 768d) cho chunk + query.
 *  - captionImage(): Gemini vision sinh OCR + mô tả + từ khoá (kể cả tên dân dã)
 *    để ảnh cũng tìm được bằng ngôn ngữ tự nhiên.
 *  - rerank(): cross-encoder qua HF (fail-soft — nếu lỗi thì giữ thứ tự RRF).
 * Không có key -> enabled()=false, pipeline tự lùi về FTS.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);

  constructor(private readonly config: ConfigService) {}

  private geminiKey(): string {
    return this.config.get<string>('ai.geminiApiKey') ?? '';
  }
  private hfKey(): string {
    return this.config.get<string>('ai.hfApiKey') ?? '';
  }

  /** Có thể sinh embedding (nhánh dense) không. */
  enabled(): boolean {
    return !!this.geminiKey();
  }

  private embedModel(): string {
    return this.config.get<string>('ai.geminiEmbeddingModel') || 'gemini-embedding-001';
  }
  private visionModel(): string {
    return this.config.get<string>('ai.geminiOcrModel') || 'gemini-2.0-flash';
  }

  /** L2-normalize (Gemini khuyến nghị khi giảm chiều < 3072). */
  private normalize(v: number[]): number[] {
    let s = 0;
    for (const x of v) s += x * x;
    const n = Math.sqrt(s) || 1;
    return v.map((x) => x / n);
  }

  /**
   * Embed nhiều đoạn text -> vector 768d (đã chuẩn hoá). null nếu không có key/lỗi.
   * taskType bất đối xứng: RETRIEVAL_DOCUMENT khi index, RETRIEVAL_QUERY khi tìm —
   * đây là chìa khoá để retrieval đúng ngữ cảnh & đa ngôn ngữ.
   */
  async embed(
    texts: string[],
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
  ): Promise<number[][] | null> {
    const key = this.geminiKey();
    if (!key || texts.length === 0) return null;
    const model = this.embedModel();
    const out: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        const body = {
          requests: batch.map((t) => ({
            model: `models/${model}`,
            content: { parts: [{ text: t.slice(0, 8000) }] },
            taskType,
            outputDimensionality: EMBED_DIM,
          })),
        };
        const r = await fetch(
          `${GEMINI_BASE}/models/${model}:batchEmbedContents?key=${encodeURIComponent(key)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        );
        if (!r.ok) {
          this.log.warn(`Gemini embed ${r.status}: ${(await r.text()).slice(0, 160)}`);
          return null;
        }
        const data = (await r.json()) as { embeddings?: { values: number[] }[] };
        for (const e of data.embeddings ?? []) out.push(this.normalize(e.values));
      }
      return out.length === texts.length ? out : null;
    } catch (e) {
      this.log.warn(`Gemini embed lỗi: ${(e as Error).message}`);
      return null;
    }
  }

  /** Embed 1 câu truy vấn (dùng taskType RETRIEVAL_QUERY). */
  async embedQuery(text: string): Promise<number[] | null> {
    const r = await this.embed([text], 'RETRIEVAL_QUERY');
    return r ? r[0] : null;
  }

  /** Sinh mô tả + OCR + từ khoá cho ảnh (tiếng Việt). '' nếu lỗi/không có key. */
  async captionImage(buffer: Buffer, mimeType: string): Promise<string> {
    const key = this.geminiKey();
    if (!key) return '';
    const model = this.visionModel();
    const prompt =
      'Bạn là công cụ lập chỉ mục ảnh. Mô tả ảnh này bằng tiếng Việt để phục vụ ' +
      'tìm kiếm: (1) nội dung/vật thể chính, (2) mọi chữ xuất hiện trong ảnh (OCR), ' +
      '(3) danh sách từ khoá gồm cả tên gọi dân dã/thông thường. Trả về văn bản thuần, ngắn gọn.';
    try {
      const r = await fetch(
        `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
                  { text: prompt },
                ],
              },
            ],
          }),
        },
      );
      if (!r.ok) {
        this.log.warn(`Gemini vision ${r.status}: ${(await r.text()).slice(0, 160)}`);
        return '';
      }
      const data = (await r.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(' ').trim() ?? '';
    } catch (e) {
      this.log.warn(`Gemini vision lỗi: ${(e as Error).message}`);
      return '';
    }
  }

  /**
   * Rerank bằng cross-encoder qua HF (BAAI/bge-reranker-v2-m3). Trả mảng điểm cùng
   * thứ tự docs, hoặc null nếu không dùng được (fail-soft -> giữ thứ tự RRF).
   */
  async rerank(query: string, docs: string[]): Promise<number[] | null> {
    const key = this.hfKey();
    if (!key || docs.length === 0) return null;
    const model = this.config.get<string>('ai.hfRerankerModel') || 'BAAI/bge-reranker-v2-m3';
    const base = (this.config.get<string>('ai.hfBaseUrl') || 'https://router.huggingface.co').replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/hf-inference/models/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: { source_sentence: query, sentences: docs.map((d) => d.slice(0, 2000)) },
        }),
      });
      if (!r.ok) {
        this.log.warn(`HF rerank ${r.status}: ${(await r.text()).slice(0, 120)}`);
        return null;
      }
      const data = await r.json();
      if (Array.isArray(data) && data.every((x) => typeof x === 'number')) return data as number[];
      return null;
    } catch (e) {
      this.log.warn(`HF rerank lỗi: ${(e as Error).message}`);
      return null;
    }
  }
}
