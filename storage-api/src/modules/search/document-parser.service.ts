import { Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'log', 'xml', 'yml', 'yaml',
  'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql',
]);

/**
 * Trích text thô để lập chỉ mục FTS (mục 8.D). Không cần API key:
 * PDF -> pdf-parse, DOCX -> mammoth, text/code -> đọc thẳng. XLSX/PPTX (mục phụ) bỏ qua.
 */
@Injectable()
export class DocumentParserService {
  private readonly log = new Logger(DocumentParserService.name);

  supports(extension: string): boolean {
    const e = extension.toLowerCase();
    return e === 'pdf' || e === 'docx' || TEXT_EXT.has(e);
  }

  async extractText(buffer: Buffer, extension: string): Promise<string> {
    const e = extension.toLowerCase();
    try {
      if (e === 'pdf') {
        // pdf-parse v2: dùng class PDFParse.
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        try {
          const res = await parser.getText();
          return res.text ?? '';
        } finally {
          await parser.destroy().catch(() => undefined);
        }
      }
      if (e === 'docx') {
        const res = await mammoth.extractRawText({ buffer });
        return res.value ?? '';
      }
      if (TEXT_EXT.has(e)) {
        return buffer.toString('utf8');
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
}
