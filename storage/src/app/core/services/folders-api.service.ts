import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BreadcrumbCrumb, Folder } from '../models/file.model';

@Injectable({ providedIn: 'root' })
export class FoldersApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/folders`;

  listChildren(parentId: string | null): Observable<Folder[]> {
    let params = new HttpParams();
    if (parentId) params = params.set('parentId', parentId);
    return this.http.get<Folder[]>(this.base, { params });
  }

  /** Mọi thư mục đã gắn sao, bất kể ở thư mục cha nào (lăng kính Gắn sao). */
  listStarred(): Observable<Folder[]> {
    return this.http.get<Folder[]>(this.base, { params: new HttpParams().set('starred', 'true') });
  }

  breadcrumb(folderId: string): Observable<BreadcrumbCrumb[]> {
    return this.http.get<BreadcrumbCrumb[]>(`${this.base}/${folderId}/breadcrumb`);
  }

  create(name: string, parentId: string | null): Observable<Folder> {
    return this.http.post<Folder>(this.base, { name, parentId });
  }

  rename(id: string, name: string): Observable<Folder> {
    return this.http.patch<Folder>(`${this.base}/${id}`, { name });
  }

  move(id: string, targetParentId: string | null): Observable<Folder> {
    return this.http.post<Folder>(`${this.base}/${id}/move`, { targetParentId });
  }

  /** Tải cả thư mục dưới dạng .zip (blob, mục 5.E). */
  downloadZip(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/download`, { responseType: 'blob' });
  }

  star(id: string, isStarred: boolean): Observable<Folder> {
    return this.http.patch<Folder>(`${this.base}/${id}/star`, { isStarred });
  }

  /** Xoá mềm -> Thùng rác (mục 11.K). */
  trash(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/${id}/trash`, {});
  }

  /** Khôi phục từ Thùng rác. */
  restore(id: string): Observable<Folder> {
    return this.http.patch<Folder>(`${this.base}/${id}/restore`, {});
  }

  /** Xoá vĩnh viễn (chỉ khi đang ở Thùng rác). */
  remove(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
