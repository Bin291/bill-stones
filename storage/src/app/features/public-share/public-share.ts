import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import {
  PublicListing,
  PublicShareApiService,
  ShareMeta,
} from '../../core/services/public-share-api.service';
import { categoryOf, formatBytes, iconOf } from '../../core/util/file-types';
import { Loader } from '../ui/loader';
import { PasswordInput } from '../ui/password-input';

type ViewKind = 'image' | 'pdf' | 'video' | 'audio';

interface ViewerState {
  name: string;
  kind: ViewKind;
  url: string;
  safeUrl: SafeResourceUrl | null; // cho iframe (pdf)
}

/** Trang công khai /s/:token (mục 12.E nhóm B) — ngoài authGuard. */
@Component({
  selector: 'app-public-share',
  imports: [Loader, PasswordInput],
  templateUrl: './public-share.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicShare implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicShareApiService);
  private readonly sanitizer = inject(DomSanitizer);

  private token = '';
  private session: string | null = null;

  protected readonly meta = signal<ShareMeta | null>(null);
  protected readonly listing = signal<PublicListing | null>(null);
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly viewer = signal<ViewerState | null>(null);
  // Xem NGAY trên trang cho link 1 file ảnh/pdf/video/audio (không cần bấm "Xem").
  protected readonly inline = signal<ViewerState | null>(null);

  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

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
        this.listing.set(await firstValueFrom(this.api.list(this.token, this.session)));
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

  /** Chuẩn bị nội dung xem ngay trên trang cho link 1 file (nếu xem được). */
  private async prepareInline(meta: ShareMeta): Promise<void> {
    const kind = this.viewKind(meta.extension);
    if (!kind) {
      this.inline.set(null);
      return;
    }
    try {
      const { url } = await firstValueFrom(this.api.contentUrl(this.token, this.session, undefined));
      this.inline.set({
        name: meta.name ?? '',
        kind,
        url,
        safeUrl: kind === 'pdf' ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null,
      });
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

  /** Xem ngay trên trang (ảnh/pdf/video/audio); loại khác mới mở tab mới. */
  async view(fileId?: string, name?: string, extension?: string): Promise<void> {
    const { url } = await firstValueFrom(this.api.contentUrl(this.token, this.session, fileId));
    const kind = this.viewKind(extension);
    if (!kind) {
      window.open(url, '_blank');
      return;
    }
    this.viewer.set({
      name: name ?? '',
      kind,
      url,
      safeUrl: kind === 'pdf' ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null,
    });
  }

  closeViewer(): void {
    this.viewer.set(null);
  }

  async download(fileId?: string, name?: string): Promise<void> {
    const { url } = await firstValueFrom(this.api.downloadUrl(this.token, this.session, fileId));
    const a = document.createElement('a');
    a.href = url;
    if (name) a.download = name;
    a.click();
  }
}
