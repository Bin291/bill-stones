import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SettingsService, ThemeMode } from '../../core/services/settings.service';
import { LangService } from '../../core/i18n/lang.service';
import { Lang } from '../../core/i18n/dictionaries';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-settings',
  imports: [TranslatePipe],
  template: `
    <h1 class="page-title">{{ 'settings.title' | t }}</h1>

    <section class="settings-block">
      <h2 class="settings-label">{{ 'settings.theme' | t }}</h2>
      <div class="seg">
        @for (opt of themeOptions; track opt.value) {
          <button
            class="seg-btn"
            type="button"
            [class.active]="settings.theme() === opt.value"
            (click)="settings.setTheme(opt.value)"
          >
            {{ opt.labelKey | t }}
          </button>
        }
      </div>
    </section>

    <section class="settings-block">
      <h2 class="settings-label">{{ 'settings.language' | t }}</h2>
      <div class="seg">
        @for (opt of langOptions; track opt.value) {
          <button
            class="seg-btn"
            type="button"
            [class.active]="lang.lang() === opt.value"
            (click)="lang.setLang(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>
    </section>

    <section class="settings-block">
      <h2 class="settings-label">{{ 'settings.account' | t }}</h2>
      <button class="signout-btn" type="button" (click)="signOut()">
        {{ 'nav.logout' | t }}
      </button>
    </section>
  `,
  styles: [
    `
      .settings-block {
        margin-bottom: 26px;
      }
      .settings-label {
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 10px;
      }
      .seg {
        display: inline-flex;
        border: 1px solid var(--border);
        border-radius: 0;
        overflow: hidden;
      }
      .seg-btn {
        padding: 10px 20px;
        background: var(--surface);
        color: var(--text);
        border: none;
        border-right: 1px solid var(--border);
        cursor: pointer;
        font-size: 14px;
        letter-spacing: 0.16px;
        font-family: inherit;
      }
      .seg-btn:last-child {
        border-right: none;
      }
      .seg-btn.active {
        background: var(--primary);
        color: var(--on-primary);
      }
      .signout-btn {
        padding: 10px 20px;
        background: var(--surface);
        color: var(--danger, #d92626);
        border: 1px solid var(--border);
        border-radius: 0;
        cursor: pointer;
        font-size: 14px;
        letter-spacing: 0.16px;
        font-family: inherit;
      }
      .signout-btn:hover {
        background: var(--danger, #d92626);
        color: #fff;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  protected readonly settings = inject(SettingsService);
  protected readonly lang = inject(LangService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  protected readonly themeOptions: { value: ThemeMode; labelKey: string }[] = [
    { value: 'light', labelKey: 'theme.light' },
    { value: 'dark', labelKey: 'theme.dark' },
    { value: 'system', labelKey: 'theme.system' },
  ];
  protected readonly langOptions: { value: Lang; label: string }[] = [
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'en', label: 'English' },
  ];
}
