import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FilesApiService } from '../../core/services/files-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { VirusScanApiService, ScanResult } from '../../core/services/virus-scan-api.service';
import {
  UploadService,
  UploadTask,
  UploadConflict,
  ConflictResolution,
} from '../../core/services/upload.service';
import { RefreshService } from '../../core/services/refresh.service';
import { AudioPlayerService } from '../../core/services/audio-player.service';
import { SettingsService } from '../../core/services/settings.service';
import { SettingsApiService } from '../../core/services/settings-api.service';
import { DeviceCapabilityService } from '../../core/services/device-capability.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ShareDialog, ShareTarget } from '../share/share-dialog';
import { VideoPlayer } from '../video-player/video-player';
import { FilePreview } from '../file-preview/file-preview';
import { TagDialog } from '../tags/tag-dialog';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { PromptDialog } from '../ui/prompt-dialog';
import { Loader } from '../ui/loader';
import { Autofocus } from '../ui/autofocus.directive';
import { MoveDialog, MoveItem } from './move-dialog';
import { TagsApiService } from '../../core/services/tags-api.service';
import { LangService } from '../../core/i18n/lang.service';
import { ToastService } from '../../core/services/toast.service';
import {
  BreadcrumbCrumb,
  Folder,
  ListFilesQuery,
  StoredFile,
  Tag,
} from '../../core/models/file.model';
import { categoryByKey, categoryOf, extensionOf, formatBytes, iconOf } from '../../core/util/file-types';
import { PrefetchService, ViewBundle } from '../../core/services/prefetch.service';
import { Lens, ViewParams, buildListQuery, viewKey } from '../../core/util/list-query';

type Mode = 'folder' | 'type' | 'starred' | 'recent' | 'tag';

/** Mục tiêu gắn thẻ cho 1 file HOẶC 1 thư mục (mở dialog tag từ context menu). */
interface TagTarget {
  fileId?: string;
  folderId?: string;
  assignedIds: string[];
}

/** Hộp thoại tuỳ biến (thay prompt/confirm trình duyệt). */
type ExplorerDialog =
  | { type: 'newFolder'; name: string }
  | { type: 'confirmDelete'; kind: 'file' | 'folder'; id: string; name: string }
  | { type: 'confirmBulkDelete'; count: number };

