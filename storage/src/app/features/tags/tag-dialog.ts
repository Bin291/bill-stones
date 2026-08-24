import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TagsApiService } from '../../core/services/tags-api.service';
import { RefreshService } from '../../core/services/refresh.service';
import { TagWithCount } from '../../core/models/file.model';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Bảng màu gợi ý (kiểu Finder) — người dùng vẫn có thể chọn màu tuỳ ý. */
const PRESET_COLORS = [
  '#8d8d8d',
  '#da1e28',
  '#ff832b',
  '#f1c21b',
  '#24a148',
  '#0f62fe',
  '#8a3ffc',
  '#ee5396',
  '#009d9a',
];

/**
 * Dialog thẻ tuỳ chỉnh (thay cho prompt trình duyệt):
 * - Luôn: quản lý thẻ (thêm/sửa tên+màu/xoá).
 * - Khi mở từ 1 file (có fileId): thêm ô tích để gán/bỏ gán thẻ cho file đó.
 */
@Component({
  selector: 'app-tag-dialog',
  imports: [TranslatePipe],
  templateUrl: './tag-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagDialog implements OnInit {
  private readonly tagsApi = inject(TagsApiService);
  private readonly refresh = inject(RefreshService);

  /** Nếu có: chế độ gán thẻ cho file này. Nếu null: chỉ quản lý thẻ. */
  readonly fileId = input<string | null>(null);
  /** Danh sách id thẻ đang gắn cho file (khởi tạo trạng thái tích). */
  readonly assignedIds = input<string[]>([]);

  readonly closed = output<void>();
  /** Bắn khi có thay đổi ảnh hưởng tới file hiện tại (để explorer nạp lại). */
  readonly changed = output<void>();

  readonly presets = PRESET_COLORS;
  readonly tags = signal<TagWithCount[]>([]);
  readonly assigned = signal<Set<string>>(new Set());
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // Form thêm thẻ mới.
  readonly newName = signal('');
  readonly newColor = signal(PRESET_COLORS[0]);

  // Sửa inline.
  readonly editingId = signal<string | null>(null);
  readonly editName = signal('');
  readonly editColor = signal('');

  readonly assignMode = computed(() => !!this.fileId());

  ngOnInit(): void {
    // Input signals đã có giá trị binding ở ngOnInit (không phải trong constructor).
    this.assigned.set(new Set(this.assignedIds()));
    void this.load();
  }

  async load(): Promise<void> {
    try {
      this.tags.set(await firstValueFrom(this.tagsApi.list()));
    } catch {
      this.error.set('Không tải được danh sách thẻ.');
    }
  }

  private notify(): void {
    this.refresh.bumpTags();
    this.changed.emit();
  }

  async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.tagsApi.create(name, this.newColor()));
      this.newName.set('');
      this.newColor.set(PRESET_COLORS[0]);
      await this.load();
      this.refresh.bumpTags();
    } catch {
      this.error.set('Không tạo được thẻ (có thể trùng tên).');
    } finally {
      this.busy.set(false);
    }
  }

  startEdit(tag: TagWithCount): void {
    this.editingId.set(tag.id);
    this.editName.set(tag.name);
    this.editColor.set(tag.color);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  async saveEdit(): Promise<void> {
    const id = this.editingId();
    const name = this.editName().trim();
    if (!id || !name || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.tagsApi.update(id, { name, color: this.editColor() }));
      this.editingId.set(null);
      await this.load();
      this.notify();
    } catch {
      this.error.set('Không lưu được thẻ (có thể trùng tên).');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(tag: TagWithCount): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.tagsApi.remove(tag.id));
      this.assigned.update((s) => {
        const next = new Set(s);
        next.delete(tag.id);
        return next;
      });
      await this.load();
      this.notify();
    } catch {
      this.error.set('Không xoá được thẻ.');
    } finally {
      this.busy.set(false);
    }
  }

  async toggleAssign(tag: TagWithCount): Promise<void> {
    const fid = this.fileId();
    if (!fid || this.busy()) return;
    const isOn = this.assigned().has(tag.id);
    this.busy.set(true);
    try {
      if (isOn) await firstValueFrom(this.tagsApi.unassign(tag.id, fid));
      else await firstValueFrom(this.tagsApi.assign(tag.id, fid));
      this.assigned.update((s) => {
        const next = new Set(s);
        if (isOn) next.delete(tag.id);
        else next.add(tag.id);
        return next;
      });
      await this.load(); // cập nhật fileCount
      this.notify();
    } catch {
      this.error.set('Không cập nhật được thẻ cho tệp.');
    } finally {
      this.busy.set(false);
    }
  }

  isAssigned(id: string): boolean {
    return this.assigned().has(id);
  }

  close(): void {
    this.closed.emit();
  }
}
