import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { UnlockDto } from './dto/share.dto';
import { ShareService } from './share.service';

/**
 * Nhóm B — truy cập công khai (KHÔNG guard) — mục 12.E.
 * Không bao giờ trả fileId thật/URL bucket; mọi thứ phân giải từ token.
 */
@Public()
@Controller('s')
export class PublicShareController {
  constructor(private readonly share: ShareService) {}

  /** Metadata dựng trang. Nếu có mật khẩu mà chưa mở khoá → chỉ trả requiresPassword. */
  @Get(':token')
  async meta(
    @Param('token') token: string,
    @Headers('x-share-session') session?: string,
  ) {
    const share = await this.share.resolvePublicShare(token);
    const kind = share.file ? 'file' : 'folder';
    if (!this.share.isUnlocked(share, session)) {
      return { kind, requiresPassword: true };
    }
    if (share.file) {
      return {
        kind: 'file',
        requiresPassword: false,
        allowDownload: share.allowDownload,
        name: share.file.name,
        extension: share.file.extension,
        mimeType: share.file.mimeType,
        size: share.file.size.toString(),
      };
    }
    return {
      kind: 'folder',
      requiresPassword: false,
      allowDownload: share.allowDownload,
      name: share.folder!.name,
    };
  }

  @Post(':token/unlock')
  async unlock(@Param('token') token: string, @Body() dto: UnlockDto) {
    const share = await this.share.resolvePublicShare(token);
    const sessionToken = this.share.unlock(share, dto.password);
    return { sessionToken };
  }

  @Get(':token/content')
  content(
    @Param('token') token: string,
    @Headers('x-share-session') session?: string,
    @Query('fileId') fileId?: string,
  ) {
    return this.withUnlocked(token, session, (share) =>
      this.share.publicContentUrl(share, 'inline', fileId),
    );
  }

  @Get(':token/download')
  download(
    @Param('token') token: string,
    @Headers('x-share-session') session?: string,
    @Query('fileId') fileId?: string,
  ) {
    return this.withUnlocked(token, session, (share) =>
      this.share.publicContentUrl(share, 'attachment', fileId),
    );
  }

  /** Render nội dung tệp (docx/xlsx/csv/text/code) thành HTML để xem trước inline. */
  @Get(':token/preview')
  preview(
    @Param('token') token: string,
    @Headers('x-share-session') session?: string,
    @Query('fileId') fileId?: string,
  ) {
    return this.withUnlocked(token, session, (share) =>
      this.share.publicPreviewHtml(share, fileId),
    );
  }

  /** Chỉ với link folder: duyệt cây con read-only (verify hậu duệ trong service). */
  @Get(':token/list')
  list(
    @Param('token') token: string,
    @Headers('x-share-session') session?: string,
    @Query('folderId') folderId?: string,
  ) {
    return this.withUnlocked(token, session, (share) =>
      this.share.publicListChildren(share, folderId),
    );
  }

  private async withUnlocked<T>(
    token: string,
    session: string | undefined,
    fn: (
      share: Awaited<ReturnType<ShareService['resolvePublicShare']>>,
    ) => Promise<T>,
  ): Promise<T> {
    const share = await this.share.resolvePublicShare(token);
    if (!this.share.isUnlocked(share, session)) {
      throw new ForbiddenException('Cần mật khẩu');
    }
    return fn(share);
  }
}
