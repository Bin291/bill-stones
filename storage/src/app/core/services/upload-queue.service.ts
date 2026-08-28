import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  UploadService,
  UploadTask,
  UploadConflict,
  ConflictResolution,
} from './upload.service';
import { VirusScanApiService, ScanResult } from './virus-scan-api.service';
import { FoldersApiService } from './folders-api.service';
import { RefreshService } from './refresh.service';
import { ToastService } from './toast.service';
import { LangService } from '../i18n/lang.service';

/** Một mục tải lên: 1 thư mục (nhiều file) hoặc 1 file lẻ. */
export interface UploadBatch {
  id: string;
  label: string;
  isFolder: boolean;
  total: number;
  done: WritableSignal<number>;
  failed: WritableSignal<number>;
  status: WritableSignal<'uploading' | 'done' | 'error' | 'canceled'>;
  firstTask: WritableSignal<UploadTask | null>; // cho file lẻ hiện %
  tasks: UploadTask[];
  files: File[];
  canceled: boolean;
}

/**
 * Hàng đợi tải lên TOÀN CỤC (root-provided) — độc lập với bất kỳ trang/route
 * nào. Trước đây trạng thái này sống trong FileExplorer nên khi người dùng
 * chuyển sang mục khác ở sidebar (route khác), component bị huỷ và khung tải
 * lên biến mất giữa chừng dù tệp CHƯA tải xong. Đưa lên service root + hiện qua
 * <app-upload-panel> đặt NGOÀI <router-outlet> (main-layout, giống mini audio
 * player) → khung tải lên tồn tại xuyên suốt mọi điều hướng, chỉ mất khi người
 * dùng tự đóng hoặc mọi mục đã THẬT SỰ xong.
 */
@Injectable({ providedIn: 'root' })
export class UploadQueueService {
  private readonly uploadService = inject(UploadService);
  private readonly virusScan = inject(VirusScanApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly refresh = inject(RefreshService);
  private readonly toast = inject(ToastService);
  private readonly lang = inject(LangService);

  readonly uploadBatches = signal<UploadBatch[]>([]);
  readonly uploadsCollapsed = signal(false);
  readonly uploadingCount = computed(
    () => this.uploadBatches().filter((b) => b.status() === 'uploading').length,
  );
  readonly uploadTotalItems = computed(() =>
    this.uploadBatches().reduce((s, b) => s + b.total, 0),
  );
  readonly uploadDoneItems = computed(() =>
    this.uploadBatches().reduce((s, b) => s + b.done() + b.failed(), 0),
  );
  readonly uploadPercent = computed(() => {
    const total = this.uploadTotalItems();
    return total > 0 ? Math.round((this.uploadDoneItems() / total) * 100) : 0;
  });
  readonly hasActiveUploads = computed(() => this.uploadBatches().length > 0);

  // Cảnh báo tệp thực thi (.exe…) trước khi tải lên — sẽ quét virus (VirusTotal).
  readonly exeWarn = signal<{ names: string[] } | null>(null);
  private exeWarnResolver: ((proceed: boolean) => void) | null = null;

  // Kết quả quét khi PHÁT HIỆN mã độc — hiện chi tiết rồi hỏi có tải lên không.
  readonly scanResult = signal<{ fileName: string; result: ScanResult } | null>(null);
  private scanResultResolver: ((proceed: boolean) => void) | null = null;

  // Trùng tên file (chính sách 'ask' trong Cài đặt).
  readonly conflictPrompt = signal<UploadConflict | null>(null);
  private conflictResolver: ((r: ConflictResolution) => void) | null = null;

  /**
   * Nạp danh sách file để tải lên: gộp mỗi thư mục thành 1 "mục" hiện "X trong
   * số N", mỗi file lẻ 1 mục. Giữ cấu trúc thư mục qua webkitRelativePath.
   * `rootId` do trang gọi tự tính (thư mục đang xem / mặc định ở Cài đặt).
   */
  async enqueue(files: File[], rootId: string | null): Promise<void> {
    // Cảnh báo tệp thực thi (.exe…) — kể cả khi nằm bên trong thư mục kéo-thả.
    const execNames = files
      .filter((f) => this.virusScan.isExecutable(f.name))
      .map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
    if (execNames.length > 0) {
      const proceed = await this.warnExecutables(execNames);
      if (!proceed) return;
    }

    // Nhóm theo thư mục gốc; file lẻ đứng riêng.
    const folderGroups = new Map<string, File[]>();
    const loose: File[] = [];
    for (const file of files) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      if (rel && rel.includes('/')) {
        const top = rel.split('/')[0];
        const arr = folderGroups.get(top) ?? [];
        arr.push(file);
        folderGroups.set(top, arr);
      } else {
        loose.push(file);
      }
    }

    const batches: UploadBatch[] = [];
    for (const [name, groupFiles] of folderGroups) {
      batches.push(this.makeBatch(name, true, groupFiles));
    }
    for (const f of loose) {
      batches.push(this.makeBatch(f.name, false, [f]));
    }

    this.uploadBatches.update((list) => [...batches, ...list]);
    this.uploadsCollapsed.set(false);
    for (const batch of batches) void this.runBatch(batch, rootId);
  }

