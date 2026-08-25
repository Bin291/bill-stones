import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { EmailOtpForm } from '../email-otp-form/email-otp-form';

@Component({
  selector: 'app-login',
  imports: [RouterLink, TranslatePipe, EmailOtpForm],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);

  readonly googleLoading = signal(false);
  readonly googleError = signal<string | null>(null);

  async loginWithGoogle(): Promise<void> {
    if (this.googleLoading()) return;
    this.googleError.set(null);
    this.googleLoading.set(true);
    try {
      // Luôn về trang chính sau khi đăng nhập.
      await this.auth.signInWithGoogle('/files');
      // Trình duyệt điều hướng sang Google; không cần tắt loading.
    } catch (err) {
      this.googleError.set(err instanceof Error ? err.message : 'auth.loginFailed');
      this.googleLoading.set(false);
    }
  }
}
