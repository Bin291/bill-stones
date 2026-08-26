import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type SearchMatchBranch = 'dense' | 'bge' | 'fts';

export interface SearchResult {
  id: string;
  name: string;
  extension: string;
  size: string;
  thumbnailUrl: string | null;
  folderId: string | null;
  hlsStatus: string | null;
  snippet: string | null;
  similarity: number;
  matchedBy: SearchMatchBranch[];
}

@Injectable({ providedIn: 'root' })
export class SearchApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/search`;

  search(q: string): Observable<{ results: SearchResult[] }> {
    const params = new HttpParams().set('q', q);
    return this.http.get<{ results: SearchResult[] }>(this.base, { params });
  }

  reindex(): Observable<{ queued: number }> {
    return this.http.post<{ queued: number }>(`${this.base}/reindex`, {});
  }
}
