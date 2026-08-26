import { ListFilesQuery } from '../models/file.model';
import { CATEGORIES, categoryByKey } from './file-types';

/** Các "lăng kính" hiển thị file (mục 11). */
export type Lens = 'folder' | 'type' | 'starred' | 'recent' | 'tag';

export interface ViewParams {
  folderId: string | null;
  category: string | null;
  tagId: string | null;
  sort: NonNullable<ListFilesQuery['sort']>;
  order: NonNullable<ListFilesQuery['order']>;
}

/** Toàn bộ đuôi mở rộng đã biết (cho lăng kính Gắn sao / Gần đây). */
export function allExtensions(): string {
  return CATEGORIES.flatMap((c) => c.extensions).join(',');
}

/** Dựng query gửi API theo lăng kính — dùng chung explorer + prefetch. */
export function buildListQuery(mode: Lens, p: ViewParams): ListFilesQuery {
  const base: ListFilesQuery = { sort: p.sort, order: p.order };
  switch (mode) {
    case 'folder':
      return { ...base, folderId: p.folderId };
    case 'type': {
      const cat = categoryByKey((p.category ?? 'other') as never);
      return { ...base, extensions: (cat?.extensions ?? []).join(','), withPath: true };
    }
    case 'tag':
      return { ...base, tagId: p.tagId ?? '', withPath: true };
    case 'starred':
      return { ...base, starred: true, extensions: allExtensions(), withPath: true };
    case 'recent':
      return { ...base, sort: 'updatedAt', order: 'desc', extensions: allExtensions(), withPath: true };
  }
}

/** Khoá cache duy nhất cho 1 "khung nhìn" (lăng kính + tham số + sắp xếp). */
export function viewKey(mode: Lens, p: ViewParams): string {
  return [mode, p.folderId ?? '', p.category ?? '', p.tagId ?? '', p.sort, p.order].join('|');
}
