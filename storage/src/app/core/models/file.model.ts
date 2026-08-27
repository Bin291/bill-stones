/** Kiểu dữ liệu khớp với API (storage-api). */

export type FileStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'delete_pending';

export interface BreadcrumbCrumb {
  id: string;
  name: string;
}

/** Thẻ (tag) tuỳ chỉnh — kiểu Finder: tên + màu. */
export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string; // "#rrggbb"
  createdAt: string;
  updatedAt: string;
}

/** Thẻ kèm số file đang gắn (dùng cho sidebar/quản lý). */
export interface TagWithCount extends Tag {
  fileCount: number;
}

export interface StoredFile {
  id: string;
  name: string;
  extension: string;
  r2Key: string;
  thumbnailUrl: string | null;
  size: string; // BigInt -> string
  mimeType: string;
  userId: string;
  folderId: string | null;
  status: FileStatus;
  hlsStatus: 'processing' | 'ready' | 'failed' | null;
  errorMessage: string | null;
  isStarred: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Chỉ có khi list ở lăng kính Loại (withPath=true)
  folderPath?: BreadcrumbCrumb[];
  // Thẻ đang gắn cho file (luôn kèm khi list).
  tags?: Tag[];
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  userId: string;
  isStarred: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Chỉ có khi list ở lăng kính Gắn sao (starred=true).
  folderPath?: BreadcrumbCrumb[];
  // Thẻ đang gắn cho thư mục (luôn kèm khi list).
  tags?: Tag[];
}

export interface ExtensionStat {
  extension: string;
  count: number;
  totalSize: string;
}

export interface ListFilesQuery {
  folderId?: string | null;
  extensions?: string;
  excludeExtensions?: string;
  tagId?: string;
  sort?: 'name' | 'createdAt' | 'updatedAt' | 'size';
  order?: 'asc' | 'desc';
  starred?: boolean;
  withPath?: boolean;
}
