/**
 * Giới hạn số job "nặng" (thumbnail, transcode HLS...) chạy song song trong 1
 * process. Container Render free tier chỉ có 512MB RAM — chạy sharp/ffmpeg
 * không giới hạn cho mọi file trong 1 thư mục (vd mở thư mục 20 ảnh/video) dễ
 * OOM-kill (status 137) ngay lập tức. Hàng đợi trong-process đơn giản, KHÔNG
 * cần Redis/BullMQ.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