  private makeBatch(label: string, isFolder: boolean, files: File[]): UploadBatch {
    return {
      id: crypto.randomUUID(),
      label,
      isFolder,
      total: files.length,
      done: signal(0),
      failed: signal(0),
      status: signal<'uploading' | 'done' | 'error' | 'canceled'>('uploading'),
      firstTask: signal<UploadTask | null>(null),
      tasks: [],
      files,
      canceled: false,
    };
  }

  private async runBatch(batch: UploadBatch, rootId: string | null): Promise<void> {
    const folderCache = new Map<string, string | null>();
    folderCache.set('', rootId);

    for (const file of batch.files) {
      if (batch.canceled) break;
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      let targetFolderId = rootId;
      if (rel && rel.includes('/')) {
        const segments = rel.split('/').slice(0, -1);
        targetFolderId = await this.ensureFolderPath(segments, rootId, folderCache);
      }
      const task = this.uploadService.createTask(file);
      batch.tasks.push(task);
      if (!batch.isFolder) batch.firstTask.set(task);

      // Quét virus tệp thực thi TRƯỚC khi lưu — chặn nếu phát hiện mã độc.
      if (this.virusScan.isExecutable(file.name)) {
        const blocked = await this.scanBeforeUpload(task, file);
        if (blocked) {
          batch.failed.update((v) => v + 1);
          continue;
        }
      }

      const result = await this.uploadService.run(task, file, targetFolderId, (c) =>
        this.askConflict(c),
      );
      if (result) batch.done.update((v) => v + 1);
      else if (task.status() !== 'canceled') batch.failed.update((v) => v + 1);
    }

    // Báo mọi nơi đang xem danh sách file (sidebar, trang hiện tại nếu có) tự
    // nạp lại — khung tải lên là GLOBAL nên không tự biết trang nào đang mở để
    // gọi thẳng revalidate() của trang đó.
    if (!batch.canceled) this.refresh.bump();

    if (batch.canceled) batch.status.set('canceled');
    else if (batch.failed() > 0) batch.status.set('error');
    else batch.status.set('done');
  }

