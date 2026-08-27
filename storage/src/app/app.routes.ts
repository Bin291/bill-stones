import { Routes } from '@angular/router';
import { authGuard, guestGuard, rootGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  // Trang chủ công khai: đã đăng nhập -> /files; chưa thì hiển thị Landing ngay tại '/'.
  {
    path: '',
    pathMatch: 'full',
    canActivate: [rootGuard],
    loadComponent: () => import('./features/landing/landing').then((m) => m.Landing),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
  },
  // Callback Magic Link / OAuth — KHÔNG guard (chưa có session lúc quay lại)
  {
    path: 'auth/callback',
    loadComponent: () => import('./features/auth/callback/callback').then((m) => m.AuthCallback),
  },
  // Đặt lại mật khẩu (đích của liên kết trong email) — KHÔNG guard
  {
    path: 'auth/reset',
    loadComponent: () => import('./features/auth/reset/reset').then((m) => m.AuthReset),
  },
  // Trang công khai — ngoài authGuard (mục 12.F)
  {
    path: 's/:token',
    loadComponent: () =>
      import('./features/public-share/public-share').then((m) => m.PublicShare),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/main-layout/main-layout').then((m) => m.MainLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'files' },
      // Lăng kính Thư mục (mục 11.H) — trang chủ "My Storage" (mục 11.P)
      {
        path: 'files',
        loadComponent: () =>
          import('./features/file-explorer/file-explorer').then((m) => m.FileExplorer),
        data: { mode: 'folder' },
      },
      {
        path: 'files/folder/:folderId',
        loadComponent: () =>
          import('./features/file-explorer/file-explorer').then((m) => m.FileExplorer),
        data: { mode: 'folder' },
      },
      // Lăng kính Loại (mục 11.H)
      {
        path: 'type/:category',
        loadComponent: () =>
          import('./features/file-explorer/file-explorer').then((m) => m.FileExplorer),
        data: { mode: 'type' },
      },
      // Lăng kính Thẻ (tag tuỳ chỉnh)
      {
        path: 'tag/:tagId',
        loadComponent: () =>
          import('./features/file-explorer/file-explorer').then((m) => m.FileExplorer),
        data: { mode: 'tag' },
      },
      {
        path: 'starred',
        loadComponent: () =>
          import('./features/file-explorer/file-explorer').then((m) => m.FileExplorer),
        data: { mode: 'starred' },
      },
      {
        path: 'recent',
        loadComponent: () =>
          import('./features/file-explorer/file-explorer').then((m) => m.FileExplorer),
        data: { mode: 'recent' },
      },
      // Tìm kiếm AI (mục 11.P — lối tắt sidebar)
      {
        path: 'search',
        loadComponent: () => import('./features/search/search').then((m) => m.Search),
      },
      {
        path: 'shared',
        loadComponent: () => import('./features/shared/shared-page').then((m) => m.SharedPage),
      },
      {
        path: 'trash',
        loadComponent: () => import('./features/trash/trash').then((m) => m.Trash),
      },
      // Hồ sơ + Cài đặt đã gộp làm 1 trang (tab). '/profile' giữ lại để không hỏng
      // link/bookmark cũ, chuyển thẳng vào tab Hồ sơ.
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
      {
        path: 'profile',
        pathMatch: 'full',
        redirectTo: 'settings',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
