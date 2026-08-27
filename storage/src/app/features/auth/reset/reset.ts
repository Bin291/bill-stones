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
import { LangService } from '../../../core/i18n/lang.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Loader } from '../../ui/loader';

/**
 * Trang đặt mật khẩu mới — nơi liên kết "Quên mật khẩu" trong email trỏ tới.
 * PKCE + detectSessionInUrl tự tạo session khôi phục; sau đó gọi updateUser để đổi mật khẩu.
 */
@Component({
  selector: 'app-auth-reset',
  imports: [RouterLink, TranslatePipe, Loader],
  templateUrl: './reset.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthReset {
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LangService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<'waiting' | 'ready' | 'invalid'>('waiting');
  readonly password = signal('');
  readonly confirm = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);

  constructor() {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (query.get('error') || hash.get('error')) {
      this.status.set('invalid');
      return;
    }

    effect(() => {
      if (this.status() !== 'waiting') return;
      if (this.auth.ready() && this.auth.isAuthenticated()) {
        this.status.set('ready');
      }
    });

    // Không có session sau khi chờ → link hỏng/hết hạn.
    const timeout = setTimeout(() => {
      if (this.status() === 'waiting' && !this.auth.isAuthenticated()) {
        this.status.set('invalid');
      }
    }, 8000);
    this.destroyRef.onDestroy(() => clearTimeout(timeout));
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loading()) return;
    const pw = this.password();
    if (pw.length < 6) {
      this.error.set(this.lang.translate('auth.passwordTooShort'));
      return;
    }
    if (pw !== this.confirm()) {
      this.error.set(this.lang.translate('auth.passwordMismatch'));
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.updatePassword(pw);
      this.info.set(this.lang.translate('auth.passwordUpdated'));
      setTimeout(() => void this.router.navigateByUrl('/files'), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/auth session missing/i.test(msg)) {
        // Phiên khôi phục từ link email đã mất/hết hạn — form vẫn còn nhưng
        // submit lại chắc chắn lỗi tiếp. Chuyển sang trạng thái "invalid" (đã
        // có sẵn UI + nút "Về trang đăng nhập") thay vì để form chết, không
        // lối thoát nào ngoài gõ lại đúng lỗi cũ.
        this.status.set('invalid');
        return;
      }
      this.error.set(msg || this.lang.translate('auth.loginFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