  /**
   * Quét virus 1 tệp thực thi trước khi lưu. Trả TRUE nếu bị chặn (mã độc) →
   * caller bỏ qua tệp này. Trả FALSE nếu an toàn/không xác định → cho tải tiếp.
   */
  private async scanBeforeUpload(task: UploadTask, file: File): Promise<boolean> {
    task.status.set('scanning');
    let result: ScanResult | null = null;
    try {
      result = await this.virusScan.scan(file);
    } catch {
      result = null; // lỗi quét → không chặn, để người dùng vẫn tải được
    }
    if (result && (result.verdict === 'malicious' || result.verdict === 'suspicious')) {
      const proceed = await this.showScanResult(file.name, result);
      if (!proceed) {
        const n = result.malicious || result.suspicious;
        task.status.set('error');
        task.error.set(this.lang.translate('scan.blocked', { n }));
        this.toast.error(
          this.lang.translate('scan.blockedToast', { name: file.name, n, total: result.total }),
        );
        return true; // người dùng chọn KHÔNG tải lên → chặn
      }
      return false; // người dùng chấp nhận rủi ro → vẫn tải lên
    }
    if (result && result.verdict === 'clean') {
      this.toast.success(
        this.lang.translate('scan.clean', { name: file.name, total: result.total }),
      );
    }
    return false;
  }

  private showScanResult(fileName: string, result: ScanResult): Promise<boolean> {
    return new Promise((resolve) => {
      this.scanResultResolver = resolve;
      this.scanResult.set({ fileName, result });
    });
  }

  resolveScanResult(proceed: boolean): void {
    this.scanResult.set(null);
    this.scanResultResolver?.(proceed);
    this.scanResultResolver = null;
  }

  private warnExecutables(names: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      this.exeWarnResolver = resolve;
      this.exeWarn.set({ names });
    });
  }

  resolveExeWarn(proceed: boolean): void {
    this.exeWarn.set(null);
    this.exeWarnResolver?.(proceed);
    this.exeWarnResolver = null;
  }

  private askConflict(c: UploadConflict): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      this.conflictResolver = resolve;
      this.conflictPrompt.set(c);
    });
  }

  resolveConflict(choice: ConflictResolution): void {
    this.conflictPrompt.set(null);
    this.conflictResolver?.(choice);
    this.conflictResolver = null;
  }

  cancelBatch(batch: UploadBatch): void {
    batch.canceled = true;
    for (const t of batch.tasks) t.cancel();
    batch.status.set('canceled');
  }

  toggleUploadsCollapse(): void {
    this.uploadsCollapsed.update((v) => !v);
  }

  /** Tạo/tìm chuỗi thư mục lồng nhau, trả id thư mục lá. */
  private async ensureFolderPath(
    segments: string[],
    rootId: string | null,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    let parentId = rootId;
    let pathKey = '';
    for (const seg of segments) {
      pathKey = pathKey ? `${pathKey}/${seg}` : seg;
      if (cache.has(pathKey)) {
        parentId = cache.get(pathKey)!;
        continue;
      }
      const children = await firstValueFrom(this.foldersApi.listChildren(parentId));
      const existing = children.find((c) => c.name === seg);
      const folder = existing ?? (await firstValueFrom(this.foldersApi.create(seg, parentId)));
      cache.set(pathKey, folder.id);
      parentId = folder.id;
    }
    return parentId;
  }

  /** Chỉ đóng khi KHÔNG còn mục nào đang tải (đã xong/lỗi/huỷ hết). */
  dismissUploads(): void {
    if (this.uploadingCount() > 0) return;
    this.uploadBatches.set([]);
  }

  /**
   * Đệ quy đọc mọi file trong các entry được kéo-thả (gồm thư mục con), gắn
   * webkitRelativePath để runBatch tái tạo cấu trúc thư mục như khi chọn bằng
   * hộp thoại chọn thư mục. Dùng cho kéo-thả (onDrop) ở bất kỳ trang nào.
   */
  async collectDroppedEntries(entries: FileSystemEntry[]): Promise<File[]> {
    const out: File[] = [];
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        const rel = prefix ? `${prefix}/${file.name}` : file.name;
        try {
          Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true });
        } catch {
          /* một số trình duyệt không cho ghi đè — vẫn upload được dạng file lẻ */
        }
        out.push(file);
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const children: FileSystemEntry[] = [];
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject),
          );
          if (!batch.length) break;
          children.push(...batch);
        }
        const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        for (const child of children) await walk(child, dirPrefix);
      }
    };
    for (const entry of entries) await walk(entry, '');
    return out;
  }
}
