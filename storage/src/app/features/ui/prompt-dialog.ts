import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Hộp thoại nhập 1 dòng văn bản (thay window.prompt).
 * Dùng cho: tạo thư mục, đổi tên…
 */
@Component({
  selector: 'app-prompt-dialog',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="cancelled.emit()">
      <div class="modal prompt-modal" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <span>{{ title() }}</span>
          <button class="btn btn-icon" type="button" (click)="cancelled.emit()">
            <span class="mi">close</span>
          </button>
        </div>
        <div class="modal-body">
          @if (label()) {
            <label class="auth-label">{{ label() }}</label>
          }
          <input
            #box
            class="auth-input"
            type="text"
            [placeholder]="placeholder()"
            [value]="value()"
            (input)="value.set($any($event.target).value)"
            (keydown.enter)="submit()"
            (keydown.escape)="cancelled.emit()"
          />
          <div class="row" style="justify-content: flex-end; margin-top: 16px">
            <button class="btn" type="button" (click)="cancelled.emit()">
              {{ 'action.cancel' | t }}
            </button>
            <button class="btn btn-primary" type="button" [disabled]="!value().trim()" (click)="submit()">
              {{ confirmLabel() || ('action.save' | t) }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PromptDialog implements OnInit {
  readonly title = input.required<string>();
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly initialValue = input<string>('');
  readonly confirmLabel = input<string>('');

  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  readonly value = signal('');

  ngOnInit(): void {
    this.value.set(this.initialValue());
    // Focus + chọn sẵn nội dung (đổi tên) ở khung nhập.
    queueMicrotask(() => {
      const el = document.querySelector<HTMLInputElement>('.prompt-modal .auth-input');
      el?.focus();
      el?.select();
    });
  }

  submit(): void {
    const v = this.value().trim();
    if (v) this.confirmed.emit(v);
  }
}
