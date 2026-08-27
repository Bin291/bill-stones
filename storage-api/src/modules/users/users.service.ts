import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FoldersService } from '../folders/folders.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const DEFAULT_QUOTA_BYTES = BigInt(10 * 1024 * 1024 * 1024); // 10 GB
const AVATAR_SIZE = 256;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export interface SettingsResponse {
  displayName: string | null;
  avatarUrl: string | null;
  hasCustomAvatar: boolean;
  /** Đã đặt mật khẩu chưa (đăng nhập được bằng email + mật khẩu). Đọc thẳng
   * `auth.users.encrypted_password` — KHÔNG dùng `identities`, vì
   * updateUser({password}) không tạo identity 'email' cho tài khoản gốc Google. */
  hasPassword: boolean;
  email: string;
  plan: 'free';
  storageQuotaBytes: string;
  usedBytes: string;
  uploadWarnSizeMb: number | null;
  maxFileSizeMb: number;
  duplicateFilePolicy: string;
  defaultUploadFolderId: string | null;
  defaultSharePrivacy: string;
}

/**
 * Cài đặt/Hồ sơ tài khoản (mục Settings & Account Management). `UserProfile`
 * ban đầu chỉ ánh xạ username -> userId (mục Auth); ở đây MỞ RỘNG bảng đó để
 * lưu thêm cài đặt cá nhân — user đăng nhập Google-only chưa từng có dòng nào
 * trong bảng này, nên mọi thao tác ghi đều `upsert`, mọi thao tác đọc đều có
 * fallback mặc định khi chưa có dòng.
 */
@Injectable()
export class UsersService {
  private readonly maxFileSizeMb: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly folders: FoldersService,
    config: ConfigService,
  ) {
    this.maxFileSizeMb = config.get<number>('limits.maxFileSizeMb') ?? 2048;
  }

  async getSettings(userId: string, email: string): Promise<SettingsResponse> {
    const [profile, usedBytes, hasPassword] = await Promise.all([
      this.prisma.userProfile.findUnique({ where: { userId } }),
      this.usedBytes(userId),
      this.hasPassword(userId),
    ]);
    const avatarUrl = profile?.avatarKey
      ? await this.storage.presignGet(profile.avatarKey, { expiresIn: 3600 })
      : null;
    return {
      displayName: profile?.displayName ?? null,
      avatarUrl,
      hasCustomAvatar: !!profile?.avatarKey,
      hasPassword,
      email,
      plan: 'free',
      storageQuotaBytes: (profile?.storageQuotaBytes ?? DEFAULT_QUOTA_BYTES).toString(),
      usedBytes: usedBytes.toString(),
      uploadWarnSizeMb: profile?.uploadWarnSizeMb ?? null,
      maxFileSizeMb: this.maxFileSizeMb,
      duplicateFilePolicy: profile?.duplicateFilePolicy ?? 'rename',
      defaultUploadFolderId: profile?.defaultUploadFolderId ?? null,
      defaultSharePrivacy: profile?.defaultSharePrivacy ?? 'private',
    };
  }

  async updateSettings(userId: string, email: string, dto: UpdateSettingsDto): Promise<SettingsResponse> {
    if (dto.defaultUploadFolderId) {
      await this.folders.assertOwned(dto.defaultUploadFolderId, userId);
    }
    await this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        email,
        displayName: dto.displayName,
        uploadWarnSizeMb: dto.uploadWarnSizeMb,
        duplicateFilePolicy: dto.duplicateFilePolicy,
        defaultUploadFolderId: dto.defaultUploadFolderId === null ? null : dto.defaultUploadFolderId,
        defaultSharePrivacy: dto.defaultSharePrivacy,
      },
      update: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.uploadWarnSizeMb !== undefined ? { uploadWarnSizeMb: dto.uploadWarnSizeMb } : {}),
        ...(dto.duplicateFilePolicy !== undefined ? { duplicateFilePolicy: dto.duplicateFilePolicy } : {}),
        ...(dto.defaultUploadFolderId !== undefined ? { defaultUploadFolderId: dto.defaultUploadFolderId } : {}),
        ...(dto.defaultSharePrivacy !== undefined ? { defaultSharePrivacy: dto.defaultSharePrivacy } : {}),
      },
    });
    return this.getSettings(userId, email);
  }

  async setAvatar(userId: string, email: string, file: { buffer: Buffer; mimetype: string }): Promise<SettingsResponse> {
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Chỉ chấp nhận file ảnh');
    }
    if (file.buffer.length > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Ảnh đại diện tối đa 5MB');
    }
    const resized = await sharp(file.buffer)
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();
    const key = `${userId}/avatar.webp`;
    await this.storage.putObject(key, resized, 'image/webp', 'no-cache');
    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, email, avatarKey: key },
      update: { avatarKey: key },
    });
    return this.getSettings(userId, email);
  }

  async removeAvatar(userId: string, email: string): Promise<SettingsResponse> {
    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, email, avatarKey: null },
      update: { avatarKey: null },
    });
    return this.getSettings(userId, email);
  }

  /**
   * Đã có mật khẩu chưa — đọc thẳng `auth.users.encrypted_password`. Không
   * dùng `identities`: `updateUser({password})` chỉ set mật khẩu, không tạo
   * identity 'email' cho tài khoản gốc Google.
   */
  private async hasPassword(userId: string): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<{ has: boolean }[]>`
        select (encrypted_password is not null and encrypted_password != '') as has
        from auth.users where id = ${userId}::uuid
      `;
      return rows[0]?.has ?? false;
    } catch {
      return false;
    }
  }

  /** Tổng dung lượng đang dùng (file chưa xoá) — dùng cho thanh dung lượng + chặn quota. */
  async usedBytes(userId: string): Promise<bigint> {
    const agg = await this.prisma.file.aggregate({
      where: { userId, deletedAt: null },
      _sum: { size: true },
    });
    return agg._sum.size ?? BigInt(0);
  }

  async quotaBytes(userId: string): Promise<bigint> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { storageQuotaBytes: true },
    });
    return profile?.storageQuotaBytes ?? DEFAULT_QUOTA_BYTES;
  }

  async duplicatePolicy(userId: string): Promise<string> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { duplicateFilePolicy: true },
    });
    return profile?.duplicateFilePolicy ?? 'rename';
  }
}
