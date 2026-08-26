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
import { AuthService } from '../../core/services/auth.service';
import { FilesApiService } from '../../core/services/files-api.service';
import { TagsApiService } from '../../core/services/tags-api.service';
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
  private readonly lang = inject(LangService);
  private readonly router = inject(Router);
  private readonly refresh = inject(RefreshService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly settings = inject(SettingsService);
  protected readonly notifications = inject(NotificationService);
  protected readonly prefetch = inject(PrefetchService);

  protected readonly profile = this.auth.profile;
  // Bỏ mục "Khác" khỏi sidebar theo yêu cầu (vẫn giữ trong CATEGORIES cho nơi khác).
  protected readonly categories = CATEGORIES.filter((c) => c.key !== 'other');
  protected readonly notifOpen = signal(false);
  protected readonly tags = signal<TagWithCount[]>([]);
  protected readonly tagDialogOpen = signal(false);

  private readonly stats = signal<ExtensionStat[]>([]);

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
    // Nạp lại số đếm khi có tín hiệu dữ liệu đổi (upload/xoá).
    effect(() => {
      this.refresh.filesChanged();
      this.loadStats();
    });
    // Nạp lại danh sách thẻ khi có thay đổi (tạo/sửa/xoá/gán).
    effect(() => {
      this.refresh.tagsChanged();
      this.loadTags();
    });
    // Nạp lại số đếm mỗi khi điều hướng (chuyển lăng kính/thư mục).
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.loadStats());
  }

  ngOnInit(): void {
    void this.notifications.refresh();
    // Tải trước MỌI dữ liệu 1 lần (splash) → các lần chuyển lăng kính sau không loading.
    void this.prefetch.prefetchAll();
  }

  loadStats(): void {
    this.filesApi.stats().subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set([]),
    });
  }

  loadTags(): void {
    this.tagsApi.list().subscribe({
      next: (t) => this.tags.set(t),
      error: () => this.tags.set([]),
    });
  }

  openTagManager(): void {
    this.tagDialogOpen.set(true);
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
