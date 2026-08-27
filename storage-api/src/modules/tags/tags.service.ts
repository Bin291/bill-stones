import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Tag } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface TagWithCount extends Tag {
  fileCount: number;
}

const DEFAULT_COLOR = '#8d8d8d';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Danh sách thẻ của user + tổng số file+thư mục đang gắn (dùng cho sidebar). */
  async list(userId: string): Promise<TagWithCount[]> {
    const tags = await this.prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { files: true, folders: true } } },
    });
    return tags.map(({ _count, ...t }) => ({ ...t, fileCount: _count.files + _count.folders }));
  }

  async create(userId: string, name: string, color?: string): Promise<Tag> {
    try {
      return await this.prisma.tag.create({
        data: { userId, name: name.trim(), color: color ?? DEFAULT_COLOR },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Đã có thẻ trùng tên');
      }
      throw e;
    }
  }

  async update(
    userId: string,
    id: string,
    data: { name?: string; color?: string },
  ): Promise<Tag> {
    await this.assertOwned(userId, id);
    try {
      return await this.prisma.tag.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.color !== undefined ? { color: data.color } : {}),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Đã có thẻ trùng tên');
      }
      throw e;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    // FileTag tự xoá theo Cascade.
    await this.prisma.tag.delete({ where: { id } });
  }

  /** Gán thẻ cho file (idempotent). */
  async assign(userId: string, tagId: string, fileId: string): Promise<void> {
    await this.assertOwned(userId, tagId);
    await this.assertFileOwned(userId, fileId);
    await this.prisma.fileTag.upsert({
      where: { fileId_tagId: { fileId, tagId } },
      create: { fileId, tagId },
      update: {},
    });
  }

  /** Bỏ gán thẻ khỏi file (idempotent). */
  async unassign(userId: string, tagId: string, fileId: string): Promise<void> {
    await this.assertOwned(userId, tagId);
    await this.assertFileOwned(userId, fileId);
    await this.prisma.fileTag.deleteMany({ where: { fileId, tagId } });
  }

  /** Gán thẻ cho thư mục (idempotent). */
  async assignFolder(userId: string, tagId: string, folderId: string): Promise<void> {
    await this.assertOwned(userId, tagId);
    await this.assertFolderOwned(userId, folderId);
    await this.prisma.folderTag.upsert({
      where: { folderId_tagId: { folderId, tagId } },
      create: { folderId, tagId },
      update: {},
    });
  }

  /** Bỏ gán thẻ khỏi thư mục (idempotent). */
  async unassignFolder(userId: string, tagId: string, folderId: string): Promise<void> {
    await this.assertOwned(userId, tagId);
    await this.assertFolderOwned(userId, folderId);
    await this.prisma.folderTag.deleteMany({ where: { folderId, tagId } });
  }

  private async assertOwned(userId: string, tagId: string): Promise<Tag> {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundException('Thẻ không tồn tại');
    if (tag.userId !== userId) throw new ForbiddenException('Không có quyền với thẻ này');
    return tag;
  }

  private async assertFileOwned(userId: string, fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw new NotFoundException('Tệp không tồn tại');
    if (file.userId !== userId) throw new ForbiddenException('Không có quyền với tệp này');
  }

  private async assertFolderOwned(userId: string, folderId: string): Promise<void> {
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.deletedAt) throw new NotFoundException('Thư mục không tồn tại');
    if (folder.userId !== userId) throw new ForbiddenException('Không có quyền với thư mục này');
  }
}
