import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SettingsService, ThemeMode } from '../../core/services/settings.service';
import { LangService } from '../../core/i18n/lang.service';
import { Lang } from '../../core/i18n/dictionaries';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AuthService } from '../../core/services/auth.service';
import { SettingsApiService, AccountSettings } from '../../core/services/settings-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { FolderPickerDialog } from '../ui/folder-picker-dialog';
import { formatBytes } from '../../core/util/file-types';

type Tab = 'general' | 'profile' | 'upload' | 'plan' | 'security';

@Component({
  selector: 'app-settings',
  imports: [TranslatePipe, FolderPickerDialog],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings implements OnInit {
  protected readonly settings = inject(SettingsService);
  protected readonly lang = inject(LangService);
  protected readonly auth = inject(AuthService);
  private readonly settingsApi = inject(SettingsApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly formatBytes = formatBytes;

  protected readonly tab = signal<Tab>('general');
  protected readonly tabs: { key: Tab; icon: string; labelKey: string }[] = [
    { key: 'general', icon: 'tune', labelKey: 'settings.tabGeneral' },
    { key: 'profile', icon: 'account_circle', labelKey: 'settings.tabProfile' },
    { key: 'upload', icon: 'upload', labelKey: 'settings.tabUpload' },
    { key: 'plan', icon: 'pie_chart', labelKey: 'settings.tabPlan' },
    { key: 'security', icon: 'lock', labelKey: 'settings.tabSecurity' },
  ];

  protected readonly account = signal<AccountSettings | null>(null);
  protected readonly loading = signal(true);
  protected readonly defaultFolderName = signal<string | null>(null);

  // Hồ sơ
  protected readonly displayNameInput = signal('');
  protected readonly profileBusy = signal(false);
  protected readonly profileMsg = signal<string | null>(null);
  protected readonly avatarBusy = signal(false);
  protected readonly newEmail = signal('');
  protected readonly emailBusy = signal(false);
  protected readonly emailMsg = signal<string | null>(null);

  // Tải lên/Tải xuống
  protected readonly uploadWarnInput = signal<number | null>(null);
  protected readonly duplicatePolicyInput = signal<'rename' | 'overwrite' | 'ask'>('rename');
  protected readonly uploadPrefsBusy = signal(false);
  protected readonly uploadPrefsMsg = signal<string | null>(null);
  protected readonly folderPickerOpen = signal(false);

  // Bảo mật
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly passwordBusy = signal(false);
  protected readonly passwordMsg = signal<string | null>(null);
  protected readonly signOutOthersBusy = signal(false);
  protected readonly signOutOthersMsg = signal<string | null>(null);
  protected readonly sharePrivacyInput = signal<'private' | 'email' | 'public'>('private');
  protected readonly securityBusy = signal(false);
  protected readonly securityMsg = signal<string | null>(null);

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
    const t = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (t && this.tabs.some((x) => x.key === t)) this.tab.set(t);
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
    this.displayNameInput.set(a.displayName ?? this.auth.profile()?.displayName ?? '');
    this.uploadWarnInput.set(a.uploadWarnSizeMb);
    this.duplicatePolicyInput.set(a.duplicateFilePolicy);
    this.sharePrivacyInput.set(a.defaultSharePrivacy);
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

  setTab(t: Tab): void {
    this.tab.set(t);
    void this.router.navigate([], { queryParams: { tab: t }, replaceUrl: true });
  }

  // --- Hồ sơ ---
  async saveDisplayName(): Promise<void> {
    const name = this.displayNameInput().trim();
    if (!name || this.profileBusy()) return;
    this.profileBusy.set(true);
    this.profileMsg.set(null);
    try {
      await this.auth.updateDisplayName(name);
      const a = await firstValueFrom(this.settingsApi.update({ displayName: name }));
      this.applyAccount(a);
      this.profileMsg.set(this.lang.translate('settings.saved'));
    } finally {
      this.profileBusy.set(false);
    }
  }

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
  async saveUploadPrefs(): Promise<void> {
    if (this.uploadPrefsBusy()) return;
    this.uploadPrefsBusy.set(true);
    this.uploadPrefsMsg.set(null);
    try {
      const a = await firstValueFrom(
        this.settingsApi.update({
          uploadWarnSizeMb: this.uploadWarnInput() ?? undefined,
          duplicateFilePolicy: this.duplicatePolicyInput(),
        }),
      );
      this.applyAccount(a);
      this.uploadPrefsMsg.set(this.lang.translate('settings.saved'));
    } finally {
      this.uploadPrefsBusy.set(false);
    }
  }

  async onFolderChosen(folderId: string | null): Promise<void> {
    this.folderPickerOpen.set(false);
    const a = await firstValueFrom(this.settingsApi.update({ defaultUploadFolderId: folderId }));
    this.applyAccount(a);
  }

  async clearDefaultFolder(): Promise<void> {
    await this.onFolderChosen(null);
  }

  // --- Bảo mật ---
  async submitPasswordChange(): Promise<void> {
    if (this.passwordBusy()) return;
    const pw = this.newPassword();
    this.passwordMsg.set(null);
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
      await this.auth.updatePassword(pw);
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

  async saveSharePrivacy(): Promise<void> {
    if (this.securityBusy()) return;
    this.securityBusy.set(true);
    this.securityMsg.set(null);
    try {
      const a = await firstValueFrom(
        this.settingsApi.update({ defaultSharePrivacy: this.sharePrivacyInput() }),
      );
      this.applyAccount(a);
      this.securityMsg.set(this.lang.translate('settings.saved'));
    } finally {
      this.securityBusy.set(false);
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
