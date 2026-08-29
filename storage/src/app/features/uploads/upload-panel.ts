import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UploadQueueService } from '../../core/services/upload-queue.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Loader } from '../ui/loader';
import { extensionOf, iconOf } from '../../core/util/file-types';

/**
 * Khung tải lên + các hộp thoại của luồng tải lên (cảnh báo .exe, kết quả quét
 * virus, trùng tên) — đặt NGOÀI <router-outlet> ở main-layout (giống mini audio
 * player) nên TỒN TẠI XUYÊN SUỐT khi người dùng chuyển trang; chỉ mất khi
 * người dùng tự đóng (và không còn mục nào đang tải) hoặc mọi mục đã xong.
 */
@Component({
  selector: 'app-upload-panel',
  imports: [TranslatePipe, Loader],
  templateUrl: './upload-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadPanel {
  protected readonly queue = inject(UploadQueueService);

  /** Icon đúng loại file cho 1 mục upload (dựa trên tên file). */
  protected uploadIconOf(label: string): string {
    return iconOf(extensionOf(label));
  }
}
