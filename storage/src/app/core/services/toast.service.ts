import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info';
}

/** Thông báo ngắn nổi ở góc màn hình (thay alert()) — VD "Đã chuyển vào thùng rác". */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<ToastMessage[]>([]);

  show(text: string, type: ToastMessage['type'] = 'success', duration = 2500): void {
    const id = crypto.randomUUID();
    this.toasts.update((t) => [...t, { id, text, type }]);
    setTimeout(() => this.dismiss(id), duration);
  }

  success(text: string): void {
    this.show(text, 'success');
  }

  error(text: string): void {
    this.show(text, 'error', 4000);
  }

  dismiss(id: string): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
