import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import Hls from 'hls.js';
import { environment } from '../../../environments/environment';
import { SupabaseService } from '../../core/services/supabase.service';
import { VideoApiService } from '../../core/services/video-api.service';

interface LevelOpt {
  index: number;
  height: number;
}

/**
 * Player HLS (streaming + ABR tự động + tua + chọn chất lượng + fullscreen).
 * Mở trong modal khi bấm vào file video. Nếu HLS chưa sẵn sàng thì kích hoạt
 * transcode + poll trạng thái. Thanh điều khiển tuỳ biến (kiểu YouTube):
 * tua bằng kéo/bấm, đệm buffer, âm lượng, chất lượng, toàn màn hình, tự ẩn.
 */
@Component({
  selector: 'app-video-player',
  templateUrl: './video-player.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoPlayer implements AfterViewInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly videoApi = inject(VideoApiService);

  readonly fileId = input.required<string>();
  readonly fileName = input<string>('');
  readonly closed = output<void>();

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly levels = signal<LevelOpt[]>([]);
  readonly currentLevel = signal(-1); // -1 = Auto
  readonly phase = signal<'loading' | 'processing' | 'playing' | 'error'>('loading');
  readonly error = signal<string | null>(null);

  // Trạng thái điều khiển tuỳ biến.
  readonly playing = signal(false);
  readonly buffering = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly bufferedEnd = signal(0);
  readonly volume = signal(1);
  readonly muted = signal(false);
  readonly settingsOpen = signal(false);
  readonly controlsVisible = signal(true);
  readonly dragging = signal(false);

  readonly progressPct = computed(() => {
    const d = this.duration();
    return d > 0 ? Math.min(100, (this.currentTime() / d) * 100) : 0;
  });
  readonly bufferPct = computed(() => {
    const d = this.duration();
    return d > 0 ? Math.min(100, (this.bufferedEnd() / d) * 100) : 0;
  });
  readonly volumeIcon = computed(() => {
    if (this.muted() || this.volume() === 0) return 'volume_off';
    if (this.volume() < 0.5) return 'volume_down';
    return 'volume_up';
  });

  private hls?: Hls;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  async ngAfterViewInit(): Promise<void> {
    try {
      const status = await firstValueFrom(this.videoApi.status(this.fileId()));
      if (status.hlsStatus === 'ready') {
        await this.attach();
      } else if (status.hlsStatus === 'failed') {
        this.phase.set('error');
        this.error.set('Xử lý video thất bại.');
      } else {
        // null hoặc processing -> kích hoạt + poll
        this.phase.set('processing');
        if (status.hlsStatus === null) await firstValueFrom(this.videoApi.generate(this.fileId()));
        this.poll();
      }
    } catch {
      this.phase.set('error');
      this.error.set('Không tải được video.');
    }
  }

  private poll(): void {
    this.pollTimer = setTimeout(async () => {
      if (this.destroyed) return;
      try {
        const s = await firstValueFrom(this.videoApi.status(this.fileId()));
        if (s.hlsStatus === 'ready') {
          await this.attach();
        } else if (s.hlsStatus === 'failed') {
          this.phase.set('error');
          this.error.set('Xử lý video thất bại.');
        } else {
          this.poll();
        }
      } catch {
        this.poll();
      }
    }, 3000);
  }

  private async attach(): Promise<void> {
    const el = this.video()?.nativeElement;
    if (!el) return;
    const master = this.videoApi.masterUrl(this.fileId());
    const token = (await this.supabase.getSession()).data.session?.access_token ?? '';
    this.phase.set('playing');

    if (Hls.isSupported()) {
      this.hls = new Hls({
        // Chỉ đính JWT cho request tới BACKEND (playlist). KHÔNG đính cho R2
        // presigned (sẽ 403 nếu kèm Authorization).
        xhrSetup: (xhr, url) => {
          if (url.startsWith(environment.apiUrl)) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
        },
        startLevel: -1,
        capLevelToPlayerSize: true,
      });
      this.hls.loadSource(master);
      this.hls.attachMedia(el);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.levels.set(this.hls!.levels.map((l, i) => ({ index: i, height: l.height })));
        void el.play().catch(() => undefined);
      });
      this.hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) =>
        this.currentLevel.set(this.hls!.autoLevelEnabled ? -1 : d.level),
      );
      this.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) this.recover(data.type);
      });
    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari/iOS: HLS native (xem HLS_STREAMING.md về giới hạn JWT trên Safari).
      el.src = master;
    } else {
      this.phase.set('error');
      this.error.set('Trình duyệt không hỗ trợ HLS.');
    }
  }

  // ===== Sự kiện <video> =====
  onLoadedMeta(): void {
    const el = this.video()?.nativeElement;
    if (el) this.duration.set(el.duration || 0);
  }
  onTimeUpdate(): void {
    const el = this.video()?.nativeElement;
    if (!el || this.dragging()) return;
    this.currentTime.set(el.currentTime);
  }
  onProgress(): void {
    const el = this.video()?.nativeElement;
    if (!el || !el.buffered.length) return;
    this.bufferedEnd.set(el.buffered.end(el.buffered.length - 1));
  }
  onVolumeChange(): void {
    const el = this.video()?.nativeElement;
    if (!el) return;
    this.volume.set(el.volume);
    this.muted.set(el.muted);
  }

  // ===== Điều khiển =====
  togglePlay(): void {
    const el = this.video()?.nativeElement;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
    this.flashControls();
  }

  private seekToFraction(frac: number): void {
    const el = this.video()?.nativeElement;
    const d = this.duration();
    if (!el || d <= 0) return;
    const t = Math.max(0, Math.min(1, frac)) * d;
    el.currentTime = t;
    this.currentTime.set(t);
  }

  private fractionFromEvent(e: PointerEvent, track: HTMLElement): number {
    const rect = track.getBoundingClientRect();
    return (e.clientX - rect.left) / rect.width;
  }

  onTrackDown(e: PointerEvent, track: HTMLElement): void {
    this.dragging.set(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.seekToFraction(this.fractionFromEvent(e, track));
  }
  onTrackMove(e: PointerEvent, track: HTMLElement): void {
    if (!this.dragging()) return;
    this.seekToFraction(this.fractionFromEvent(e, track));
  }
  onTrackUp(): void {
    this.dragging.set(false);
  }

  skip(seconds: number): void {
    const el = this.video()?.nativeElement;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(this.duration(), el.currentTime + seconds));
    this.flashControls();
  }

  setVolume(value: string): void {
    const el = this.video()?.nativeElement;
    if (!el) return;
    const v = Number(value);
    el.volume = v;
    el.muted = v === 0;
  }
  toggleMute(): void {
    const el = this.video()?.nativeElement;
    if (!el) return;
    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) el.volume = 0.5;
  }

  toggleSettings(): void {
    this.settingsOpen.update((v) => !v);
  }
  setLevel(value: string): void {
    const index = Number(value);
    this.currentLevel.set(index);
    if (this.hls) this.hls.currentLevel = index;
    this.settingsOpen.set(false);
  }

  fullscreen(): void {
    const stage = this.video()?.nativeElement.closest('.vp-stage') as HTMLElement | null;
    const target = stage ?? this.video()?.nativeElement;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void target?.requestFullscreen?.();
  }

  fmt(sec: number): string {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // ===== Tự ẩn thanh điều khiển =====
  flashControls(): void {
    this.controlsVisible.set(true);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.playing() && !this.dragging() && !this.settingsOpen()) {
        this.controlsVisible.set(false);
      }
    }, 2800);
  }

  private recover(type: string): void {
    if (type === Hls.ErrorTypes.NETWORK_ERROR) this.hls?.startLoad();
    else if (type === Hls.ErrorTypes.MEDIA_ERROR) this.hls?.recoverMediaError();
    else {
      this.phase.set('error');
      this.error.set('Lỗi phát video.');
    }
  }

  close(): void {
    this.closed.emit();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hls?.destroy();
  }
}
