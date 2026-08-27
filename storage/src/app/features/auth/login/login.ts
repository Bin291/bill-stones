import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LangService } from '../../../core/i18n/lang.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Đăng nhập bằng TÊN ĐĂNG NHẬP hoặc EMAIL + mật khẩu (một ô nhập chung).
 * Kèm luồng "Quên mật khẩu" (nhập email → gửi liên kết đặt lại) và nút Google.
 */
@Component({
  selector: 'app-login',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LangService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly mode = signal<'login' | 'forgot'>('login');

  // Đăng nhập
  readonly loginId = signal('');
  readonly password = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Quên mật khẩu
  readonly resetEmail = signal('');
  readonly resetSent = signal(false);
  readonly info = signal<string | null>(null);

  ngOnInit(): void {
    const email = this.route.snapshot.queryParamMap.get('email');
    if (email) {
      this.loginId.set(email);
    }
  }

  // Google
  readonly googleLoading = signal(false);
  readonly googleError = signal<string | null>(null);

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loading()) return;
    const id = this.loginId().trim();
    const pw = this.password();
    if (!id || !pw) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.signInWithLogin(id, pw);
      await this.router.navigateByUrl('/files');
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.loading.set(false);
    }
  }

  openForgot(): void {
    this.mode.set('forgot');
    this.error.set(null);
    this.info.set(null);
    this.resetSent.set(false);
    this.resetEmail.set(this.loginId().includes('@') ? this.loginId().trim() : '');
  }

  backToLogin(): void {
    this.mode.set('login');
    this.error.set(null);
    this.info.set(null);
  }

  async submitForgot(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loading()) return;
    const email = this.resetEmail().trim();
    if (!EMAIL_RE.test(email)) {
      this.error.set(this.lang.translate('auth.invalidEmail'));
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.sendPasswordReset(email);
      this.resetSent.set(true);
      this.info.set(this.lang.translate('auth.resetSent'));
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.loading.set(false);
    }
  }

  async loginWithGoogle(): Promise<void> {
    if (this.googleLoading()) return;
    this.googleError.set(null);
    this.googleLoading.set(true);
    try {
      await this.auth.signInWithGoogle('/files');
    } catch (err) {
      this.googleError.set(err instanceof Error ? err.message : 'auth.loginFailed');
      this.googleLoading.set(false);
    }
  }

  private mapError(err: unknown): string {
    const msg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
    // Lỗi HttpErrorResponse của Angular gói message backend trong error.error.message.
    const nested =
      err && typeof err === 'object' && 'error' in err
        ? (err as { error?: { message?: string } }).error?.message
        : undefined;
    const text = nested || msg;
    const low = text.toLowerCase();
    if (low.includes('invalid login') || low.includes('mật khẩu không đúng') || low.includes('401')) {
      return this.lang.translate('auth.loginFailed');
    }
    if (low.includes('not confirmed') || low.includes('chưa được xác nhận')) {
      return this.lang.translate('auth.confirmEmail');
    }
    return text || this.lang.translate('auth.loginFailed');
  }
}