interface ContextMenu {
  x: number;
  y: number;
  kind: 'file' | 'folder';
  id: string;
  name: string;
  isStarred: boolean;
  /** false = mới mở, đang đo kích thước thật để định vị lại — chưa hiện ra. */
  visible: boolean;
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
    Loader,
    Autofocus,
  ],
  templateUrl: './file-explorer.html',
  host: {
    class: 'explorer-host',
    // Lăn chuột ở bất kỳ đâu → đóng context menu (mục yêu cầu: menu biến mất khi cuộn).
    '(window:wheel)': 'onWindowScroll()',
    '(window:scroll)': 'onWindowScroll()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileExplorer {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly filesApi = inject(FilesApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly uploadService = inject(UploadService);
  private readonly virusScan = inject(VirusScanApiService);
  private readonly refresh = inject(RefreshService);
  private readonly audioSvc = inject(AudioPlayerService);
  private readonly tagsApi = inject(TagsApiService);
  private readonly prefetch = inject(PrefetchService);
  private readonly lang = inject(LangService);
  private readonly toast = inject(ToastService);
  protected readonly settings = inject(SettingsService);
  private readonly settingsApi = inject(SettingsApiService);
  private readonly device = inject(DeviceCapabilityService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly mode = signal<Mode>('folder');
  protected readonly folderId = signal<string | null>(null);
  protected readonly category = signal<string | null>(null);
  protected readonly tagId = signal<string | null>(null);
  protected readonly tagName = signal<string>('');
  protected readonly tagColor = signal<string>('#8d8d8d');

  protected readonly folders = signal<Folder[]>([]);
  protected readonly files = signal<StoredFile[]>([]);

  protected readonly nameFilter = signal('');
  protected readonly foldersExpanded = signal(true);
  protected readonly filesExpanded = signal(true);
  protected readonly displayFolders = computed(() => this.filterByName(this.folders()));
  protected readonly displayFiles = computed(() => this.filterByName(this.files()));
  private filterByName<T extends { name: string }>(list: T[]): T[] {
    const q = this.nameFilter().trim().toLowerCase();
    return q ? list.filter((x) => x.name.toLowerCase().includes(q)) : list;
  }
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
  protected readonly menuEl = viewChild<ElementRef<HTMLElement>>('menuEl');
  protected readonly shareTarget = signal<ShareTarget | null>(null);
  protected readonly videoTarget = signal<{ id: string; name: string; size: string } | null>(null);
  protected readonly previewTarget = signal<StoredFile | null>(null);
  protected readonly tagTarget = signal<TagTarget | null>(null);
  protected readonly dialog = signal<ExplorerDialog | null>(null);
  protected readonly deleteBusy = signal(false);
  protected readonly moveTarget = signal<MoveItem[] | null>(null);
  protected readonly conflictPrompt = signal<UploadConflict | null>(null);
  private conflictResolver: ((r: ConflictResolution) => void) | null = null;

  // Cảnh báo tệp thực thi (.exe…) trước khi tải lên — sẽ quét virus (VirusTotal).
  protected readonly exeWarn = signal<{ names: string[] } | null>(null);
  private exeWarnResolver: ((proceed: boolean) => void) | null = null;

  // Kết quả quét khi PHÁT HIỆN mã độc — hiện chi tiết rồi hỏi có tải lên không.
  protected readonly scanResult = signal<{ fileName: string; result: ScanResult } | null>(null);
  private scanResultResolver: ((proceed: boolean) => void) | null = null;

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
  protected readonly bulkBusy = signal(false);
  protected readonly selectedCount = computed(
    () => this.selectedFileIds().size + this.selectedFolderIds().size,
  );
  protected readonly allSelected = computed(
    () =>
      this.selectedCount() > 0 &&
      this.selectedCount() === this.files().length + this.folders().length,
  );

  // --- Kéo chuột chọn vùng (marquee) kiểu Google Drive ---
  /** Hình chữ nhật vùng chọn (toạ độ viewport, position:fixed). null = không kéo. */
  protected readonly marqueeRect = signal<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeActive = false;
  private marqueeWasSelectionMode = false;
  private marqueeBaseFiles = new Set<string>();
  private marqueeBaseFolders = new Set<string>();
  private readonly onMarqueeMoveBound = (e: MouseEvent): void => this.onMarqueeMove(e);
  private readonly onMarqueeUpBound = (): void => this.onMarqueeUp();

  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

  /** Icon đúng loại file cho 1 mục upload (dựa trên tên file, ligature Material Icons hợp lệ). */
  protected uploadIconOf(label: string): string {
    return iconOf(extensionOf(label));
  }

  /** File ảnh? → thumbnail hiển thị đúng tỉ lệ gốc (object-fit: contain). */
  protected isImage(extension: string): boolean {
    return categoryOf(extension) === 'image';
  }

  /**
   * Hiển thị tên thư mục do hệ thống TỰ ĐẶT theo ngôn ngữ đang chọn:
   * "Thư mục mới (2)" ⇄ "New folder (2)". Tên do người dùng tự đặt giữ nguyên.
   */
  protected folderDisplayName(name: string): string {
    const cur = this.lang.translate('folder.newDefault');
    for (const base of ['Thư mục mới', 'New folder']) {
      if (name === base) return cur;
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`^${esc} \\((\\d+)\\)$`).exec(name);
      if (m) return `${cur} (${m[1]})`;
    }
    return name;
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

    // Định vị menu chuột phải sau khi đã render (đo được kích thước thật) —
    // kiểu Google Drive: lật sang trái/lên trên nếu tràn màn hình, không bao
    // giờ mở ra ngoài viewport. Menu render ẩn (visibility) tới khi đo xong.
    effect(() => {
      const el = this.menuEl()?.nativeElement;
      const m = this.menu();
      if (!el || !m || m.visible) return;
      const pad = 8;
      const rect = el.getBoundingClientRect();
      let x = m.x;
      let y = m.y;
      if (x + rect.width + pad > window.innerWidth) x = m.x - rect.width; // lật trái
      if (y + rect.height + pad > window.innerHeight) y = m.y - rect.height; // lật lên
      x = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad));
      y = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad));
      this.menu.set({ ...m, x, y, visible: true });
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
    this.nameFilter.set(''); // đổi lăng kính/thư mục → xoá bộ lọc tên
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
    if (mode === 'starred') {
      const [folders, files] = await Promise.all([
        firstValueFrom(this.foldersApi.listStarred()),
        firstValueFrom(this.filesApi.list(query)),
      ]);
      return { folders, files, crumbs: [] };
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

  /** Đưa tới thư mục CHA của 1 thư mục (dùng cho badge đường dẫn ở lăng kính Gắn sao). */
  goToFolderParent(folder: Folder): void {
    const last = folder.folderPath?.at(-1);
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

  // --- Tạo thư mục (HỘP THOẠI riêng, có nút Huỷ) ---
  /** Bấm "Thư mục mới" → mở dialog với ô tên điền sẵn (đánh số kiểu Windows).
   * Không còn giới hạn số cấp lồng nhau (theo yêu cầu — bỏ giới hạn 7 cấp). */
  createFolder(): void {
    this.dialog.set({ type: 'newFolder', name: this.nextFolderName() });
  }

  /** Xác nhận tạo từ dialog. Trùng tên → tự thêm (2), (3)… */
  async submitNewFolder(name: string): Promise<void> {
    this.dialog.set(null);
    if (this.creatingBusy) return;
    this.creatingBusy = true;
    const base = this.lang.translate('folder.newDefault');
    const typed = name.trim();
    const finalName = this.uniqueFolderName(typed || base);
    try {
      const created = await firstValueFrom(
        this.foldersApi.create(finalName, this.folderId()),
      );
      // Hiện thư mục mới NGAY (optimistic) — không chờ revalidate full bundle,
      // vì bundle gộp cả danh sách file (có thể tải chậm) nên thư mục sẽ bị "kẹt"
      // chờ theo tới khi files về. Chèn ngay rồi revalidate im lặng để đồng bộ.
      if (this.mode() === 'folder') {
        this.folders.update((list) =>
          [...list, { ...created, tags: created.tags ?? [] }].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
      }
      void this.revalidate();
      this.refresh.bump();
    } catch (e) {
      // VD vượt 7 cấp → backend trả 400 kèm thông báo; hiện toast cho người dùng.
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? (e as { error?: { message?: string } }).error?.message
          : undefined;
      this.toast.error(msg || this.lang.translate('folder.createFailed'));
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
  /** Ngưỡng "file nặng" để cảnh báo trên máy yếu (50MB). */
  private static readonly HEAVY_FILE_BYTES = 50 * 1024 * 1024;
  /** File đang chờ mở sau cảnh báo hiệu năng (máy yếu). null = không có cảnh báo. */
  protected readonly perfWarn = signal<StoredFile | null>(null);

  openFile(file: StoredFile): void {
    if (this.selectionMode()) {
      this.toggleSelect('file', file.id);
      return;
    }
    if (file.status !== 'ready') return;
    // Máy yếu + file nặng → hỏi trước (mở có thể lâu/giảm hiệu năng tạm thời).
    if (this.device.isWeak() && Number(file.size) >= FileExplorer.HEAVY_FILE_BYTES) {
      this.perfWarn.set(file);
      return;
    }
    this.doOpenFile(file);
  }

  /** Mở thật sự (sau khi qua kiểm tra cảnh báo). */
  private doOpenFile(file: StoredFile): void {
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

  /** Tóm tắt cấu hình máy (hiện trong cảnh báo hiệu năng). */
  protected deviceSummary(): string {
    return this.device.summary();
  }

  /** Người dùng chọn "Tiếp tục" trong cảnh báo hiệu năng → mở file. */
  perfContinue(): void {
    const file = this.perfWarn();
    this.perfWarn.set(null);
    if (file) this.doOpenFile(file);
  }

  /** Người dùng chọn "Dừng lại" → huỷ mở. */
  perfCancel(): void {
    this.perfWarn.set(null);
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
      visible: false,
    });
  }

  closeMenu(): void {
    this.menu.set(null);
  }

  /** Cuộn chuột (bánh xe hoặc trang) → ẩn context menu nếu đang mở. */
  onWindowScroll(): void {
    if (this.menu()) this.menu.set(null);
  }

  /**
   * Chuột phải vào VÙNG TRỐNG (không phải card) → chặn menu mặc định của trình
   * duyệt. Card tự gọi preventDefault + stopPropagation trong openMenu() nên
   * handler này chỉ chạy cho vùng trống.
   */
  onRootContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.menu.set(null);
  }

  /**
   * Bấm chuột trái vào VÙNG TRỐNG: đóng mọi menu đang mở. KHÔNG chọn/huỷ chọn gì
   * (để tránh "bao quát hết") — chỉ dọn menu. Card tự stopPropagation nên click
   * trên card không lọt tới đây.
   */
  onRootClick(): void {
    this.menu.set(null);
    this.sortMenuOpen.set(false);
    this.uploadMenuOpen.set(false);
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
  }

  selectAll(): void {
    if (this.allSelected()) {
      this.clearSelection();
      return;
    }
    this.selectedFileIds.set(new Set(this.files().map((f) => f.id)));
    this.selectedFolderIds.set(new Set(this.folders().map((f) => f.id)));
  }

  /**
   * Bắt đầu kéo chọn vùng khi nhấn chuột trái ở VÙNG TRỐNG (không phải card/nút).
   * Giữ Ctrl/Shift để CỘNG thêm vào lựa chọn hiện có. Chỉ là "click" (không kéo) thì
   * không làm gì — vượt ngưỡng 6px mới coi là kéo (mục yêu cầu #5/#6).
   */
  onRootMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const t = event.target as HTMLElement;
    if (
      t.closest(
        '.card, [data-id], tr, button, a, input, textarea, label, .toolbar, .select-bar, .menu, .sort-pop, .explorer-section-title, .inline-name, .uploads-panel',
      )
    ) {
      return;
    }
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    this.marqueeStart = { x: event.clientX, y: event.clientY };
    this.marqueeActive = false;
    this.marqueeWasSelectionMode = this.selectionMode();
    this.marqueeBaseFiles = additive ? new Set(this.selectedFileIds()) : new Set();
    this.marqueeBaseFolders = additive ? new Set(this.selectedFolderIds()) : new Set();
    window.addEventListener('mousemove', this.onMarqueeMoveBound);
    window.addEventListener('mouseup', this.onMarqueeUpBound);
  }

  private onMarqueeMove(event: MouseEvent): void {
    const start = this.marqueeStart;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!this.marqueeActive) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // chưa đủ để coi là kéo
      this.marqueeActive = true;
      if (this.marqueeBaseFiles.size === 0 && this.marqueeBaseFolders.size === 0) {
        this.clearSelection();
      }
    }
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    this.marqueeRect.set({ left, top, width, height });
    this.applyMarqueeSelection(left, top, left + width, top + height);
    event.preventDefault();
  }

  /** Chọn mọi mục (card ở lưới HOẶC hàng ở danh sách) giao với hình chữ nhật. */
  private applyMarqueeSelection(l: number, t: number, r: number, b: number): void {
    const files = new Set(this.marqueeBaseFiles);
    const folders = new Set(this.marqueeBaseFolders);
    const cards = document.querySelectorAll<HTMLElement>('.explorer-root [data-id][data-kind]');
    cards.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const hit = rect.left < r && rect.right > l && rect.top < b && rect.bottom > t;
      if (!hit) return;
      const id = el.dataset['id'];
      if (!id) return;
      if (el.dataset['kind'] === 'folder') folders.add(id);
      else files.add(id);
    });
    this.selectedFileIds.set(files);
    this.selectedFolderIds.set(folders);
    if ((files.size > 0 || folders.size > 0) && !this.selectionMode()) {
      this.selectionMode.set(true);
    }
  }

  private onMarqueeUp(): void {
    window.removeEventListener('mousemove', this.onMarqueeMoveBound);
    window.removeEventListener('mouseup', this.onMarqueeUpBound);
    this.marqueeStart = null;
    this.marqueeRect.set(null);
    if (!this.marqueeActive) return;
    this.marqueeActive = false;
    // Kéo nhưng không trúng gì → khôi phục trạng thái chọn trước đó (không kẹt ở chế độ chọn rỗng).
    if (this.selectedCount() === 0) this.selectionMode.set(this.marqueeWasSelectionMode);
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

  /** Bấm "Xoá" hàng loạt → mở hộp thoại xác nhận của web app (không xoá ngay). */
  bulkTrash(): void {
    if (this.selectedCount() === 0 || this.bulkBusy()) return;
    this.dialog.set({ type: 'confirmBulkDelete', count: this.selectedCount() });
  }

  /** Xác nhận từ hộp thoại → chuyển toàn bộ mục đang chọn vào Thùng rác. */
  async confirmBulkTrash(): Promise<void> {
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
      this.toast.success(this.lang.translate('toast.movedToTrash'));
      this.dialog.set(null);
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

  /** Mở dialog gắn thẻ cho file/thư mục đang chọn trong context menu. */
  openTag(): void {
    const m = this.menu();
    if (!m) return;
    if (m.kind === 'file') {
      const file = this.fileById(m.id);
      this.tagTarget.set({ fileId: m.id, assignedIds: (file?.tags ?? []).map((t) => t.id) });
    } else {
      const folder = this.folderById(m.id);
      this.tagTarget.set({ folderId: m.id, assignedIds: (folder?.tags ?? []).map((t) => t.id) });
    }
    this.menu.set(null);
  }

  /**
   * Cập nhật lại danh sách thẻ tại chỗ khi dialog gắn thẻ bắn `changed` — không
   * reload cả danh sách (mục 1.3). `undefined` = thay đổi chung (sửa/xoá thẻ) →
   * nạp lại nền để đồng bộ tên/màu thẻ đã đổi trên mọi mục đang hiện.
   */
  onTagsChanged(payload: { fileId?: string; folderId?: string; tags: Tag[] } | undefined): void {
    if (!payload) {
      void this.revalidate();
      return;
    }
    if (payload.fileId) {
      const fid = payload.fileId;
      this.files.update((fs) => fs.map((f) => (f.id === fid ? { ...f, tags: payload.tags } : f)));
    } else if (payload.folderId) {
      const folId = payload.folderId;
      this.folders.update((fs) => fs.map((f) => (f.id === folId ? { ...f, tags: payload.tags } : f)));
    }
  }

  // --- Đổi tên INLINE (ngay trên card/hàng, không hộp thoại) ---
  renameItem(): void {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    this.startRename(m.kind, m.id, m.name);
  }

  private startRename(kind: 'file' | 'folder', id: string, name: string): void {
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
      // Đổi tên CHỈ mục đang chọn — KHÔNG đụng tới các mục khác (bỏ dồn số thứ tự).
      if (kind === 'file') {
        await firstValueFrom(this.filesApi.rename(id, newName));
      } else {
        await firstValueFrom(this.foldersApi.rename(id, newName));
      }
      void this.revalidate();
    } finally {
      this.renamingBusy = false;
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
    if (d?.type !== 'confirmDelete' || this.deleteBusy()) return;
    this.deleteBusy.set(true);
    try {
      if (d.kind === 'file') await firstValueFrom(this.filesApi.trash(d.id));
      else await firstValueFrom(this.foldersApi.trash(d.id));
      this.toast.success(this.lang.translate('toast.movedToTrash'));
      this.dialog.set(null);
      void this.revalidate();
      this.refresh.bump();
    } catch {
      this.toast.error(this.lang.translate('toast.actionFailed'));
    } finally {
      this.deleteBusy.set(false);
    }
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

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragDepth = 0;
    this.dragOver.set(false);
    const dt = event.dataTransfer;
    if (!dt) return;
    // Duyệt CẢ CÂY thư mục khi kéo-thả folder (webkitGetAsEntry) — nếu không,
    // dataTransfer.files chỉ có mục cấp trên cùng, bỏ sót file (và .exe) bên trong.
    const items = dt.items;
    const entries: FileSystemEntry[] = [];
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }
    if (entries.length) {
      const files = await this.collectDroppedEntries(entries);
      if (files.length) void this.uploadFileList(files);
      return;
    }
    const files = dt.files;
    if (files && files.length) void this.uploadFileList(Array.from(files));
  }

  /**
   * Đệ quy đọc mọi file trong các entry được kéo-thả (gồm thư mục con), gắn
   * webkitRelativePath để runBatch tái tạo cấu trúc thư mục như khi chọn bằng
   * hộp thoại chọn thư mục.
   */
  private async collectDroppedEntries(entries: FileSystemEntry[]): Promise<File[]> {
    const out: File[] = [];
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        const rel = prefix ? `${prefix}/${file.name}` : file.name;
        try {
          Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true });
        } catch {
          /* một số trình duyệt không cho ghi đè — vẫn upload được dạng file lẻ */
        }
        out.push(file);
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const children: FileSystemEntry[] = [];
        // readEntries trả theo lô, phải gọi lặp tới khi rỗng.
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject),
          );
          if (!batch.length) break;
          children.push(...batch);
        }
        const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        for (const child of children) await walk(child, dirPrefix);
      }
    };
    for (const entry of entries) await walk(entry, '');
    return out;
  }

  /**
   * Upload: gộp mỗi thư mục thành 1 "mục" hiện "X trong số N", mỗi file lẻ 1 mục.
   * Giữ cấu trúc thư mục qua webkitRelativePath (mục 2.1).
   */
  private async uploadFileList(files: File[]): Promise<void> {
    // Cảnh báo tệp thực thi (.exe…) — kể cả khi nằm bên trong thư mục kéo-thả.
    // Người dùng phải xác nhận; các tệp này sẽ được quét virus khi tải lên.
    const execNames = files
      .filter((f) => this.virusScan.isExecutable(f.name))
      .map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
    if (execNames.length > 0) {
      const proceed = await this.warnExecutables(execNames);
      if (!proceed) return;
    }

    // Đang xem đúng 1 thư mục cụ thể → tải vào đó. Ngược lại (gốc "Kho của
    // tôi", hoặc các lăng kính không phải thư mục như Gắn sao/Thẻ/Tìm kiếm)
    // → dùng "Thư mục tải lên mặc định" đã cấu hình ở Cài đặt, nếu có.
    const explicitFolderId = this.isFolderLens() ? this.folderId() : null;
    const rootId = explicitFolderId ?? this.settingsApi.defaultUploadFolderId();

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

      // Quét virus tệp thực thi TRƯỚC khi lưu — chặn nếu phát hiện mã độc.
      if (this.virusScan.isExecutable(file.name)) {
        const blocked = await this.scanBeforeUpload(task, file);
        if (blocked) {
          batch.failed.update((v) => v + 1);
          continue;
        }
      }

      const result = await this.uploadService.run(task, file, targetFolderId, (c) =>
        this.askConflict(c),
      );
      if (result) batch.done.update((v) => v + 1);
      else if (task.status() !== 'canceled') batch.failed.update((v) => v + 1);
    }

    if (batch.canceled) batch.status.set('canceled');
    else if (batch.failed() > 0) batch.status.set('error');
    else batch.status.set('done');

    void this.revalidate();
    this.refresh.bump();
  }

  /**
   * Quét virus 1 tệp thực thi trước khi lưu. Trả TRUE nếu bị chặn (mã độc) →
   * caller bỏ qua tệp này. Trả FALSE nếu an toàn/không xác định → cho tải tiếp.
   */
  private async scanBeforeUpload(task: UploadTask, file: File): Promise<boolean> {
    task.status.set('scanning');
    let result: ScanResult | null = null;
    try {
      result = await this.virusScan.scan(file);
    } catch {
      result = null; // lỗi quét → không chặn, để người dùng vẫn tải được
    }
    if (result && (result.verdict === 'malicious' || result.verdict === 'suspicious')) {
      // Hiện CHI TIẾT kết quả quét rồi để người dùng tự quyết định có tải lên không.
      const proceed = await this.showScanResult(file.name, result);
      if (!proceed) {
        const n = result.malicious || result.suspicious;
        task.status.set('error');
        task.error.set(this.lang.translate('scan.blocked', { n }));
        this.toast.error(
          this.lang.translate('scan.blockedToast', { name: file.name, n, total: result.total }),
        );
        return true; // người dùng chọn KHÔNG tải lên → chặn
      }
      return false; // người dùng chấp nhận rủi ro → vẫn tải lên
    }
    if (result && result.verdict === 'clean') {
      this.toast.success(
        this.lang.translate('scan.clean', { name: file.name, total: result.total }),
      );
    }
    return false;
  }

  /** Mở hộp thoại CHI TIẾT kết quả quét (mã độc) và đợi người dùng quyết định. */
  private showScanResult(fileName: string, result: ScanResult): Promise<boolean> {
    return new Promise((resolve) => {
      this.scanResultResolver = resolve;
      this.scanResult.set({ fileName, result });
    });
  }

  resolveScanResult(proceed: boolean): void {
    this.scanResult.set(null);
    this.scanResultResolver?.(proceed);
    this.scanResultResolver = null;
  }

  /** Mở cảnh báo tệp thực thi và đợi người dùng quyết định (tiếp tục/huỷ). */
  private warnExecutables(names: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      this.exeWarnResolver = resolve;
      this.exeWarn.set({ names });
    });
  }

  resolveExeWarn(proceed: boolean): void {
    this.exeWarn.set(null);
    this.exeWarnResolver?.(proceed);
    this.exeWarnResolver = null;
  }

  /** Mở hộp thoại "Trùng tên file" và đợi người dùng chọn (mục Cài đặt — Hỏi lại). */
  private askConflict(c: UploadConflict): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      this.conflictResolver = resolve;
      this.conflictPrompt.set(c);
    });
  }

  resolveConflict(choice: ConflictResolution): void {
    this.conflictPrompt.set(null);
    this.conflictResolver?.(choice);
    this.conflictResolver = null;
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

  /** Tra thư mục trong danh sách hiện tại theo id (dùng cho gắn thẻ). */
  private folderById(id: string): Folder | undefined {
    return this.folders().find((f) => f.id === id);
  }
}
