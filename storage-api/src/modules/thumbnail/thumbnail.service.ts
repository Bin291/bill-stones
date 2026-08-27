import { Injectable, Logger } from '@nestjs/common';
import { File } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', 'flv', 'wmv']);
const PDF_EXT = new Set(['pdf']);
const DOC_EXT = new Set(['docx']);
const SHEET_EXT = new Set(['xlsx', 'xls', 'csv']);
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'log', 'xml', 'yml', 'yaml',
  'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql',
]);
const THUMB_W = 400;
const THUMB_H = 300;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // >300MB thì bỏ qua để không xử lý nặng
const MAX_SNIPPET_BYTES = 40 * 1024 * 1024; // khớp giới hạn của DocPreviewService

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Sinh thumbnail (mục 7):
 * - Ảnh: sharp resize trực tiếp.
 * - Video: ffmpeg chụp 1 frame trong ~10s đầu.
 * - PDF: rasterize trang 1 bằng pdfjs-dist + @napi-rs/canvas (không cần cài
 *   LibreOffice/Poppler ở hệ thống — canvas đi kèm binary dựng sẵn theo nền tảng).
 * - DOCX/XLSX/XLS/CSV/text/code: KHÔNG render pixel-perfect (nặng, cần LibreOffice)
 *   mà vẽ "snippet" nội dung THẬT (vài dòng văn bản/ô đầu) thành ảnh nhẹ qua SVG+sharp.
 * Lưu webp lên R2 tại `{userId}/{fileId}.thumb.webp`, set File.thumbnailUrl = key đó
 * (FilesService sẽ ký presigned URL khi trả về client).
 */
