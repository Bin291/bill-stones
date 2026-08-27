import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';

/** Ngăn xếp thông báo ngắn ở góc màn hình — mount 1 lần ở layout gốc. */
@Component({
  selector: 'app-toast-container',
  template: `
    <div class="toast-stack">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast-item" [class]="'toast-' + t.type" (click)="toast.dismiss(t.id)">
          <span class="mi">{{ t.type === 'error' ? 'error' : t.type === 'info' ? 'info' : 'check_circle' }}</span>
          {{ t.text }}
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-stack {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 400;
        pointer-events: none;
      }
      .toast-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        background: var(--canvas);
        border: 1px solid var(--hairline);
        border-left: 3px solid var(--success);
        font-size: 14px;
        color: var(--ink);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
        cursor: pointer;
        pointer-events: auto;
        animation: toast-in 0.18s ease-out;
      }
      .toast-item.toast-error {
        border-left-color: var(--danger);
      }
      .toast-item.toast-info {
        border-left-color: var(--primary);
      }
      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastContainer {
  protected readonly toast = inject(ToastService);
}
