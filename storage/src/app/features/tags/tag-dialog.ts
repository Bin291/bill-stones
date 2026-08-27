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
import { Tag, TagWithCount } from '../../core/models/file.model';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ConfirmDialog } from '../ui/confirm-dialog';

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
  imports: [TranslatePipe, ConfirmDialog],
  templateUrl: './tag-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagDialog implements OnInit {
  private readonly tagsApi = inject(TagsApiService);
  private readonly refresh = inject(RefreshService);

  /** Nếu có: chế độ gán thẻ cho file này. Nếu null: chỉ quản lý thẻ. */
  readonly fileId = input<string | null>(null);
  /** Nếu có: chế độ gán thẻ cho thư mục này (thay cho fileId). */
  readonly folderId = input<string | null>(null);
  /** Danh sách id thẻ đang gắn cho file/thư mục (khởi tạo trạng thái tích). */
  readonly assignedIds = input<string[]>([]);

  readonly closed = output<void>();
  /**
   * Bắn NGAY mỗi lần tích/bỏ tích — kèm tagIds mới nhất để explorer cập nhật
   * badge tại chỗ, không cần reload. `undefined` = thay đổi chung (sửa/xoá thẻ,
   * ảnh hưởng nhiều mục) — explorer nên nạp lại danh sách trong trường hợp này.
   */
  readonly changed = output<{ fileId?: string; folderId?: string; tags: Tag[] } | undefined>();

  readonly presets = PRESET_COLORS;
  readonly tags = signal<TagWithCount[]>([]);
  readonly assigned = signal<Set<string>>(new Set());
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // Form thêm thẻ mới. newColor = null: CHƯA chọn màu → khi tạo sẽ lấy màu ngẫu
  // nhiên trong 9 màu có sẵn.
  readonly newName = signal('');
  readonly newColor = signal<string | null>(null);

  // Sửa inline.
  readonly editingId = signal<string | null>(null);
  readonly editName = signal('');
  readonly editColor = signal('');

  readonly assignMode = computed(() => !!this.fileId() || !!this.folderId());
  readonly pendingDelete = signal<TagWithCount | null>(null);

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
    this.changed.emit(undefined);
  }

  async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Chưa chọn màu → lấy màu ngẫu nhiên trong 9 màu có sẵn.
      const color = this.newColor() ?? this.randomPreset();
      await firstValueFrom(this.tagsApi.create(name, color));
      this.newName.set('');
      this.newColor.set(null);
      await this.load();
      this.refresh.bumpTags();
    } catch (e) {
      this.error.set(this.tagError(e, 'Không tạo được thẻ.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** Thông báo lỗi chính xác: 409 = trùng tên; còn lại = lỗi kết nối/máy chủ. */
  private tagError(e: unknown, fallback: string): string {
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0;
    if (status === 409) return 'Đã có thẻ trùng tên.';
    if (status === 0) return 'Không kết nối được máy chủ. Thử lại.';
    const msg =
      e && typeof e === 'object' && 'error' in e
        ? (e as { error?: { message?: string } }).error?.message
        : undefined;
    return msg || fallback;
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
    } catch (e) {
      this.error.set(this.tagError(e, 'Không lưu được thẻ.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** Bấm nút xoá → chỉ mở hộp thoại xác nhận (chưa xoá thật). */
  requestDelete(tag: TagWithCount): void {
    this.pendingDelete.set(tag);
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  /** Xác nhận trong hộp thoại → xoá thật. */
  async confirmDelete(): Promise<void> {
    const tag = this.pendingDelete();
    this.pendingDelete.set(null);
    if (tag) await this.remove(tag);
  }

  private async remove(tag: TagWithCount): Promise<void> {
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

  /**
   * Gán/bỏ gán NGAY LẬP TỨC (cập nhật lạc quan): đổi ô tích + số đếm tại chỗ,
   * BẮN `changed` ngay (không đợi đóng dialog) để card ngoài danh sách cập nhật
   * màu thẻ tức thì, rồi mới gọi API nền — lỗi thì hoàn tác cả 2.
   */
  toggleAssign(tag: TagWithCount): void {
    const fid = this.fileId();
    const folId = this.folderId();
    if (!fid && !folId) return;
    const isOn = this.assigned().has(tag.id);
    this.assigned.update((s) => {
      const next = new Set(s);
      if (isOn) next.delete(tag.id);
      else next.add(tag.id);
      return next;
    });
    this.bumpCount(tag.id, isOn ? -1 : 1);
    this.emitTargetChanged();

    const req = fid
      ? isOn
        ? this.tagsApi.unassign(tag.id, fid)
        : this.tagsApi.assign(tag.id, fid)
      : isOn
        ? this.tagsApi.unassignFolder(tag.id, folId!)
        : this.tagsApi.assignFolder(tag.id, folId!);
    firstValueFrom(req)
      .then(() => this.refresh.bumpTags())
      .catch(() => {
        // Hoàn tác nếu lỗi.
        this.assigned.update((s) => {
          const next = new Set(s);
          if (isOn) next.add(tag.id);
          else next.delete(tag.id);
          return next;
        });
        this.bumpCount(tag.id, isOn ? 1 : -1);
        this.error.set('Không cập nhật được thẻ cho tệp.');
        this.emitTargetChanged();
      });
  }

  /** Bắn `changed` kèm danh sách thẻ (đủ tên+màu) đang gắn hiện tại cho mục đang mở. */
  private emitTargetChanged(): void {
    const ids = this.assigned();
    const tags = this.tags().filter((t) => ids.has(t.id));
    this.changed.emit({
      fileId: this.fileId() ?? undefined,
      folderId: this.folderId() ?? undefined,
      tags,
    });
  }

  /** Cập nhật số đếm fileCount tại chỗ (không gọi lại API). */
  private bumpCount(tagId: string, delta: number): void {
    this.tags.update((list) =>
      list.map((t) =>
        t.id === tagId ? { ...t, fileCount: Math.max(0, (t.fileCount ?? 0) + delta) } : t,
      ),
    );
  }

  isAssigned(id: string): boolean {
    return this.assigned().has(id);
  }

  /** Chọn 1 màu ngẫu nhiên trong 9 màu có sẵn (khi người dùng không chọn màu). */
  private randomPreset(): string {
    return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
  }

  close(): void {
    this.closed.emit();
  }
}
