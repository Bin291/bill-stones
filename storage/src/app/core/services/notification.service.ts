import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ToastService } from './toast.service';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Thông báo trong app + badge chưa đọc (mục 11.F, 12.J). Poll nhẹ để hiện ngay khi có chia sẻ mới. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly base = `${environment.apiUrl}/notifications`;

  readonly items = signal<AppNotification[]>([]);
  readonly unreadCount = signal(0);

  /** Id thông báo đã thấy — để chỉ "bắn" toast cho thông báo MỚI xuất hiện. */
  private readonly seenIds = new Set<string>();

  /**
   * Nạp danh sách thông báo + số chưa đọc.
   * @param announce true → hiện toast cho MỌI thông báo chưa đọc vừa mới xuất hiện
   *                 (dùng cho lần poll định kỳ; lần nạp đầu để false, chỉ ghi nhận).
   */
  async refresh(announce = false): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ items: AppNotification[]; unreadCount: number }>(this.base),
      );
      if (announce) {
        const fresh = res.items.filter((n) => !n.readAt && !this.seenIds.has(n.id));
        for (const n of fresh) {
          this.toast.show(n.body ? `${n.title} — ${n.body}` : n.title, 'info', 5000);
          this.notifyBrowser(n.title, n.body ?? undefined);
        }
      }
      for (const n of res.items) this.seenIds.add(n.id);
      this.items.set(res.items);
      this.unreadCount.set(res.unreadCount);
    } catch {
      // im lặng — badge chỉ là phụ trợ
    }
  }

  async markRead(id: string): Promise<void> {
    await firstValueFrom(this.http.patch(`${this.base}/${id}/read`, {}));
    void this.refresh();
  }

  async markAllRead(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.base}/read-all`, {}));
    void this.refresh();
  }

  /** Bắn Notification trình duyệt nếu được cấp quyền (mục 11.F Phương án 1). */
  notifyBrowser(title: string, body?: string): void {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      void Notification.requestPermission();
    }
  }
}
