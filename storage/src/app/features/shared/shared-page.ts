import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  SharedApiService,
  SharedFolderContents,
  SharedItem,
} from '../../core/services/shared-api.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Loader } from '../ui/loader';
import { FilePreview } from '../file-preview/file-preview';
import { formatBytes, iconOf } from '../../core/util/file-types';
import { Folder, StoredFile } from '../../core/models/file.model';

/** "Được chia sẻ với tôi" (mục 12.E nhóm C) — Xem + Tải xuống, có thể mở thư mục để duyệt. */
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

  // Duyệt bên trong thư mục được chia sẻ.
  /** Đường dẫn thư mục đang mở (breadcrumb). Rỗng = đang ở danh sách chia sẻ gốc. */
  protected readonly path = signal<{ id: string; name: string }[]>([]);
  protected readonly folderView = signal<SharedFolderContents | null>(null);
  protected readonly inFolder = computed(() => this.path().length > 0);

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

  /** Mở 1 mục ở danh sách gốc: file → xem trước; thư mục → duyệt vào trong. */
  openItem(item: SharedItem): void {
    if (item.kind === 'folder' && item.folder) {
      void this.enterFolder(item.folder.id, item.folder.name, true);
    } else if (item.kind === 'file' && item.file) {
      this.previewTarget.set(item.file);
    }
  }

  /** Đi vào 1 thư mục con khi đang duyệt. */
  openSubfolder(folder: Folder): void {
    void this.enterFolder(folder.id, folder.name, false);
  }

  /** Nạp nội dung thư mục; reset=true khi mở từ danh sách gốc (đặt lại breadcrumb). */
  private async enterFolder(folderId: string, name: string, reset: boolean): Promise<void> {
    this.loading.set(true);
    try {
      const contents = await firstValueFrom(this.sharedApi.listFolder(folderId));
      this.folderView.set(contents);
      this.path.update((p) => (reset ? [{ id: folderId, name }] : [...p, { id: folderId, name }]));
    } catch {
      /* giữ nguyên hiển thị hiện tại nếu lỗi */
    } finally {
      this.loading.set(false);
    }
  }

  /** Về danh sách chia sẻ gốc. */
  goRoot(): void {
    this.path.set([]);
    this.folderView.set(null);
  }

  /** Nhảy tới 1 mốc breadcrumb (index trong path). */
  async goToCrumb(index: number): Promise<void> {
    const crumb = this.path()[index];
    if (!crumb) return;
    this.loading.set(true);
    try {
      const contents = await firstValueFrom(this.sharedApi.listFolder(crumb.id));
      this.folderView.set(contents);
      this.path.update((p) => p.slice(0, index + 1));
    } finally {
      this.loading.set(false);
    }
  }

  openFile(file: StoredFile): void {
    this.previewTarget.set(file);
  }

  async download(file: StoredFile): Promise<void> {
    const { url } = await firstValueFrom(this.sharedApi.downloadUrl(file.id));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  }

  /** Tải file ở danh sách gốc (kiểm allowDownload của chính mục đó). */
  async downloadItem(item: SharedItem): Promise<void> {
    if (item.kind !== 'file' || !item.file || !item.allowDownload) return;
    await this.download(item.file);
  }
}
