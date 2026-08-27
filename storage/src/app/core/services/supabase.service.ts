import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  createClient,
  Session,
  SupabaseClient,
  User,
} from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/** Storage in-memory cho môi trường SSR (không có localStorage). */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Bọc SupabaseClient — chỉ dùng cho Auth (login/JWT) và Realtime (mục 3, 6).
 * File/metadata đi qua storage-api, KHÔNG gọi thẳng Supabase DB từ client.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient;
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        // PKCE: an toàn hơn cho SPA; magic link/OAuth trả ?code= và tự đổi lấy
        // session khi detectSessionInUrl = true (mục callback bên dưới).
        flowType: 'pkce',
        persistSession: this.isBrowser,
        autoRefreshToken: this.isBrowser, // tự gia hạn refresh token
        detectSessionInUrl: this.isBrowser,
        storage: this.isBrowser ? undefined : (new MemoryStorage() as unknown as Storage),
      },
    });
  }

  getSession(): Promise<{ data: { session: Session | null } }> {
    return this.client.auth.getSession();
  }

  onAuthChange(cb: (session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  }

  signInWithPassword(email: string, password: string) {
    return this.client.auth.signInWithPassword({ email, password });
  }

  /** Đăng ký email + password, kèm metadata (username, display_name) và link xác nhận. */
  signUp(email: string, password: string, meta?: Record<string, unknown>) {
    return this.client.auth.signUp({
      email,
      password,
      options: {
        data: meta,
        emailRedirectTo: this.isBrowser ? `${window.location.origin}/auth/callback` : undefined,
      },
    });
  }

  /** Đặt lại session từ token do backend cấp (đăng nhập bằng tên đăng nhập). */
  setSession(accessToken: string, refreshToken: string) {
    return this.client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }

  /** Gửi email đặt lại mật khẩu (Quên mật khẩu). Link về trang /auth/reset. */
  resetPasswordForEmail(email: string) {
    const redirectTo = this.isBrowser ? `${window.location.origin}/auth/reset` : undefined;
    return this.client.auth.resetPasswordForEmail(email, { redirectTo });
  }

  /** Cập nhật mật khẩu mới (dùng ở trang /auth/reset sau khi bấm link). */
  updatePassword(password: string) {
    return this.client.auth.updateUser({ password });
  }

  /** Đổi tên hiển thị (lưu trong user_metadata — không có bảng User riêng). */
  updateDisplayName(displayName: string) {
    return this.client.auth.updateUser({ data: { display_name: displayName } });
  }

  /**
   * Đổi email — Supabase tự gửi email xác nhận tới địa chỉ mới trước khi áp
   * dụng. PHẢI truyền emailRedirectTo, nếu không link trong email sẽ quay về
   * Site URL mặc định cấu hình trên Supabase Dashboard (thường sai/không tồn
   * tại ở môi trường dev) thay vì trang /auth/callback của app.
   */
  updateEmail(email: string) {
    const emailRedirectTo = this.isBrowser
      ? `${window.location.origin}/auth/callback`
      : undefined;
    return this.client.auth.updateUser({ email }, { emailRedirectTo });
  }

  /** Đăng xuất mọi phiên KHÁC phiên hiện tại (mục Bảo mật — không cần liệt kê thiết bị). */
  signOutOthers() {
    return this.client.auth.signOut({ scope: 'others' });
  }

  /**
   * Gửi email đăng nhập/đăng ký không mật khẩu (mục Auth): email chứa CẢ Magic
   * Link lẫn mã OTP 6 số (nếu template có {{ .Token }}).
   * - shouldCreateUser=false: chỉ đăng nhập user đã tồn tại (dùng cho /login)
   * - shouldCreateUser=true: cho phép tạo mới (dùng cho /register)
   */
  signInWithOtp(email: string, shouldCreateUser: boolean, emailRedirectTo: string) {
    return this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser, emailRedirectTo },
    });
  }

  /** Xác thực mã OTP 6 số người dùng nhập tay. */
  verifyEmailOtp(email: string, token: string) {
    return this.client.auth.verifyOtp({ email, token, type: 'email' });
  }

  signInWithGoogle(redirectTo: string) {
    return this.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }

  signOut() {
    return this.client.auth.signOut();
  }

  getUser(): Promise<{ data: { user: User | null } }> {
    return this.client.auth.getUser();
  }
}
