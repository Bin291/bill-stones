import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { File, Prisma, Tag } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FoldersService, BreadcrumbCrumb } from '../folders/folders.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { resolveNameCollision } from '../../common/utils/name-collision';
import { ListFilesQueryDto } from './dto/file-query.dto';

export interface FileWithPath extends File {
  folderPath?: BreadcrumbCrumb[];
  tags?: Tag[];
}

export interface ExtensionStat {
  extension: string;
  count: number;
  totalSize: string; // BigInt -> string
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly folders: FoldersService,
    private readonly thumbnails: ThumbnailService,
  ) {}

  /**
   * Thay thumbnailUrl (đang là R2 key) bằng presigned URL cho client. Nếu chưa có
   * thumbnail mà file là ảnh/video đã ready → sinh nền (backfill file cũ — mục 7).
   */
  private async withThumb<T extends File>(file: T): Promise<T> {
    if (file.thumbnailUrl) {
      const url = await this.storage.presignGet(file.thumbnailUrl, { expiresIn: 3600 });
      return { ...file, thumbnailUrl: url };
    }
    if (file.status === 'ready' && this.thumbnails.supports(file.extension)) {
      this.thumbnails.generateInBackground(file);
    }
    return file;
  }

  async assertOwned(fileId: string, userId: string): Promise<File> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt)
      throw new NotFoundException('Tệp không tồn tại');
    if (file.userId !== userId)
      throw new ForbiddenException('Không có quyền với tệp này');
    return file;
  }

  async list(userId: string, q: ListFilesQueryDto): Promise<FileWithPath[]> {
    const where: Prisma.FileWhereInput = { userId, deletedAt: null };

    // Lăng kính Thẻ / Loại cắt ngang mọi folder; ngược lại lọc theo folder.
    if (q.tagId) {
      where.tags = { some: { tagId: q.tagId } };
    } else if (q.extensions) {
      const exts = q.extensions
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      where.extension = { in: exts };
    } else if (q.folderId !== undefined) {
      where.folderId = q.folderId || null;
    }

    if (q.starred) where.isStarred = true;

    const sortField = q.sort ?? 'createdAt';
    const order = q.order ?? (sortField === 'name' ? 'asc' : 'desc');

    const files = await this.prisma.file.findMany({
      where,
      orderBy: { [sortField]: order },
      include: { tags: { include: { tag: true } } },
    });

    // Đính presigned thumbnail URL + thẻ cho mọi file; kèm breadcrumb nếu withPath.
    const cache = new Map<string, BreadcrumbCrumb[]>();
    const result: FileWithPath[] = [];
    for (const f of files) {
      const { tags, ...bare } = f;
      const withThumb = await this.withThumb(bare);
      const flatTags = tags.map((ft) => ft.tag);
      if (!q.withPath) {
        result.push({ ...withThumb, tags: flatTags });
        continue;
      }
      let path: BreadcrumbCrumb[] = [];
      if (f.folderId) {
        if (!cache.has(f.folderId)) {
          cache.set(f.folderId, await this.folders.breadcrumb(userId, f.folderId));
        }
        path = cache.get(f.folderId)!;
      }
      result.push({ ...withThumb, folderPath: path, tags: flatTags });
    }
    return result;
  }

  async get(userId: string, fileId: string): Promise<File> {
    const file = await this.assertOwned(fileId, userId);
    return this.withThumb(file);
  }

  async rename(userId: string, fileId: string, name: string): Promise<File> {
    const file = await this.assertOwned(fileId, userId);
    const siblings = await this.prisma.file.findMany({
      where: {
        userId,
        folderId: file.folderId,
        deletedAt: null,
        NOT: { id: fileId },
      },
      select: { name: true },
    });
    const finalName = resolveNameCollision(
      name,
      siblings.map((s) => s.name),
      false,
    );
    // Cập nhật cả extension nếu đuôi đổi.
    const dot = finalName.lastIndexOf('.');
    const extension =
      dot > 0 ? finalName.slice(dot + 1).toLowerCase() : file.extension;
    return this.prisma.file.update({
      where: { id: fileId },
      data: { name: finalName, extension },
    });
  }

  async move(
    userId: string,
    fileId: string,
    targetFolderId: string | null,
  ): Promise<File> {
    const file = await this.assertOwned(fileId, userId);
    if (targetFolderId) await this.folders.assertOwned(targetFolderId, userId);
    const siblings = await this.prisma.file.findMany({
      where: {
        userId,
        folderId: targetFolderId ?? null,
        deletedAt: null,
        NOT: { id: fileId },
      },
      select: { name: true },
    });
    const finalName = resolveNameCollision(
      file.name,
      siblings.map((s) => s.name),
      false,
    );
    return this.prisma.file.update({
      where: { id: fileId },
      data: { folderId: targetFolderId ?? null, name: finalName },
    });
  }

  async setStar(
    userId: string,
    fileId: string,
    isStarred: boolean,
  ): Promise<File> {
    await this.assertOwned(fileId, userId);
    return this.prisma.file.update({
      where: { id: fileId },
      data: { isStarred },
    });
  }

  /** Xoá mềm 1 file -> Thùng rác (mục 7.E giai đoạn 1, 11.K). */
  async moveToTrash(userId: string, fileId: string): Promise<void> {
    await this.assertOwned(fileId, userId);
    await this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
  }

  /** Khôi phục file từ Thùng rác, giải trùng tên tại vị trí gốc (mục 7.E, 11.K). */
  async restore(userId: string, fileId: string): Promise<File> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Tệp không tồn tại');
    if (file.userId !== userId)
      throw new ForbiddenException('Không có quyền với tệp này');
    if (!file.deletedAt)
      throw new BadRequestException('Tệp không nằm trong Thùng rác');
    const siblings = await this.prisma.file.findMany({
      where: {
        userId,
        folderId: file.folderId,
        deletedAt: null,
        NOT: { id: fileId },
      },
      select: { name: true },
    });
    const finalName = resolveNameCollision(
      file.name,
      siblings.map((s) => s.name),
      false,
    );
    return this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: null, name: finalName },
    });
  }

  /**
   * Xoá vĩnh viễn 1 file (mục 7.E giai đoạn 2): chỉ hợp lệ khi đã ở Thùng rác.
   * Thứ tự: xoá object R2 (gốc + thumbnail + artifact) TRƯỚC, hard-delete DB SAU.
   */
  async permanentDelete(userId: string, fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Tệp không tồn tại');
    if (file.userId !== userId)
      throw new ForbiddenException('Không có quyền với tệp này');
    if (!file.deletedAt)
      throw new BadRequestException('Chỉ xoá vĩnh viễn item đang ở Thùng rác');

    await this.prisma.file.update({
      where: { id: fileId },
      data: { status: 'delete_pending' },
    });
    await this.storage.deleteObjects([
      file.r2Key,
      this.storage.thumbnailKey(userId, fileId),
      this.storage.artifactKey(userId, fileId),
    ]);
    // Dọn cây HLS nếu có (video streaming).
    await this.storage.deletePrefix(`${userId}/${fileId}/hls`).catch(() => undefined);
    // Prisma cascade tự xoá DocumentChunk con.
    await this.prisma.file.delete({ where: { id: fileId } });
  }

  /** Số đếm theo đuôi file cho sidebar "Theo loại" (mục 11.H #36). */
  async statsByExtension(userId: string): Promise<ExtensionStat[]> {
    const grouped = await this.prisma.file.groupBy({
      by: ['extension'],
      where: { userId, deletedAt: null, status: 'ready' },
      _count: { _all: true },
      _sum: { size: true },
    });
    return grouped
      .map((g) => ({
        extension: g.extension,
        count: g._count._all,
        totalSize: (g._sum.size ?? BigInt(0)).toString(),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Presigned URL tải xuống trực tiếp từ R2 (mục 5.C). */
  async getDownloadUrl(
    userId: string,
    fileId: string,
  ): Promise<{ url: string }> {
    const file = await this.assertOwned(fileId, userId);
    const url = await this.storage.presignGet(file.r2Key, {
      expiresIn: 600,
      downloadFileName: file.name,
    });
    return { url };
  }

  /** Presigned URL để xem inline (preview, hỗ trợ Range — mục 5.C). */
  async getPreviewUrl(
    userId: string,
    fileId: string,
  ): Promise<{ url: string }> {
    const file = await this.assertOwned(fileId, userId);
    const url = await this.storage.presignGet(file.r2Key, {
      expiresIn: 600,
      responseContentType: file.mimeType,
    });
    return { url };
  }
}
