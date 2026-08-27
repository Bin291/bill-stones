import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AccountSettings {
  displayName: string | null;
  avatarUrl: string | null;
  hasCustomAvatar: boolean;
  email: string;
  plan: 'free';
  storageQuotaBytes: string;
  usedBytes: string;
  uploadWarnSizeMb: number | null;
  maxFileSizeMb: number;
  duplicateFilePolicy: 'rename' | 'overwrite' | 'ask';
  defaultUploadFolderId: string | null;
  defaultSharePrivacy: 'private' | 'email' | 'public';
}

export interface UpdateAccountSettings {
  displayName?: string;
  uploadWarnSizeMb?: number;
  duplicateFilePolicy?: 'rename' | 'overwrite' | 'ask';
  defaultUploadFolderId?: string | null;
  defaultSharePrivacy?: 'private' | 'email' | 'public';
}

/** API Cài đặt/Hồ sơ tài khoản (mục Settings & Account Management). */
@Injectable({ providedIn: 'root' })
export class SettingsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/users/me`;

  get(): Observable<AccountSettings> {
    return this.http.get<AccountSettings>(`${this.base}/settings`);
  }

  update(dto: UpdateAccountSettings): Observable<AccountSettings> {
    return this.http.patch<AccountSettings>(`${this.base}/settings`, dto);
  }

  setAvatar(file: File): Observable<AccountSettings> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<AccountSettings>(`${this.base}/avatar`, form);
  }

  removeAvatar(): Observable<AccountSettings> {
    return this.http.delete<AccountSettings>(`${this.base}/avatar`);
  }
}
