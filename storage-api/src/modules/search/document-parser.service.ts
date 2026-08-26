import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'log', 'xml', 'yml', 'yaml',
  'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql',
]);
// Excel: đọc bằng thư viện xlsx (đã có sẵn, dùng cho preview ở
// doc-preview.service.ts) — chuyển mỗi sheet thành CSV để FTS/embedding bắt
// được cả tên cột lẫn dữ liệu ô. Trước đây KHÔNG nằm trong supports() nên
// file Excel hoàn toàn không được lập chỉ mục.
const EXCEL_EXT = new Set(['xlsx', 'xls']);
// DOCX có thể chứa ẢNH nhúng (screenshot, biểu đồ dán) — mammoth.extractRawText
// bỏ qua hoàn toàn ảnh, chỉ lấy text. Bổ sung bằng cách trích từng ảnh nhúng
// rồi caption qua CÙNG pipeline vision dùng cho ảnh độc lập.
const DOCX_VISION_MAX_IMAGES = 6;
// Ảnh: dùng Gemini vision auto-caption (OCR + mô tả + từ khoá) thay vì
// SigLIP/CLIP — HF Inference Providers không host serverless nhóm model này
// nữa (2025, xem HYBRID_SEARCH.md §4.2). Text sinh ra chảy vào cùng pipeline
// chunk/embed như tài liệu thường -> tự động lọt vào cả 3 nhánh dense/bge/fts.
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);

const PROMPT_IMAGE =
  'Trả về ĐÚNG format sau (không giải thích thêm, không thêm markdown):\n\n' +
  'OCR:\n<mọi chữ/số hiện trong ảnh, giữ nguyên thứ tự dòng; ' +
  'nếu không có chữ ghi "(không có chữ)">\n\n' +
  'MÔ TẢ:\n<mô tả bằng tiếng Việt tự nhiên, 2–4 câu, LIỆT KÊ RÕ: ' +
  'loại ảnh, vật thể/người chính, số áo hoặc số hiệu nếu có, ' +
  'màu sắc chủ đạo, hành động, bối cảnh>\n\n' +
  'TỪ KHOÁ:\n<5–15 từ khoá/cụm từ tiếng Việt phân tách bằng dấu phẩy, ' +
  'BAO GỒM: tên chính, TÊN GỌI DÂN DÃ / TÊN THƯỜNG GỌI (nếu là loài động ' +
  'vật, thực vật, món ăn — ví dụ "hoa xuyến chi" thì thêm "cứt lợn, cỏ hôi, ' +
  'cỏ heo, đơn kim"), THUỘC TÍNH nổi bật (màu, hình dạng, số), NGỮ CẢNH sử ' +
  'dụng. Không viết câu, chỉ dán từ khoá.>\n\n' +
  'KEYWORDS EN:\n<bản dịch tiếng Anh của 5–10 từ khoá quan trọng nhất ở trên ' +
  '(vật thể chính, màu sắc, hành động, tên riêng) — GHI TỪNG TỪ ĐƠN LẺ bằng ' +
  'tiếng Anh, phân tách dấu phẩy, không viết câu. Mục này giúp tìm kiếm bằng ' +
  'tiếng Anh vẫn ra kết quả dù mô tả chính viết tiếng Việt.>';

