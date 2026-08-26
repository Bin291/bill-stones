import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TrashApiService, TrashItem } from '../../core/services/trash-api.service';
import { FilesApiService } from '../../core/services/files-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { RefreshService } from '../../core/services/refresh.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Loader } from '../ui/loader';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { formatBytes, iconOf } from '../../core/util/file-types';

type PendingConfirm =
  | { type: 'purge'; item: TrashItem }
  | { type: 'empty' };

/** Thùng rác (mục 7.E, 11.K): khôi phục / xoá vĩnh viễn / dọn thùng rác. */
@Component({
  selector: 'app-trash',
  imports: [TranslatePipe, ConfirmDialog, Loader],
  templateUrl: './trash.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Trash implements OnInit {
  private readonly trashApi = inject(TrashApiService);
  private readonly filesApi = inject(FilesApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly refresh = inject(RefreshService);

  protected readonly items = signal<TrashItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly confirm = signal<PendingConfirm | null>(null);
  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await firstValueFrom(this.trashApi.list()));
    } catch {
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async restore(item: TrashItem): Promise<void> {
    if (item.kind === 'file') await firstValueFrom(this.filesApi.restore(item.id));
    else await firstValueFrom(this.foldersApi.restore(item.id));
    void this.load();
    this.refresh.bump();
  }

  // --- Xác nhận qua hộp thoại giữa màn hình (thay prompt/confirm trình duyệt) ---
  askPurge(item: TrashItem): void {
    this.confirm.set({ type: 'purge', item });
  }

  askEmpty(): void {
    this.confirm.set({ type: 'empty' });
  }

  async runConfirm(): Promise<void> {
    const c = this.confirm();
    this.confirm.set(null);
    if (!c) return;
    if (c.type === 'purge') {
      if (c.item.kind === 'file') await firstValueFrom(this.filesApi.remove(c.item.id));
      else await firstValueFrom(this.foldersApi.remove(c.item.id));
    } else {
      await firstValueFrom(this.trashApi.empty());
    }
    await this.load();
    this.refresh.bump();
  }
}
