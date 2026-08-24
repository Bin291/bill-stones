import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { StorageService } from '../storage/storage.service';

const OFFICE = new Set(['docx']);
const SHEET = new Set(['xlsx', 'xls', 'csv']);
const TEXT = new Set([
  'txt', 'md', 'markdown', 'json', 'log', 'xml', 'yml', 'yaml',
  'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql',
]);
const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Render nội dung tài liệu thành HTML để xem trước: DOCX (mammoth, ảnh inline),
 * Excel/CSV (SheetJS -> bảng HTML), text/code (<pre>). PDF dùng iframe presigned
 * (không qua đây).
 */
@Injectable()
export class DocPreviewService {
  private readonly log = new Logger(DocPreviewService.name);

  constructor(private readonly storage: StorageService) {}

  supports(extension: string): boolean {
    const e = extension.toLowerCase();
    return OFFICE.has(e) || SHEET.has(e) || TEXT.has(e);
  }

  async renderHtml(file: { r2Key: string; extension: string }): Promise<string> {
    const e = file.extension.toLowerCase();
    if (!this.supports(e)) throw new BadRequestException('Loại tệp không hỗ trợ xem trước HTML');

    const buffer = await this.storage.getObjectBuffer(file.r2Key);
    if (buffer.length > MAX_BYTES) {
      return '<p style="color:#8c8c8c">Tệp quá lớn để xem trước.</p>';
    }

    if (OFFICE.has(e)) {
      // mammoth mặc định nhúng ảnh dạng data URI -> giữ hình trong DOCX.
      const res = await mammoth.convertToHtml({ buffer });
      return `<div class="doc-html">${res.value}</div>`;
    }

    if (SHEET.has(e)) {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const parts: string[] = [];
      for (const name of wb.SheetNames) {
        const html = XLSX.utils.sheet_to_html(wb.Sheets[name]);
        parts.push(`<h3 class="sheet-title">${this.escape(name)}</h3>${html}`);
      }
      return `<div class="doc-html sheet-html">${parts.join('')}</div>`;
    }

    // text/code
    const text = buffer.toString('utf8');
    return `<pre class="doc-pre">${this.escape(text)}</pre>`;
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
