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

  /** Có thay đổi gán/bỏ gán chưa đồng bộ về explorer/sidebar (đồng bộ khi đóng). */
  private dirty = false;

  /**
   * Gán/bỏ gán NGAY LẬP TỨC (cập nhật lạc quan): đổi ô tích + số đếm tại chỗ, gọi
   * API nền, lỗi thì hoàn tác. KHÔNG reload cả danh sách và KHÔNG bắn `changed`
   * mỗi lần bấm (tránh giật/lag) — dồn lại tới khi đóng dialog.
   */
  toggleAssign(tag: TagWithCount): void {
    const fid = this.fileId();
    if (!fid) return;
    const isOn = this.assigned().has(tag.id);
    // Cập nhật giao diện ngay.
    this.assigned.update((s) => {
      const next = new Set(s);
      if (isOn) next.delete(tag.id);
      else next.add(tag.id);
      return next;
    });
    this.bumpCount(tag.id, isOn ? -1 : 1);
    this.dirty = true;

    const req = isOn ? this.tagsApi.unassign(tag.id, fid) : this.tagsApi.assign(tag.id, fid);
    firstValueFrom(req).catch(() => {
      // Hoàn tác nếu lỗi.
      this.assigned.update((s) => {
        const next = new Set(s);
        if (isOn) next.add(tag.id);
        else next.delete(tag.id);
        return next;
      });
      this.bumpCount(tag.id, isOn ? 1 : -1);
      this.error.set('Không cập nhật được thẻ cho tệp.');
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

  /** Sinh 1 màu hex ngẫu nhiên (đủ tươi để dễ phân biệt) cho nút "Ngẫu nhiên". */
  randomHex(): string {
    // HSL ngẫu nhiên -> hex: bão hoà cao, độ sáng vừa để chấm màu rõ.
    const h = Math.floor(Math.random() * 360);
    const s = 65 + Math.floor(Math.random() * 20); // 65-85%
    const l = 45 + Math.floor(Math.random() * 15); // 45-60%
    const a = (s * Math.min(l, 100 - l)) / 100 / 100;
    const f = (n: number): string => {
      const k = (n + h / 30) % 12;
      const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  close(): void {
    // Đồng bộ 1 lần khi đóng: cập nhật thẻ trên card + số đếm sidebar.
    if (this.dirty) {
      this.dirty = false;
      this.notify();
    }
    this.closed.emit();
  }
}
