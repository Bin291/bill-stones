import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SearchApiService, SearchResult } from '../../core/services/search-api.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Loader } from '../ui/loader';
import { formatBytes, iconOf } from '../../core/util/file-types';

/**
 * Tìm kiếm (mục 8.E — nhánh FTS, accent-insensitive). Nhấn Enter để tìm
 * (không debounce — tiết kiệm tài nguyên, khớp mục 8.C).
 */
@Component({
  selector: 'app-search',
  imports: [TranslatePipe, Loader],
  templateUrl: './search.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  private readonly api = inject(SearchApiService);
  private readonly router = inject(Router);

  readonly query = signal('');
  readonly results = signal<SearchResult[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly note = signal<string | null>(null);

  readonly iconOf = iconOf;
  readonly formatBytes = formatBytes;

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    const q = this.query().trim();
    if (q.length < 2) {
      this.note.set('Nhập ít nhất 2 ký tự.');
      return;
    }
    this.note.set(null);
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.search(q));
      this.results.set(res.results);
      this.searched.set(true);
    } catch {
      this.results.set([]);
      this.note.set('Tìm kiếm lỗi.');
    } finally {
      this.loading.set(false);
    }
  }

  async reindex(): Promise<void> {
    const { queued } = await firstValueFrom(this.api.reindex());
    this.note.set(`Đang lập chỉ mục ${queued} tệp… thử tìm lại sau vài giây.`);
  }

  open(r: SearchResult): void {
    // Mở thư mục chứa tệp để xem/preview trong ngữ cảnh.
    if (r.folderId) void this.router.navigate(['/files/folder', r.folderId]);
    else void this.router.navigate(['/files']);
  }
}
