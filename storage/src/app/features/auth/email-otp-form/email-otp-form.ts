import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { LangService } from '../../../core/i18n/lang.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Đăng nhập/đăng ký không mật khẩu bằng **liên kết xác nhận email** (magic link).
 * Không nhập mã: người dùng nhập email → nhận email → bấm liên kết → /auth/callback
 * tạo session. mode 'signin' user phải tồn tại | 'signup' cho phép tạo mới.
 */
@Component({
  selector: 'app-email-otp-form',
  imports: [TranslatePipe],
  templateUrl: './email-otp-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailOtpForm {
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LangService);
  private readonly destroyRef = inject(DestroyRef);

  readonly mode = input<'signin' | 'signup'>('signin');

  readonly step = signal<'email' | 'sent'>('email');
  readonly email = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly resendIn = signal(0);

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  // Gửi liên kết đăng nhập tới email.
  async sendLink(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loading()) return;
    const email = this.email().trim();
    if (!EMAIL_RE.test(email)) {
      this.error.set(this.lang.translate('auth.invalidEmail'));
      return;
    }
    this.error.set(null);
    this.info.set(null);
    this.loading.set(true);
    try {
      await this.auth.sendEmailOtp(email, this.mode());
      this.step.set('sent');
      this.info.set(this.lang.translate('auth.linkSent'));
      this.startCountdown();
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.loading.set(false);
    }
  }

  async resend(): Promise<void> {
    if (this.resendIn() > 0 || this.loading()) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.sendEmailOtp(this.email().trim(), this.mode());
      this.info.set(this.lang.translate('auth.linkSent'));
      this.startCountdown();
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.loading.set(false);
    }
  }

  changeEmail(): void {
    this.step.set('email');
    this.error.set(null);
    this.info.set(null);
    this.clearTimer();
    this.resendIn.set(0);
  }

  private startCountdown(): void {
    this.clearTimer();
    this.resendIn.set(RESEND_SECONDS);
    this.timer = setInterval(() => {
      const next = this.resendIn() - 1;
      this.resendIn.set(next);
      if (next <= 0) this.clearTimer();
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Chuyển lỗi Supabase thành thông báo thân thiện. */
  private mapError(err: unknown, fallbackKey = 'auth.loginFailed'): string {
    const msg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
    const low = msg.toLowerCase();
    if (
      this.mode() === 'signin' &&
      (low.includes('not allowed') || low.includes('not found') || low.includes('signups'))
    ) {
      return this.lang.translate('auth.userNotFound');
    }
    // Rate limit của Supabase ("For security purposes... after N seconds") — hiện nguyên văn.
    return msg || this.lang.translate(fallbackKey);
  }
}
