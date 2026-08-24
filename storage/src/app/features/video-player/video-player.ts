import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
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
 * transcode + poll trạng thái.
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

  private hls?: Hls;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
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

  setLevel(value: string): void {
    const index = Number(value);
    this.currentLevel.set(index);
    if (this.hls) this.hls.currentLevel = index;
  }

  fullscreen(): void {
    void this.video()?.nativeElement.requestFullscreen?.();
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
    this.hls?.destroy();
  }
}
