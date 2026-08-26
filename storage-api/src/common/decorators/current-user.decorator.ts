import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Thông tin user lấy từ JWT Supabase (mục 3). */
export interface AuthUser {
  id: string; // ID tài khoản đã tách theo provider (sub, hoặc sub__oauth cho Google)
  sub?: string; // sub gốc trong JWT (user id Supabase)
  provider?: 'email' | 'oauth'; // phương thức đăng nhập của phiên
  email?: string;
  role?: string;
}

/**
 * `@CurrentUser() user: AuthUser` — lấy user đã xác thực từ request.
 * `@CurrentUser('id') userId: string` — lấy 1 field.
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthUser | undefined,
    ctx: ExecutionContext,
  ): AuthUser | string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
