import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

/**
 * Sinh embedding text 768d — chuẩn khớp cột pgvector(768) trên DocumentChunk.
 *
 * Chọn provider theo thứ tự:
 *   1. BazaarLink (OpenAI-compatible) nếu còn API key VÀ chưa gặp 402 credit
 *   2. Direct Google Gemini (embedding-001, outputDimensionality=768) — fallback
 *
 * Lý do fallback thay vì cứng 1 provider: BazaarLink hết credit trả 402 -> để
 * pipeline tự chuyển sang Gemini khỏi phải sửa env & restart. Khi user nạp lại
 * credit, restart process sẽ reset "circuit" và ưu tiên BazaarLink trở lại.
 */
@Injectable()
export class AiEmbeddingService {
  private readonly logger = new Logger(AiEmbeddingService.name);
  private readonly bazaar?: OpenAI;
  private readonly gemini?: GoogleGenAI;
  private readonly bazaarModel: string;
  private readonly geminiModel: string;
  private readonly dim: number;
  private bazaarDisabled = false; // sau 1 lần 402, không thử BazaarLink nữa trong session

  constructor(private readonly config: ConfigService) {
    const bazaarKey = this.config.get<string>('ai.bazaarlinkApiKey') ?? '';
    const bazaarUrl = this.config.get<string>(
      'ai.bazaarlinkBaseUrl',
      'https://bazaarlink.ai/api/v1',
    );
    const geminiKey = this.config.get<string>('ai.geminiApiKey') ?? '';

    if (bazaarKey) {
      this.bazaar = new OpenAI({ apiKey: bazaarKey, baseURL: bazaarUrl });
    }
    if (geminiKey) {
      this.gemini = new GoogleGenAI({ apiKey: geminiKey });
    }
    this.bazaarModel = this.config.get<string>(
      'ai.bazaarlinkEmbeddingModel',
      'openai/text-embedding-3-small',
    );
    this.geminiModel = this.config.get<string>('ai.geminiEmbeddingModel', 'gemini-embedding-001');
    this.dim = this.config.get<number>('ai.embedDimensions', 768);

    if (!this.bazaar && !this.gemini) {
      this.logger.warn(
        'Không cấu hình BAZAARLINK_API_KEY lẫn GEMINI_API_KEY — nhánh dense embedding tắt.',
      );
    }
  }

  /** true nếu có ít nhất 1 provider khả dụng (dùng để bỏ qua nhánh dense sớm). */
  get enabled(): boolean {
    return !!this.bazaar || !!this.gemini;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const [vec] = await this.generateEmbeddings([text]);
    return vec;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (this.bazaar && !this.bazaarDisabled) {
      try {
        const res = await this.bazaar.embeddings.create({
          model: this.bazaarModel,
          input: texts,
          dimensions: this.dim,
        });
        return (res.data ?? []).map((e) => e.embedding ?? []);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 402) {
          this.bazaarDisabled = true;
          this.logger.warn(
            'BazaarLink 402 (hết credit) — chuyển embedding sang Gemini cho phần còn lại của session.',
          );
        } else {
          this.logger.warn(
            `BazaarLink embed lỗi (${status ?? '?'}): ${(err as Error).message} — thử Gemini.`,
          );
        }
      }
    }

    if (this.gemini) {
      // Gemini không có batch input trong API SDK hiện tại — gọi tuần tự.
      const out: number[][] = [];
      for (const t of texts) {
        const res = await this.gemini.models.embedContent({
          model: this.geminiModel,
          contents: t,
          config: { outputDimensionality: this.dim },
        });
        out.push(res.embeddings?.[0]?.values ?? []);
      }
      return out;
    }

    throw new Error('Không provider nào khả dụng để sinh embedding');
  }
}
