/**
 * Định dạng thời gian tương đối (VD "5 phút trước", "3 giờ trước") — dùng cho
 * trang "Được chia sẻ với tôi" và mọi nơi cần hiện "bao lâu trước" thay vì mốc
 * ngày giờ tuyệt đối. `translate` là hàm dịch của LangService (hỗ trợ {n}).
 */
export function relativeTime(
  date: string | Date,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const diffSec = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));

  if (diffSec < 60) return translate('time.justNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return translate('time.minutesAgo', { n: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return translate('time.hoursAgo', { n: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return translate('time.daysAgo', { n: diffDay });
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return translate('time.monthsAgo', { n: diffMonth });
  const diffYear = Math.floor(diffMonth / 12);
  return translate('time.yearsAgo', { n: diffYear });
}
