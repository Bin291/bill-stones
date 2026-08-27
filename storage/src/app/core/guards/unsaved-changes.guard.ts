import { CanDeactivateFn } from '@angular/router';

/** Component nào chặn rời trang khi có thay đổi chưa lưu thì cài đặt hàm này. */
export interface CanComponentDeactivate {
  canDeactivate: () => boolean;
}

/**
 * Guard chặn điều hướng khi còn thay đổi chưa lưu. Uỷ quyền cho component tự
 * quyết (thường bật hộp thoại confirm() của trình duyệt). Giữ interface riêng để
 * không phải import class component (giữ nguyên lazy-load).
 */
export const unsavedChangesGuard: CanDeactivateFn<CanComponentDeactivate> = (component) =>
  component.canDeactivate();
