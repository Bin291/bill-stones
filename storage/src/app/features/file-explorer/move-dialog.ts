import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FilesApiService } from '../../core/services/files-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { BreadcrumbCrumb, Folder } from '../../core/models/file.model';

/** Mục cần chuyển (file hoặc folder). */
export interface MoveItem {
  kind: 'file' | 'folder';
  id: string;
  name: string;
}

/**
 * Hộp thoại "Chuyển đến thư mục": duyệt cây thư mục (drill-in) rồi chọn đích.
 * Loại trừ chính các folder đang chuyển để không tạo vòng lặp; backend cũng chặn.
 */
@Component({
  selector: 'app-move-dialog',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="cancelled.emit()">
      <div class="modal move-modal" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <span><span class="mi">drive_file_move</span> {{ 'action.move' | t }}</span>
          <button class="btn btn-icon" type="button" (click)="cancelled.emit()">
            <span class="mi">close</span>
          </button>
        </div>

        @if (error()) {
          <div class="auth-error" style="margin: 12px 16px 0">{{ error() }}</div>
        }

        <div class="modal-body">
          <!-- Breadcrumb đích -->
          <nav class="move-crumbs">
            <button class="move-crumb" type="button" [class.current]="!parentId()" (click)="go(null)">
              {{ 'common.root' | t }}
            </button>
            @for (c of breadcrumb(); track c.id) {
              <span class="mi" style="font-size: 18px">chevron_right</span>
              <button class="move-crumb" type="button" (click)="go(c.id)">{{ c.name }}</button>
            }
          </nav>

          <!-- Danh sách thư mục con để drill-in -->
          <div class="move-list">
            @if (loading()) {
              <div class="empty" style="border: none; padding: 16px">{{ 'files.loading' | t }}</div>
            } @else {
              @for (f of subfolders(); track f.id) {
                <button class="move-row" type="button" (click)="go(f.id)">
                  <span class="mi" style="color: var(--primary)">folder</span>
                  <span class="move-row-name">{{ f.name }}</span>
                  <span class="mi" style="margin-left: auto; color: var(--ink-subtle)">chevron_right</span>
                </button>
              } @empty {
                <div class="empty" style="border: none; padding: 16px">{{ 'move.noSub' | t }}</div>
              }
            }
          </div>

          <div class="row" style="justify-content: flex-end; margin-top: 16px; gap: 8px">
            <button class="btn" type="button" (click)="cancelled.emit()">{{ 'action.cancel' | t }}</button>
            <button class="btn btn-primary" type="button" [disabled]="busy()" (click)="confirm()">
              {{ 'move.here' | t }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class MoveDialog implements OnInit {
  private readonly filesApi = inject(FilesApiService);
  private readonly foldersApi = inject(FoldersApiService);

  readonly items = input.required<MoveItem[]>();
  readonly moved = output<void>();
  readonly cancelled = output<void>();

  readonly parentId = signal<string | null>(null);
  readonly folders = signal<Folder[]>([]);
  readonly breadcrumb = signal<BreadcrumbCrumb[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // Ẩn các folder đang được chuyển khỏi danh sách (không thể chuyển vào chính nó/con).
  private movedFolderIds = new Set<string>();

  ngOnInit(): void {
    this.movedFolderIds = new Set(
      this.items().filter((i) => i.kind === 'folder').map((i) => i.id),
    );
    void this.load(null);
  }

  subfolders(): Folder[] {
    return this.folders().filter((f) => !this.movedFolderIds.has(f.id));
  }

  async go(parentId: string | null): Promise<void> {
    this.parentId.set(parentId);
    await this.load(parentId);
  }

  private async load(parentId: string | null): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [folders, crumbs] = await Promise.all([
        firstValueFrom(this.foldersApi.listChildren(parentId)),
        parentId ? firstValueFrom(this.foldersApi.breadcrumb(parentId)) : Promise.resolve([]),
      ]);
      this.folders.set(folders);
      this.breadcrumb.set(crumbs);
    } catch {
      this.folders.set([]);
      this.error.set('Không tải được danh sách thư mục.');
    } finally {
      this.loading.set(false);
    }
  }

  async confirm(): Promise<void> {
    if (this.busy()) return;
    const target = this.parentId();
    this.busy.set(true);
    this.error.set(null);
    try {
      for (const item of this.items()) {
        if (item.kind === 'file') await firstValueFrom(this.filesApi.move(item.id, target));
        else await firstValueFrom(this.foldersApi.move(item.id, target));
      }
      this.moved.emit();
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? (e as { error?: { message?: string } }).error?.message
          : undefined;
      this.error.set(msg || 'Không chuyển được vào thư mục này.');
    } finally {
      this.busy.set(false);
    }
  }
}
