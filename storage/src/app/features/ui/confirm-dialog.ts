import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Hộp thoại xác nhận ở giữa màn hình (thay window.confirm).
 * Dùng cho các hành động phá huỷ: xoá, dọn thùng rác…
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="cancelled.emit()">
      <div class="modal confirm-modal" (click)="$event.stopPropagation()">
        <div class="confirm-body">
          <span class="mi confirm-icon" [class.danger]="danger()">
            {{ danger() ? 'warning' : 'help_outline' }}
          </span>
          <h2 class="confirm-title">{{ title() }}</h2>
          @if (message()) {
            <p class="confirm-message">{{ message() }}</p>
          }
        </div>
        <div class="confirm-actions">
          <button class="btn" type="button" (click)="cancelled.emit()">
            {{ 'action.cancel' | t }}
          </button>
          <button
            class="btn"
            type="button"
            [class.btn-danger]="danger()"
            [class.btn-primary]="!danger()"
            (click)="confirmed.emit()"
          >
            {{ confirmLabel() || ('action.confirm' | t) }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmDialog {
  readonly title = input.required<string>();
  readonly message = input<string>('');
  readonly confirmLabel = input<string>('');
  readonly danger = input<boolean>(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
