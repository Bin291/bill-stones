import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Loader } from './loader';

/**
 * Hộp thoại xác nhận ở giữa màn hình (thay window.confirm).
 * Dùng cho các hành động phá huỷ: xoá, dọn thùng rác…
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [TranslatePipe, Loader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="busy() ? null : cancelled.emit()">
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
          @if (busy()) {
            <!-- Đang xử lý: ẨN 2 nút, dùng loader của app đặt CHÍNH GIỮA. -->
            <div class="confirm-actions-loading"><app-loader [dot]="5" [gap]="3" /></div>
          } @else {
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
          }
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
  /** true = đang xử lý (VD xoá ~1-2s) — vô hiệu 2 nút, hiện loading trên nút xác nhận. */
  readonly busy = input<boolean>(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
