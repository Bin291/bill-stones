import { Injectable, signal } from '@angular/core';

export interface AudioTrack {
  id: string;
  name: string;
}

/**
 * Trạng thái bài đang phát cho mini-player toàn cục (đặt trong MainLayout nên
 * giữ chạy khi điều hướng — như Spotify/SoundCloud).
 */
@Injectable({ providedIn: 'root' })
export class AudioPlayerService {
  readonly track = signal<AudioTrack | null>(null);

  play(track: AudioTrack): void {
    this.track.set(track);
  }

  close(): void {
    this.track.set(null);
  }
}
