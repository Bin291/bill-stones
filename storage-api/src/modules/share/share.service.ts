import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { File, Folder, Share } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FilesService } from '../files/files.service';
import { FoldersService } from '../folders/folders.service';
import { CreateLinkDto, InviteDto, UpdateShareDto } from './dto/share.dto';
import {
  generateShareToken,
  hashSharePassword,
  signShareSession,
  verifyShareSession,
  verifySharePassword,
} from './share.crypto';

export interface AuthUserRow {
  id: string;
  email: string;
  avatarUrl?: string | null;
}

@Injectable()
export class ShareService {
  private readonly baseUrl: string;
  private readonly sessionSecret: string;
  private readonly contentTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
    private readonly folders: FoldersService,
    config: ConfigService,
  ) {
    this.baseUrl =
      config.get<string>('share.baseUrl') ?? 'http://localhost:4200';
    this.sessionSecret =
      config.get<string>('share.sessionSecret') ?? 'dev-secret';
    this.contentTtl = config.get<number>('share.contentTtlSeconds') ?? 600;
  }

  // ===================== Nhóm A: quản lý quyền (owner) =====================

  private assertExactlyOneTarget(fileId?: string, folderId?: string): void {
    if ((fileId && folderId) || (!fileId && !folderId)) {
      throw new BadRequestException('Cần đúng 1 target: fileId HOẶC folderId');
    }
  }

  /** Kiểm quyền sở hữu + trả về tên mục (dùng cho nội dung thông báo). */
  private async assertOwnedTarget(
    userId: string,
    fileId?: string,
    folderId?: string,
  ): Promise<string> {
    if (fileId) return (await this.files.assertOwned(fileId, userId)).name;
    if (folderId) return (await this.folders.assertOwned(folderId, userId)).name;
    return '';
  }

  private expiresAtFrom(days?: number | null): Date | null {
    if (!days || days <= 0) return null;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  async createLink(
    userId: string,
    dto: CreateLinkDto,
  ): Promise<Share & { url: string }> {
    this.assertExactlyOneTarget(dto.fileId, dto.folderId);
    await this.assertOwnedTarget(userId, dto.fileId, dto.folderId);
    const share = await this.prisma.share.create({
      data: {
        userId,
        fileId: dto.fileId ?? null,
        folderId: dto.folderId ?? null,
        token: generateShareToken(),
        passwordHash: dto.password ? hashSharePassword(dto.password) : null,
        allowDownload: dto.allowDownload ?? true,
        expiresAt: this.expiresAtFrom(dto.expiresInDays),
      },
    });
    return { ...share, url: this.linkUrl(share.token!) };
  }

  linkUrl(token: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/s/${token}`;
  }

  async invite(userId: string, ownerEmail: string, dto: InviteDto): Promise<Share> {
    this.assertExactlyOneTarget(dto.fileId, dto.folderId);
    const itemName = await this.assertOwnedTarget(userId, dto.fileId, dto.folderId);

    const recipient = await this.lookupUserByEmail(dto.email);
    if (!recipient) {
      throw new BadRequestException(
        `Người dùng với email ${dto.email} chưa đăng ký tài khoản.`,
      );
    }
    if (recipient.id === userId) {
      throw new BadRequestException('Không thể chia sẻ cho chính mình.');
    }

    const targetKey = dto.fileId ? 'fileId' : 'folderId';
    const targetVal = dto.fileId ?? dto.folderId!;

    const existing = await this.prisma.share.findFirst({
      where: {
        userId,
        [targetKey]: targetVal,
        sharedWithUserId: recipient.id,
      },
    });
    if (existing) {
      return existing;
    }

    // Tạo Share + Notification trong cùng transaction — người nhận thấy ngay
    // "ai" đã chia sẻ "gì" với mình (mục 12.J).
    return this.prisma.$transaction(async (tx) => {
      const share = await tx.share.create({
        data: {
          userId,
          fileId: dto.fileId ?? null,
          folderId: dto.folderId ?? null,
          sharedWithUserId: recipient.id,
          sharedWithEmail: recipient.email,
          allowDownload: dto.allowDownload ?? true,
          expiresAt: this.expiresAtFrom(dto.expiresInDays),
        },
      });
      await tx.notification.create({
        data: {
          userId: recipient.id,
          type: 'share_received',
          title: `${ownerEmail} đã chia sẻ một mục với bạn`,
          body: itemName,
          linkPath: '/shared',
          shareId: share.id,
        },
      });
      return share;
    });
  }

  async listForTarget(
    userId: string,
    fileId?: string,
    folderId?: string,
  ): Promise<Share[]> {
    this.assertExactlyOneTarget(fileId, folderId);
    await this.assertOwnedTarget(userId, fileId, folderId);
    const shares = await this.prisma.share.findMany({
      where: { userId, fileId: fileId ?? null, folderId: folderId ?? null },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = shares
      .map((s) => s.sharedWithUserId)
      .filter((id): id is string => !!id);

    if (userIds.length > 0) {
      try {
        const users = await this.prisma.$queryRaw<{ id: string; avatarUrl: string | null }[]>`
          select id::text, raw_user_meta_data->>'avatar_url' as "avatarUrl"
          from auth.users
          where id = any(${userIds.map(id => id)}::uuid[])
        `;
        const avatarMap = new Map(users.map((u) => [u.id, u.avatarUrl]));
        return shares.map((s) => ({
          ...s,
          sharedWithAvatarUrl: s.sharedWithUserId ? (avatarMap.get(s.sharedWithUserId) ?? null) : null,
        } as any));
      } catch {
        return shares;
      }
    }
    return shares;
  }

  async update(
    userId: string,
    shareId: string,
    dto: UpdateShareDto,
  ): Promise<Share> {
    const share = await this.assertOwnShare(userId, shareId);
    const data: Record<string, unknown> = {};
    if (dto.allowDownload !== undefined)
      data['allowDownload'] = dto.allowDownload;
    if (dto.expiresInDays !== undefined)
      data['expiresAt'] = this.expiresAtFrom(dto.expiresInDays);
    if (dto.password !== undefined) {
      data['passwordHash'] = dto.password
        ? hashSharePassword(dto.password)
        : null;
    }
    return this.prisma.share.update({
      where: { id: shareId },
      data,
    });
  }

  async revoke(userId: string, shareId: string): Promise<Share> {
    await this.assertOwnShare(userId, shareId);
    return this.prisma.share.delete({ where: { id: shareId } });
  }

  private async assertOwnShare(
    userId: string,
    shareId: string,
  ): Promise<Share> {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });
    if (!share) throw new NotFoundException('Không tìm thấy bản ghi chia sẻ');
    if (share.userId !== userId)
      throw new ForbiddenException('Không có quyền thao tác trên bản ghi chia sẻ này');
    return share;
  }

  private async lookupUserByEmail(email: string): Promise<AuthUserRow | null> {
    try {
      const rows = await this.prisma.$queryRaw<AuthUserRow[]>`
        select id::text, email, raw_user_meta_data->>'avatar_url' as "avatarUrl"
        from auth.users where email = ${email} limit 1
      `;
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Gợi ý email khi mời chia sẻ — tìm user đã có tài khoản trên app theo tiền
   * tố email, để người dùng không phải gõ chính xác 100% (mục Invite users).
   * Loại chính mình, giới hạn kết quả để tránh dò quét toàn bộ danh sách user.
   */
  async searchUsersByEmail(userId: string, query: string): Promise<AuthUserRow[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    try {
      const rows = await this.prisma.$queryRaw<AuthUserRow[]>`
        select id::text, email, raw_user_meta_data->>'avatar_url' as "avatarUrl"
        from auth.users
        where email ilike ${q + '%'} and id != ${userId}::uuid
        order by email asc
        limit 8
      `;
      return rows;
    } catch {
      return [];
    }
  }

  // ===================== Kiểm quyền đọc (mục 12.I) =====================

  /** Danh sách folder tổ tiên (từ cha trực tiếp lên gốc) của 1 folder. */
  private async ancestorFolderIds(folderId: string | null): Promise<string[]> {
    const ids: string[] = [];
    let current = folderId;
    const guard = new Set<string>();
    while (current) {
      if (guard.has(current)) break;
      guard.add(current);
      const folder: Folder | null = await this.prisma.folder.findUnique({
        where: { id: current },
      });
      if (!folder) break;
      ids.push(folder.id);
      current = folder.parentId;
    }
    return ids;
  }

  /**
   * Trả file nếu user có quyền đọc: chính chủ, share trực tiếp, hoặc share 1 folder
   * tổ tiên (mục 12.I). Ngược lại ném NotFound (không lộ tồn tại). Kèm điều kiện
   * share chưa hết hạn, file ready & chưa trash.
   */
  async assertGrantedAccess(userId: string, fileId: string): Promise<File> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt || file.status !== 'ready') {
      throw new NotFoundException('Tệp không tồn tại');
    }
    if (file.userId === userId) return file;

    const now = new Date();
    const ancestorIds = await this.ancestorFolderIds(file.folderId);
    const share = await this.prisma.share.findFirst({
      where: {
        sharedWithUserId: userId,
        OR: [{ fileId }, { folderId: { in: ancestorIds } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
    });
    if (!share) throw new NotFoundException('Tệp không tồn tại');
    return file;
  }

  // ===================== Kênh C: Được chia sẻ với tôi =====================

  async listSharedWithMe(userId: string): Promise<unknown[]> {
    const now = new Date();
    const shares = await this.prisma.share.findMany({
      where: {
        sharedWithUserId: userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { file: true, folder: true },
      orderBy: { createdAt: 'desc' },
    });
    const result: unknown[] = [];
    for (const s of shares) {
      if (s.file) {
        if (s.file.deletedAt || s.file.status !== 'ready') continue;
        result.push({
          shareId: s.id,
          kind: 'file',
          sharedByEmail: await this.ownerEmail(s.userId),
          allowDownload: s.allowDownload,
          file: { ...s.file, size: s.file.size.toString() },
        });
      } else if (s.folder) {
        if (s.folder.deletedAt) continue;
        result.push({
          shareId: s.id,
          kind: 'folder',
          sharedByEmail: await this.ownerEmail(s.userId),
          allowDownload: s.allowDownload,
          folder: s.folder,
        });
      }
    }
    return result;
  }

  /**
   * Liệt kê con của một thư mục ĐƯỢC CHIA SẺ cho user (hoặc thư mục con nằm trong
   * cây đó) — để mở/duyệt thư mục ở trang "Được chia sẻ với tôi". Quyền: chính chủ,
   * hoặc có share (chưa hết hạn) trên chính thư mục hoặc một thư mục tổ tiên.
   */
  async listSharedFolderChildren(
    userId: string,
    folderId: string,
  ): Promise<{
    folder: { id: string; name: string };
    folders: Folder[];
    files: unknown[];
    allowDownload: boolean;
  }> {
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.deletedAt) {
      throw new NotFoundException('Thư mục không tồn tại');
    }

    let allowDownload = true;
    if (folder.userId !== userId) {
      const now = new Date();
      // ancestorFolderIds gồm cả chính folderId → khớp share trên folder này hoặc tổ tiên.
      const ancestorIds = await this.ancestorFolderIds(folderId);
      const share = await this.prisma.share.findFirst({
        where: {
          sharedWithUserId: userId,
          folderId: { in: ancestorIds },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (!share) throw new NotFoundException('Thư mục không tồn tại');
      allowDownload = share.allowDownload;
    }

    const [folders, files] = await Promise.all([
      this.prisma.folder.findMany({
        where: { parentId: folderId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prisma.file.findMany({
        where: { folderId, deletedAt: null, status: 'ready' },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      folder: { id: folder.id, name: folder.name },
      folders,
      files: files.map((f) => ({ ...f, size: f.size.toString() })),
      allowDownload,
    };
  }

  private async ownerEmail(ownerId: string): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<AuthUserRow[]>`
        select id::text, email from auth.users where id = ${ownerId}::uuid limit 1
      `;
      return rows[0]?.email ?? null;
    } catch {
      return null;
    }
  }

  async sharedFileContentUrl(
    userId: string,
    fileId: string,
    disposition: 'inline' | 'attachment',
  ): Promise<{ url: string }> {
    const file = await this.assertGrantedAccess(userId, fileId);
    if (disposition === 'attachment') {
      // 403 nếu share cấm tải — kiểm bằng share áp dụng.
      await this.assertDownloadAllowed(userId, file);
      const url = await this.storage.presignGet(file.r2Key, {
        expiresIn: this.contentTtl,
        downloadFileName: file.name,
      });
      return { url };
    }
    const url = await this.storage.presignGet(file.r2Key, {
      expiresIn: this.contentTtl,
      responseContentType: file.mimeType,
    });
    return { url };
  }

  private async assertDownloadAllowed(
    userId: string,
    file: File,
  ): Promise<void> {
    if (file.userId === userId) return;
    const now = new Date();
    const ancestorIds = await this.ancestorFolderIds(file.folderId);
    const share = await this.prisma.share.findFirst({
      where: {
        sharedWithUserId: userId,
        OR: [{ fileId: file.id }, { folderId: { in: ancestorIds } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
    });
    if (!share?.allowDownload)
      throw new ForbiddenException('Chia sẻ này không cho phép tải xuống');
  }

  // ===================== Kênh B: link công khai =====================

  /** Phân giải token: tồn tại → chưa hết hạn → target chưa trash → (file) ready. */
  async resolvePublicShare(
    token: string,
  ): Promise<Share & { file: File | null; folder: Folder | null }> {
    const share = await this.prisma.share.findUnique({
      where: { token },
      include: { file: true, folder: true },
    });
    if (!share) throw new NotFoundException('Link không tồn tại');
    if (share.expiresAt && share.expiresAt <= new Date()) {
      throw new NotFoundException('Link đã hết hạn');
    }
    if (share.file) {
      if (share.file.deletedAt || share.file.status !== 'ready') {
        throw new NotFoundException('Nội dung không còn khả dụng');
      }
    } else if (share.folder) {
      if (share.folder.deletedAt)
        throw new NotFoundException('Nội dung không còn khả dụng');
    } else {
      throw new NotFoundException('Link không hợp lệ');
    }
    return share;
  }

  isUnlocked(share: Share, sessionToken?: string): boolean {
    if (!share.passwordHash) return true;
    return verifyShareSession(sessionToken, share.token!, this.sessionSecret);
  }

  unlock(share: Share, password: string): string {
    if (
      !share.passwordHash ||
      !verifySharePassword(password, share.passwordHash)
    ) {
      throw new UnauthorizedException('Mật khẩu không đúng');
    }
    return signShareSession(share.token!, this.sessionSecret);
  }

  async publicContentUrl(
    share: Share & { file: File | null; folder: Folder | null },
    disposition: 'inline' | 'attachment',
    childFileId?: string,
  ): Promise<{ url: string }> {
    const file = await this.resolveShareFile(share, childFileId);
    if (disposition === 'attachment' && !share.allowDownload) {
      throw new ForbiddenException('Link này không cho phép tải xuống');
    }
    if (disposition === 'attachment') {
      await this.prisma.share.update({
        where: { id: share.id },
        data: { downloadCount: { increment: 1 }, lastAccessAt: new Date() },
      });
      const url = await this.storage.presignGet(file.r2Key, {
        expiresIn: this.contentTtl,
        downloadFileName: file.name,
      });
      return { url };
    }
    await this.prisma.share.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastAccessAt: new Date() },
    });
    const url = await this.storage.presignGet(file.r2Key, {
      expiresIn: this.contentTtl,
      responseContentType: file.mimeType,
    });
    return { url };
  }

  /** Với link folder: liệt kê con của folderId sau khi verify hậu duệ (mục 12.D). */
  async publicListChildren(
    share: Share & { folder: Folder | null },
    folderId?: string,
  ): Promise<{ folders: Folder[]; files: unknown[] }> {
    if (!share.folder)
      throw new BadRequestException('Link này không phải thư mục');
    const targetFolderId = folderId ?? share.folder.id;
    if (targetFolderId !== share.folder.id) {
      await this.assertDescendantFolder(share.folder.id, targetFolderId);
    }
    const [folders, files] = await Promise.all([
      this.prisma.folder.findMany({
        where: { parentId: targetFolderId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prisma.file.findMany({
        where: { folderId: targetFolderId, deletedAt: null, status: 'ready' },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      folders,
      files: files.map((f) => ({ ...f, size: f.size.toString() })),
    };
  }

  private async resolveShareFile(
    share: Share & { file: File | null; folder: Folder | null },
    childFileId?: string,
  ): Promise<File> {
    if (share.file && !childFileId) return share.file;
    if (share.folder && childFileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: childFileId },
      });
      if (!file || file.deletedAt || file.status !== 'ready') {
        throw new NotFoundException('Tệp không tồn tại');
      }
      await this.assertDescendantFile(share.folder.id, file);
      return file;
    }
    throw new BadRequestException('Yêu cầu không hợp lệ');
  }

  /** Verify folder con nằm trong cây của rootFolderId (mục 12.D). */
  private async assertDescendantFolder(
    rootFolderId: string,
    folderId: string,
  ): Promise<void> {
    const ancestors = await this.ancestorFolderIds(folderId);
    if (!ancestors.includes(rootFolderId)) {
      throw new NotFoundException('Không tìm thấy');
    }
  }

  /** Verify file con nằm trong cây của rootFolderId. */
  private async assertDescendantFile(
    rootFolderId: string,
    file: File,
  ): Promise<void> {
    if (!file.folderId) throw new NotFoundException('Không tìm thấy');
    const ancestors = await this.ancestorFolderIds(file.folderId);
    if (!ancestors.includes(rootFolderId)) {
      throw new NotFoundException('Không tìm thấy');
    }
  }
}
