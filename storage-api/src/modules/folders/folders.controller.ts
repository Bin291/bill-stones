import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZipArchive } from 'archiver'; // archiver v8: dùng class thay factory
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateFolderDto,
  MoveFolderDto,
  RenameFolderDto,
  StarDto,
} from './dto/folder.dto';
import { FoldersService } from './folders.service';
import { StorageService } from '../storage/storage.service';

@Controller('folders')
export class FoldersController {
  constructor(
    private readonly folders: FoldersService,
    private readonly storage: StorageService,
  ) {}

  /** GET /folders/:id/download — tải cả thư mục dưới dạng .zip (stream, mục 5.E). */
  @Get(':id/download')
  async download(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { name, entries } = await this.folders.collectFilesForZip(userId, id);
    const safe = (name || 'folder').replace(/[^\p{L}\p{N}._ -]/gu, '_');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(safe)}.zip"`,
    });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('warning', () => undefined);
    archive.on('error', () => res.destroy());
    archive.pipe(res);
    for (const e of entries) {
      const stream = await this.storage.getObjectStream(e.r2Key);
      archive.append(stream, { name: e.path });
    }
    await archive.finalize();
  }

  /**
   * GET /folders?parentId=... — con trực tiếp (lazy load cây, mục 11.C).
   * GET /folders?starred=true — mọi thư mục đã gắn sao, bất kể ở đâu (mục Gắn sao).
   */
  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query('parentId') parentId?: string,
    @Query('starred') starred?: string,
  ) {
    if (starred === 'true') return this.folders.listStarred(userId);
    return this.folders.listChildren(userId, parentId ?? null);
  }

  @Get(':id/breadcrumb')
  breadcrumb(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.folders.breadcrumb(userId, id);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateFolderDto) {
    return this.folders.create(userId, dto.name, dto.parentId ?? null);
  }

  @Patch(':id')
  rename(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: RenameFolderDto,
  ) {
    return this.folders.rename(userId, id, dto.name);
  }

  @Post(':id/move')
  move(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: MoveFolderDto,
  ) {
    return this.folders.move(userId, id, dto.targetParentId ?? null);
  }

  @Patch(':id/star')
  star(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: StarDto,
  ) {
    return this.folders.setStar(userId, id, dto.isStarred);
  }

  /** Xoá mềm -> Thùng rác (mục 7.E giai đoạn 1, 11.K). */
  @Patch(':id/trash')
  async trash(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.folders.moveToTrash(userId, id);
    return { success: true };
  }

  /** Khôi phục từ Thùng rác (mục 11.K). */
  @Patch(':id/restore')
  restore(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.folders.restore(userId, id);
  }

  /** Xoá vĩnh viễn (chỉ khi đã ở Thùng rác — mục 7.E giai đoạn 2). */
  @Delete(':id')
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.folders.permanentDelete(userId, id);
    return { success: true };
  }
}
