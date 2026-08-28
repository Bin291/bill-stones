import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Folder } from '../models/file.model';

export interface ShareMeta {
  kind: 'file' | 'folder';
  requiresPassword: boolean;
  allowDownload?: boolean;
  name?: string;
  extension?: string;
  mimeType?: string;
  size?: string;
}

export interface PublicListing {
  folders: Folder[];
  files: { id: string; name: string; extension: string; size: string; mimeType: string }[];
}

@Injectable({ providedIn: 'root' })
export class PublicShareApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/s`;

  private headers(session: string | null): HttpHeaders {
    return session ? new HttpHeaders({ 'x-share-session': session }) : new HttpHeaders();
  }

  meta(token: string, session: string | null): Observable<ShareMeta> {
    return this.http.get<ShareMeta>(`${this.base}/${token}`, { headers: this.headers(session) });
  }

  unlock(token: string, password: string): Observable<{ sessionToken: string }> {
    return this.http.post<{ sessionToken: string }>(`${this.base}/${token}/unlock`, { password });
  }

  contentUrl(token: string, session: string | null, fileId?: string): Observable<{ url: string }> {
    const q = fileId ? `?fileId=${fileId}` : '';
    return this.http.get<{ url: string }>(`${this.base}/${token}/content${q}`, {
      headers: this.headers(session),
    });
  }

  downloadUrl(token: string, session: string | null, fileId?: string): Observable<{ url: string }> {
    const q = fileId ? `?fileId=${fileId}` : '';
    return this.http.get<{ url: string }>(`${this.base}/${token}/download${q}`, {
      headers: this.headers(session),
    });
  }

  /** Render docx/xlsx/csv/text/code thành HTML để xem trước inline (mục preview). */
  previewHtml(
    token: string,
    session: string | null,
    fileId?: string,
  ): Observable<{ html: string }> {
    const q = fileId ? `?fileId=${fileId}` : '';
    return this.http.get<{ html: string }>(`${this.base}/${token}/preview${q}`, {
      headers: this.headers(session),
    });
  }

  list(token: string, session: string | null, folderId?: string): Observable<PublicListing> {
    const q = folderId ? `?folderId=${folderId}` : '';
    return this.http.get<PublicListing>(`${this.base}/${token}/list${q}`, {
      headers: this.headers(session),
    });
  }
}
