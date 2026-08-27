import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Share {
  id: string;
  userId: string;
  fileId: string | null;
  folderId: string | null;
  token: string | null;
  sharedWithUserId: string | null;
  sharedWithEmail: string | null;
  allowDownload: boolean;
  expiresAt: string | null;
  viewCount: number;
  downloadCount: number;
  createdAt: string;
  sharedWithAvatarUrl?: string | null;
}

export interface ShareLink extends Share {
  url: string;
}

export interface CreateLinkBody {
  fileId?: string;
  folderId?: string;
  allowDownload?: boolean;
  expiresInDays?: number;
  password?: string;
}

export interface InviteBody {
  fileId?: string;
  folderId?: string;
  email: string;
  allowDownload?: boolean;
  expiresInDays?: number;
}

@Injectable({ providedIn: 'root' })
export class ShareApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/shares`;

  createLink(body: CreateLinkBody): Observable<ShareLink> {
    return this.http.post<ShareLink>(`${this.base}/link`, body);
  }

  invite(body: InviteBody): Observable<Share> {
    return this.http.post<Share>(`${this.base}/invite`, body);
  }

  searchUsers(q: string): Observable<{ id: string; email: string; avatarUrl?: string | null }[]> {
    return this.http.get<{ id: string; email: string; avatarUrl?: string | null }[]>(`${this.base}/users/search`, {
      params: new HttpParams().set('q', q),
    });
  }

  list(target: { fileId?: string; folderId?: string }): Observable<Share[]> {
    let params = new HttpParams();
    if (target.fileId) params = params.set('fileId', target.fileId);
    if (target.folderId) params = params.set('folderId', target.folderId);
    return this.http.get<Share[]>(this.base, { params });
  }

  update(
    id: string,
    body: { allowDownload?: boolean; expiresInDays?: number | null; password?: string | null },
  ): Observable<Share> {
    return this.http.patch<Share>(`${this.base}/${id}`, body);
  }

  revoke(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
