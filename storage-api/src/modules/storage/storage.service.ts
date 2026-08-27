import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

export interface PresignGetOptions {
  expiresIn?: number; // giây, mặc định 600
  downloadFileName?: string; // set Content-Disposition attachment
  responseContentType?: string;
}

/**
 * Lớp truy cập Cloudflare R2 qua API tương thích S3 (mục 5.F).
 * Toàn bộ luồng multipart/presign/ListParts/stream/delete gói ở đây để đổi
 * provider chỉ cần đổi cấu hình client, không đụng nơi gọi.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | null;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('r2.bucket') ?? 'storage-app';
    this.publicBaseUrl =
      this.config.get<string | null>('r2.publicBaseUrl') ?? null;

    this.client = new S3Client({
      region: this.config.get<string>('r2.region') ?? 'auto',
      endpoint: this.config.get<string>('r2.endpoint'),
      credentials: {
        accessKeyId: this.config.get<string>('r2.accessKeyId') ?? '',
        secretAccessKey: this.config.get<string>('r2.secretAccessKey') ?? '',
      },
      // Giữ cấu hình từ giai đoạn GCS (mục 5.F #49): vô hại trên R2, đỡ dính lại
      // nếu sau này đổi provider lần nữa.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Key object cố định theo ID (mục 5.A) — rename/move chỉ là thao tác DB. */
  objectKey(userId: string, fileId: string): string {
    return `${userId}/${fileId}`;
  }

  thumbnailKey(userId: string, fileId: string): string {
    return `${userId}/${fileId}.thumb.webp`;
  }

  /** Key cache HTML preview đã render sẵn (docx/xlsx/csv/text/code — mục 1.5). */
  previewHtmlKey(userId: string, fileId: string): string {
    return `${userId}/${fileId}.preview.html`;
  }

  artifactKey(userId: string, fileId: string): string {
    return `${userId}/${fileId}.txt`;
  }

  // --- Multipart upload (mục 5.A) ---

  async createMultipartUpload(
    key: string,
    contentType?: string,
  ): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) throw new Error('R2 không trả UploadId');
    return res.UploadId;
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer | Uint8Array,
  ): Promise<string> {
    const res = await this.client.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
      }),
    );
    if (!res.ETag) throw new Error('R2 không trả ETag cho part');
    return res.ETag;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .slice()
            .sort((a, b) => a.PartNumber - b.PartNumber)
            .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  /** Resume: hỏi thẳng R2 phần nào đã nhận (mục 5.A) — không cần bảng DB riêng. */
  async listParts(key: string, uploadId: string): Promise<CompletedPart[]> {
    const parts: CompletedPart[] = [];
    let marker: string | undefined;
    do {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber && p.ETag)
          parts.push({ PartNumber: p.PartNumber, ETag: p.ETag });
      }
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  // --- Đọc / ghi object thường ---

  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    cacheControl?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return res.Body as Readable;
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
      );
    }
    return Buffer.concat(chunks);
  }

  /** Như getObjectBuffer, nhưng trả null (thay vì ném lỗi) nếu object chưa tồn tại. */
  async getObjectBufferIfExists(key: string): Promise<Buffer | null> {
    try {
      return await this.getObjectBuffer(key);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw e;
    }
  }

  /** Liệt kê + xoá mọi object dưới 1 prefix (VD dọn cây HLS khi xoá video). */
  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    const keys: string[] = [];
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
          ContinuationToken: token,
        }),
      );
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    await this.deleteObjects(keys);
  }

  /** Tải object về file tạm (cho ffmpeg đọc frame video — mục 7.C). */
  async downloadToFile(key: string, filePath: string): Promise<void> {
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const stream = await this.getObjectStream(key);
    await pipeline(stream, createWriteStream(filePath));
  }

  /** Xoá nhiều object 1 lần (mục 7.E — gốc + thumbnail + artifact). */
  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    // DeleteObjects giới hạn 1000 key/lần.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  // --- Presigned URL (mục 5.C) ---

  async presignGet(key: string, opts: PresignGetOptions = {}): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts.downloadFileName
        ? `attachment; filename="${encodeURIComponent(opts.downloadFileName)}"`
        : undefined,
      ResponseContentType: opts.responseContentType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: opts.expiresIn ?? 600,
    });
  }

  /** Fallback: cho trình duyệt PUT thẳng 1 part (mục 5.A — hiện không dùng). */
  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn = 600,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Theo mục 12.B: R2_PUBLIC_BASE_URL để trống ⇒ luôn trả null ⇒ mọi đường đọc
   * đều là presigned, link chia sẻ thu hồi được.
   */
  publicUrl(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}
