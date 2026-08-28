import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Folder, Tag } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { resolveNameCollision } from '../../common/utils/name-collision';

export interface BreadcrumbCrumb {
  id: string;
  name: string;
}

export interface FolderWithTags extends Folder {
  tags: Tag[];
}

export interface FolderWithPath extends FolderWithTags {
  folderPath?: BreadcrumbCrumb[];
}

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Đảm bảo folder tồn tại + thuộc sở hữu user (mục 3, 12.A). */
  async assertOwned(folderId: string, userId: string): Promise<Folder> {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder || folder.deletedAt)
      throw new NotFoundException('Thư mục không tồn tại');
    if (folder.userId !== userId)
      throw new ForbiddenException('Không có quyền với thư mục này');
    return folder;
  }

  /** Liệt kê thư mục con trực tiếp (lazy load cây sidebar — mục 11.C). */
  async listChildren(
    userId: string,
    parentId: string | null,
  ): Promise<FolderWithTags[]> {
    if (parentId) await this.assertOwned(parentId, userId);
    const folders = await this.prisma.folder.findMany({
      where: { userId, parentId: parentId ?? null, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { tags: { include: { tag: true } } },
    });
    return folders.map(({ tags, ...bare }) => ({
      ...bare,
      tags: tags.map((ft) => ft.tag),
    }));
  }

  /** Mọi thư mục đã gắn sao của user, bất kể nằm ở thư mục cha nào (mục Gắn sao). */
  async listStarred(userId: string): Promise<FolderWithPath[]> {
    const folders = await this.prisma.folder.findMany({
      where: { userId, isStarred: true, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { tags: { include: { tag: true } } },
    });
    const cache = new Map<string, BreadcrumbCrumb[]>();
    const result: FolderWithPath[] = [];
    for (const f of folders) {
      const { tags, ...bare } = f;
      let folderPath: BreadcrumbCrumb[] = [];
      if (f.parentId) {
        if (!cache.has(f.parentId)) {
          cache.set(f.parentId, await this.breadcrumb(userId, f.parentId));
        }
        folderPath = cache.get(f.parentId)!;
      }
      result.push({ ...bare, folderPath, tags: tags.map((ft) => ft.tag) });
    }
    return result;
  }

  async create(
    userId: string,
    name: string,
    parentId: string | null,
  ): Promise<Folder> {
    if (parentId) {
      await this.assertOwned(parentId, userId);
      // Không giới hạn số cấp thư mục lồng nhau (theo yêu cầu — bỏ giới hạn 7 cấp).
    }
    const siblings = await this.prisma.folder.findMany({
      where: { userId, parentId: parentId ?? null, deletedAt: null },
      select: { name: true },
    });
    const finalName = resolveNameCollision(
      name,
      siblings.map((s) => s.name),
      true,
    );
    return this.prisma.folder.create({
      data: { name: finalName, parentId: parentId ?? null, userId },
    });
  }

  async rename(
    userId: string,
    folderId: string,
    name: string,
  ): Promise<Folder> {
    const folder = await this.assertOwned(folderId, userId);
    const siblings = await this.prisma.folder.findMany({
      where: {
        userId,
        parentId: folder.parentId,
        deletedAt: null,
        NOT: { id: folderId },
      },
      select: { name: true },
    });
    const finalName = resolveNameCollision(
      name,
      siblings.map((s) => s.name),
      true,
    );
    return this.prisma.folder.update({
      where: { id: folderId },
      data: { name: finalName },
    });
  }

  async move(
    userId: string,
    folderId: string,
    targetParentId: string | null,
  ): Promise<Folder> {
    const folder = await this.assertOwned(folderId, userId);
    if (targetParentId) {
      await this.assertOwned(targetParentId, userId);
      if (targetParentId === folderId) {
        throw new BadRequestException('Không thể chuyển thư mục vào chính nó');
      }
      // Chặn chuyển vào hậu duệ của chính nó (tạo vòng lặp).
      const descendantIds = await this.collectDescendantFolderIds(folderId);
      if (descendantIds.has(targetParentId)) {
        throw new BadRequestException(
          'Không thể chuyển thư mục vào thư mục con của nó',
        );
      }
    }
    const siblings = await this.prisma.folder.findMany({
      where: {
        userId,
        parentId: targetParentId ?? null,
        deletedAt: null,
        NOT: { id: folderId },
      },
      select: { name: true },
    });
    const finalName = resolveNameCollision(
      folder.name,
      siblings.map((s) => s.name),
      true,
    );
    return this.prisma.folder.update({
      where: { id: folderId },
      data: { parentId: targetParentId ?? null, name: finalName },
    });
  }

  async setStar(
    userId: string,
    folderId: string,
    isStarred: boolean,
  ): Promise<Folder> {
    await this.assertOwned(folderId, userId);
    return this.prisma.folder.update({
      where: { id: folderId },
      data: { isStarred },
    });
  }

  /**
   * Xoá mềm (vào Thùng rác — mục 7.E giai đoạn 1): set deletedAt cho folder +
   * đệ quy toàn bộ file/folder con cùng thời điểm. Dữ liệu R2 chưa động tới.
   */
  async moveToTrash(userId: string, folderId: string): Promise<void> {
    await this.assertOwned(folderId, userId);
    const now = new Date();
    const folderIds = [
      folderId,
      ...(await this.collectDescendantFolderIds(folderId)),
    ];
    await this.prisma.$transaction([
      this.prisma.file.updateMany({
        where: { folderId: { in: folderIds }, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.folder.updateMany({
        where: { id: { in: folderIds }, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);
  }

  /**
   * Khôi phục folder từ Thùng rác (mục 7.E, 11.K): clear deletedAt cho cả cây con,
   * giải trùng tên tại vị trí gốc (chỉ so với item đang active).
   */
  async restore(userId: string, folderId: string): Promise<Folder> {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('Thư mục không tồn tại');
    if (folder.userId !== userId)
      throw new ForbiddenException('Không có quyền với thư mục này');
    if (!folder.deletedAt)
      throw new BadRequestException('Thư mục không nằm trong Thùng rác');

    const siblings = await this.prisma.folder.findMany({
      where: {
        userId,
        parentId: folder.parentId,
        deletedAt: null,
        NOT: { id: folderId },
      },
      select: { name: true },
    });
    const finalName = resolveNameCollision(
      folder.name,
      siblings.map((s) => s.name),
      true,
    );
    const folderIds = [
      folderId,
      ...(await this.collectDescendantFolderIds(folderId)),
    ];
    await this.prisma.$transaction([
      this.prisma.file.updateMany({
        where: { folderId: { in: folderIds }, deletedAt: { not: null } },
        data: { deletedAt: null },
      }),
      this.prisma.folder.updateMany({
        where: { id: { in: folderIds }, deletedAt: { not: null } },
        data: { deletedAt: null },
      }),
    ]);
    return this.prisma.folder.update({
      where: { id: folderId },
      data: { name: finalName },
    });
  }

  /**
   * Xoá vĩnh viễn 1 folder (mục 7.E giai đoạn 2): gom toàn bộ object key của mọi
   * file con TRƯỚC, xoá trên R2, rồi hard-delete folder gốc (Prisma cascade con).
   */
  async permanentDelete(userId: string, folderId: string): Promise<void> {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('Thư mục không tồn tại');
    if (folder.userId !== userId)
      throw new ForbiddenException('Không có quyền với thư mục này');
    if (!folder.deletedAt)
      throw new BadRequestException('Chỉ xoá vĩnh viễn item đang ở Thùng rác');

    const folderIds = [
      folderId,
      ...(await this.collectDescendantFolderIds(folderId)),
    ];
    const files = await this.prisma.file.findMany({
      where: { folderId: { in: folderIds } },
      select: { id: true, r2Key: true, userId: true },
    });
    const keys: string[] = [];
    for (const f of files) {
      keys.push(f.r2Key);
      keys.push(this.storage.thumbnailKey(f.userId, f.id));
      keys.push(this.storage.artifactKey(f.userId, f.id));
    }
    await this.storage.deleteObjects(keys);
    // Dọn cây HLS của từng video con (nếu có).
    for (const f of files) {
      await this.storage.deletePrefix(`${f.userId}/${f.id}/hls`).catch(() => undefined);
    }
    // Xoá folder gốc — cascade tự xoá folder/file/chunk con.
    await this.prisma.folder.delete({ where: { id: folderId } });
  }

  /** Breadcrumb đầy đủ từ gốc -> folder (mục 11.H). */
  async breadcrumb(
    userId: string,
    folderId: string,
  ): Promise<BreadcrumbCrumb[]> {
    const crumbs: BreadcrumbCrumb[] = [];
    let current: string | null = folderId;
    const guard = new Set<string>();
    while (current) {
      if (guard.has(current)) break; // an toàn chống vòng lặp dữ liệu hỏng
      guard.add(current);
      const folder: Folder | null = await this.prisma.folder.findUnique({
        where: { id: current },
      });
      if (!folder || folder.userId !== userId) break;
      crumbs.unshift({ id: folder.id, name: folder.name });
      current = folder.parentId;
    }
    return crumbs;
  }

  /**
   * Gom mọi file trong cây thư mục kèm đường dẫn tương đối để nén zip (mục 5.E).
   * Trả về tên folder gốc (đặt tên file zip) + danh sách {path, r2Key}.
   */
  async collectFilesForZip(
    userId: string,
    folderId: string,
  ): Promise<{ name: string; entries: { path: string; r2Key: string }[] }> {
    const root = await this.assertOwned(folderId, userId);
    const ids = [folderId, ...(await this.collectDescendantFolderIds(folderId))];
    const folders = await this.prisma.folder.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, parentId: true },
    });
    const byId = new Map(folders.map((f) => [f.id, f]));

    // Đường dẫn tương đối của 1 folder so với folder gốc ('' = chính gốc).
    const relCache = new Map<string, string>();
    const relOf = (id: string): string => {
      if (id === folderId) return '';
      if (relCache.has(id)) return relCache.get(id)!;
      const f = byId.get(id);
      if (!f) return '';
      const parentRel = f.parentId ? relOf(f.parentId) : '';
      const rel = parentRel ? `${parentRel}/${f.name}` : f.name;
      relCache.set(id, rel);
      return rel;
    };

    const files = await this.prisma.file.findMany({
      where: { folderId: { in: ids }, deletedAt: null, status: 'ready' },
      select: { name: true, folderId: true, r2Key: true },
    });
    const entries = files.map((f) => {
      const dir = f.folderId ? relOf(f.folderId) : '';
      return { path: dir ? `${dir}/${f.name}` : f.name, r2Key: f.r2Key };
    });
    return { name: root.name, entries };
  }

  /** Tập id mọi folder hậu duệ (không gồm chính nó). Duyệt BFS theo parentId. */
  async collectDescendantFolderIds(folderId: string): Promise<Set<string>> {
    const result = new Set<string>();
    let frontier = [folderId];
    while (frontier.length) {
      const children = await this.prisma.folder.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = [];
      for (const c of children) {
        if (!result.has(c.id)) {
          result.add(c.id);
          frontier.push(c.id);
        }
      }
    }
    return result;
  }
}