@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  supports(extension: string): boolean {
    const e = extension.toLowerCase();
    return IMAGE_EXT.has(e) || VIDEO_EXT.has(e) || this.supportsSnippet(e);
  }

  private supportsSnippet(ext: string): boolean {
    return PDF_EXT.has(ext) || DOC_EXT.has(ext) || SHEET_EXT.has(ext) || TEXT_EXT.has(ext);
  }

  /** Chạy nền, nuốt lỗi (không chặn luồng upload). Dedupe theo fileId. */
  generateInBackground(file: Pick<File, 'id' | 'userId' | 'r2Key' | 'extension' | 'size'>): void {
    if (this.inProgress.has(file.id)) return;
    this.inProgress.add(file.id);
    void this.generate(file)
      .catch((err) => this.logger.warn(`Thumbnail ${file.id} lỗi: ${(err as Error).message}`))
      .finally(() => this.inProgress.delete(file.id));
  }

  async generate(
    file: Pick<File, 'id' | 'userId' | 'r2Key' | 'extension' | 'size'>,
  ): Promise<void> {
    const ext = file.extension.toLowerCase();
    let webp: Buffer | null = null;

    if (IMAGE_EXT.has(ext)) {
      const src = await this.storage.getObjectBuffer(file.r2Key);
      webp = await this.toWebp(src);
    } else if (VIDEO_EXT.has(ext)) {
      if (Number(file.size) > MAX_VIDEO_BYTES) return;
      webp = await this.videoThumb(file.r2Key, file.id, ext);
    } else if (this.supportsSnippet(ext)) {
      if (Number(file.size) > MAX_SNIPPET_BYTES) return;
      const src = await this.storage.getObjectBuffer(file.r2Key);
      webp = await this.snippetThumb(src, ext);
    } else {
      return;
    }

    if (!webp) return;
    const key = this.storage.thumbnailKey(file.userId, file.id);
    await this.storage.putObject(key, webp, 'image/webp');
    await this.prisma.file.update({ where: { id: file.id }, data: { thumbnailUrl: key } });
    this.logger.log(`Đã sinh thumbnail cho ${file.id}`);
  }

  private toWebp(input: Buffer): Promise<Buffer> {
    return sharp(input)
      .rotate() // tôn trọng EXIF orientation
      .resize(THUMB_W, THUMB_H, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
  }

  /** Chụp 1 frame video trong 10s đầu (thử giây 1, fallback giây 0). */
  private async videoThumb(r2Key: string, fileId: string, ext: string): Promise<Buffer | null> {
    const srcPath = join(tmpdir(), `thumb-${fileId}.${ext}`);
    const framePath = join(tmpdir(), `thumb-${fileId}.png`);
    try {
      await this.storage.downloadToFile(r2Key, srcPath);
      let ok = await this.grabFrame(srcPath, framePath, 1).catch(() => false);
      if (!ok) ok = await this.grabFrame(srcPath, framePath, 0).catch(() => false);
      if (!ok) return null;
      const frame = await fs.readFile(framePath);
      return await this.toWebp(frame);
    } finally {
      await fs.rm(srcPath, { force: true }).catch(() => undefined);
      await fs.rm(framePath, { force: true }).catch(() => undefined);
    }
  }

  private grabFrame(srcPath: string, outPath: string, atSeconds: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      ffmpeg(srcPath)
        .inputOptions(['-ss', String(atSeconds)]) // seek nhanh trước input
        .outputOptions(['-frames:v', '1'])
        .output(outPath)
        .on('end', () => resolve(true))
        .on('error', (e: Error) => reject(e))
        .run();
    });
  }

  private async snippetThumb(buffer: Buffer, ext: string): Promise<Buffer | null> {
    try {
      if (PDF_EXT.has(ext)) return await this.pdfThumb(buffer);
      if (DOC_EXT.has(ext)) return await this.docxSnippet(buffer);
      if (SHEET_EXT.has(ext)) return await this.sheetSnippet(buffer);
      return await this.textSnippet(buffer, ext);
    } catch (e) {
      this.logger.warn(`Snippet thumb (${ext}) lỗi: ${(e as Error).message}`);
      return null;
    }
  }

  /** Rasterize trang 1 của PDF thành ảnh — dùng pdfjs-dist (ESM, cần import động) + canvas dựng sẵn. */
  private async pdfThumb(buffer: Buffer): Promise<Buffer | null> {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas, DOMMatrix } = await import('@napi-rs/canvas');
    if (!(globalThis as { DOMMatrix?: unknown }).DOMMatrix) {
      (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrix;
    }
    const fontsDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      standardFontDataUrl: pathToFileURL(fontsDir).href,
    } as Parameters<typeof pdfjsLib.getDocument>[0]);
    try {
      const doc = await loadingTask.promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(THUMB_W / base.width, THUMB_H / base.height);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        canvas: canvas as unknown,
        viewport,
      } as unknown as Parameters<typeof page.render>[0]).promise;
      return await this.toWebp(canvas.toBuffer('image/png'));
    } finally {
      await loadingTask.destroy();
    }
  }

  /** Snippet DOCX: vài dòng đầu của nội dung text thật (mammoth), không kèm định dạng. */
  private async docxSnippet(buffer: Buffer): Promise<Buffer> {
    const res = await mammoth.extractRawText({ buffer });
    const lines = this.wrapText(res.value.trim().slice(0, 600), 42).slice(0, 9);
    return this.renderSnippet(lines, 'DOCX', '#0f62fe');
  }

  /** Snippet Excel/CSV: vài hàng x cột đầu của sheet đầu tiên. */
  private async sheetSnippet(buffer: Buffer): Promise<Buffer> {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const first = wb.SheetNames[0];
    const rows = first
      ? (XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, blankrows: false }) as unknown[][])
      : [];
    const lines = rows
      .slice(0, 8)
      .map((row) => row.slice(0, 5).map((c) => String(c ?? '').slice(0, 12)).join('  ').slice(0, 44));
    return this.renderSnippet(lines, 'SHEET', '#24a148');
  }

  /** Snippet text/code: vài dòng đầu nguyên văn. */
  private textSnippet(buffer: Buffer, ext: string): Promise<Buffer> {
    const lines = buffer
      .toString('utf8')
      .split(/\r?\n/)
      .slice(0, 16)
      .map((l) => l.slice(0, 46));
    return this.renderSnippet(lines, ext.toUpperCase(), '#8a3ffc');
  }

  /** Vẽ 1 "thẻ" nội dung (nhãn loại file + vài dòng thật) thành ảnh webp qua SVG. */
  private renderSnippet(lines: string[], label: string, accent: string): Promise<Buffer> {
    const padding = 20;
    const lineHeight = 20;
    const safeLines = lines.length ? lines : ['(trống)'];
    const textNodes = safeLines
      .map(
        (l, i) =>
          `<text x="${padding}" y="${padding + 34 + i * lineHeight}" font-family="Menlo, Consolas, monospace" font-size="13" fill="#3d3d3d">${this.escapeXml(l)}</text>`,
      )
      .join('');
    const svg = `<svg width="${THUMB_W}" height="${THUMB_H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff" />
      <rect x="0" y="0" width="100%" height="6" fill="${accent}" />
      <text x="${padding}" y="${padding + 12}" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${accent}" letter-spacing="1">${label}</text>
      ${textNodes}
    </svg>`;
    return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  }

  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Bọc đoạn văn bản dài thành nhiều dòng ngắn (~`width` ký tự/dòng) để vẽ snippet. */
  private wrapText(text: string, width: number): string[] {
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (!w) continue;
      if ((cur ? cur + ' ' + w : w).length > width) {
        if (cur) lines.push(cur);
        cur = w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
}
