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
      // Supabase tự LIÊN KẾT Google vào tài khoản email trùng địa chỉ (cùng `sub`)
      // ⇒ 2 cách đăng nhập chung dữ liệu. Tách: nếu phiên là Google (amr=oauth) NHƯNG
      // tài khoản gốc tạo bằng email (provider='email') → đây là "Google phụ" ⇒ dùng
      // kho riêng `sub__oauth`. Đăng nhập email giữ `sub` (dữ liệu gốc). Tài khoản
      // gốc-Google (provider='google') giữ `sub` để KHÔNG treo dữ liệu của họ.
      const separateOAuth = this.isOAuthSession(payload) && this.primaryProvider(payload) === 'email';
      return {
        id: separateOAuth ? `${sub}__oauth` : sub,
        sub,
        provider: separateOAuth ? 'oauth' : 'email',
        email: typeof payload['email'] === 'string' ? (payload['email'] as string) : undefined,
        role: typeof payload['role'] === 'string' ? (payload['role'] as string) : undefined,
      };
    } catch (err) {
      this.logger.debug(`Verify token thất bại: ${(err as Error).message}`);
      throw new UnauthorizedException('Token không hợp lệ');
    }
  }

  /** Phiên hiện tại có đăng nhập bằng OAuth (Google) không — dựa vào `amr`. */
  private isOAuthSession(payload: Record<string, unknown>): boolean {
    const amr = Array.isArray(payload['amr'])
      ? (payload['amr'] as { method?: string }[])
      : [];
    return amr.some((a) => a && a.method === 'oauth');
  }

  /** Provider tạo tài khoản (sign-up) — 'email' | 'google' | ... */
  private primaryProvider(payload: Record<string, unknown>): string {
    const meta = payload['app_metadata'] as { provider?: string } | undefined;
    return meta?.provider ?? 'email';
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
