/**
 * Mapping tĩnh extension -> nhóm loại (mục 11.H #36) + icon Material.
 * Dễ mở rộng: chỉ thêm đuôi vào nhóm tương ứng.
 */
export type CategoryKey = 'document' | 'image' | 'video' | 'audio' | 'code' | 'archive' | 'other';

export interface Category {
  key: CategoryKey;
  labelKey: string; // key i18n
  icon: string;
  extensions: string[];
}

export const CATEGORIES: Category[] = [
  {
    key: 'document',
    labelKey: 'cat.document',
    icon: 'description',
    extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt', 'csv'],
  },
  {
    key: 'image',
    labelKey: 'cat.image',
    icon: 'image',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'tiff', 'ico'],
  },
  {
    key: 'video',
    labelKey: 'cat.video',
    icon: 'movie',
    extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm4v'],
  },
  {
    key: 'audio',
    labelKey: 'cat.audio',
    icon: 'music_note',
    extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  },
  {
    key: 'archive',
    labelKey: 'cat.archive',
    icon: 'folder_zip',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  },
  // "Khác": mọi file có đuôi KHÔNG thuộc các nhóm trên (gồm cả code, và đuôi lạ).
  { key: 'other', labelKey: 'cat.other', icon: 'insert_drive_file', extensions: [] },
];

/** Union đuôi của mọi nhóm ĐÃ BIẾT (trừ "Khác") — dùng để lọc lăng kính "Khác". */
export const NAMED_EXTENSIONS: string[] = CATEGORIES.filter((c) => c.key !== 'other').flatMap(
  (c) => c.extensions,
);

const EXT_TO_CATEGORY = new Map<string, CategoryKey>();
for (const c of CATEGORIES) for (const e of c.extensions) EXT_TO_CATEGORY.set(e, c.key);

export function categoryOf(extension: string): CategoryKey {
  return EXT_TO_CATEGORY.get(extension.toLowerCase()) ?? 'other';
}

export function iconOf(extension: string): string {
  const cat = CATEGORIES.find((c) => c.key === categoryOf(extension));
  return cat?.icon ?? 'insert_drive_file';
}

/** Đuôi file từ tên đầy đủ (VD "báo cáo.docx" -> "docx"; không có đuôi -> ""). */
export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(i + 1) : '';
}

export function categoryByKey(key: CategoryKey): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

export function formatBytes(bytes: number | string): string {
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const val = n / 1024 ** exp;
  return `${exp === 0 ? val : val.toFixed(1)} ${units[exp]}`;
}
