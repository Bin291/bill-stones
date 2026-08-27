import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  /** GET /tags — thẻ của user + số file đang gắn. */
  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.tags.list(userId);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateTagDto) {
    return this.tags.create(userId, dto.name, dto.color);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tags.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.tags.remove(userId, id);
    return { success: true };
  }

  /** Gán thẻ :id cho file :fileId. */
  @Post(':id/files/:fileId')
  async assign(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    await this.tags.assign(userId, id, fileId);
    return { success: true };
  }

  /** Bỏ gán thẻ :id khỏi file :fileId. */
  @Delete(':id/files/:fileId')
  async unassign(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    await this.tags.unassign(userId, id, fileId);
    return { success: true };
  }

  /** Gán thẻ :id cho thư mục :folderId. */
  @Post(':id/folders/:folderId')
  async assignFolder(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('folderId') folderId: string,
  ) {
    await this.tags.assignFolder(userId, id, folderId);
    return { success: true };
  }

  /** Bỏ gán thẻ :id khỏi thư mục :folderId. */
  @Delete(':id/folders/:folderId')
  async unassignFolder(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('folderId') folderId: string,
  ) {
    await this.tags.unassignFolder(userId, id, folderId);
    return { success: true };
  }
}