// PDF có bảng/biểu đồ dán dưới dạng ẢNH RASTER (rất phổ biến ở paper khoa
// học) -> pdf-parse chỉ đọc text layer nên các số liệu trong bảng loại này
// KHÔNG bao giờ được trích xuất, kể cả khi trang đó vẫn có nhiều text thật
// khác (nên không thể dò bằng mật độ ký tự/trang). Test thực tế: gửi CẢ file
// PDF cho Gemini (document understanding đa phương thức, không phải OCR ảnh
// từng trang) đọc đúng bảng bị rasterize. Giới hạn dung lượng/trang để tránh
// tốn quota cho file quá lớn — 1 lần gọi/file (lúc index), không phải theo
// từng trang/ảnh.
const PDF_VISION_MAX_BYTES = 15 * 1024 * 1024; // ~20MB base64 sau inflate — dưới trần inline data của Gemini
const PDF_VISION_MAX_PAGES = 40;
const PROMPT_PDF =
  'Đây là 1 file PDF. Nhiệm vụ: liệt kê lại TOÀN BỘ nội dung các BẢNG SỐ ' +
  'LIỆU và BIỂU ĐỒ/HÌNH có trong tài liệu mà có thể KHÔNG trích xuất được ' +
  'bằng text layer thông thường (vd bảng dán dưới dạng ảnh chụp/screenshot). ' +
  'Với MỖI bảng: ghi rõ số Table, tiêu đề bảng, rồi liệt kê ĐẦY ĐỦ từng hàng ' +
  'theo dạng "tên hàng: cột1=giá_trị1, cột2=giá_trị2, ...", GIỮ NGUYÊN CHÍNH ' +
  'XÁC mọi con số/phần trăm/ký hiệu (không làm tròn, không suy diễn). Với ' +
  'biểu đồ/hình: mô tả ngắn nội dung chính. Bỏ qua phần văn bản/đoạn văn ' +
  'thường (đã có text layer riêng, không cần lặp lại). Nếu tài liệu không có ' +
  'bảng/hình dạng ảnh nào, trả về đúng chuỗi "(không có)".';

/**
 * Trích text thô để lập chỉ mục (mục 8.D). Không cần API key cho tài liệu:
 * PDF -> pdf-parse, DOCX -> mammoth, text/code -> đọc thẳng.
 * Ảnh cần API key (BazaarLink/Gemini) -> vision auto-caption (mục 8.E).
 */
// Gemini free tier: 5 request/phút cho generateContent (vision) — vượt quá
// là 429 RESOURCE_EXHAUSTED và ảnh đó bị bỏ qua HOÀN TOÀN (không exception ở
// tầng index() vì runVisionForImage trả '' thay vì throw). Giãn cách CHUNG
// (static, dùng chung mọi instance/request) để reindex hàng loạt không tự
// đốt hết quota trong vài giây.
const GEMINI_MIN_INTERVAL_MS = 13_000; // 60s/5 + biên an toàn
const GEMINI_MAX_RETRIES = 2;

@Injectable()
export class DocumentParserService {
  private readonly log = new Logger(DocumentParserService.name);
  private readonly ai?: OpenAI;
  private readonly gemini?: GoogleGenAI;
  private readonly ocrModel: string; // BazaarLink
  private readonly geminiOcrModel: string;
  private bazaarDisabled = false;
  // static: chia sẻ giữa MỌI file đang index song song trong tiến trình.
  private static geminiChain: Promise<void> = Promise.resolve();
  private static lastGeminiCallAt = 0;

  constructor(private readonly config: ConfigService) {
    const bazaarKey = this.config.get<string>('ai.bazaarlinkApiKey') ?? '';
    if (bazaarKey) {
      this.ai = new OpenAI({
        apiKey: bazaarKey,
        baseURL: this.config.get<string>('ai.bazaarlinkBaseUrl', 'https://bazaarlink.ai/api/v1'),
      });
    }
    const geminiKey = this.config.get<string>('ai.geminiApiKey') ?? '';
    if (geminiKey) this.gemini = new GoogleGenAI({ apiKey: geminiKey });

    this.ocrModel = this.config.get<string>('ai.bazaarlinkOcrModel', 'google/gemini-2.5-flash');
    this.geminiOcrModel = this.config.get<string>('ai.geminiOcrModel', 'gemini-3.5-flash');
  }

  supports(extension: string): boolean {
    const e = extension.toLowerCase();
    return (
      e === 'pdf' || e === 'docx' || TEXT_EXT.has(e) || IMAGE_EXT.has(e) || EXCEL_EXT.has(e)
    );
  }

  /** true nếu đuôi là ảnh cần vision (dùng để bỏ qua sớm khi không có API key nào). */
  isImage(extension: string): boolean {
    return IMAGE_EXT.has(extension.toLowerCase());
  }

