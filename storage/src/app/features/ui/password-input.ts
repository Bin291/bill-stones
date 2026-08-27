import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Ô nhập mật khẩu có nút con mắt để hiện/ẩn mật khẩu. Dùng chung cho đăng nhập,
 * đăng ký, đặt lại mật khẩu, cài đặt… Giữ nguyên kiểu binding [value]/(valueChange)
 * bằng signal như các ô .auth-input khác trong app.
 */
@Component({
  selector: 'app-password-input',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pw-field">
      <input
        class="auth-input pw-input"
        [type]="show() ? 'text' : 'password'"
        [attr.autocomplete]="autocomplete()"
        [placeholder]="placeholder()"
        [value]="value()"
        [required]="required()"
        (input)="valueChange.emit($any($event.target).value)"
        (keydown.enter)="enter.emit()"
      />
      <button
        class="pw-eye"
        type="button"
        [attr.aria-label]="(show() ? 'auth.hidePassword' : 'auth.showPassword') | t"
        [attr.aria-pressed]="show()"
        (click)="show.set(!show())"
      >
        <span class="mi">{{ show() ? 'visibility_off' : 'visibility' }}</span>
      </button>
    </div>
  `,
  styles: `
    .pw-field {
      position: relative;
    }
    .pw-input {
      padding-right: 44px;
    }
    .pw-eye {
      position: absolute;
      top: 0;
      right: 0;
      height: 100%;
      width: 40px;
      display: grid;
      place-items: center;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--ink-subtle);
    }
    .pw-eye:hover {
      color: var(--ink);
    }
    .pw-eye .mi {
      font-size: 20px;
    }
  `,
})
export class PasswordInput {
  readonly value = input<string>('');
  readonly placeholder = input<string>('');
  readonly autocomplete = input<string>('current-password');
  readonly required = input<boolean>(false);
  readonly valueChange = output<string>();
  readonly enter = output<void>();
  protected readonly show = signal(false);
}
