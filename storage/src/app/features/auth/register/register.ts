import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LangService } from '../../../core/i18n/lang.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;

/** Đăng ký: tên đăng nhập + email + mật khẩu + nhập lại mật khẩu. */
@Component({
  selector: 'app-register',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './register.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LangService);
  private readonly router = inject(Router);

  readonly username = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly confirm = signal('');

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly done = signal(false);

  readonly googleLoading = signal(false);
  readonly googleError = signal<string | null>(null);

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loading()) return;
    const username = this.username().trim();
    const email = this.email().trim();
    const pw = this.password();
    const confirm = this.confirm();

    if (!USERNAME_RE.test(username)) {
      this.error.set(this.lang.translate('auth.usernameInvalid'));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      this.error.set(this.lang.translate('auth.invalidEmail'));
      return;
    }
    if (pw.length < 6) {
      this.error.set(this.lang.translate('auth.passwordTooShort'));
      return;
    }
    if (pw !== confirm) {
      this.error.set(this.lang.translate('auth.passwordMismatch'));
      return;
    }

    this.error.set(null);
    this.info.set(null);
    this.loading.set(true);
    try {
      // Chặn sớm nếu tên đăng nhập đã có (tránh tạo user rồi mới báo trùng).
      if (!(await this.auth.isUsernameAvailable(username))) {
        this.error.set(this.lang.translate('auth.usernameTaken'));
        return;
      }
      const { needsConfirmation } = await this.auth.register(username, email, pw);
      if (needsConfirmation) {
        this.done.set(true);
        this.info.set(this.lang.translate('auth.confirmSignup'));
      } else {
        await this.router.navigateByUrl('/files');
      }
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.loading.set(false);
    }
  }

  async registerWithGoogle(): Promise<void> {
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
    const nested =
      err && typeof err === 'object' && 'error' in err
        ? (err as { error?: { message?: string } }).error?.message
        : undefined;
    const text = nested || msg;
    const low = text.toLowerCase();
    if (low.includes('already registered') || low.includes('already been registered') || low.includes('user already')) {
      return this.lang.translate('auth.emailInUse');
    }
    if (low.includes('tên đăng nhập đã') || low.includes('already taken')) {
      return this.lang.translate('auth.usernameTaken');
    }
    return text || this.lang.translate('auth.loginFailed');
  }
}
