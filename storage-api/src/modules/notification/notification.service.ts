import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Đẩy tín hiệu realtime tới kênh cá nhân của người nhận để client nạp thông báo
   * NGAY LẬP TỨC (không đợi poll). Dùng Realtime Broadcast qua HTTP với service key —
   * payload rỗng (chỉ là "ping"), client tự gọi API có xác thực để lấy nội dung, nên
   * không lộ dữ liệu qua kênh. Lỗi thì bỏ qua (đã có poll dự phòng).
   */
  async pingUser(userId: string): Promise<void> {
    const url = this.config.get<string>('supabase.url');
    const key = this.config.get<string>('supabase.serviceRoleKey');
    if (!url || !key) return;
    try {
      await fetch(`${url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ topic: `notif:${userId}`, event: 'new', payload: {} }],
        }),
      });
    } catch (e) {
      this.logger.warn(`realtime ping failed: ${String(e)}`);
    }
  }

  list(userId: string, unreadOnly: boolean): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Thông báo không tồn tại');
    if (n.userId !== userId) throw new ForbiddenException('Không có quyền');
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
