import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import {
  PublicListing,
  PublicShareApiService,
  ShareMeta,
} from '../../core/services/public-share-api.service';
import { categoryOf, formatBytes, iconOf } from '../../core/util/file-types';
import { SettingsService } from '../../core/services/settings.service';
import { Loader } from '../ui/loader';
import { PasswordInput } from '../ui/password-input';

type ViewKind = 'image' | 'pdf' | 'video' | 'audio';
/** Loại nội dung ô preview: media | 'doc' (render HTML: docx/xlsx/text/code) | null (không xem trước được). */
type PaneKind = ViewKind | 'doc' | null;

/** Nội dung đang xem — dùng chung cho link 1 tệp (inline) lẫn ô preview thư mục. */
interface PaneState {
  id: string;
  name: string;
  ext: string;
  kind: PaneKind;
  url: string;
  safeUrl: SafeResourceUrl | null; // iframe (pdf)
  html: SafeHtml | null; // doc/text/code render sẵn
}

interface CrumbItem {
  label: string;
  index: number; // -1 = gốc, >=0 = path[index], -2 = dấu "…" (không bấm)
  ellipsis: boolean;
  current: boolean;
}

/** Đuôi tệp render được HTML (khớp DocPreviewService phía backend). */
const DOC_EXT = new Set([
  'docx', 'xlsx', 'xls', 'csv',
  'txt', 'md', 'markdown', 'json', 'log', 'xml', 'yml', 'yaml',
  'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql',
]);

