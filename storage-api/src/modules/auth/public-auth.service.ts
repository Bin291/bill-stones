import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/** Kết quả token khi đăng nhập bằng password grant (Supabase). */
export interface GrantSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Xác thực công khai (không cần Bearer token) cho luồng TÊN ĐĂNG NHẬP + mật khẩu:
 * - kiểm tra tên đăng nhập còn trống,
 * - đăng ký hồ sơ (ánh xạ username -> userId/email) sau khi client gọi supabase signUp,
 * - đăng nhập bằng username: tra ra email rồi đổi lấy session qua password grant của Supabase.
 * Supabase Auth chỉ hỗ trợ email/password nên bảng UserProfile là cầu nối.
 */
@Injectable()
export class PublicAuthService {
  private readonly logger = new Logger(PublicAuthService.name);
  private readonly supabaseUrl?: string;
  private readonly anonKey?: string;
  private readonly serviceRoleKey?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.supabaseUrl = config.get<string>('supabase.url')?.replace(/\/$/, '');
    this.anonKey = config.get<string>('supabase.anonKey');
    this.serviceRoleKey = config.get<string>('supabase.serviceRoleKey');
  }

  private norm(username: string): string {
    return username.trim().toLowerCase();
  }

  /** Tên đăng nhập hợp lệ: 3-30 ký tự chữ/số/gạch dưới/chấm. */
  private assertValidUsername(username: string): void {
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username.trim())) {
      throw new BadRequestException(
        'Tên đăng nhập 3-30 ký tự, chỉ gồm chữ, số, dấu chấm hoặc gạch dưới',
      );
    }
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const u = this.norm(username);
    if (!u) return false;
    const existing = await this.prisma.userProfile.findUnique({ where: { username: u } });
    return !existing;
  }

  /**
   * Đăng ký hồ sơ sau khi client tạo user Supabase (supabase.auth.signUp).
   * Xác minh userId/email khớp thật trên Supabase bằng service-role trước khi chiếm
   * tên (tránh chiếm tên cho userId bất kỳ).
   */
  async registerProfile(userId: string, username: string, email: string): Promise<void> {
    this.assertValidUsername(username);
    const u = this.norm(username);

    const taken = await this.prisma.userProfile.findUnique({ where: { username: u } });
    if (taken && taken.userId !== userId) {
      throw new ConflictException('Tên đăng nhập đã tồn tại');
    }

    // Xác minh user tồn tại + email khớp (chống chiếm tên cho userId giả).
    const verified = await this.adminGetUser(userId);
    if (!verified || (verified.email ?? '').toLowerCase() !== email.trim().toLowerCase()) {
      throw new BadRequestException('Thông tin tài khoản không hợp lệ');
    }

    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, username: u, usernameDisplay: username.trim(), email: email.trim() },
      update: { username: u, usernameDisplay: username.trim(), email: email.trim() },
    });
  }

  /** Đăng nhập bằng tên đăng nhập: tra email rồi password grant. */
  async loginWithUsername(username: string, password: string): Promise<GrantSession> {
    const u = this.norm(username);
    const profile = await this.prisma.userProfile.findUnique({ where: { username: u } });
    // Không phân biệt "sai tên" vs "sai mật khẩu".
    if (!profile) throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng');
    return this.passwordGrant(profile.email, password);
  }

  /** Đổi email + password lấy session qua endpoint token của Supabase. */
  private async passwordGrant(email: string, password: string): Promise<GrantSession> {
    if (!this.supabaseUrl || !this.anonKey) {
      throw new BadRequestException('Supabase chưa cấu hình');
    }
    const res = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const desc = String(data['error_description'] ?? data['msg'] ?? '');
      if (/not confirmed/i.test(desc)) {
        throw new UnauthorizedException('Email chưa được xác nhận. Hãy kiểm tra hộp thư.');
      }
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng');
    }
    return {
      access_token: String(data['access_token']),
      refresh_token: String(data['refresh_token']),
      expires_in: Number(data['expires_in'] ?? 3600),
      token_type: String(data['token_type'] ?? 'bearer'),
    };
  }

  /** Lấy user Supabase bằng service-role (admin) để xác minh khi đăng ký hồ sơ. */
  private async adminGetUser(userId: string): Promise<{ email?: string } | null> {
    if (!this.supabaseUrl || !this.serviceRoleKey) return null;
    try {
      const res = await fetch(`${this.supabaseUrl}/auth/v1/admin/users/${userId}`, {
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
        },
      });
      if (!res.ok) return null;
      return (await res.json()) as { email?: string };
    } catch (err) {
      this.logger.debug(`adminGetUser lỗi: ${(err as Error).message}`);
      return null;
    }
  }
}
