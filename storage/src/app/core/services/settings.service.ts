import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ViewMode = 'grid' | 'list';

/**
 * Cài đặt cá nhân lưu localStorage (mục 11.D, 31) — không thêm bảng DB.
 * Theme áp vào <html data-theme>, view mode dùng cho lăng kính Lưới/Danh sách (11.G).
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly theme = signal<ThemeMode>(this.read('app.theme', 'system') as ThemeMode);
  readonly viewMode = signal<ViewMode>(this.read('app.viewMode', 'grid') as ViewMode);

  constructor() {
    effect(() => this.applyTheme(this.theme()));
    effect(() => this.persist('app.viewMode', this.viewMode()));
  }

  setTheme(v: ThemeMode) {
    this.theme.set(v);
    this.persist('app.theme', v);
  }
  setViewMode(v: ViewMode) {
    this.viewMode.set(v);
  }
  toggleView() {
    this.viewMode.set(this.viewMode() === 'grid' ? 'list' : 'grid');
  }

  private applyTheme(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    let resolved = mode;
    if (mode === 'system') {
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      resolved = prefersDark ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', resolved);
  }

  private read(key: string, fallback: string): string {
    if (typeof localStorage === 'undefined') return fallback;
    return localStorage.getItem(key) ?? fallback;
  }
  private persist(key: string, value: string): void {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  }
}
