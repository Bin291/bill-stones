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

/**
 * Xử lý khi người dùng bấm Magic Link trong email (hoặc quay lại từ OAuth).
 * PKCE + detectSessionInUrl tự đổi `?code=` lấy session ngay khi client khởi tạo;
 * component chỉ chờ session xuất hiện rồi điều hướng, hoặc báo lỗi nếu link hỏng/hết hạn.
 */
@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './callback.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallback {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<'processing' | 'error'>('processing');
  private navigated = false;

  constructor() {
    // Lỗi trả về trong query hoặc hash (VD link hết hạn: ?error=access_denied&error_description=...)
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (query.get('error') || hash.get('error')) {
      this.status.set('error');
      return;
    }

    // Chờ session xuất hiện (client tự đổi code khi detectSessionInUrl = true).
    effect(() => {
      if (this.navigated) return;
      if (this.auth.ready() && this.auth.isAuthenticated()) {
        this.navigated = true;
        // Luôn về trang chính sau khi đăng nhập (không quay lại trang của phiên trước).
        void this.router.navigateByUrl('/files');
      }
    });

    // Hết thời gian chờ mà chưa có session → coi như link hỏng/hết hạn.
    const timeout = setTimeout(() => {
      if (!this.navigated && !this.auth.isAuthenticated()) this.status.set('error');
    }, 8000);
    this.destroyRef.onDestroy(() => clearTimeout(timeout));
  }
}
