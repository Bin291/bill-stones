import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { BreadcrumbCrumb, Folder } from '../../core/models/file.model';

/** Hộp thoại chọn 1 thư mục (duyệt cây, drill-in) — dùng cho "Thư mục mặc định" trong Cài đặt. */
@Component({
  selector: 'app-folder-picker-dialog',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="cancelled.emit()">
      <div class="modal move-modal" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <span><span class="mi">folder</span> {{ 'settings.defaultFolder' | t }}</span>
          <button class="btn btn-icon" type="button" (click)="cancelled.emit()">
            <span class="mi">close</span>
          </button>
        </div>

        <div class="modal-body">
          <nav class="move-crumbs">
            <button class="move-crumb" type="button" [class.current]="!parentId()" (click)="go(null)">
              {{ 'common.root' | t }}
            </button>
            @for (c of breadcrumb(); track c.id) {
              <span class="mi" style="font-size: 18px">chevron_right</span>
              <button class="move-crumb" type="button" (click)="go(c.id)">{{ c.name }}</button>
            }
          </nav>

          <div class="move-list">
            @if (loading()) {
              <div class="empty" style="border: none; padding: 16px">{{ 'files.loading' | t }}</div>
            } @else {
              @for (f of folders(); track f.id) {
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
            <button class="btn btn-primary" type="button" (click)="chosen.emit(parentId())">
              {{ 'move.here' | t }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class FolderPickerDialog implements OnInit {
  private readonly foldersApi = inject(FoldersApiService);

  readonly chosen = output<string | null>();
  readonly cancelled = output<void>();

  readonly parentId = signal<string | null>(null);
  readonly folders = signal<Folder[]>([]);
  readonly breadcrumb = signal<BreadcrumbCrumb[]>([]);
  readonly loading = signal(false);

  ngOnInit(): void {
    void this.load(null);
  }

  async go(parentId: string | null): Promise<void> {
    this.parentId.set(parentId);
    await this.load(parentId);
  }

  private async load(parentId: string | null): Promise<void> {
    this.loading.set(true);
    try {
      const [folders, crumbs] = await Promise.all([
        firstValueFrom(this.foldersApi.listChildren(parentId)),
        parentId ? firstValueFrom(this.foldersApi.breadcrumb(parentId)) : Promise.resolve([]),
      ]);
      this.folders.set(folders);
      this.breadcrumb.set(crumbs);
    } catch {
      this.folders.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
