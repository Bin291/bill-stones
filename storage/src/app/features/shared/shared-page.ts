import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SharedApiService, SharedItem } from '../../core/services/shared-api.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Loader } from '../ui/loader';
import { FilePreview } from '../file-preview/file-preview';
import { formatBytes, iconOf } from '../../core/util/file-types';
import { StoredFile } from '../../core/models/file.model';

/** "Được chia sẻ với tôi" (mục 12.E nhóm C) — chỉ Xem + Tải xuống. */
@Component({
  selector: 'app-shared-page',
  imports: [TranslatePipe, Loader, FilePreview],
  templateUrl: './shared-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedPage implements OnInit {
  private readonly sharedApi = inject(SharedApiService);

  protected readonly items = signal<SharedItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;
  protected readonly previewTarget = signal<StoredFile | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await firstValueFrom(this.sharedApi.list()));
    } catch {
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  open(item: SharedItem): void {
    if (item.kind !== 'file' || !item.file) return;
    this.previewTarget.set(item.file);
  }

  async download(item: SharedItem): Promise<void> {
    if (item.kind !== 'file' || !item.file || !item.allowDownload) return;
    const { url } = await firstValueFrom(this.sharedApi.downloadUrl(item.file.id));
    const a = document.createElement('a');
    a.href = url;
    a.download = item.file.name;
    a.click();
  }
}