/** Trang công khai /s/:token (mục 12.E nhóm B) — ngoài authGuard. */
@Component({
  selector: 'app-public-share',
  imports: [Loader, PasswordInput],
  templateUrl: './public-share.html',
  styleUrl: './public-share.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicShare implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicShareApiService);
  private readonly sanitizer = inject(DomSanitizer);
  // Inject để áp theme sáng/tối đã lưu (SettingsService tự set <html data-theme>
  // trong constructor) — đồng bộ giao diện trang share với app.
  private readonly settings = inject(SettingsService);

  private token = '';
  private session: string | null = null;

  protected readonly meta = signal<ShareMeta | null>(null);
  protected readonly listing = signal<PublicListing | null>(null);
  /** Đường dẫn thư mục con đang duyệt (breadcrumb; rỗng = ở thư mục gốc được chia sẻ). */
  protected readonly path = signal<{ id: string; name: string }[]>([]);
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  /** Đang chuyển thư mục trong workspace — chỉ hiện thanh mảnh, KHÔNG che cả trang. */
  protected readonly navLoading = signal(false);

  // Xem NGAY trên trang cho link 1 tệp.
  protected readonly inline = signal<PaneState | null>(null);

  /** Ô preview bên trái (workspace 2 cột kiểu VS Code) cho link THƯ MỤC. */
  protected readonly pane = signal<PaneState | null>(null);
  protected readonly paneLoading = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  /** Bề rộng ô preview (theo %) — kéo thanh chia để tuỳ chỉnh. */
  protected readonly previewPct = signal(62);

  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

  /** Breadcrumb đã thu gọn: nếu quá sâu thì hiện "gốc / … / 2 mục cuối". */
  protected readonly crumbs = computed<CrumbItem[]>(() => {
    const rootName = this.meta()?.name ?? '';
    const p = this.path();
    const full: CrumbItem[] = [
      { label: rootName, index: -1, ellipsis: false, current: p.length === 0 },
      ...p.map((c, i) => ({ label: c.name, index: i, ellipsis: false, current: i === p.length - 1 })),
    ];
    if (full.length <= 4) return full;
    return [full[0], { label: '…', index: -2, ellipsis: true, current: false }, ...full.slice(full.length - 2)];
  });

  /** Cache danh sách theo folderId để duyệt lại/hover trước là VÀO NGAY (không tải lại). */
  private readonly listCache = new Map<string, PublicListing>();
  private readonly inFlight = new Map<string, Promise<PublicListing>>();

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    void this.loadMeta();
  }

  async loadMeta(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const meta = await firstValueFrom(this.api.meta(this.token, this.session));
      this.meta.set(meta);
      if (!meta.requiresPassword && meta.kind === 'folder') {
        this.listing.set(await this.fetchList());
      } else if (!meta.requiresPassword && meta.kind === 'file') {
        await this.prepareInline(meta);
      }
    } catch {
      this.error.set('Link không tồn tại hoặc đã hết hạn.');
      this.meta.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /** Lấy danh sách 1 thư mục, ưu tiên cache; gộp các request trùng đang bay. */
  private fetchList(folderId?: string): Promise<PublicListing> {
    const key = folderId ?? '__root__';
    const cached = this.listCache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const p = firstValueFrom(this.api.list(this.token, this.session, folderId))
      .then((res) => {
        this.listCache.set(key, res);
        this.inFlight.delete(key);
        return res;
      })
      .catch((err) => {
        this.inFlight.delete(key);
        throw err;
      });
    this.inFlight.set(key, p);
    return p;
  }

  /** Rê chuột lên thư mục → nạp trước nội dung để lúc bấm vào là hiện ngay. */
  prefetchFolder(folderId: string): void {
    void this.fetchList(folderId).catch(() => {
      /* prefetch lỗi thì bỏ qua, lúc bấm thật sẽ báo lỗi */
    });
  }

  /** Bấm vào thư mục con → duyệt vào trong (backend verify là hậu duệ của link). */
  async openFolder(folder: { id: string; name: string }): Promise<void> {
    this.navLoading.set(true);
    try {
      const list = await this.fetchList(folder.id);
      this.listing.set(list);
      this.path.update((p) => [...p, { id: folder.id, name: folder.name }]);
      this.clearPane();
    } catch {
      this.error.set('Không mở được thư mục.');
    } finally {
      this.navLoading.set(false);
    }
  }

  /** Về thư mục gốc được chia sẻ. */
  async goRoot(): Promise<void> {
    this.navLoading.set(true);
    try {
      this.listing.set(await this.fetchList());
      this.path.set([]);
      this.clearPane();
    } finally {
      this.navLoading.set(false);
    }
  }

  /** Nhảy tới 1 mốc breadcrumb (index trong path). */
  async goToCrumb(index: number): Promise<void> {
    const crumb = this.path()[index];
    if (!crumb) return;
    this.navLoading.set(true);
    try {
      this.listing.set(await this.fetchList(crumb.id));
      this.path.update((p) => p.slice(0, index + 1));
      this.clearPane();
    } finally {
      this.navLoading.set(false);
    }
  }

  /** Điều hướng theo 1 mốc breadcrumb (đã thu gọn): -1 = gốc, >=0 = path[index]. */
  goCrumb(index: number): void {
    if (index === -1) void this.goRoot();
    else if (index >= 0) void this.goToCrumb(index);
  }

  /** Chọn 1 tệp trong danh sách → nạp nội dung vào ô preview bên trái. */
  async selectFile(fileId: string, name: string, extension: string): Promise<void> {
    this.selectedId.set(fileId);
    this.paneLoading.set(true);
    this.pane.set(null);
    try {
      this.pane.set(await this.buildPane(fileId, name, extension));
    } catch {
      this.pane.set(null);
      this.selectedId.set(null);
    } finally {
      this.paneLoading.set(false);
    }
  }

  /** Xoá lựa chọn preview (đổi thư mục → về màn hình chào của ô preview). */
  private clearPane(): void {
    this.pane.set(null);
    this.selectedId.set(null);
  }

  /**
   * Dựng trạng thái xem trước cho 1 tệp: ảnh/PDF/video/audio → URL nội dung;
   * docx/xlsx/text/code → HTML render sẵn; còn lại → không xem trước được.
   * fileId rỗng = link 1 tệp (backend tự lấy file của link).
   */
  private async buildPane(fileId: string, name: string, ext: string): Promise<PaneState> {
    const id = fileId || undefined;
    const kind = this.viewKind(ext);
    if (kind) {
      const { url } = await firstValueFrom(this.api.contentUrl(this.token, this.session, id));
      return {
        id: fileId,
        name,
        ext,
        kind,
        url,
        safeUrl: kind === 'pdf' ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null,
        html: null,
      };
    }
    if (DOC_EXT.has(ext.toLowerCase())) {
      const { html } = await firstValueFrom(this.api.previewHtml(this.token, this.session, id));
      return {
        id: fileId,
        name,
        ext,
        kind: 'doc',
        url: '',
        safeUrl: null,
        html: this.sanitizer.bypassSecurityTrustHtml(html),
      };
    }
    return { id: fileId, name, ext, kind: null, url: '', safeUrl: null, html: null };
  }

  async unlock(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.api.unlock(this.token, this.password()));
      this.session = res.sessionToken;
      await this.loadMeta();
    } catch {
      this.error.set('Mật khẩu không đúng.');
    }
  }

  /** Chuẩn bị nội dung xem ngay trên trang cho link 1 tệp. */
  private async prepareInline(meta: ShareMeta): Promise<void> {
    try {
      this.inline.set(await this.buildPane('', meta.name ?? '', meta.extension ?? ''));
    } catch {
      this.inline.set(null);
    }
  }

  private viewKind(extension?: string): ViewKind | null {
    const e = (extension || '').toLowerCase();
    if (e === 'pdf') return 'pdf';
    const cat = categoryOf(e);
    if (cat === 'image') return 'image';
    if (cat === 'video') return 'video';
    if (cat === 'audio') return 'audio';
    return null;
  }

  /** Kéo thanh chia giữa 2 cột để đổi bề rộng ô preview (giới hạn 30–80%). */
  onSplitterDown(ev: PointerEvent): void {
    ev.preventDefault();
    const workspace = (ev.currentTarget as HTMLElement).parentElement;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const move = (e: PointerEvent): void => {
      // Ô preview nằm bên PHẢI → bề rộng tính từ mép phải tới con trỏ.
      const pct = ((rect.right - e.clientX) / rect.width) * 100;
      this.previewPct.set(Math.min(80, Math.max(30, Math.round(pct))));
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  async download(fileId?: string, name?: string): Promise<void> {
    const { url } = await firstValueFrom(this.api.downloadUrl(this.token, this.session, fileId));
    const a = document.createElement('a');
    a.href = url;
    if (name) a.download = name;
    a.click();
  }
}
