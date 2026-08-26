import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Loader dạng ma trận chấm 5×5 kiểu "equalizer" — tái hiện dotm-square-18 của
 * bộ Dot Matrix (shadcn) cho Angular. Mỗi cột nhấp nhô như thanh âm lượng: chấm
 * dưới mức sáng (~0.95), đỉnh sáng nhất (1.0), phía trên mờ (~0.1); các cột lệch
 * pha để tạo sóng chạy. Dùng thay mọi hiệu ứng loading của web.
 */
@Component({
  selector: 'app-loader',
  template: `
    <span
      class="dmx"
      role="status"
      [attr.aria-label]="label()"
      [style.--dmx-dot.px]="dot()"
      [style.--dmx-gap.px]="gap()"
      [style.--dmx-cycle]="cycle()"
    >
      @for (c of cols; track c) {
        <span class="dmx-col" [style.--c]="c">
          @for (r of rows; track r) {
            <span class="dmx-dot"></span>
          }
        </span>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        color: var(--primary);
      }
      .dmx {
        display: inline-flex;
        gap: var(--dmx-gap, 4px);
        line-height: 0;
      }
      .dmx-col {
        display: flex;
        flex-direction: column-reverse; /* chấm đầu tiên = đáy cột */
        gap: var(--dmx-gap, 4px);
      }
      .dmx-dot {
        width: var(--dmx-dot, 6px);
        height: var(--dmx-dot, 6px);
        border-radius: 50%;
        background: currentColor;
        opacity: 0.12;
        animation-duration: var(--dmx-cycle, 1.3s);
        animation-timing-function: ease-in-out;
        animation-iteration-count: infinite;
        /* Mỗi cột lệch pha → sóng chạy ngang */
        animation-delay: calc(var(--c, 0) * (var(--dmx-cycle, 1.3s) / -8));
        will-change: opacity;
      }
      /* Ngưỡng sáng theo hàng: đáy sáng gần như luôn, càng lên đỉnh càng chớp nhanh */
      .dmx-dot:nth-child(1) {
        animation-name: dmx-r0;
      }
      .dmx-dot:nth-child(2) {
        animation-name: dmx-r1;
      }
      .dmx-dot:nth-child(3) {
        animation-name: dmx-r2;
      }
      .dmx-dot:nth-child(4) {
        animation-name: dmx-r3;
      }
      .dmx-dot:nth-child(5) {
        animation-name: dmx-r4;
      }

      @keyframes dmx-r0 {
        0%,
        100% {
          opacity: 0.9;
        }
        50% {
          opacity: 1;
        }
      }
      @keyframes dmx-r1 {
        0%,
        12% {
          opacity: 0.12;
        }
        22%,
        78% {
          opacity: 0.95;
        }
        50% {
          opacity: 1;
        }
        88%,
        100% {
          opacity: 0.12;
        }
      }
      @keyframes dmx-r2 {
        0%,
        26% {
          opacity: 0.12;
        }
        36%,
        64% {
          opacity: 0.95;
        }
        50% {
          opacity: 1;
        }
        74%,
        100% {
          opacity: 0.12;
        }
      }
      @keyframes dmx-r3 {
        0%,
        38% {
          opacity: 0.12;
        }
        46%,
        54% {
          opacity: 0.95;
        }
        50% {
          opacity: 1;
        }
        62%,
        100% {
          opacity: 0.12;
        }
      }
      @keyframes dmx-r4 {
        0%,
        44% {
          opacity: 0.12;
        }
        50% {
          opacity: 1;
        }
        56%,
        100% {
          opacity: 0.12;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dmx-dot {
          animation: none;
          opacity: 0.55;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Loader {
  /** Đường kính mỗi chấm (px). */
  readonly dot = input(6);
  /** Khoảng cách giữa các chấm (px). */
  readonly gap = input(4);
  /** Thời lượng 1 chu kỳ (VD '1.3s'). */
  readonly cycle = input('1.3s');
  readonly label = input('Đang tải');

  /** Lưới 5×5 (kiểu dotm-square-18). */
  protected readonly cols = [0, 1, 2, 3, 4];
  protected readonly rows = [0, 1, 2, 3, 4];
}
