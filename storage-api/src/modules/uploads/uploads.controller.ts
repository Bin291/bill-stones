import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AbortUploadDto,
  CompleteUploadDto,
  InitUploadDto,
} from './dto/upload.dto';
import { UploadsService } from './uploads.service';
import { VirusScanService } from '../virus-scan/virus-scan.service';

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly virusScan: VirusScanService,
  ) {}

  /**
   * POST /uploads/scan-hash — quét virus theo sha256 (tệp đã có trong CSDL
   * VirusTotal → kết quả tức thì, không cần tải bytes). Client tính sha256.
   */
  @Post('scan-hash')
  scanHash(
    @CurrentUser('id') _userId: string,
    @Body() body: { sha256?: string },
  ) {
    const sha = (body.sha256 ?? '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha)) {
      throw new BadRequestException('sha256 không hợp lệ');
    }
    return this.virusScan.scanByHash(sha);
  }

  /**
   * POST /uploads/scan-file — quét virus tệp LẠ (hash 404): client gửi nguyên
   * bytes (raw octet-stream), backend tải lên VirusTotal phân tích rồi chờ.
   * Tên tệp qua header x-file-name.
   */
  @Post('scan-file')
  scanFile(
    @CurrentUser('id') _userId: string,
    @Req() req: Request,
    @Headers('x-file-name') fileNameRaw: string,
  ) {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException('Body phải là octet-stream (Buffer)');
    }
    let fileName = 'upload.bin';
    try {
      fileName = fileNameRaw ? decodeURIComponent(fileNameRaw) : fileName;
    } catch {
      /* header không decode được — dùng tên mặc định */
    }
    return this.virusScan.scanBytes(body, fileName);
  }

  /** POST /uploads/init — mở phiên multipart. */
  @Post('init')
  init(@CurrentUser('id') userId: string, @Body() dto: InitUploadDto) {
    return this.uploads.init(
      userId,
      dto.name,
      dto.size,
      dto.mimeType,
      dto.folderId ?? null,
      dto.duplicateAction,
    );
  }

  /**
   * POST /uploads/part — nhận 1 chunk (raw octet-stream, mục 5.A).
   * Metadata qua header: x-file-id, x-upload-id, x-part-number.
   * Body raw được parse bởi express.raw() đăng ký ở main.ts cho route này.
   */
  @Post('part')
  uploadPart(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Headers('x-file-id') fileId: string,
    @Headers('x-upload-id') uploadId: string,
    @Headers('x-part-number') partNumberRaw: string,
  ) {
    if (!fileId || !uploadId || !partNumberRaw) {
      throw new BadRequestException(
        'Thiếu header x-file-id / x-upload-id / x-part-number',
      );
    }
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('Body chunk phải là octet-stream (Buffer)');
    }
    const partNumber = parseInt(partNumberRaw, 10);
    return this.uploads.uploadPart(userId, fileId, uploadId, partNumber, body);
  }

  /** POST /uploads/complete — ghép part. */
  @Post('complete')
  complete(@CurrentUser('id') userId: string, @Body() dto: CompleteUploadDto) {
    return this.uploads.complete(userId, dto.fileId, dto.uploadId, dto.parts);
  }

  /** POST /uploads/abort — huỷ phiên. */
  @Post('abort')
  async abort(@CurrentUser('id') userId: string, @Body() dto: AbortUploadDto) {
    await this.uploads.abort(userId, dto.fileId, dto.uploadId);
    return { success: true };
  }

  /** GET-like resume qua POST để tránh cache: liệt kê part đã nhận. */
  @Post('list-parts')
  listParts(
    @CurrentUser('id') userId: string,
    @Query('fileId') fileId: string,
    @Query('uploadId') uploadId: string,
    @Body() body: { fileId?: string; uploadId?: string },
  ) {
    const fid = fileId || body.fileId;
    const uid = uploadId || body.uploadId;
    if (!fid || !uid) throw new BadRequestException('Thiếu fileId / uploadId');
    return this.uploads.listParts(userId, fid, uid);
  }
}
