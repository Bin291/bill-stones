import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StoredFile } from '../models/file.model';

interface InitResult {
  fileId: string;
  uploadId: string;
  r2Key: string;
  chunkSize: number;
  name: string;
}

interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

export type UploadStatus = 'pending' | 'uploading' | 'completing' | 'done' | 'error' | 'canceled';

/** Trùng tên (chính sách 'ask') — đủ thông tin để hỏi lại người dùng. */
export interface UploadConflict {
  name: string;
  existingFileId: string;
}
export type ConflictResolution = 'rename' | 'overwrite' | 'skip';

export interface UploadTask {
  id: string; // client-side id
  fileName: string;
  size: number;
  progress: WritableSignal<number>; // 0..100
  status: WritableSignal<UploadStatus>;
  error: WritableSignal<string | null>;
  cancel: () => void;
}

/**
 * Multipart chunked upload phía client (mục 5.A): chia file thành chunk, gửi qua
 * POST /uploads/part (không PUT thẳng lên bucket), song song có giới hạn, resumable.
 */
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/uploads`;

  /** Lưu uploadId theo dấu vân tay file để resume sau khi đóng tab (mục 5.A). */
  private resumeKey(file: File, folderId: string | null): string {
    return `upload:${folderId ?? 'root'}:${file.name}:${file.size}:${file.lastModified}`;
  }

  /**
   * Thử lại thao tác mạng khi gặp lỗi TẠM THỜI (mất kết nối, server khởi động lại,
   * 5xx, 429) — giúp mọi loại tệp tải lên ổn định. Lỗi client thật (400/401/403/413)
   * thì báo ngay, không thử lại.
   */
  private async withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status ?? 0;
        // Không thử lại với lỗi client rõ ràng (trừ 408 timeout, 429 quá tải).
        const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
        if (permanent || i === attempts - 1) break;
        // Backoff tăng dần: 0.6s, 1.2s, 2.4s…
        await new Promise((r) => setTimeout(r, 600 * 2 ** i));
      }
    }
    throw lastErr;
  }

  createTask(file: File): UploadTask {
    const controller = { canceled: false };
    const task: UploadTask = {
      id: crypto.randomUUID(),
      fileName: file.name,
      size: file.size,
      progress: signal(0),
      status: signal<UploadStatus>('pending'),
      error: signal<string | null>(null),
      cancel: () => {
        controller.canceled = true;
        task.status.set('canceled');
      },
    };
    (task as UploadTask & { _controller: { canceled: boolean } })._controller = controller;
    return task;
  }

  async run(
    task: UploadTask,
    file: File,
    folderId: string | null,
    onConflict?: (c: UploadConflict) => Promise<ConflictResolution>,
  ): Promise<StoredFile | null> {
    const controller = (task as UploadTask & { _controller: { canceled: boolean } })._controller;
    try {
      task.status.set('uploading');

      // 1) init (hoặc resume nếu có phiên lưu trước đó).
      const rk = this.resumeKey(file, folderId);
      let init: InitResult;
      let existing: CompletedPart[] = [];
      const saved = localStorage.getItem(rk);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as InitResult;
          existing = await this.listParts(parsed.fileId, parsed.uploadId);
          init = parsed;
        } catch {
          const result = await this.initOrAsk(file, folderId, onConflict);
          if (!result) {
            task.status.set('canceled');
            return null;
          }
          init = result;
          localStorage.setItem(rk, JSON.stringify(init));
        }
      } else {
        const result = await this.initOrAsk(file, folderId, onConflict);
        if (!result) {
          task.status.set('canceled');
          return null;
        }
        init = result;
        localStorage.setItem(rk, JSON.stringify(init));
      }

      const chunkSize = init.chunkSize || environment.chunkSizeBytes;
      const totalParts = Math.max(1, Math.ceil(file.size / chunkSize));
      const doneParts = new Map<number, string>();
      for (const p of existing) doneParts.set(p.PartNumber, p.ETag);

      let uploadedBytes = doneParts.size * chunkSize;
      const setProgress = () =>
        task.progress.set(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
      setProgress();

      // 2) Upload các part còn thiếu, song song có giới hạn.
      const pending: number[] = [];
      for (let i = 1; i <= totalParts; i++) if (!doneParts.has(i)) pending.push(i);

      const concurrency = Math.max(1, environment.uploadConcurrency);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < pending.length) {
          if (controller.canceled) return;
          const partNumber = pending[cursor++];
          const start = (partNumber - 1) * chunkSize;
          const blob = file.slice(start, Math.min(start + chunkSize, file.size));
          const etag = await this.uploadPart(init.fileId, init.uploadId, partNumber, blob);
          doneParts.set(partNumber, etag);
          uploadedBytes += blob.size;
          setProgress();
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));

      if (controller.canceled) {
        await this.abort(init.fileId, init.uploadId).catch(() => undefined);
        localStorage.removeItem(rk);
        return null;
      }

      // 3) complete.
      task.status.set('completing');
      const parts: CompletedPart[] = Array.from(doneParts.entries())
        .map(([PartNumber, ETag]) => ({ PartNumber, ETag }))
        .sort((a, b) => a.PartNumber - b.PartNumber);
      const result = await this.complete(init.fileId, init.uploadId, parts);

      localStorage.removeItem(rk);
      task.progress.set(100);
      task.status.set('done');
      return result;
    } catch (err) {
      task.status.set('error');
      task.error.set(err instanceof Error ? err.message : 'Tải lên thất bại');
      return null;
    }
  }

  private init(
    file: File,
    folderId: string | null,
    duplicateAction?: 'rename' | 'overwrite',
  ): Promise<InitResult> {
    return this.withRetry(() =>
      firstValueFrom(
        this.http.post<InitResult>(`${this.base}/init`, {
          name: file.name,
          size: String(file.size),
          mimeType: file.type || 'application/octet-stream',
          folderId,
          duplicateAction,
        }),
      ),
    );
  }

  /**
   * init() nhưng bắt lỗi 409 (trùng tên, chính sách 'ask') để hỏi lại người dùng
   * qua `onConflict` — trả null nếu người dùng chọn bỏ qua file này.
   */
  private async initOrAsk(
    file: File,
    folderId: string | null,
    onConflict?: (c: UploadConflict) => Promise<ConflictResolution>,
  ): Promise<InitResult | null> {
    try {
      return await this.init(file, folderId);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const body = (err as { error?: { code?: string; existingFileId?: string } })?.error;
      if (status === 409 && body?.code === 'DUPLICATE_NAME' && onConflict) {
        const resolution = await onConflict({ name: file.name, existingFileId: body.existingFileId ?? '' });
        if (resolution === 'skip') return null;
        return this.init(file, folderId, resolution);
      }
      throw err;
    }
  }

  private async uploadPart(
    fileId: string,
    uploadId: string,
    partNumber: number,
    blob: Blob,
  ): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const res = await this.withRetry(() =>
      firstValueFrom(
        this.http.post<{ ETag: string; PartNumber: number }>(`${this.base}/part`, buffer, {
          headers: new HttpHeaders({
            'Content-Type': 'application/octet-stream',
            'x-file-id': fileId,
            'x-upload-id': uploadId,
            'x-part-number': String(partNumber),
          }),
        }),
      ),
    );
    return res.ETag;
  }

  private complete(
    fileId: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<StoredFile> {
    return this.withRetry(() =>
      firstValueFrom(
        this.http.post<StoredFile>(`${this.base}/complete`, { fileId, uploadId, parts }),
      ),
    );
  }

  private abort(fileId: string, uploadId: string): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(`${this.base}/abort`, { fileId, uploadId }),
    );
  }

  private listParts(fileId: string, uploadId: string): Promise<CompletedPart[]> {
    return firstValueFrom(
      this.http.post<CompletedPart[]>(
        `${this.base}/list-parts?fileId=${fileId}&uploadId=${uploadId}`,
        {},
      ),
    );
  }
}
