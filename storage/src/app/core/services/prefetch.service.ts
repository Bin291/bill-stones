import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FilesApiService } from './files-api.service';
import { FoldersApiService } from './folders-api.service';
import { BreadcrumbCrumb, Folder, StoredFile } from '../models/file.model';
import { CATEGORIES } from '../util/file-types';
import { Lens, ViewParams, buildListQuery, viewKey } from '../util/list-query';

/** Trần thời gian hiện splash khi mới vào app (ms) — không vượt quá 5 giây. */
const MAX_SPLASH_MS = 5000;

/** Gói dữ liệu 1 khung nhìn (folders + files + breadcrumb). */
export interface ViewBundle {
  folders: Folder[];
  files: StoredFile[];
  crumbs: BreadcrumbCrumb[];
}

/**
 * Tải TRƯỚC toàn bộ dữ liệu khi mới vào app (splash) rồi cache lại, để các lần
 * chuyển lăng kính/thư mục sau KHÔNG phải hiện loading nữa. Explorer đọc cache
 * theo cùng `viewKey`; sidebar đọc tags/stats đã prefetch.
 */
@Injectable({ providedIn: 'root' })
export class PrefetchService {
  private readonly filesApi = inject(FilesApiService);
  private readonly foldersApi = inject(FoldersApiService);

  private readonly cache = new Map<string, ViewBundle>();

  private readonly _ready = signal(false);
  readonly ready = this._ready.asReadonly();
  private started = false;

  getView(key: string): ViewBundle | undefined {
    return this.cache.get(key);
  }
  setView(key: string, bundle: ViewBundle): void {
    this.cache.set(key, bundle);
  }

  /** Xoá toàn bộ cache (khi đăng xuất / đổi tài khoản). */
  clear(): void {
    this.cache.clear();
    this._ready.set(false);
    this.started = false;
  }

  private defParams(overrides: Partial<ViewParams> = {}): ViewParams {
    return {
      folderId: null,
      category: null,
      tagId: null,
      sort: 'createdAt',
      order: 'desc',
      ...overrides,
    };
  }

  /** Tải trước mọi lăng kính + tags + stats, song song. Gọi 1 lần khi vào app. */
  async prefetchAll(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const lenses: { mode: Lens; params: ViewParams }[] = [
      { mode: 'folder', params: this.defParams() },
      { mode: 'starred', params: this.defParams() },
      { mode: 'recent', params: this.defParams() },
      ...CATEGORIES.map((c) => ({ mode: 'type' as Lens, params: this.defParams({ category: c.key }) })),
    ];

    const jobs: Promise<unknown>[] = lenses.map((l) => this.fetchView(l.mode, l.params));
    // Ẩn splash NGAY khi prefetch xong, NHƯNG tối đa 5 giây — nếu quá thì vào app
    // luôn, các job còn lại chạy nền tiếp tục lấp cache.
    const cap = new Promise<void>((r) => setTimeout(r, MAX_SPLASH_MS));
    await Promise.race([Promise.allSettled(jobs), cap]);
    this._ready.set(true);
  }

  /** Nạp 1 khung nhìn vào cache (dùng cho prefetch). */
  private async fetchView(mode: Lens, p: ViewParams): Promise<void> {
    try {
      const query = buildListQuery(mode, p);
      const [files, folders] = await Promise.all([
        firstValueFrom(this.filesApi.list(query)),
        mode === 'folder'
          ? firstValueFrom(this.foldersApi.listChildren(p.folderId))
          : Promise.resolve<Folder[]>([]),
      ]);
      this.cache.set(viewKey(mode, p), { folders, files, crumbs: [] });
    } catch {
      /* prefetch fail-soft: explorer sẽ tự tải khi cần */
    }
  }
}
