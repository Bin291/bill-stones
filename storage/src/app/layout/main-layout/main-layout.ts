import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgOptimizedImage } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { FilesApiService } from '../../core/services/files-api.service';
import { TagsApiService } from '../../core/services/tags-api.service';
import { SettingsApiService } from '../../core/services/settings-api.service';
import { SharedApiService } from '../../core/services/shared-api.service';
import { LangService } from '../../core/i18n/lang.service';
import { SettingsService } from '../../core/services/settings.service';
import { RefreshService } from '../../core/services/refresh.service';
import { NotificationService, AppNotification } from '../../core/services/notification.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { CATEGORIES, CategoryKey, categoryOf } from '../../core/util/file-types';
import { ExtensionStat, TagWithCount } from '../../core/models/file.model';
import { MiniAudioPlayer } from '../../features/audio-player/mini-audio-player';
import { TagDialog } from '../../features/tags/tag-dialog';
import { Loader } from '../../features/ui/loader';
import { PrefetchService } from '../../core/services/prefetch.service';

interface NavItem {
  icon: string;
  labelKey: string;
  path: string;
}

@Component({
  selector: 'app-main-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
    MiniAudioPlayer,
    TagDialog,
    NgOptimizedImage,
    Loader,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayout implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly filesApi = inject(FilesApiService);
  private readonly tagsApi = inject(TagsApiService);
  private readonly settingsApi = inject(SettingsApiService);
  private readonly sharedApi = inject(SharedApiService);
  private readonly lang = inject(LangService);
  private readonly router = inject(Router);
  private readonly refresh = inject(RefreshService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly settings = inject(SettingsService);
  protected readonly notifications = inject(NotificationService);
  protected readonly prefetch = inject(PrefetchService);

  protected readonly profile = this.auth.profile;
  protected readonly avatarUrl = this.auth.effectiveAvatarUrl;
  /** Ảnh avatar lỗi tải (URL presigned hết hạn, R2 chập chờn…) → ẩn, fallback icon. */
  protected readonly avatarLoadFailed = signal(false);
  // Hiện đủ các nhóm loại, gồm cả "Khác" (đã bỏ nhóm Code — file code rơi vào Khác).
  protected readonly categories = CATEGORIES;
  protected readonly notifOpen = signal(false);
  protected readonly tags = signal<TagWithCount[]>([]);
  protected readonly tagDialogOpen = signal(false);

  private readonly stats = signal<ExtensionStat[]>([]);
  protected readonly sharedCount = signal(0);

  protected readonly browseItems: NavItem[] = [
    { icon: 'cloud', labelKey: 'nav.myStorage', path: '/files' },
    { icon: 'star_border', labelKey: 'nav.starred', path: '/starred' },
    { icon: 'schedule', labelKey: 'nav.recent', path: '/recent' },
    { icon: 'search', labelKey: 'nav.search', path: '/search' },
    { icon: 'group', labelKey: 'nav.shared', path: '/shared' },
    { icon: 'delete_outline', labelKey: 'nav.trash', path: '/trash' },
  ];

  /** Số đếm theo nhóm loại, gộp từ stats theo extension (mục 11.H #36). */
  protected readonly categoryCounts = computed<Record<CategoryKey, number>>(() => {
    const counts: Record<CategoryKey, number> = {
      document: 0,
      image: 0,
      video: 0,
      audio: 0,
      code: 0,
      archive: 0,
      other: 0,
    };
    for (const s of this.stats()) counts[categoryOf(s.extension)] += s.count;
    return counts;
  });

  constructor() {
    // Có URL avatar mới (đổi ảnh, tải lại trang…) → cho thử tải lại, xoá cờ lỗi cũ.
    effect(() => {
      this.avatarUrl();
      this.avatarLoadFailed.set(false);
    });
    // Nạp lại số đếm khi có tín hiệu dữ liệu đổi (upload/xoá). CHỜ có phiên đăng
    // nhập (đọc isAuthenticated) — tránh gọi API lúc reload khi token chưa sẵn sàng
    // → 401 → danh sách rỗng và không tự nạp lại.
    effect(() => {
      this.refresh.filesChanged();
      if (this.auth.isAuthenticated()) this.loadStats();
    });
    // Nạp lại danh sách thẻ khi có thay đổi (tạo/sửa/xoá/gán) hoặc khi phiên sẵn sàng.
    effect(() => {
      this.refresh.tagsChanged();
      if (this.auth.isAuthenticated()) this.loadTags();
    });
    // Nạp lại số đếm mỗi khi điều hướng (chuyển lăng kính/thư mục).
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.loadStats();
        this.loadSharedCount();
      });
  }

  ngOnInit(): void {
    void this.notifications.refresh();
    // Tải trước MỌI dữ liệu 1 lần (splash) → các lần chuyển lăng kính sau không loading.
    void this.prefetch.prefetchAll();
    void this.loadCustomAvatar();
    this.loadSharedCount();
  }

  /** Số mục người khác đã chia sẻ với mình — hiện cạnh "Được chia sẻ với tôi". */
  loadSharedCount(): void {
    this.sharedApi.list().subscribe({
      next: (items) => this.sharedCount.set(items.length),
      error: () => {
        /* lỗi tạm thời: giữ nguyên số đếm cũ */
      },
    });
  }

  /** Nạp avatar tuỳ chỉnh (nếu có) 1 lần khi vào app, để sidebar hiển thị đúng
   * ngay cả khi chưa từng mở trang Cài đặt trong phiên này. */
  private async loadCustomAvatar(): Promise<void> {
    try {
      const a = await firstValueFrom(this.settingsApi.get());
      this.auth.setCustomAvatarUrl(a.avatarUrl);
    } catch {
      /* fail-soft — sidebar vẫn dùng avatar Google/metadata làm dự phòng */
    }
  }

  loadStats(): void {
    this.filesApi.stats().subscribe({
      next: (s) => this.stats.set(s),
      error: () => {
        /* lỗi tạm thời: giữ nguyên số đếm cũ, không xoá trắng */
      },
    });
  }

  loadTags(): void {
    this.tagsApi.list().subscribe({
      next: (t) => this.tags.set(t),
      error: () => {
        /* lỗi tạm thời: giữ nguyên danh sách thẻ cũ, không xoá trắng */
      },
    });
  }

  openTagManager(): void {
    this.tagDialogOpen.set(true);
  }

  /** Avatar tải lỗi (URL presigned hết hạn, mạng chập chờn…) → ẩn ảnh, hiện icon dự phòng. */
  onAvatarError(): void {
    this.avatarLoadFailed.set(true);
  }

  toggleNotif(): void {
    this.notifOpen.update((v) => !v);
    if (this.notifOpen()) void this.notifications.refresh();
  }

  async openNotif(n: AppNotification): Promise<void> {
    await this.notifications.markRead(n.id);
    this.notifOpen.set(false);
    if (n.linkPath) void this.router.navigateByUrl(n.linkPath);
  }

  markAllRead(): void {
    void this.notifications.markAllRead();
  }

  toggleLang(): void {
    this.lang.toggle();
  }

  currentLang(): string {
    return this.lang.lang().toUpperCase();
  }

  async logout(): Promise<void> {
    this.prefetch.clear(); // xoá cache để tài khoản khác không thấy dữ liệu cũ
    await this.auth.signOut();
    location.href = '/login';
  }
}
