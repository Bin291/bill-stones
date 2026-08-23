/** Kiểu dữ liệu khớp với API (storage-api). */

export type FileStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'delete_pending';

export interface BreadcrumbCrumb {
  id: string;
  name: string;
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
}

export interface ExtensionStat {
  extension: string;
  count: number;
  totalSize: string;
}

export interface ListFilesQuery {
  folderId?: string | null;
  extensions?: string;
  sort?: 'name' | 'createdAt' | 'updatedAt' | 'size';
  order?: 'asc' | 'desc';
  starred?: boolean;
  withPath?: boolean;
}
