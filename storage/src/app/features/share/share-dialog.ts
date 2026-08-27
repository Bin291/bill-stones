import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Share, ShareApiService } from '../../core/services/share-api.service';
import { environment } from '../../../environments/environment';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LangService } from '../../core/i18n/lang.service';

export interface ShareTarget {
  kind: 'file' | 'folder';
  id: string;
  name: string;
}

@Component({
  selector: 'app-share-dialog',
  imports: [TranslatePipe],
  templateUrl: './share-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareDialog {
  private readonly shareApi = inject(ShareApiService);
  private readonly lang = inject(LangService);

  readonly target = input.required<ShareTarget>();
  readonly closed = output<void>();

  readonly shares = signal<Share[]>([]);
  readonly email = signal('');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  // Gợi ý email khi gõ (chỉ user đã có tài khoản trên hệ thống)
  readonly suggestions = signal<{ id: string; email: string; avatarUrl?: string | null }[]>([]);
  readonly suggestOpen = signal(false);
  private suggestTimer?: ReturnType<typeof setTimeout>;
  private suggestSeq = 0;

  // Tuỳ chọn tạo link
  readonly linkAllowDownload = signal(true);
  readonly linkExpiresDays = signal(0);
  readonly linkPassword = signal('');
  readonly copied = signal<string | null>(null);

  readonly invites = computed(() => this.shares().filter((s) => s.sharedWithUserId));
  readonly links = computed(() => this.shares().filter((s) => s.token));

  constructor() {
    effect(() => {
      const t = this.target();
      if (t) void this.load();
    });
  }

  private body(): { fileId?: string; folderId?: string } {
    const t = this.target();
    return t.kind === 'file' ? { fileId: t.id } : { folderId: t.id };
  }

  async load(): Promise<void> {
    this.shares.set(await firstValueFrom(this.shareApi.list(this.body())));
  }

  async invite(): Promise<void> {
    const email = this.email().trim();
    if (!email) return;
    this.error.set(null);
    this.busy.set(true);
    this.suggestOpen.set(false);
    try {
      await firstValueFrom(this.shareApi.invite({ ...this.body(), email }));
      this.email.set('');
      await this.load();
    } catch (err) {
      this.error.set(this.extractError(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Gõ tới đâu gợi ý email tài khoản đã có trên hệ thống tới đó (debounce). */
  onEmailInput(value: string): void {
    this.email.set(value);
    clearTimeout(this.suggestTimer);
    const q = value.trim();
    if (q.length < 2) {
      this.suggestions.set([]);
      this.suggestOpen.set(false);
      return;
    }
    const seq = ++this.suggestSeq;
    this.suggestTimer = setTimeout(async () => {
      try {
        const already = new Set(this.invites().map((s) => s.sharedWithEmail?.toLowerCase()));
        const rows = await firstValueFrom(this.shareApi.searchUsers(q));
        if (seq !== this.suggestSeq) return; // kết quả trả về trễ, đã có truy vấn mới hơn
        this.suggestions.set(rows.filter((r) => !already.has(r.email.toLowerCase())));
        this.suggestOpen.set(true);
      } catch {
        this.suggestions.set([]);
      }
    }, 250);
  }

  selectSuggestion(s: { email: string }): void {
    this.email.set(s.email);
    this.suggestions.set([]);
    this.suggestOpen.set(false);
  }

  /** Đóng gợi ý khi rời ô nhập — trễ nhẹ để kịp nhận click vào 1 gợi ý. */
  onEmailBlur(): void {
    setTimeout(() => this.suggestOpen.set(false), 150);
  }

  async createLink(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.shareApi.createLink({
          ...this.body(),
          allowDownload: this.linkAllowDownload(),
          expiresInDays: this.linkExpiresDays() || undefined,
          password: this.linkPassword() || undefined,
        }),
      );
      this.linkPassword.set('');
      await this.load();
    } catch (err) {
      this.error.set(this.extractError(err));
    } finally {
      this.busy.set(false);
    }
  }

  linkUrl(share: Share): string {
    return `${environment.apiUrl.replace(/\/$/, '')}`.length && share.token
      ? `${location.origin}/s/${share.token}`
      : '';
  }

  async copy(share: Share): Promise<void> {
    const url = this.linkUrl(share);
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(share.id);
      setTimeout(() => this.copied.set(null), 1500);
    } catch {
      this.copied.set(null);
    }
  }

  async revoke(share: Share): Promise<void> {
    await firstValueFrom(this.shareApi.revoke(share.id));
    await this.load();
  }

  close(): void {
    this.closed.emit();
  }

  private extractError(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const e = (err as { error?: { message?: string } }).error;
      if (e?.message) return e.message;
    }
    return this.lang.translate('share.errorGeneric');
  }
}
