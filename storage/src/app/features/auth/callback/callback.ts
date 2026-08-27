import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Loader } from '../../ui/loader';

/**
 * Xử lý khi người dùng bấm Magic Link trong email (hoặc quay lại từ OAuth).
 * PKCE + detectSessionInUrl tự đổi `?code=` lấy session ngay khi client khởi tạo;
 * component chỉ chờ session xuất hiện rồi điều hướng, hoặc báo lỗi nếu link hỏng/hết hạn.
 */
@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink, TranslatePipe, Loader],
  templateUrl: './callback.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallback {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<'processing' | 'error' | 'blocked'>('processing');
  private navigated = false;

  constructor() {
    // Lỗi trả về trong query hoặc hash (VD link hết hạn: ?error=access_denied&error_description=...)
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (query.get('error') || hash.get('error')) {
      this.status.set('error');
      return;
    }
    const viaGoogle = query.get('via') === 'google';

    // Chờ session xuất hiện (client tự đổi code khi detectSessionInUrl = true).
    effect(() => {
      if (this.navigated) return;
      if (!this.auth.ready() || !this.auth.isAuthenticated()) return;
      this.navigated = true;

      // Đăng nhập qua Google NHƯNG email này đã có mật khẩu (identity 'email')
      // từ trước ⇒ Supabase tự liên kết chung 1 user, nhưng app coi đây là 2
      // "tài khoản" khác nhau (dữ liệu tách riêng qua sub__oauth ở backend) —
      // chặn lại, không cho tự nhiên rơi vào 1 không gian dữ liệu rỗng khác.
      if (viaGoogle && this.auth.hasPasswordIdentity()) {
        void this.auth.signOut().then(() => this.status.set('blocked'));
        return;
      }

      // Luôn về trang chính sau khi đăng nhập (không quay lại trang của phiên trước).
      void this.router.navigateByUrl('/files');
    });

    // Hết thời gian chờ mà chưa có session → coi như link hỏng/hết hạn.
    const timeout = setTimeout(() => {
      if (!this.navigated && !this.auth.isAuthenticated()) this.status.set('error');
    }, 8000);
    this.destroyRef.onDestroy(() => clearTimeout(timeout));
  }
}
