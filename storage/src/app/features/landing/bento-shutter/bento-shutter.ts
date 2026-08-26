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

interface BentoTile {
  code: string;
  label: string;
  icon: 'storage' | 'latency' | 'lock' | 'shield' | 'pipeline' | 'sla' | 'globe' | 'console';
  /** Hướng văng ra khi "cửa sập" mở (đơn vị: bội số của khoảng cách văng cơ sở). */
  dir: { x: number; y: number; rot: number };
}

/**
 * "Bento Shutter Reveal" — lớp lưới Bento Tile (z-index trên) văng ra 4 hướng
 * khi cuộn, để lộ nội dung tiêu đề bên dưới (z-index dưới) đang zoom + hiện dần.
 * Toàn bộ pin bằng CSS (wrapper 300vh + position: sticky), GSAP chỉ scrub theo
 * tiến trình cuộn — không tính tay quãng pin qua window.innerHeight.
 */
@Component({
  selector: 'app-bento-shutter',
  imports: [RouterLink],
  templateUrl: './bento-shutter.html',
  styleUrl: './bento-shutter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BentoShutter {
  private readonly destroyRef = inject(DestroyRef);

  protected readonly wrapper = viewChild.required<ElementRef<HTMLElement>>('wrapper');
  protected readonly revealed = viewChild.required<ElementRef<HTMLElement>>('revealed');
  protected readonly tileEls = viewChildren<ElementRef<HTMLElement>>('tile');

  protected readonly tiles: BentoTile[] = [
    { code: 'COS-01', label: 'Object Storage', icon: 'storage', dir: { x: -1, y: -1, rot: -8 } },
    { code: 'EDGE-99', label: '<12ms Edge Latency', icon: 'latency', dir: { x: 0, y: -1.3, rot: 6 } },
    { code: 'IAM-SEC', label: 'Zero-Trust Encryption', icon: 'lock', dir: { x: 1, y: -1, rot: 10 } },
    { code: 'SOC2-07', label: 'SOC2 Compliance', icon: 'shield', dir: { x: 1.3, y: 0, rot: -6 } },
    { code: 'NET-10G', label: '10Gbps Pipeline', icon: 'pipeline', dir: { x: 1, y: 1, rot: 8 } },
    { code: 'SLA-999', label: '99.999% SLA', icon: 'sla', dir: { x: 0, y: 1.3, rot: -10 } },
    { code: 'GEO-RPL', label: 'Global Replication', icon: 'globe', dir: { x: -1, y: 1, rot: 6 } },
    { code: 'CDS-CON', label: 'Carbon Console', icon: 'console', dir: { x: -1.3, y: 0, rot: -6 } },
  ];

  constructor() {
    // afterNextRender: chạy sau khi render/hydration đã ổn định, không cần tự
    // kiểm tra platform và không đụng độ SSR (khác ngAfterViewInit).
    afterNextRender(() => {
      gsap.registerPlugin(ScrollTrigger);
      this.initShutter();
      this.destroyRef.onDestroy(() => {
        ScrollTrigger.getAll().forEach((t) => t.kill());
      });
    });
  }

  private initShutter(): void {
    const wrapperEl = this.wrapper().nativeElement;
    const revealedEl = this.revealed().nativeElement;
    const tiles = this.tileEls().map((r) => r.nativeElement);
    const throwDist = 900; // px văng cơ sở (nhân theo dir.x/dir.y từng thẻ)

    gsap.set(revealedEl, { scale: 0.8, opacity: 0 });
    gsap.set(tiles, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 });

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: wrapperEl,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1,
      },
    });

    tl.to(revealedEl, { scale: 1, opacity: 1, ease: 'none' }, 0);

    tiles.forEach((tile, i) => {
      const d = this.tiles[i]?.dir ?? { x: 0, y: 0, rot: 0 };
      tl.to(
        tile,
        {
          x: d.x * throwDist,
          y: d.y * throwDist,
          rotation: d.rot,
          scale: 0.6,
          opacity: 0,
          ease: 'none',
        },
        0,
      );
    });
  }
}
