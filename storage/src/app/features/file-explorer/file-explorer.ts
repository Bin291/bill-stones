import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FilesApiService } from '../../core/services/files-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { UploadService, UploadTask } from '../../core/services/upload.service';
import { RefreshService } from '../../core/services/refresh.service';
import { AudioPlayerService } from '../../core/services/audio-player.service';
import { SettingsService } from '../../core/services/settings.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ShareDialog, ShareTarget } from '../share/share-dialog';
import { VideoPlayer } from '../video-player/video-player';
import { FilePreview } from '../file-preview/file-preview';
import { TagDialog } from '../tags/tag-dialog';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Loader } from '../ui/loader';
import { Autofocus } from '../ui/autofocus.directive';
import { MoveDialog, MoveItem } from './move-dialog';
import { TagsApiService } from '../../core/services/tags-api.service';
import { LangService } from '../../core/i18n/lang.service';
import {
  BreadcrumbCrumb,
  Folder,
  ListFilesQuery,
  StoredFile,
} from '../../core/models/file.model';
import { categoryByKey, categoryOf, formatBytes, iconOf } from '../../core/util/file-types';
import { PrefetchService, ViewBundle } from '../../core/services/prefetch.service';
import { Lens, ViewParams, buildListQuery, viewKey } from '../../core/util/list-query';

type Mode = 'folder' | 'type' | 'starred' | 'recent' | 'tag';

/** Mục tiêu gắn thẻ cho 1 file (mở dialog tag từ context menu). */
interface TagTarget {
  fileId: string;
  assignedIds: string[];
}

/** Hộp thoại tuỳ biến (thay prompt/confirm trình duyệt). */
type ExplorerDialog = { type: 'confirmDelete'; kind: 'file' | 'folder'; id: string; name: string };

interface ContextMenu {
  x: number;
  y: number;
  kind: 'file' | 'folder';
  id: string;
  name: string;
  isStarred: boolean;
}

/** Một mục tải lên: 1 thư mục (nhiều file) hoặc 1 file lẻ. */
interface UploadBatch {
  id: string;
  label: string;
  isFolder: boolean;
  total: number;
  done: WritableSignal<number>;
  failed: WritableSignal<number>;
  status: WritableSignal<'uploading' | 'done' | 'error' | 'canceled'>;
  firstTask: WritableSignal<UploadTask | null>; // cho file lẻ hiện %
  tasks: UploadTask[];
  files: File[];
  canceled: boolean;
}

