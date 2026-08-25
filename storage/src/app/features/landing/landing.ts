import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

interface FeatureTile {
  icon: string;
  title: string;
  desc: string;
}

interface Metric {
  value: number;
  decimals: number;
  suffix: string;
  label: string;
}

/**
 * Landing page công khai — hiệu ứng cuộn 2D bằng GSAP + ScrollTrigger
 * (Parallax hero, Pinning + Card Stacking cho Features, đếm số + SVG
 * stroke-dashoffset cho Metrics). Không dùng Three.js (mục yêu cầu: nhẹ,
 * mượt trên mobile). Phong cách IBM Carbon Gray 100 (#161616 / #0f62fe).
 */
@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  private readonly destroyRef = inject(DestroyRef);

  protected readonly heroSection = viewChild.required<ElementRef<HTMLElement>>('heroSection');
  protected readonly heroVisual = viewChild.required<ElementRef<HTMLElement>>('heroVisual');
  protected readonly floatingIcons = viewChildren<ElementRef<HTMLElement>>('floatIcon');

  protected readonly pinWrap = viewChild.required<ElementRef<HTMLElement>>('pinWrap');
  protected readonly pinInner = viewChild.required<ElementRef<HTMLElement>>('pinInner');
  protected readonly cardEls = viewChildren<ElementRef<HTMLElement>>('featureCard');

  protected readonly metricsSection = viewChild.required<ElementRef<HTMLElement>>('metricsSection');
  protected readonly flowPath = viewChild.required<ElementRef<SVGPathElement>>('flowPath');
  protected readonly metricEls = viewChildren<ElementRef<HTMLElement>>('metricValue');

  protected readonly features: FeatureTile[] = [
    {
      icon: 'lock',
      title: 'Encryption',
      desc: 'Mã hoá đầu-cuối AES-256 cho mọi tệp, cả khi lưu trữ lẫn khi truyền tải.',
    },
    {
      icon: 'redundancy',
      title: 'Redundancy',
      desc: 'Dữ liệu được nhân bản trên nhiều vùng lưu trữ — không một điểm lỗi nào làm mất dữ liệu.',
    },
    {
      icon: 'speed',
      title: 'Speed',
      desc: 'Upload đa phần song song (multipart) và CDN biên giúp tốc độ truy cập tối ưu.',
    },
  ];

  protected readonly metrics: Metric[] = [
    { value: 99.999, decimals: 3, suffix: '%', label: 'Uptime' },
    { value: 12, decimals: 0, suffix: 'ms', label: 'Latency trung bình' },
    { value: 256, decimals: 0, suffix: '-bit', label: 'Mã hoá AES' },
  ];

  constructor() {
    // afterNextRender: cơ chế Angular dành riêng cho code chỉ được phép chạy
    // ở browser sau khi bản render đầu tiên (kể cả hydration) đã ổn định —
    // không cần tự kiểm tra isPlatformBrowser, và không bao giờ chạy khi SSR.
    afterNextRender(() => {
      gsap.registerPlugin(ScrollTrigger);

      this.initHeroParallax();
      this.initFeatureStacking();
      this.initMetrics();

      this.destroyRef.onDestroy(() => {
        ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      });
    });
  }

  /** Section 1 — Hero: khung dashboard trôi chậm hơn nội dung (parallax Y) + icon bay vào. */
  private initHeroParallax(): void {
    const heroEl = this.heroSection().nativeElement;
    const visualEl = this.heroVisual().nativeElement;
    const icons = this.floatingIcons().map((r) => r.nativeElement);

    gsap.to(visualEl, {
      yPercent: -14,
      ease: 'none',
      scrollTrigger: {
        trigger: heroEl,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });

    if (icons.length) {
      gsap.from(icons, {
        opacity: 0,
        y: 32,
        scale: 0.7,
        stagger: 0.15,
        duration: 0.8,
        ease: 'power2.out',
        delay: 0.3,
      });
    }
  }

  /**
   * Section 2 — Features: pin màn hình, 3 thẻ Carbon Tile trượt lên xếp chồng.
   *
   * Trigger chạy trên `pinWrap` (wrapper cao 300vh khai báo thuần CSS —
   * xem `.landing-features` trong landing.css) với `start/end` mặc định
   * 'top top' → 'bottom bottom', KHÔNG tự tính quãng cuộn qua
   * `window.innerHeight` bằng JS. Cách tính tay từng gây lệch pixel khi
   * ScrollTrigger.refresh() chạy lại (vd. sau khi web font load xong) vì
   * hàm callback re-evaluate không đồng bộ với thời điểm layout ổn định —
   * khiến các trigger nằm sau (Metrics) không bao giờ vào ngưỡng kích hoạt.
   * Phần tử được pin thực sự là `pinInner` (position: sticky bên trong).
   */
  private initFeatureStacking(): void {
    const pinEl = this.pinWrap().nativeElement;
    const pinInnerEl = this.pinInner().nativeElement;
    const cards = this.cardEls().map((r) => r.nativeElement);
    if (!cards.length) return;

    const stackOffset = 20; // px lệch giữa các lớp thẻ khi xếp chồng
    const scaleStep = 0.035;

    cards.forEach((card, i) => {
      gsap.set(card, {
        y: i === 0 ? 0 : '100vh',
        scale: 1 - i * scaleStep,
        // Thẻ vào sau nằm trên (che lớp trước) — đúng ý "lớp bảo mật kích hoạt".
        zIndex: i + 1,
      });
    });

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: pinEl,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1,
        pin: pinInnerEl,
        anticipatePin: 1,
      },
    });

    cards.forEach((card, i) => {
      if (i === 0) return;
      tl.to(
        card,
        { y: i * stackOffset, scale: 1 - i * scaleStep, duration: 1, ease: 'power1.out' },
        i - 1,
      );
      // Thẻ phía dưới lùi nhẹ ra sau khi thẻ mới phủ lên (hiệu ứng lớp bảo mật kích hoạt).
      if (i - 1 >= 0) {
        tl.to(
          cards[i - 1],
          { scale: 1 - i * scaleStep - 0.01, duration: 1, ease: 'power1.out' },
          i - 1,
        );
      }
    });
  }

  /** Section 3 — Metrics: SVG line tự vẽ (stroke-dashoffset) + số đếm tăng dần. */
  private initMetrics(): void {
    const sectionEl = this.metricsSection().nativeElement;
    const pathEl = this.flowPath().nativeElement;
    const len = pathEl.getTotalLength();

    gsap.set(pathEl, { strokeDasharray: len, strokeDashoffset: len });
    gsap.to(pathEl, {
      strokeDashoffset: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: sectionEl,
        start: 'top 75%',
        end: 'bottom 55%',
        scrub: true,
      },
    });

    this.metricEls().forEach((ref, i) => {
      const el = ref.nativeElement;
      const metric = this.metrics[i];
      if (!metric) return;
      const counter = { val: 0 };
      let entered = false;
      // Tự tạo tween ở trạng thái pause rồi restart() thủ công trong onEnter,
      // thay vì dựa vào scrollTrigger.toggleActions trên chính tween đó: nếu
      // ScrollTrigger đã ở trạng thái active NGAY LÚC khởi tạo/refresh (không
      // có một lần chuyển inactive→active thật sự để bắt), toggleActions
      // 'play' sẽ không bắn — khiến số đếm đứng yên ở 0 dù đã cuộn tới nơi.
      // Cờ `entered` chặn việc restart() lặp lại nếu onEnter bắn lại lần nữa
      // (vd. ScrollTrigger.refresh() do resize thật) — tránh số đếm bị bắn về 0
      // giữa chừng; chỉ phát đúng một lần khi cuộn tới.
      const tween = gsap.to(counter, {
        val: metric.value,
        duration: 1.8,
        ease: 'power1.out',
        paused: true,
        onUpdate: () => {
          el.textContent = counter.val.toFixed(metric.decimals) + metric.suffix;
        },
      });

      ScrollTrigger.create({
        trigger: el,
        start: 'top 85%',
        onEnter: () => {
          if (entered) return;
          entered = true;
          tween.restart();
        },
      });
    });
  }
}