  async extractText(buffer: Buffer, extension: string, mimeType?: string): Promise<string> {
    const e = extension.toLowerCase();
    try {
      if (e === 'pdf') {
        // pdf-parse v2: dùng class PDFParse.
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        let text = '';
        let pageCount = 0;
        try {
          const res = await parser.getText();
          text = res.text ?? '';
          pageCount = res.total ?? 0;
        } finally {
          await parser.destroy().catch(() => undefined);
        }
        const supplement = await this.runVisionForPdf(buffer, pageCount);
        return supplement ? `${text}\n\n${supplement}` : text;
      }
      if (e === 'docx') {
        const res = await mammoth.extractRawText({ buffer });
        const text = res.value ?? '';
        const supplement = await this.runVisionForDocxImages(buffer);
        return supplement ? `${text}\n\n${supplement}` : text;
      }
      if (TEXT_EXT.has(e)) {
        return buffer.toString('utf8');
      }
      if (EXCEL_EXT.has(e)) {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const parts: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]).trim();
          if (csv) parts.push(`### Sheet: ${sheetName} ###\n${csv}`);
        }
        return parts.join('\n\n');
      }
      if (IMAGE_EXT.has(e)) {
        return await this.runVisionForImage(buffer, mimeType || `image/${e}`);
      }
    } catch (err) {
      this.log.warn(`Trích text (${e}) lỗi: ${(err as Error).message}`);
    }
    return '';
  }

  /** Cắt 1000 ký tự, overlap 100 (mục 8.C) — không thêm thư viện. */
  chunk(text: string, size = 1000, overlap = 100): string[] {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const chunks: string[] = [];
    let i = 0;
    while (i < clean.length) {
      chunks.push(clean.slice(i, i + size));
      i += size - overlap;
      if (chunks.length > 5000) break; // chặn an toàn file khổng lồ
    }
    return chunks;
  }

  /**
   * OCR + mô tả + từ khoá cho ẢNH — thay thế nhánh SigLIP không dùng được.
   * "Auto-captioning": Gemini/BazaarLink vision trả 3 khối OCR/MÔ TẢ/TỪ KHOÁ
   * để hybrid search bắt được cả chữ hiện trong ảnh lẫn nội dung ảnh (vật
   * thể, màu, số áo, tên dân dã...).
   */
  private async runVisionForImage(buffer: Buffer, mimeType: string): Promise<string> {
    if (this.ai && !this.bazaarDisabled) {
      try {
        const res = await this.ai.chat.completions.create({
          model: this.ocrModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT_IMAGE },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` },
                },
              ],
            },
          ],
        });
        return (res.choices[0]?.message?.content ?? '').trim();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 402) {
          this.bazaarDisabled = true;
          this.log.warn(
            'BazaarLink 402 (hết credit) — chuyển vision sang Gemini cho phần còn lại của session.',
          );
        } else {
          this.log.warn(
            `BazaarLink vision lỗi (${status ?? '?'}): ${(err as Error).message} — thử Gemini.`,
          );
        }
      }
    }

    if (this.gemini) {
      return this.callGeminiPaced([
        { text: PROMPT_IMAGE },
        { inlineData: { mimeType, data: buffer.toString('base64') } },
      ]);
    }

    return '';
  }

  /**
   * Bổ sung nội dung BẢNG/BIỂU ĐỒ dạng ảnh raster nhúng trong PDF — thứ mà
   * pdf-parse (chỉ đọc text layer) không bao giờ thấy được, kể cả khi trang
   * đó vẫn có nhiều text thật khác (nên không dò được bằng mật độ ký tự).
   * Gửi CẢ file 1 lần (document understanding), không phải OCR từng trang.
   */
  private async runVisionForPdf(buffer: Buffer, pageCount: number): Promise<string> {
    if (!this.gemini) return '';
    if (buffer.length > PDF_VISION_MAX_BYTES) {
      this.log.warn(`PDF quá lớn (${buffer.length}B) — bỏ qua bổ sung vision.`);
      return '';
    }
    if (pageCount > PDF_VISION_MAX_PAGES) {
      this.log.warn(`PDF quá nhiều trang (${pageCount}) — bỏ qua bổ sung vision.`);
      return '';
    }
    const result = await this.callGeminiPaced([
      { text: PROMPT_PDF },
      { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
    ]);
    const trimmed = result.trim();
    return trimmed && trimmed !== '(không có)' ? trimmed : '';
  }

  /**
   * Trích ẢNH nhúng trong DOCX (screenshot, biểu đồ dán...) rồi caption từng
   * ảnh qua CÙNG pipeline vision dùng cho ảnh độc lập — mammoth.extractRawText
   * bỏ qua hoàn toàn ảnh nên nếu không có bước này, nội dung ảnh trong docx
   * sẽ vô hình với search giống hệt vấn đề bảng-dạng-ảnh trong PDF.
   * Dùng convertToHtml() CHỈ để lấy callback ảnh — bỏ qua phần HTML trả về,
   * text chính vẫn lấy từ extractRawText() (giữ nguyên hành vi cũ, an toàn).
   */
  private async runVisionForDocxImages(buffer: Buffer): Promise<string> {
    if (!this.gemini && !this.ai) return '';
    const images: { data: string; contentType: string }[] = [];
    try {
      await mammoth.convertToHtml(
        { buffer },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            if (images.length < DOCX_VISION_MAX_IMAGES) {
              const data = await image.read('base64');
              images.push({ data, contentType: image.contentType || 'image/png' });
            }
            return { src: '' };
          }),
        },
      );
    } catch (err) {
      this.log.warn(`Đọc ảnh nhúng DOCX lỗi: ${(err as Error).message}`);
      return '';
    }
    if (images.length === 0) return '';

    const captions: string[] = [];
    for (const img of images) {
      const mimeType = img.contentType.startsWith('image/') ? img.contentType : 'image/png';
      const caption = await this.runVisionForImage(Buffer.from(img.data, 'base64'), mimeType);
      if (caption) captions.push(caption);
    }
    return captions.length
      ? `### ẢNH NHÚNG TRONG TÀI LIỆU ###\n\n${captions.join('\n\n---\n\n')}`
      : '';
  }

  /** Gọi Gemini generateContent với giãn cách + retry-on-429 dùng chung. */
  private async callGeminiPaced(
    parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
  ): Promise<string> {
    if (!this.gemini) return '';
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      await this.paceGemini();
      try {
        const res = await this.gemini.models.generateContent({
          model: this.geminiOcrModel,
          contents: [{ role: 'user', parts }],
        });
        return (res.text ?? '').trim();
      } catch (err) {
        const message = (err as Error).message;
        const retryDelay = this.parseRetryDelayMs(message);
        if (retryDelay !== null && attempt < GEMINI_MAX_RETRIES) {
          this.log.warn(
            `Gemini vision 429 (hết quota phút này) — thử lại sau ${Math.round(retryDelay / 1000)}s (lần ${attempt + 1}/${GEMINI_MAX_RETRIES}).`,
          );
          await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        this.log.warn(`Gemini vision lỗi: ${message}`);
        break;
      }
    }
    return '';
  }

  /** Giãn cách các lệnh gọi Gemini vision để không vượt quota free-tier. */
  private async paceGemini(): Promise<void> {
    const prevChain = DocumentParserService.geminiChain;
    let release!: () => void;
    DocumentParserService.geminiChain = new Promise((r) => (release = r));
    await prevChain;
    const wait = DocumentParserService.lastGeminiCallAt + GEMINI_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    DocumentParserService.lastGeminiCallAt = Date.now();
    release();
  }

  /** Đọc "retryDelay":"38s" từ lỗi 429 của Gemini (RESOURCE_EXHAUSTED). */
  private parseRetryDelayMs(message: string): number | null {
    if (!message.includes('RESOURCE_EXHAUSTED')) return null;
    const m = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    return m ? Math.ceil(parseFloat(m[1]) * 1000) + 1000 : 30_000;
  }
}
