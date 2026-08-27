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
// >8MB thì không sinh nền lúc upload (đợi request đầu tiên convert on-demand) —
// tránh dồn việc nặng vào lúc upload hàng loạt.
const MAX_PREGENERATE_BYTES = 8 * 1024 * 1024;

/**
 * Render nội dung tài liệu thành HTML để xem trước: DOCX (mammoth, ảnh inline),
 * Excel/CSV (SheetJS -> bảng HTML), text/code (<pre>). PDF dùng iframe presigned
 * (không qua đây).
 *
 * Kết quả được CACHE trên R2 (`{userId}/{fileId}.preview.html`, mục 1.5): convert
 * docx/xlsx nặng (tải nguyên file + parse) chỉ chạy 1 lần — lần mở sau (hoặc mọi
 * người xem link chia sẻ) chỉ tải lại HTML đã render sẵn, không convert lại.
 */
@Injectable()
export class DocPreviewService {
  private readonly log = new Logger(DocPreviewService.name);
  private readonly inProgress = new Set<string>();

  constructor(private readonly storage: StorageService) {}

  supports(extension: string): boolean {
    const e = extension.toLowerCase();
    return OFFICE.has(e) || SHEET.has(e) || TEXT.has(e);
  }

  async renderHtml(file: { id: string; userId: string; r2Key: string; extension: string }): Promise<string> {
    const e = file.extension.toLowerCase();
    if (!this.supports(e)) throw new BadRequestException('Loại tệp không hỗ trợ xem trước HTML');

    const cacheKey = this.storage.previewHtmlKey(file.userId, file.id);
    const cached = await this.storage.getObjectBufferIfExists(cacheKey);
    if (cached) return cached.toString('utf8');

    const html = await this.render(file.r2Key, e);
    // Lỗi ghi cache không nên chặn việc trả preview cho user — chỉ log.
    await this.storage
      .putObject(cacheKey, html, 'text/html; charset=utf-8')
      .catch((err) => this.log.warn(`Không ghi được cache preview ${file.id}: ${(err as Error).message}`));
    return html;
  }

  /** Sinh + cache trước lúc upload xong (file nhỏ) — mở lần đầu cũng nhanh (mục 1.5). */
  pregenerateInBackground(file: { id: string; userId: string; r2Key: string; extension: string; size: bigint | number }): void {
    const e = file.extension.toLowerCase();
    if (!this.supports(e)) return;
    if (Number(file.size) > MAX_PREGENERATE_BYTES) return;
    if (this.inProgress.has(file.id)) return;
    this.inProgress.add(file.id);
    void this.renderHtml(file)
      .catch((err) => this.log.warn(`Pregenerate preview ${file.id} lỗi: ${(err as Error).message}`))
      .finally(() => this.inProgress.delete(file.id));
  }

  private async render(r2Key: string, e: string): Promise<string> {
    const buffer = await this.storage.getObjectBuffer(r2Key);
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
