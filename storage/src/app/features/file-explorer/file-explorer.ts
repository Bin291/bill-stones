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
import { PromptDialog } from '../ui/prompt-dialog';
import { MoveDialog, MoveItem } from './move-dialog';
import { TagsApiService } from '../../core/services/tags-api.service';
import {
  BreadcrumbCrumb,
  Folder,
  ListFilesQuery,
  StoredFile,
} from '../../core/models/file.model';
import { CATEGORIES, categoryByKey, categoryOf, formatBytes, iconOf } from '../../core/util/file-types';

type Mode = 'folder' | 'type' | 'starred' | 'recent' | 'tag';

/** Mục tiêu gắn thẻ cho 1 file (mở dialog tag từ context menu). */
interface TagTarget {
  fileId: string;
  assignedIds: string[];
}

/** Hộp thoại tuỳ biến (thay prompt/confirm trình duyệt). */
type ExplorerDialog =
  | { type: 'newFolder' }
  | { type: 'rename'; kind: 'file' | 'folder'; id: string; name: string }
  | { type: 'confirmDelete'; kind: 'file' | 'folder'; id: string; name: string };

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
    PromptDialog,
    MoveDialog,
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
    setTimeout(() => void this.load(), 3000);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.menu.set(null);
    try {
      if (this.isFolderLens()) {
        const fid = this.folderId();
        const [folders, files, crumbs] = await Promise.all([
          firstValueFrom(this.foldersApi.listChildren(fid)),
          firstValueFrom(this.filesApi.list(this.buildQuery())),
          fid ? firstValueFrom(this.foldersApi.breadcrumb(fid)) : Promise.resolve([]),
        ]);
        this.folders.set(folders);
        this.files.set(files);
        this.breadcrumb.set(crumbs);
      } else {
        this.folders.set([]);
        this.breadcrumb.set([]);
        const files = await firstValueFrom(this.filesApi.list(this.buildQuery()));
        this.files.set(files);
      }
    } catch {
      this.folders.set([]);
      this.files.set([]);
    } finally {
      this.loading.set(false);
      this.scheduleThumbRefresh();
    }
  }

  private buildQuery(): ListFilesQuery {
    const base: ListFilesQuery = { sort: this.sort(), order: this.order() };
    switch (this.mode()) {
      case 'folder':
        return { ...base, folderId: this.folderId() };
      case 'type': {
        const cat = categoryByKey((this.category() ?? 'other') as never);
        return { ...base, extensions: (cat?.extensions ?? []).join(','), withPath: true };
      }
      case 'tag':
        return { ...base, tagId: this.tagId() ?? '', withPath: true };
      case 'starred':
        return { ...base, starred: true, extensions: this.allExtensions(), withPath: true };
      case 'recent':
        return {
          ...base,
          sort: 'updatedAt',
          order: 'desc',
          extensions: this.allExtensions(),
          withPath: true,
        };
    }
  }

  private allExtensions(): string {
    return CATEGORIES.flatMap((c) => c.extensions).join(',');
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

  setSort(field: NonNullable<ListFilesQuery['sort']>): void {
    if (this.sort() === field) {
      this.order.set(this.order() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sort.set(field);
      this.order.set(field === 'name' ? 'asc' : 'desc');
    }
    void this.load();
  }

  // --- Tạo thư mục (hộp thoại tuỳ biến) ---
  createFolder(): void {
    this.dialog.set({ type: 'newFolder' });
  }

  async submitNewFolder(name: string): Promise<void> {
    this.dialog.set(null);
    await firstValueFrom(this.foldersApi.create(name.trim(), this.folderId()));
    void this.load();
    this.refresh.bump();
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
      await this.load();
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
    void this.load();
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

  // --- Đổi tên (hộp thoại tuỳ biến) ---
  renameItem(): void {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    this.dialog.set({ type: 'rename', kind: m.kind, id: m.id, name: m.name });
  }

  async submitRename(name: string): Promise<void> {
    const d = this.dialog();
    this.dialog.set(null);
    if (d?.type !== 'rename') return;
    if (d.kind === 'file') await firstValueFrom(this.filesApi.rename(d.id, name.trim()));
    else await firstValueFrom(this.foldersApi.rename(d.id, name.trim()));
    void this.load();
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
    void this.load();
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

    void this.load();
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
