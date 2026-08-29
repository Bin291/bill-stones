import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { File } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService, CompletedPart } from '../storage/storage.service';
import { FoldersService } from '../folders/folders.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { HlsTranscodeService } from '../hls/hls-transcode.service';
import { IndexingService } from '../search/indexing.service';
import { DocPreviewService } from '../files/doc-preview.service';
import { UsersService } from '../users/users.service';
import {
  resolveNameCollision,
  extractExtension,
} from '../../common/utils/name-collision';

export interface InitUploadResult {
  fileId: string;
  uploadId: string;
  r2Key: string;
  chunkSize: number; // bytes
  name: string; // tên cuối cùng sau khi giải trùng
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly maxFileSize: number;
  private readonly chunkSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly folders: FoldersService,
    private readonly thumbnails: ThumbnailService,
    private readonly hls: HlsTranscodeService,
    private readonly indexing: IndexingService,
    private readonly docPreview: DocPreviewService,
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    this.maxFileSize =
      (config.get<number>('limits.maxFileSizeMb') ?? 2048) * 1024 * 1024;
    this.chunkSize =
      (config.get<number>('limits.chunkSizeMb') ?? 8) * 1024 * 1024;
  }

  /** Mở phiên multipart: tạo File row + CreateMultipartUpload trên R2 (mục 5.A). */
  async init(
    userId: string,
    name: string,
    sizeStr: string,
    mimeType: string | undefined,
    folderId: string | null,
    duplicateAction?: 'rename' | 'overwrite',
  ): Promise<InitUploadResult> {
    let size: bigint;
    try {
      size = BigInt(sizeStr);
    } catch {
      throw new BadRequestException('size không hợp lệ');
    }
    if (size <= BigInt(0)) throw new BadRequestException('size phải > 0');
    if (size > BigInt(this.maxFileSize)) {
      throw new BadRequestException(
        `Tệp vượt trần ${Math.round(this.maxFileSize / 1024 / 1024)}MB (mục 5.D)`,
      );
    }
    if (folderId) await this.folders.assertOwned(folderId, userId);

    // Chặn upload vượt hạn mức lưu trữ (mục Cài đặt — Gói & Dung lượng).
    const [usedBytes, quotaBytes] = await Promise.all([
      this.users.usedBytes(userId),
      this.users.quotaBytes(userId),
    ]);
    if (usedBytes + size > quotaBytes) {
      const usedGb = (Number(usedBytes) / 1024 / 1024 / 1024).toFixed(2);
      const quotaGb = (Number(quotaBytes) / 1024 / 1024 / 1024).toFixed(0);
      throw new BadRequestException(
        `Đã dùng ${usedGb}GB / ${quotaGb}GB — tệp này vượt hạn mức lưu trữ`,
      );
    }

    const siblings = await this.prisma.file.findMany({
      where: { userId, folderId: folderId ?? null, deletedAt: null },
      select: { id: true, name: true },
    });
    const collision = siblings.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());

    // Trùng tên: theo lựa chọn client gửi cho lần này, hoặc mặc định đã lưu ở Cài đặt.
    const policy = duplicateAction ?? (await this.users.duplicatePolicy(userId));
    let finalName = name;
    if (collision) {
      if (policy === 'ask') {
        throw new ConflictException({
          code: 'DUPLICATE_NAME',
          message: `Đã có tệp "${name}" trong thư mục này`,
          existingFileId: collision.id,
          name,
        });
      }
      if (policy === 'overwrite') {
        // Đưa file trùng tên cũ vào Thùng rác — giữ tên gốc cho file mới.
        await this.prisma.file.update({
          where: { id: collision.id },
          data: { deletedAt: new Date() },
        });
      } else {
        // rename (mặc định, mục 2.1): tự thêm hậu tố " (2)", " (3)"…
        finalName = resolveNameCollision(
          name,
          siblings.map((s) => s.name),
          false,
        );
      }
    }
    const extension = extractExtension(finalName);

    const file = await this.prisma.file.create({
      data: {
        name: finalName,
        extension,
        r2Key: `pending-${randomUUID()}`, // đặt tạm (duy nhất), cập nhật sau khi có id
        size,
        mimeType: mimeType ?? 'application/octet-stream',
        userId,
        folderId: folderId ?? null,
        status: 'uploading',
      },
    });

    const r2Key = this.storage.objectKey(userId, file.id);
    const uploadId = await this.storage.createMultipartUpload(
      r2Key,
      file.mimeType,
    );
    await this.prisma.file.update({ where: { id: file.id }, data: { r2Key } });

    return {
      fileId: file.id,
      uploadId,
      r2Key,
      chunkSize: this.chunkSize,
      name: finalName,
    };
  }

  /** Nhận 1 chunk, đẩy lên R2, trả ETag (mục 5.A — chunk đi qua backend, né CORS). */
  async uploadPart(
    userId: string,
    fileId: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<{ ETag: string; PartNumber: number }> {
    const file = await this.getUploadingFile(userId, fileId);
    if (!body || body.length === 0) throw new BadRequestException('Chunk rỗng');
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      throw new BadRequestException('partNumber không hợp lệ');
    }
    const etag = await this.storage.uploadPart(
      file.r2Key,
      uploadId,
      partNumber,
      body,
    );
    return { ETag: etag, PartNumber: partNumber };
  }

  /** Ghép part -> hoàn tất. Set status = 'processing' để pipeline AI/thumbnail xử lý. */
  async complete(
    userId: string,
    fileId: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<File> {
    const file = await this.getUploadingFile(userId, fileId);
    await this.storage.completeMultipartUpload(file.r2Key, uploadId, parts);
    // Pipeline AI + thumbnail (mục 5.B, 7) sẽ chuyển 'processing' -> 'ready'/'failed'.
    // Trước khi có worker (giai đoạn sau), tạm set 'ready' để file dùng được ngay.
    const updated = await this.prisma.file.update({
      where: { id: fileId },
      data: { status: 'ready' },
    });
    this.logger.log(`Upload hoàn tất: ${fileId} (${updated.name})`);
    // Sinh thumbnail nền (không chặn response — mục 7.A).
    if (this.thumbnails.supports(updated.extension)) {
      this.thumbnails.generateInBackground(updated);
    }
    // Transcode HLS nền cho video (streaming + ABR).
    if (this.hls.supports(updated.extension)) {
      this.hls.transcodeInBackground(updated);
    }
    // Lập chỉ mục FTS nền cho tài liệu/text (tìm kiếm — mục 8.E).
    if (this.indexing.supports(updated.extension)) {
      this.indexing.indexInBackground(updated);
    }
    // Render + cache trước HTML preview cho file nhỏ — mở lần đầu cũng nhanh (mục 1.5).
    this.docPreview.pregenerateInBackground(updated);
    return updated;
  }

  /** Huỷ phiên: abort trên R2 + xoá row File tạm. */
  async abort(userId: string, fileId: string, uploadId: string): Promise<void> {
    const file = await this.getUploadingFile(userId, fileId);
    try {
      await this.storage.abortMultipartUpload(file.r2Key, uploadId);
    } catch (err) {
      this.logger.warn(`Abort R2 lỗi (bỏ qua): ${(err as Error).message}`);
    }
    // Huỷ ở ~99% (đã gọi complete): multipart không abort được nữa nhưng object đã
    // ghép xong → xoá object để không bỏ lại rác trên R2.
    await this.storage.deleteObjects([file.r2Key]).catch(() => undefined);
    await this.prisma.file.delete({ where: { id: fileId } });
  }

  /** Resume: hỏi R2 phần nào đã nhận (mục 5.A). */
  async listParts(
    userId: string,
    fileId: string,
    uploadId: string,
  ): Promise<CompletedPart[]> {
    const file = await this.getUploadingFile(userId, fileId);
    return this.storage.listParts(file.r2Key, uploadId);
  }

  private async getUploadingFile(
    userId: string,
    fileId: string,
  ): Promise<File> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Phiên upload không tồn tại');
    if (file.userId !== userId)
      throw new ForbiddenException('Không có quyền với phiên upload này');
    return file;
  }
}
