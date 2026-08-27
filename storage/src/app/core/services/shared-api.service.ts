import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Folder, StoredFile } from '../models/file.model';

export interface SharedItem {
  shareId: string;
  kind: 'file' | 'folder';
  sharedByEmail: string | null;
  allowDownload: boolean;
  file?: StoredFile;
  folder?: Folder;
}

/** Nội dung 1 thư mục được chia sẻ khi mở vào để duyệt. */
export interface SharedFolderContents {
  folder: { id: string; name: string };
  folders: Folder[];
  files: StoredFile[];
  allowDownload: boolean;
}

@Injectable({ providedIn: 'root' })
export class SharedApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/shared`;

  list(): Observable<SharedItem[]> {
    return this.http.get<SharedItem[]>(this.base);
  }

  /** Duyệt nội dung 1 thư mục được chia sẻ (hoặc thư mục con của nó). */
  listFolder(folderId: string): Observable<SharedFolderContents> {
    return this.http.get<SharedFolderContents>(`${this.base}/folder/${folderId}/list`);
  }

  contentUrl(fileId: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.base}/file/${fileId}/content`);
  }

  downloadUrl(fileId: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.base}/file/${fileId}/download`);
  }
}
