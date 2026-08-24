import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Tag, TagWithCount } from '../models/file.model';

/** API thẻ (tag) tuỳ chỉnh — CRUD + gán/bỏ gán cho file. */
@Injectable({ providedIn: 'root' })
export class TagsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/tags`;

  list(): Observable<TagWithCount[]> {
    return this.http.get<TagWithCount[]>(this.base);
  }

  create(name: string, color: string): Observable<Tag> {
    return this.http.post<Tag>(this.base, { name, color });
  }

  update(id: string, data: { name?: string; color?: string }): Observable<Tag> {
    return this.http.patch<Tag>(`${this.base}/${id}`, data);
  }

  remove(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }

  assign(tagId: string, fileId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/${tagId}/files/${fileId}`, {});
  }

  unassign(tagId: string, fileId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${tagId}/files/${fileId}`);
  }
}