@Component({
  selector: 'app-file-explorer',
  imports: [
    TranslatePipe,
    DatePipe,
    ShareDialog,
    VideoPlayer,
    FilePreview,
    TagDialog,
    ConfirmDialog,
    MoveDialog,
    Loader,
    Autofocus,
  ],
  templateUrl: './file-explorer.html',
  host: { class: 'explorer-host' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileExplorer {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly filesApi = inject(FilesApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly uploadService = inject(UploadService);
  private readonly refresh = inject(RefreshService);
  private readonly audioSvc = inject(AudioPlayerService);
  private readonly tagsApi = inject(TagsApiService);
  private readonly prefetch = inject(PrefetchService);
  private readonly lang = inject(LangService);
  protected readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly mode = signal<Mode>('folder');
  protected readonly folderId = signal<string | null>(null);
  protected readonly category = signal<string | null>(null);
  protected readonly tagId = signal<string | null>(null);
  protected readonly tagName = signal<string>('');
  protected readonly tagColor = signal<string>('#8d8d8d');

  protected readonly folders = signal<Folder[]>([]);
  protected readonly files = signal<StoredFile[]>([]);
  protected readonly breadcrumb = signal<BreadcrumbCrumb[]>([]);
  protected readonly loading = signal(false);
  protected readonly dragOver = signal(false);

  protected readonly sort = signal<ListFilesQuery['sort']>('createdAt');
  protected readonly order = signal<ListFilesQuery['order']>('desc');
  protected readonly sortMenuOpen = signal(false);

  /** Các lựa chọn sắp xếp GỘP (trường + chiều) như kiểu shop — chọn 1 là ra ngay. */
  protected readonly sortOptions: {
    sort: NonNullable<ListFilesQuery['sort']>;
    order: NonNullable<ListFilesQuery['order']>;
    labelKey: string;
    icon: string;
  }[] = [
    { sort: 'name', order: 'asc', labelKey: 'sort.nameAsc', icon: 'sort_by_alpha' },
    { sort: 'name', order: 'desc', labelKey: 'sort.nameDesc', icon: 'sort_by_alpha' },
    { sort: 'createdAt', order: 'desc', labelKey: 'sort.dateNew', icon: 'schedule' },
    { sort: 'createdAt', order: 'asc', labelKey: 'sort.dateOld', icon: 'history' },
    { sort: 'size', order: 'desc', labelKey: 'sort.sizeDesc', icon: 'data_usage' },
    { sort: 'size', order: 'asc', labelKey: 'sort.sizeAsc', icon: 'data_usage' },
  ];
  /** Nhãn lựa chọn đang áp dụng — hiện trên nút để biết đang sắp theo kiểu gì. */
  protected readonly sortLabelKey = computed(() => {
    const s = this.sort();
    const o = this.order();
    return this.sortOptions.find((x) => x.sort === s && x.order === o)?.labelKey ?? 'sort.dateNew';
  });
  protected isActiveSort(sort: string, order: string): boolean {
    return this.sort() === sort && this.order() === order;
  }
  protected readonly uploadMenuOpen = signal(false);

  protected readonly uploadBatches = signal<UploadBatch[]>([]);
  protected readonly uploadsCollapsed = signal(false);
  protected readonly uploadingCount = computed(
    () => this.uploadBatches().filter((b) => b.status() === 'uploading').length,
  );
  // Tổng số mục con (file) + số đã xử lý (xong/lỗi) + % — hiện dưới tiêu đề panel.
  protected readonly uploadTotalItems = computed(() =>
    this.uploadBatches().reduce((s, b) => s + b.total, 0),
  );
  protected readonly uploadDoneItems = computed(() =>
    this.uploadBatches().reduce((s, b) => s + b.done() + b.failed(), 0),
  );
  protected readonly uploadPercent = computed(() => {
    const total = this.uploadTotalItems();
    return total > 0 ? Math.round((this.uploadDoneItems() / total) * 100) : 0;
  });
  readonly hasActiveUploads = computed(() => this.uploadBatches().length > 0);
  protected readonly menu = signal<ContextMenu | null>(null);
  protected readonly shareTarget = signal<ShareTarget | null>(null);
  protected readonly videoTarget = signal<{ id: string; name: string; size: string } | null>(null);
  protected readonly previewTarget = signal<StoredFile | null>(null);
  protected readonly tagTarget = signal<TagTarget | null>(null);
  protected readonly dialog = signal<ExplorerDialog | null>(null);
  protected readonly moveTarget = signal<MoveItem[] | null>(null);

  // Tạo thư mục inline kiểu Windows Explorer (ô tên điền sẵn, sửa tại chỗ).
  protected readonly creatingFolder = signal(false);
  protected readonly newFolderName = signal('');
  private creatingBusy = false;

  // Đổi tên INLINE ngay trên card/hàng (không dùng hộp thoại).
  protected readonly renamingId = signal<string | null>(null);
  protected readonly renamingKind = signal<'file' | 'folder'>('file');
  protected readonly renameName = signal('');
  private renameOldName = '';
  private renamingBusy = false;

  // --- Chọn nhiều (multi-select) để thao tác hàng loạt ---
  protected readonly selectionMode = signal(false);
  protected readonly selectedFileIds = signal<Set<string>>(new Set());
  protected readonly selectedFolderIds = signal<Set<string>>(new Set());
  protected readonly confirmingBulkDelete = signal(false);
  protected readonly bulkBusy = signal(false);
  protected readonly selectedCount = computed(
    () => this.selectedFileIds().size + this.selectedFolderIds().size,
  );
  protected readonly allSelected = computed(
    () =>
      this.selectedCount() > 0 &&
      this.selectedCount() === this.files().length + this.folders().length,
  );

  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

  /** File ảnh? → thumbnail hiển thị đúng tỉ lệ gốc (object-fit: contain). */
  protected isImage(extension: string): boolean {
    return categoryOf(extension) === 'image';
  }

  /** Số chấm màu thẻ hiện trực tiếp trên card; dư ra gộp thành "+N" (hover xem). */
  private readonly MAX_TAG_DOTS = 5;
  protected visibleTags(tags: StoredFile['tags']): NonNullable<StoredFile['tags']> {
    return (tags ?? []).slice(0, this.MAX_TAG_DOTS);
  }
  protected overflowTags(tags: StoredFile['tags']): NonNullable<StoredFile['tags']> {
    return (tags ?? []).slice(this.MAX_TAG_DOTS);
  }

  protected readonly title = computed(() => {
    switch (this.mode()) {
      case 'type': {
        const cat = categoryByKey((this.category() ?? 'other') as never);
        return cat ? cat.labelKey : 'cat.other';
      }
      case 'starred':
        return 'nav.starred';
      case 'recent':
        return 'nav.recent';
      default:
        return 'nav.myStorage';
    }
  });

  protected readonly isFolderLens = computed(() => this.mode() === 'folder');

  constructor() {
    // Phản ứng khi đổi route (mode qua data, folderId/category qua params).
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      this.mode.set((data['mode'] as Mode) ?? 'folder');
      this.syncFromParams();
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncFromParams();
    });
  }

  private thumbRetries = 0;

  private syncFromParams(): void {
    this.folderId.set(this.route.snapshot.paramMap.get('folderId'));
    this.category.set(this.route.snapshot.paramMap.get('category'));
    const tagId = this.route.snapshot.paramMap.get('tagId');
    this.tagId.set(tagId);
    if (this.mode() === 'tag' && tagId) void this.loadTagMeta(tagId);
    this.clearSelection();
    this.thumbRetries = 0;
    void this.load();
  }

  /** Nạp tên + màu thẻ để hiển thị tiêu đề lăng kính Thẻ. */
  private async loadTagMeta(tagId: string): Promise<void> {
    try {
      const tags = await firstValueFrom(this.tagsApi.list());
      const tag = tags.find((t) => t.id === tagId);
      this.tagName.set(tag?.name ?? '');
      this.tagColor.set(tag?.color ?? '#8d8d8d');
    } catch {
      this.tagName.set('');
    }
  }

  /** Thumbnail sinh nền ở backend — nạp lại vài lần để card tự hiện khi có (mục 7). */
  private scheduleThumbRefresh(): void {
    if (this.thumbRetries >= 3) return;
    const pending = this.files().some(
      (f) =>
        f.status === 'ready' &&
        !f.thumbnailUrl &&
        (categoryOf(f.extension) === 'image' || categoryOf(f.extension) === 'video'),
    );
    if (!pending) return;
    this.thumbRetries++;
    setTimeout(() => void this.revalidate(), 3000);
  }

  /** Tham số khung nhìn hiện tại (để dựng query + khoá cache). */
  private currentParams(): ViewParams {
    return {
      folderId: this.folderId(),
      category: this.category(),
      tagId: this.tagId(),
      sort: this.sort() ?? 'createdAt',
      order: this.order() ?? 'desc',
    };
  }
  private currentKey(): string {
    return viewKey(this.mode() as Lens, this.currentParams());
  }
  private applyBundle(b: ViewBundle): void {
    this.folders.set(b.folders);
    this.files.set(b.files);
    this.breadcrumb.set(b.crumbs);
  }

  /** Gọi API lấy dữ liệu khung nhìn hiện tại. */
  private async fetchBundle(): Promise<ViewBundle> {
    const mode = this.mode() as Lens;
    const p = this.currentParams();
    const query = buildListQuery(mode, p);
    if (mode === 'folder') {
      const fid = p.folderId;
      const [folders, files, crumbs] = await Promise.all([
        firstValueFrom(this.foldersApi.listChildren(fid)),
        firstValueFrom(this.filesApi.list(query)),
        fid ? firstValueFrom(this.foldersApi.breadcrumb(fid)) : Promise.resolve([]),
      ]);
      return { folders, files, crumbs };
    }
    const files = await firstValueFrom(this.filesApi.list(query));
    return { folders: [], files, crumbs: [] };
  }

  /**
   * Nạp khung nhìn: cache có → hiện NGAY; cache-miss → GIỮ hiển thị hiện tại rồi
   * lấp im lặng. KHÔNG bao giờ hiện spinner trong nội dung — chỉ có 1 splash tổng
   * lúc mới vào app (không lặp lại cho tới khi refresh trang).
   */
  async load(): Promise<void> {
    this.menu.set(null);
    const key = this.currentKey();
    const cached = this.prefetch.getView(key);
    if (cached) this.applyBundle(cached);
    try {
      const fresh = await this.fetchBundle();
      this.prefetch.setView(key, fresh);
      this.applyBundle(fresh);
    } catch {
      /* giữ hiển thị hiện tại nếu lỗi */
    } finally {
      this.scheduleThumbRefresh();
    }
  }

  /** Nạp lại SILENT sau thao tác (không spinner, giữ hiển thị hiện tại đến khi có dữ liệu mới). */
  async revalidate(): Promise<void> {
    try {
      const fresh = await this.fetchBundle();
      this.prefetch.setView(this.currentKey(), fresh);
      this.applyBundle(fresh);
    } catch {
      /* giữ nguyên hiển thị hiện tại nếu lỗi */
    } finally {
      this.scheduleThumbRefresh();
    }
  }

  // --- Điều hướng ---
  openFolder(folder: Folder): void {
    if (this.selectionMode()) {
      this.toggleSelect('folder', folder.id);
      return;
    }
    void this.router.navigate(['/files/folder', folder.id]);
  }

  goCrumb(crumb: BreadcrumbCrumb | null): void {
    if (!crumb) void this.router.navigate(['/files']);
    else void this.router.navigate(['/files/folder', crumb.id]);
  }

  goToFilePath(file: StoredFile): void {
    const last = file.folderPath?.at(-1);
    if (last) void this.router.navigate(['/files/folder', last.id]);
    else void this.router.navigate(['/files']);
  }

  // --- Sort (gộp vào 1 nút dropdown) ---
  toggleSortMenu(event: Event): void {
    event.stopPropagation();
    this.sortMenuOpen.update((v) => !v);
  }

  /** Áp dụng 1 lựa chọn sắp xếp gộp (trường + chiều). */
  applySort(sort: NonNullable<ListFilesQuery['sort']>, order: NonNullable<ListFilesQuery['order']>): void {
    this.sort.set(sort);
    this.order.set(order);
    this.sortMenuOpen.set(false);
    void this.revalidate();
  }

  // --- Tạo thư mục INLINE (kiểu Windows Explorer) ---
  /** Bấm "Thư mục mới" → hiện 1 card với ô tên điền sẵn (đánh số kiểu Windows). */
  createFolder(): void {
    if (this.creatingFolder()) return;
    this.newFolderName.set(this.nextFolderName());
    this.creatingFolder.set(true);
  }

  cancelCreateFolder(): void {
    this.creatingFolder.set(false);
    this.newFolderName.set('');
    this.creatingBusy = false;
  }

  /** Xác nhận tạo (Enter hoặc rời ô). Trùng tên → tự thêm (2), (3)… */
  async confirmCreateFolder(): Promise<void> {
    if (!this.creatingFolder() || this.creatingBusy) return;
    this.creatingBusy = true;
    const typed = this.newFolderName().trim();
    const base = this.lang.translate('folder.newDefault');
    // Tránh trùng ngay ở client (backend cũng có lớp chống trùng dự phòng).
    const name = typed ? this.uniqueFolderName(typed) : this.nextFolderName();
    this.creatingFolder.set(false);
    this.newFolderName.set('');
    try {
      await firstValueFrom(this.foldersApi.create(name || base, this.folderId()));
      void this.revalidate();
      this.refresh.bump();
    } finally {
      this.creatingBusy = false;
    }
  }

  /** Tên "Thư mục mới" khả dụng kế tiếp: base, rồi "base (2)", "base (3)"… */
  private nextFolderName(): string {
    return this.uniqueFolderName(this.lang.translate('folder.newDefault'));
  }

  /** Trả tên chưa trùng trong thư mục hiện tại theo kiểu Windows: base → base (2) → … */
  private uniqueFolderName(desired: string): string {
    const taken = new Set(this.folders().map((f) => f.name.toLowerCase()));
    if (!taken.has(desired.toLowerCase())) return desired;
    const { base } = this.parseIndexed(desired);
    for (let i = 2; i < 100000; i++) {
      const candidate = `${base} (${i})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} (${Date.now()})`;
  }

  /** Tách "Base (n)" → {base, index}; không có số → index = 1 (kiểu Windows). */
  private parseIndexed(name: string): { base: string; index: number } {
    const m = /^(.*?)\s\((\d+)\)$/.exec(name.trim());
    if (m) return { base: m[1], index: Number(m[2]) };
    return { base: name.trim(), index: 1 };
  }

  // --- Download / mở file ---
  openFile(file: StoredFile): void {
    if (this.selectionMode()) {
      this.toggleSelect('file', file.id);
      return;
    }
    if (file.status !== 'ready') return;
    const cat = categoryOf(file.extension);
    // Video -> player HLS; Âm thanh -> mini-player góc dưới; còn lại -> preview modal.
    if (cat === 'video') {
      this.videoTarget.set({ id: file.id, name: file.name, size: file.size });
    } else if (cat === 'audio') {
      this.audioSvc.play({ id: file.id, name: file.name });
    } else {
      this.previewTarget.set(file);
    }
  }

  async download(file: StoredFile): Promise<void> {
    this.menu.set(null);
    const { url } = await firstValueFrom(this.filesApi.downloadUrl(file.id));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  }

  /** Tải cả thư mục dạng .zip (mục 5.E). */
  async downloadFolder(): Promise<void> {
    const m = this.menu();
    if (!m || m.kind !== 'folder') return;
    this.menu.set(null);
    const blob = await firstValueFrom(this.foldersApi.downloadZip(m.id));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${m.name}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Context menu ---
  openMenu(event: MouseEvent, kind: 'file' | 'folder', item: StoredFile | Folder): void {
    event.preventDefault();
    event.stopPropagation();
    this.menu.set({
      x: event.clientX,
      y: event.clientY,
      kind,
      id: item.id,
      name: item.name,
      isStarred: item.isStarred,
    });
  }

  closeMenu(): void {
    this.menu.set(null);
  }

  openShare(): void {
    const m = this.menu();
    if (!m) return;
    this.shareTarget.set({ kind: m.kind, id: m.id, name: m.name });
    this.menu.set(null);
  }

  // --- Chọn nhiều & thao tác hàng loạt ---
  toggleSelectionMode(): void {
    this.selectionMode.update((v) => !v);
    if (!this.selectionMode()) this.clearSelection();
  }

  clearSelection(): void {
    this.selectedFileIds.set(new Set());
    this.selectedFolderIds.set(new Set());
    this.confirmingBulkDelete.set(false);
  }

  isSelected(kind: 'file' | 'folder', id: string): boolean {
    return kind === 'file' ? this.selectedFileIds().has(id) : this.selectedFolderIds().has(id);
  }

  toggleSelect(kind: 'file' | 'folder', id: string, event?: Event): void {
    event?.stopPropagation();
    const sig = kind === 'file' ? this.selectedFileIds : this.selectedFolderIds;
    sig.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    this.confirmingBulkDelete.set(false);
  }

  selectAll(): void {
    if (this.allSelected()) {
      this.clearSelection();
      return;
    }
    this.selectedFileIds.set(new Set(this.files().map((f) => f.id)));
    this.selectedFolderIds.set(new Set(this.folders().map((f) => f.id)));
  }

  /** Gắn/bỏ sao cho toàn bộ mục đang chọn — cập nhật tại chỗ, không nhấp nháy. */
  async bulkStar(starred: boolean): Promise<void> {
    if (this.bulkBusy() || this.selectedCount() === 0) return;
    this.bulkBusy.set(true);
    const fileIds = [...this.selectedFileIds()];
    const folderIds = [...this.selectedFolderIds()];
    try {
      await Promise.all([
        ...fileIds.map((id) => firstValueFrom(this.filesApi.star(id, starred))),
        ...folderIds.map((id) => firstValueFrom(this.foldersApi.star(id, starred))),
      ]);
      for (const id of fileIds) this.applyStarLocally('file', id, starred);
      for (const id of folderIds) this.applyStarLocally('folder', id, starred);
      this.clearSelection();
      this.refresh.bump();
    } finally {
      this.bulkBusy.set(false);
    }
  }

  /** Chuyển toàn bộ mục đang chọn vào Thùng rác (xác nhận inline, không dùng hộp thoại trình duyệt). */
  async bulkTrash(): Promise<void> {
    if (!this.confirmingBulkDelete()) {
      this.confirmingBulkDelete.set(true);
      return;
    }
    if (this.bulkBusy() || this.selectedCount() === 0) return;
    this.bulkBusy.set(true);
    try {
      const fileOps = [...this.selectedFileIds()].map((id) =>
        firstValueFrom(this.filesApi.trash(id)),
      );
      const folderOps = [...this.selectedFolderIds()].map((id) =>
        firstValueFrom(this.foldersApi.trash(id)),
      );
      await Promise.all([...fileOps, ...folderOps]);
      this.clearSelection();
      await this.revalidate();
      this.refresh.bump();
    } finally {
      this.bulkBusy.set(false);
    }
  }

  /** Mở dialog "Chuyển đến" cho 1 mục từ context menu. */
  openMove(): void {
    const m = this.menu();
    if (!m) return;
    this.moveTarget.set([{ kind: m.kind, id: m.id, name: m.name }]);
    this.menu.set(null);
  }

  /** Mở dialog "Chuyển đến" cho toàn bộ mục đang chọn (bulk). */
  bulkMove(): void {
    if (this.selectedCount() === 0) return;
    const items: MoveItem[] = [
      ...this.folders()
        .filter((f) => this.selectedFolderIds().has(f.id))
        .map((f) => ({ kind: 'folder' as const, id: f.id, name: f.name })),
      ...this.files()
        .filter((f) => this.selectedFileIds().has(f.id))
        .map((f) => ({ kind: 'file' as const, id: f.id, name: f.name })),
    ];
    this.moveTarget.set(items);
  }

  /** Sau khi chuyển xong: đóng dialog, bỏ chọn, nạp lại. */
  onMoved(): void {
    this.moveTarget.set(null);
    this.clearSelection();
    void this.revalidate();
    this.refresh.bump();
  }

  /** Mở dialog gắn thẻ cho file đang chọn trong context menu. */
  openTag(): void {
    const m = this.menu();
    if (!m || m.kind !== 'file') return;
    const file = this.fileById(m.id);
    this.tagTarget.set({
      fileId: m.id,
      assignedIds: (file?.tags ?? []).map((t) => t.id),
    });
    this.menu.set(null);
  }

  // --- Đổi tên INLINE (ngay trên card/hàng, không hộp thoại) ---
  renameItem(): void {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    this.startRename(m.kind, m.id, m.name);
  }

  private startRename(kind: 'file' | 'folder', id: string, name: string): void {
    this.creatingFolder.set(false); // không tạo mới song song
    this.renamingKind.set(kind);
    this.renameOldName = name;
    this.renameName.set(name);
    this.renamingId.set(id);
  }

  cancelRename(): void {
    this.renamingId.set(null);
    this.renamingBusy = false;
  }

  /** Xác nhận đổi tên (Enter/rời ô). Thư mục: dồn số thứ tự nhóm trùng tên. */
  async confirmRename(): Promise<void> {
    const id = this.renamingId();
    if (!id || this.renamingBusy) return;
    const kind = this.renamingKind();
    const newName = this.renameName().trim();
    const oldName = this.renameOldName;
    this.renamingBusy = true;
    this.renamingId.set(null);
    try {
      if (!newName || newName === oldName) return; // không đổi → thôi
      if (kind === 'file') {
        await firstValueFrom(this.filesApi.rename(id, newName));
      } else {
        await firstValueFrom(this.foldersApi.rename(id, newName));
        await this.renumberAfter(oldName, id);
      }
      void this.revalidate();
    } finally {
      this.renamingBusy = false;
    }
  }

  /**
   * Sau khi đổi tên/loại 1 thư mục khỏi nhóm "Base (n)", các thư mục có index lớn
   * hơn sẽ giảm 1 để giữ dãy liền mạch (New folder (3) → New folder (2)…).
   */
  private async renumberAfter(oldName: string, renamedId: string): Promise<void> {
    const removed = this.parseIndexed(oldName);
    const group = this.folders()
      .filter((f) => f.id !== renamedId)
      .map((f) => ({ f, ...this.parseIndexed(f.name) }))
      .filter(
        (x) => x.base.toLowerCase() === removed.base.toLowerCase() && x.index > removed.index,
      )
      .sort((a, b) => a.index - b.index);

    for (const item of group) {
      const ni = item.index - 1;
      const target = ni <= 1 ? removed.base : `${removed.base} (${ni})`;
      try {
        await firstValueFrom(this.foldersApi.rename(item.f.id, target));
      } catch {
        /* fail-soft: bỏ qua mục lỗi, tiếp tục */
      }
    }
  }

  /** Cập nhật trạng thái sao ngay tại chỗ — KHÔNG reload để tránh nhấp nháy. */
  private applyStarLocally(kind: 'file' | 'folder', id: string, starred: boolean): void {
    // Ở lăng kính "Gắn sao": bỏ sao thì loại khỏi danh sách luôn.
    if (this.mode() === 'starred' && !starred) {
      if (kind === 'file') this.files.update((fs) => fs.filter((f) => f.id !== id));
      else this.folders.update((fs) => fs.filter((f) => f.id !== id));
      return;
    }
    if (kind === 'file') {
      this.files.update((fs) => fs.map((f) => (f.id === id ? { ...f, isStarred: starred } : f)));
    } else {
      this.folders.update((fs) => fs.map((f) => (f.id === id ? { ...f, isStarred: starred } : f)));
    }
  }

  async toggleStar(): Promise<void> {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    const next = !m.isStarred;
    this.applyStarLocally(m.kind, m.id, next); // hiện luôn, không nhấp nháy
    try {
      if (m.kind === 'file') await firstValueFrom(this.filesApi.star(m.id, next));
      else await firstValueFrom(this.foldersApi.star(m.id, next));
      this.refresh.bump();
    } catch {
      this.applyStarLocally(m.kind, m.id, !next); // hoàn tác nếu lỗi
    }
  }

  deleteItem(): void {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    this.dialog.set({ type: 'confirmDelete', kind: m.kind, id: m.id, name: m.name });
  }

  async confirmDelete(): Promise<void> {
    const d = this.dialog();
    this.dialog.set(null);
    if (d?.type !== 'confirmDelete') return;
    if (d.kind === 'file') await firstValueFrom(this.filesApi.trash(d.id));
    else await firstValueFrom(this.foldersApi.trash(d.id));
    void this.revalidate();
    this.refresh.bump();
  }

  // --- Upload ---
  toggleUploadMenu(event: Event): void {
    event.stopPropagation();
    this.uploadMenuOpen.update((v) => !v);
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) void this.uploadFileList(Array.from(input.files));
    input.value = '';
    this.uploadMenuOpen.set(false);
  }

  // Đếm depth để overlay không nhấp nháy khi rê qua các card con.
  private dragDepth = 0;

  private isFileDrag(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  }

  onDragEnter(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragOver.set(true);
  }

  onDragOver(event: DragEvent): void {
    if (this.isFileDrag(event)) event.preventDefault(); // cho phép thả
  }

  onDragLeave(): void {
    this.dragDepth--;
    if (this.dragDepth <= 0) {
      this.dragDepth = 0;
      this.dragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.dragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length) void this.uploadFileList(Array.from(files));
  }

  /**
   * Upload: gộp mỗi thư mục thành 1 "mục" hiện "X trong số N", mỗi file lẻ 1 mục.
   * Giữ cấu trúc thư mục qua webkitRelativePath (mục 2.1).
   */
  private uploadFileList(files: File[]): void {
    const rootId = this.isFolderLens() ? this.folderId() : null;

    // Nhóm theo thư mục gốc; file lẻ đứng riêng.
    const folderGroups = new Map<string, File[]>();
    const loose: File[] = [];
    for (const file of files) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      if (rel && rel.includes('/')) {
        const top = rel.split('/')[0];
        const arr = folderGroups.get(top) ?? [];
        arr.push(file);
        folderGroups.set(top, arr);
      } else {
        loose.push(file);
      }
    }

    const batches: UploadBatch[] = [];
    for (const [name, groupFiles] of folderGroups) {
      batches.push(this.makeBatch(name, true, groupFiles));
    }
    for (const f of loose) {
      batches.push(this.makeBatch(f.name, false, [f]));
    }

    this.uploadBatches.update((list) => [...batches, ...list]);
    this.uploadsCollapsed.set(false);
    for (const batch of batches) void this.runBatch(batch, rootId);
  }

  private makeBatch(label: string, isFolder: boolean, files: File[]): UploadBatch {
    return {
      id: crypto.randomUUID(),
      label,
      isFolder,
      total: files.length,
      done: signal(0),
      failed: signal(0),
      status: signal<'uploading' | 'done' | 'error' | 'canceled'>('uploading'),
      firstTask: signal<UploadTask | null>(null),
      tasks: [],
      files,
      canceled: false,
    };
  }

  private async runBatch(batch: UploadBatch, rootId: string | null): Promise<void> {
    const folderCache = new Map<string, string | null>();
    folderCache.set('', rootId);

    for (const file of batch.files) {
      if (batch.canceled) break;
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      let targetFolderId = rootId;
      if (rel && rel.includes('/')) {
        const segments = rel.split('/').slice(0, -1);
        targetFolderId = await this.ensureFolderPath(segments, rootId, folderCache);
      }
      const task = this.uploadService.createTask(file);
      batch.tasks.push(task);
      if (!batch.isFolder) batch.firstTask.set(task);
      const result = await this.uploadService.run(task, file, targetFolderId);
      if (result) batch.done.update((v) => v + 1);
      else if (task.status() !== 'canceled') batch.failed.update((v) => v + 1);
    }

    if (batch.canceled) batch.status.set('canceled');
    else if (batch.failed() > 0) batch.status.set('error');
    else batch.status.set('done');

    void this.revalidate();
    this.refresh.bump();
  }

  cancelBatch(batch: UploadBatch): void {
    batch.canceled = true;
    for (const t of batch.tasks) t.cancel();
    batch.status.set('canceled');
  }

  toggleUploadsCollapse(): void {
    this.uploadsCollapsed.update((v) => !v);
  }

  /** Tạo/tìm chuỗi thư mục lồng nhau, trả id thư mục lá. */
  private async ensureFolderPath(
    segments: string[],
    rootId: string | null,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    let parentId = rootId;
    let pathKey = '';
    for (const seg of segments) {
      pathKey = pathKey ? `${pathKey}/${seg}` : seg;
      if (cache.has(pathKey)) {
        parentId = cache.get(pathKey)!;
        continue;
      }
      const children = await firstValueFrom(this.foldersApi.listChildren(parentId));
      const existing = children.find((c) => c.name === seg);
      const folder = existing ?? (await firstValueFrom(this.foldersApi.create(seg, parentId)));
      cache.set(pathKey, folder.id);
      parentId = folder.id;
    }
    return parentId;
  }

  dismissUploads(): void {
    this.uploadBatches.set([]);
  }

  /** Tra file trong danh sách hiện tại theo id (dùng cho menu download). */
  fileById(id: string): StoredFile {
    return this.files().find((f) => f.id === id) as StoredFile;
  }
}
