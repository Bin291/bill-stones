import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';

// jose là ESM — dùng dynamic import để chạy được từ output CommonJS của Nest.
type JoseModule = typeof import('jose');
type JWKS = ReturnType<JoseModule['createRemoteJWKSet']>;

/**
 * Xác thực access token của Supabase.
 * - Mặc định (project mới): khóa BẤT ĐỐI XỨNG ES256 → verify bằng JWKS công khai
 *   tại `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
 * - Dự phòng: nếu token HS256 (legacy) và có SUPABASE_JWT_SECRET thật → verify secret.
 */
@Injectable()
export class SupabaseJwtService {
  private readonly logger = new Logger(SupabaseJwtService.name);
  private readonly jwksUrl?: string;
  private readonly issuer?: string;
  private readonly hs256Secret?: string;

  private jose?: JoseModule;
  private jwks?: JWKS;

  constructor(config: ConfigService) {
    this.jwksUrl = config.get<string>('supabase.jwksUrl');
    this.issuer = config.get<string>('supabase.issuer');
    const secret = config.get<string>('supabase.jwtSecret');
    // Bỏ qua giá trị placeholder.
    this.hs256Secret =
      secret && !secret.startsWith('your-') && secret.length > 20 ? secret : undefined;
  }

  private async getJose(): Promise<JoseModule> {
    if (!this.jose) this.jose = await import('jose');
    return this.jose;
  }

  private async getJwks(): Promise<JWKS> {
    const jose = await this.getJose();
    if (!this.jwks) {
      if (!this.jwksUrl) throw new Error('SUPABASE_URL chưa cấu hình — không có JWKS');
      this.jwks = jose.createRemoteJWKSet(new URL(this.jwksUrl));
    }
    return this.jwks;
  }

  private algOf(token: string): string | null {
    try {
      const [h] = token.split('.');
      const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg?: string };
      return header.alg ?? null;
    } catch {
      return null;
    }
  }

  async verify(token: string): Promise<AuthUser> {
    const alg = this.algOf(token);
    try {
      let payload: Record<string, unknown>;

      if (alg && alg.startsWith('HS')) {
        // Nhánh legacy HS256.
        if (!this.hs256Secret) throw new Error('Token HS256 nhưng không có JWT secret');
        payload = this.verifyHs256(token, this.hs256Secret);
      } else {
        // Nhánh chính: ES256/RS256 qua JWKS.
        const jose = await this.getJose();
        const jwks = await this.getJwks();
        const result = await jose.jwtVerify(token, jwks, {
          issuer: this.issuer,
          // Supabase đặt aud = 'authenticated' cho user đã đăng nhập.
          audience: 'authenticated',
        });
        payload = result.payload as Record<string, unknown>;
      }

      const sub = payload['sub'];
      if (typeof sub !== 'string' || !sub) {
        throw new Error('Token thiếu sub');
      }
      // Tách tài khoản theo phương thức đăng nhập: đăng nhập bằng OAuth (Google)
      // là KHO RIÊNG, dù trùng email với đăng nhập bằng mã email. Đăng nhập email
      // (otp/password) giữ nguyên `sub` để không mất dữ liệu hiện có.
      const oauth = this.isOAuthSession(payload);
      return {
        id: oauth ? `${sub}__oauth` : sub,
        sub,
        provider: oauth ? 'oauth' : 'email',
        email: typeof payload['email'] === 'string' ? (payload['email'] as string) : undefined,
        role: typeof payload['role'] === 'string' ? (payload['role'] as string) : undefined,
      };
    } catch (err) {
      this.logger.debug(`Verify token thất bại: ${(err as Error).message}`);
      throw new UnauthorizedException('Token không hợp lệ');
    }
  }

  /**
   * Phiên có phải OAuth (Google) không — dựa vào `amr` (method='oauth') hoặc
   * `app_metadata.provider` khác 'email'. Dùng để tách kho theo phương thức.
   */
  private isOAuthSession(payload: Record<string, unknown>): boolean {
    const amr = Array.isArray(payload['amr'])
      ? (payload['amr'] as { method?: string }[])
      : [];
    if (amr.some((a) => a && a.method === 'oauth')) return true;
    const meta = payload['app_metadata'] as { provider?: string } | undefined;
    return !!meta?.provider && meta.provider !== 'email';
  }

  private verifyHs256(token: string, secret: string): Record<string, unknown> {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) throw new Error('JWT sai định dạng');
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    const a = Buffer.from(s);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Chữ ký sai');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    if (typeof payload['exp'] === 'number' && payload['exp'] * 1000 < Date.now()) {
      throw new Error('Token hết hạn');
    }
    return payload;
  }
}
