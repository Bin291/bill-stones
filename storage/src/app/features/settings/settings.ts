import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SettingsService, ThemeMode } from '../../core/services/settings.service';
import { LangService } from '../../core/i18n/lang.service';
import { Lang } from '../../core/i18n/dictionaries';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AuthService } from '../../core/services/auth.service';
import {
  SettingsApiService,
  AccountSettings,
  UpdateAccountSettings,
} from '../../core/services/settings-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { FolderPickerDialog } from '../ui/folder-picker-dialog';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { formatBytes } from '../../core/util/file-types';
import { CanComponentDeactivate } from '../../core/guards/unsaved-changes.guard';

@Component({
  selector: 'app-settings',
  imports: [TranslatePipe, FolderPickerDialog, ConfirmDialog],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Chặn đóng/tải lại tab khi còn thay đổi chưa lưu (hộp thoại mặc định của trình duyệt).
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class Settings implements OnInit, CanComponentDeactivate {
  protected readonly settings = inject(SettingsService);
  protected readonly lang = inject(LangService);
  protected readonly auth = inject(AuthService);
  private readonly settingsApi = inject(SettingsApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly router = inject(Router);

  protected readonly formatBytes = formatBytes;

  protected readonly account = signal<AccountSettings | null>(null);
  protected readonly loading = signal(true);
  protected readonly defaultFolderName = signal<string | null>(null);

  // Lưu chung (thay cho các nút Lưu từng mục): chỉ hiện thanh khi có thay đổi.
  protected readonly saveBusy = signal(false);
  /** Tên hiển thị gốc (đã lưu) — mốc để so sánh dirty. */
  private readonly baseDisplayName = signal('');

  // Hộp thoại "rời trang mà không lưu?" (thay window.confirm ở canDeactivate).
  protected readonly leaveConfirmOpen = signal(false);
  private leaveConfirmResolve: ((ok: boolean) => void) | null = null;

  // Hồ sơ
  protected readonly displayNameInput = signal('');
  protected readonly avatarBusy = signal(false);
  /** Ảnh avatar lỗi tải (URL presigned hết hạn…) → ẩn ảnh, hiện icon dự phòng. */
  protected readonly avatarLoadFailed = signal(false);
  protected readonly newEmail = signal('');
  protected readonly emailBusy = signal(false);
  protected readonly emailMsg = signal<string | null>(null);

  // Tải lên/Tải xuống
  protected readonly uploadWarnInput = signal<number | null>(null);
  protected readonly duplicatePolicyInput = signal<'rename' | 'overwrite' | 'ask'>('rename');
  protected readonly folderIdInput = signal<string | null>(null);
  protected readonly folderPickerOpen = signal(false);

  // Bảo mật
  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly passwordBusy = signal(false);
  protected readonly passwordMsg = signal<string | null>(null);
  protected readonly signOutOthersBusy = signal(false);
  protected readonly signOutOthersMsg = signal<string | null>(null);
  protected readonly sharePrivacyInput = signal<'private' | 'email' | 'public'>('private');

  /** Có thay đổi chưa lưu? (so input hiện tại với giá trị đã tải về). */
  protected readonly dirty = computed<boolean>(() => {
    const a = this.account();
    if (!a) return false;
    return (
      this.displayNameInput().trim() !== this.baseDisplayName().trim() ||
      (this.uploadWarnInput() ?? null) !== (a.uploadWarnSizeMb ?? null) ||
      this.duplicatePolicyInput() !== a.duplicateFilePolicy ||
      this.sharePrivacyInput() !== a.defaultSharePrivacy ||
      (this.folderIdInput() ?? null) !== (a.defaultUploadFolderId ?? null)
    );
  });

  protected readonly themeOptions: { value: ThemeMode; labelKey: string }[] = [
    { value: 'light', labelKey: 'theme.light' },
    { value: 'dark', labelKey: 'theme.dark' },
    { value: 'system', labelKey: 'theme.system' },
  ];
  protected readonly langOptions: { value: Lang; label: string }[] = [
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'en', label: 'English' },
  ];
  protected readonly duplicateOptions: { value: 'ask' | 'rename' | 'overwrite'; labelKey: string }[] = [
    { value: 'ask', labelKey: 'settings.duplicateAsk' },
    { value: 'rename', labelKey: 'settings.duplicateRename' },
    { value: 'overwrite', labelKey: 'settings.duplicateOverwrite' },
  ];
  protected readonly privacyOptions: { value: 'private' | 'email' | 'public'; labelKey: string }[] = [
    { value: 'private', labelKey: 'settings.privacyPrivate' },
    { value: 'email', labelKey: 'settings.privacyEmail' },
    { value: 'public', labelKey: 'settings.privacyPublic' },
  ];

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const a = await firstValueFrom(this.settingsApi.get());
      this.applyAccount(a);
    } finally {
      this.loading.set(false);
    }
  }

  private applyAccount(a: AccountSettings): void {
    this.account.set(a);
    this.avatarLoadFailed.set(false);
    const name = a.displayName ?? this.auth.profile()?.displayName ?? '';
    this.baseDisplayName.set(name);
    this.displayNameInput.set(name);
    this.uploadWarnInput.set(a.uploadWarnSizeMb);
    this.duplicatePolicyInput.set(a.duplicateFilePolicy);
    this.sharePrivacyInput.set(a.defaultSharePrivacy);
    this.folderIdInput.set(a.defaultUploadFolderId);
    if (a.defaultUploadFolderId) void this.loadFolderName(a.defaultUploadFolderId);
    else this.defaultFolderName.set(null);
  }

  private async loadFolderName(id: string): Promise<void> {
    try {
      const crumbs = await firstValueFrom(this.foldersApi.breadcrumb(id));
      this.defaultFolderName.set(crumbs.at(-1)?.name ?? null);
    } catch {
      this.defaultFolderName.set(null);
    }
  }

  /**
   * Có thay đổi chưa lưu → chặn rời trang, hỏi lại bằng hộp thoại riêng của app
   * (không dùng window.confirm() — xấu, không theo giao diện chung).
   */
  canDeactivate(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.leaveConfirmOpen.set(true);
    return new Promise<boolean>((resolve) => {
      this.leaveConfirmResolve = resolve;
    });
  }

  /** Xác nhận rời trang, bỏ thay đổi chưa lưu. */
  confirmLeave(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveConfirmResolve?.(true);
    this.leaveConfirmResolve = null;
  }

  /** Ở lại trang, giữ nguyên thay đổi chưa lưu. */
  cancelLeave(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveConfirmResolve?.(false);
    this.leaveConfirmResolve = null;
  }

  /** Đóng/tải lại tab khi còn thay đổi → bật hộp thoại cảnh báo mặc định. */
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  }

  /** Lưu TẤT CẢ thay đổi trong một lần (thay cho các nút Lưu từng mục). */
  async saveAll(): Promise<void> {
    if (this.saveBusy() || !this.dirty()) return;
    this.saveBusy.set(true);
    try {
      const name = this.displayNameInput().trim();
      if (name && name !== this.baseDisplayName().trim()) {
        await this.auth.updateDisplayName(name);
      }
      const update: UpdateAccountSettings = {
        duplicateFilePolicy: this.duplicatePolicyInput(),
        defaultSharePrivacy: this.sharePrivacyInput(),
        defaultUploadFolderId: this.folderIdInput(),
      };
      if (name) update.displayName = name;
      if (this.uploadWarnInput() != null) update.uploadWarnSizeMb = this.uploadWarnInput()!;
      const a = await firstValueFrom(this.settingsApi.update(update));
      this.applyAccount(a);
    } finally {
      this.saveBusy.set(false);
    }
  }

  /** Đặt lại mọi input về giá trị đã lưu (huỷ thay đổi chưa lưu). */
  resetChanges(): void {
    const a = this.account();
    if (a) this.applyAccount(a);
  }

  /** Avatar tải lỗi → ẩn ảnh, hiện icon dự phòng thay vì icon-vỡ của trình duyệt. */
  onAvatarError(): void {
    this.avatarLoadFailed.set(true);
  }

  // --- Hồ sơ ---
  async onAvatarPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.avatarBusy()) return;
    this.avatarBusy.set(true);
    try {
      const a = await firstValueFrom(this.settingsApi.setAvatar(file));
      this.applyAccount(a);
      this.auth.setCustomAvatarUrl(a.avatarUrl);
    } finally {
      this.avatarBusy.set(false);
    }
  }

  async removeAvatar(): Promise<void> {
    if (this.avatarBusy()) return;
    this.avatarBusy.set(true);
    try {
      const a = await firstValueFrom(this.settingsApi.removeAvatar());
      this.applyAccount(a);
      this.auth.setCustomAvatarUrl(null);
    } finally {
      this.avatarBusy.set(false);
    }
  }

  async submitEmailChange(): Promise<void> {
    const email = this.newEmail().trim();
    if (!email || this.emailBusy()) return;
    this.emailBusy.set(true);
    this.emailMsg.set(null);
    try {
      await this.auth.updateEmail(email);
      this.newEmail.set('');
      this.emailMsg.set(this.lang.translate('settings.changeEmailSent'));
    } catch (e) {
      this.emailMsg.set(this.extractError(e));
    } finally {
      this.emailBusy.set(false);
    }
  }

  // --- Tải lên/Tải xuống ---
  /** Chọn thư mục mặc định: chỉ đổi input + hiện tên; lưu khi bấm Lưu chung. */
  async onFolderChosen(folderId: string | null): Promise<void> {
    this.folderPickerOpen.set(false);
    this.folderIdInput.set(folderId);
    if (folderId) await this.loadFolderName(folderId);
    else this.defaultFolderName.set(null);
  }

  clearDefaultFolder(): void {
    this.folderIdInput.set(null);
    this.defaultFolderName.set(null);
  }

  // --- Bảo mật ---
  /**
   * Đổi mật khẩu: nếu user đã có mật khẩu từ trước (identity 'email') thì BẮT
   * BUỘC xác minh mật khẩu cũ trước khi cho đổi. User chỉ đăng nhập Google
   * (chưa từng đặt mật khẩu) thì bỏ qua bước này — không có gì để xác minh.
   */
  async submitPasswordChange(): Promise<void> {
    if (this.passwordBusy()) return;
    const pw = this.newPassword();
    this.passwordMsg.set(null);
    if (this.auth.hasPasswordIdentity() && !this.currentPassword()) {
      this.passwordMsg.set(this.lang.translate('settings.currentPasswordRequired'));
      return;
    }
    if (pw.length < 6) {
      this.passwordMsg.set(this.lang.translate('settings.passwordTooShort'));
      return;
    }
    if (pw !== this.confirmPassword()) {
      this.passwordMsg.set(this.lang.translate('settings.passwordMismatch'));
      return;
    }
    this.passwordBusy.set(true);
    try {
      if (this.auth.hasPasswordIdentity()) {
        const ok = await this.auth.verifyPassword(this.currentPassword());
        if (!ok) {
          this.passwordMsg.set(this.lang.translate('settings.currentPasswordWrong'));
          return;
        }
      }
      await this.auth.updatePassword(pw);
      this.currentPassword.set('');
      this.newPassword.set('');
      this.confirmPassword.set('');
      this.passwordMsg.set(this.lang.translate('settings.passwordChanged'));
    } catch (e) {
      this.passwordMsg.set(this.extractError(e));
    } finally {
      this.passwordBusy.set(false);
    }
  }

  async doSignOutOthers(): Promise<void> {
    if (this.signOutOthersBusy()) return;
    this.signOutOthersBusy.set(true);
    this.signOutOthersMsg.set(null);
    try {
      await this.auth.signOutOthers();
      this.signOutOthersMsg.set(this.lang.translate('settings.signOutOthersDone'));
    } catch (e) {
      this.signOutOthersMsg.set(this.extractError(e));
    } finally {
      this.signOutOthersBusy.set(false);
    }
  }

  usageRatio(a: AccountSettings): number {
    const used = Number(a.usedBytes);
    const quota = Number(a.storageQuotaBytes) || 1;
    return used / quota;
  }

  usageBarWidth(a: AccountSettings): number {
    return Math.min(100, Math.round(this.usageRatio(a) * 100));
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  private extractError(e: unknown): string {
    if (e && typeof e === 'object' && 'message' in e) {
      return String((e as { message?: string }).message ?? '');
    }
    return 'Đã xảy ra lỗi';
  }
}
