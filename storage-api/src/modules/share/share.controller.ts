import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateLinkDto, InviteDto, UpdateShareDto } from './dto/share.dto';
import { ShareService } from './share.service';

/** Nhóm A — quản lý quyền chia sẻ (owner, có đăng nhập) — mục 12.E. */
@Controller('shares')
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post('link')
  createLink(@CurrentUser('id') userId: string, @Body() dto: CreateLinkDto) {
    return this.share.createLink(userId, dto);
  }

  @Post('invite')
  invite(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') ownerEmail: string,
    @Body() dto: InviteDto,
  ) {
    return this.share.invite(userId, ownerEmail ?? '', dto);
  }

  /** Gợi ý email khi gõ ở ô "Mời qua email" — chỉ user đã có tài khoản. */
  @Get('users/search')
  searchUsers(@CurrentUser('id') userId: string, @Query('q') q?: string) {
    return this.share.searchUsersByEmail(userId, q ?? '');
  }

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query('fileId') fileId?: string,
    @Query('folderId') folderId?: string,
  ) {
    return this.share.listForTarget(userId, fileId, folderId);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateShareDto,
  ) {
    return this.share.update(userId, id, dto);
  }

  @Delete(':id')
  async revoke(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.share.revoke(userId, id);
    return { success: true };
  }
}
