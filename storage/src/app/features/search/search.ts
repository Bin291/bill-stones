import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  SearchApiService,
  SearchMatchBranch,
  SearchResult,
} from '../../core/services/search-api.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatBytes, iconOf } from '../../core/util/file-types';
import { StoredFile } from '../../core/models/file.model';
import { FilePreview } from '../file-preview/file-preview';

const MATCH_LABELS: Record<SearchMatchBranch, string> = {
  dense: 'Ngữ nghĩa',
  bge: 'Đa ngôn ngữ',
  fts: 'Từ khoá',
};

/**
 * Tìm kiếm (mục 8.E — hybrid dense + bge + fts, RRF). Nhấn Enter để tìm
 * (không debounce — tiết kiệm tài nguyên, khớp mục 8.C).
 */
@Component({
  selector: 'app-search',
  imports: [TranslatePipe, DecimalPipe, FilePreview],
  templateUrl: './search.html',
  styleUrl: './search.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  private readonly api = inject(SearchApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly query = signal('');
  readonly results = signal<SearchResult[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly note = signal<string | null>(null);
  readonly previewTarget = signal<StoredFile | null>(null);

  readonly iconOf = iconOf;
  readonly formatBytes = formatBytes;

  constructor() {
    // Truy vấn mẫu từ Landing (?q=...) -> tự điền và tìm luôn.
    const q = this.route.snapshot.queryParamMap.get('q')?.trim();
    if (q) {
      this.query.set(q);
      void this.runSearch(q);
    }
  }

  /** Bậc màu cho badge % khớp — chỉ để hiển thị, không ảnh hưởng xếp hạng. */
  similarityBucket(similarity: number): 'high' | 'mid' | 'low' {
    if (similarity >= 0.75) return 'high';
    if (similarity >= 0.5) return 'mid';
    return 'low';
  }

  /** Gộp dense+bge thành 1 chip "Ngữ nghĩa" (tránh lặp), giữ nguyên fts riêng. */
  matchLabels(matchedBy: SearchMatchBranch[]): string[] {
    const labels = new Set(matchedBy.map((b) => MATCH_LABELS[b] ?? b));
    return [...labels];
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    await this.runSearch(this.query().trim());
  }

  private async runSearch(q: string): Promise<void> {
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

  /**
   * Xem nội dung ngay tại trang search — dựng StoredFile tối giản từ
   * SearchResult (FilePreview chỉ thật sự đọc id/name/extension/size, các
   * trường còn lại của StoredFile không được component dùng tới).
   */
  openPreview(r: SearchResult): void {
    this.previewTarget.set({
      id: r.id,
      name: r.name,
      extension: r.extension,
      r2Key: '',
      thumbnailUrl: r.thumbnailUrl,
      size: r.size,
      mimeType: '',
      userId: '',
      folderId: r.folderId,
      status: 'ready',
      hlsStatus: r.hlsStatus as StoredFile['hlsStatus'],
      errorMessage: null,
      isStarred: false,
      deletedAt: null,
      createdAt: '',
      updatedAt: '',
    } satisfies StoredFile);
  }

  /** Mở thư mục chứa tệp — dùng khi cần thao tác thêm ngoài xem nhanh. */
  goToFolder(r: SearchResult, event: Event): void {
    event.stopPropagation();
    if (r.folderId) void this.router.navigate(['/files/folder', r.folderId]);
    else void this.router.navigate(['/files']);
  }
}
