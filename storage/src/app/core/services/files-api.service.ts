import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ExtensionStat, ListFilesQuery, StoredFile } from '../models/file.model';

@Injectable({ providedIn: 'root' })
export class FilesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/files`;

  list(query: ListFilesQuery): Observable<StoredFile[]> {
    let params = new HttpParams();
    if (query.folderId !== undefined && query.folderId !== null) {
      params = params.set('folderId', query.folderId);
    } else if (query.folderId === null && !query.extensions) {
      params = params.set('folderId', '');
    }
    if (query.extensions) params = params.set('extensions', query.extensions);
    if (query.sort) params = params.set('sort', query.sort);
    if (query.order) params = params.set('order', query.order);
    if (query.starred) params = params.set('starred', 'true');
    if (query.withPath) params = params.set('withPath', 'true');
    return this.http.get<StoredFile[]>(this.base, { params });
  }

  stats(): Observable<ExtensionStat[]> {
    return this.http.get<ExtensionStat[]>(`${this.base}/stats`);
  }

  get(id: string): Observable<StoredFile> {
    return this.http.get<StoredFile>(`${this.base}/${id}`);
  }

  downloadUrl(id: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.base}/${id}/download-url`);
  }

  previewUrl(id: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.base}/${id}/preview-url`);
  }

  /** HTML render sẵn cho docx/excel/text (xem trước nội dung). */
  previewHtml(id: string): Observable<{ html: string }> {
    return this.http.get<{ html: string }>(`${this.base}/${id}/preview-html`);
  }

  rename(id: string, name: string): Observable<StoredFile> {
    return this.http.patch<StoredFile>(`${this.base}/${id}`, { name });
  }

  move(id: string, targetFolderId: string | null): Observable<StoredFile> {
    return this.http.post<StoredFile>(`${this.base}/${id}/move`, { targetFolderId });
  }

  star(id: string, isStarred: boolean): Observable<StoredFile> {
    return this.http.patch<StoredFile>(`${this.base}/${id}/star`, { isStarred });
  }

  /** Xoá mềm -> Thùng rác (mục 11.K). */
  trash(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/${id}/trash`, {});
  }

  /** Khôi phục từ Thùng rác. */
  restore(id: string): Observable<StoredFile> {
    return this.http.patch<StoredFile>(`${this.base}/${id}/restore`, {});
  }

  /** Xoá vĩnh viễn (chỉ khi đang ở Thùng rác). */
  remove(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
