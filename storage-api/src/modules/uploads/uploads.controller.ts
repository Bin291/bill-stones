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

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

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
