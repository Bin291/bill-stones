import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AudioPlayerService } from '../../core/services/audio-player.service';
import { FilesApiService } from '../../core/services/files-api.service';

/** Mini-player âm thanh ghim góc dưới-trái, giữ chạy khi chuyển trang. */
@Component({
  selector: 'app-mini-audio-player',
  templateUrl: './mini-audio-player.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiniAudioPlayer {
  private readonly audioSvc = inject(AudioPlayerService);
  private readonly filesApi = inject(FilesApiService);
  private readonly audioRef = viewChild<ElementRef<HTMLAudioElement>>('audio');

  protected readonly track = this.audioSvc.track;
  protected readonly src = signal<string | null>(null);
  protected readonly playing = signal(false);
  protected readonly current = signal(0);
  protected readonly duration = signal(0);
  protected readonly loading = signal(false);
  protected readonly volume = signal(1);
  protected readonly muted = signal(false);

  // % lấp đầy cho thanh trượt (nền gradient) — để bar "đầy" chứ không thưa.
  protected readonly seekFill = computed(() => {
    const d = this.duration();
    return d > 0 ? (this.current() / d) * 100 : 0;
  });
  protected readonly volFill = computed(() => (this.muted() ? 0 : this.volume() * 100));

  private lastId: string | null = null;
  private prevVolume = 1;

  constructor() {
    effect(() => {
      const t = this.track();
      if (!t) {
        this.src.set(null);
        this.lastId = null;
        return;
      }
      if (t.id === this.lastId) return;
      this.lastId = t.id;
      void this.load(t.id);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.current.set(0);
    this.duration.set(0);
    try {
      const { url } = await firstValueFrom(this.filesApi.previewUrl(id));
      this.src.set(url);
    } catch {
      this.src.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  onCanPlay(): void {
    const el = this.audioRef()?.nativeElement;
    if (!el) return;
    el.volume = this.volume();
    el.muted = this.muted();
    if (el.paused) void el.play().catch(() => undefined);
  }

  onMeta(): void {
    this.duration.set(this.audioRef()?.nativeElement.duration ?? 0);
  }
  onTime(): void {
    this.current.set(this.audioRef()?.nativeElement.currentTime ?? 0);
  }
  onPlay(): void {
    this.playing.set(true);
  }
  onPause(): void {
    this.playing.set(false);
  }
  onEnded(): void {
    this.playing.set(false);
  }

  toggle(): void {
    const el = this.audioRef()?.nativeElement;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }

  seek(value: string): void {
    const el = this.audioRef()?.nativeElement;
    if (el) el.currentTime = Number(value);
  }

  // --- Âm lượng ---
  setVolume(value: string): void {
    this.applyVolume(Number(value));
  }

  private applyVolume(v: number): void {
    const el = this.audioRef()?.nativeElement;
    if (el) {
      el.volume = v;
      el.muted = v === 0;
    }
    this.volume.set(v);
    this.muted.set(v === 0);
  }

  toggleMute(): void {
    if (this.muted() || this.volume() === 0) {
      this.applyVolume(this.prevVolume > 0 ? this.prevVolume : 1);
    } else {
      this.prevVolume = this.volume();
      this.applyVolume(0);
    }
  }

  volumeIcon(): string {
    if (this.muted() || this.volume() === 0) return 'volume_off';
    if (this.volume() < 0.5) return 'volume_down';
    return 'volume_up';
  }

  close(): void {
    this.audioRef()?.nativeElement.pause();
    this.audioSvc.close();
  }

  fmt(sec: number): string {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
