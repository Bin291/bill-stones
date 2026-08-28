import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Đọc cấu hình máy (số nhân CPU, RAM ước lượng, GPU) để cảnh báo khi mở file/thư mục
 * nặng trên máy yếu. Chỉ đọc thông tin trình duyệt cho phép (không xâm phạm) và chỉ
 * tính 1 lần rồi cache.
 */
@Injectable({ providedIn: 'root' })
export class DeviceCapabilityService {
  private readonly platformId = inject(PLATFORM_ID);
  private computed = false;
  private weak = false;
  private summaryText = '';

  private detect(): void {
    if (this.computed || !isPlatformBrowser(this.platformId)) return;
    this.computed = true;

    const cores = navigator.hardwareConcurrency || 0;
    // deviceMemory: chỉ Chromium hỗ trợ, làm tròn & giới hạn 8GB (bảo mật).
    const ram = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    const gpu = this.detectGpu();

    // Heuristic "máy yếu": RAM ≤ 4GB HOẶC CPU ≤ 2 nhân.
    const weakRam = typeof ram === 'number' && ram <= 4;
    const weakCpu = cores > 0 && cores <= 2;
    this.weak = weakRam || weakCpu;

    const parts: string[] = [];
    if (typeof ram === 'number') parts.push(`RAM ~${ram}GB`);
    if (cores) parts.push(`CPU ${cores} nhân`);
    if (gpu) parts.push(gpu);
    this.summaryText = parts.join(' · ');
  }

  /** GPU rút gọn (bỏ phần chi tiết trong ngoặc), rỗng nếu không đọc được. */
  private detectGpu(): string {
    try {
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (!ext) return '';
      let renderer =
        (gl.getParameter(
          (ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
        ) as string) || '';
      // ANGLE (Vendor, Renderer (0x…), Direct3D…) → lấy phần tên card (Renderer).
      const angle = renderer.match(/^ANGLE \([^,]+,\s*([^,(]+)/);
      if (angle) renderer = angle[1];
      return renderer
        .replace(/\(.*?\)/g, '') // bỏ mã hex
        .replace(/\s+with Max-Q Design/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 32);
    } catch {
      return '';
    }
  }

  /** Máy có bị coi là yếu không (để quyết định hiện cảnh báo). */
  isWeak(): boolean {
    this.detect();
    return this.weak;
  }

  /** Tóm tắt cấu hình ngắn gọn để hiển thị trong cảnh báo. */
  summary(): string {
    this.detect();
    return this.summaryText;
  }
}
