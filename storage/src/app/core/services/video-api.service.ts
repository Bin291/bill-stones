import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class VideoApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/videos`;

  masterUrl(fileId: string): string {
    return `${this.base}/${fileId}/hls/master.m3u8`;
  }

  status(fileId: string): Observable<{ hlsStatus: string | null }> {
    return this.http.get<{ hlsStatus: string | null }>(`${this.base}/${fileId}/hls/status`);
  }

  generate(fileId: string): Observable<{ hlsStatus: string }> {
    return this.http.post<{ hlsStatus: string }>(`${this.base}/${fileId}/hls/generate`, {});
  }
}
