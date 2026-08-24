import { Injectable, signal } from '@angular/core';

/**
 * Tín hiệu "dữ liệu file thay đổi" để các nơi (sidebar counts, ...) tự nạp lại.
 * Bump sau upload / xoá / khôi phục.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  readonly filesChanged = signal(0);
  readonly tagsChanged = signal(0);

  bump(): void {
    this.filesChanged.update((v) => v + 1);
  }

  /** Báo danh sách thẻ đổi (tạo/sửa/xoá/gán) — sidebar tự nạp lại. */
  bumpTags(): void {
    this.tagsChanged.update((v) => v + 1);
  }
}
