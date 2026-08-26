import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

/** Chặn route khi chưa đăng nhập; chờ AuthService khôi phục session xong. */
export const authGuard: CanActivateFn = (_route, state) => {
  // DEV: bỏ qua đăng nhập (environment.bypassAuth) — vào thẳng mọi trang.
  if (environment.bypassAuth) return true;

  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.ready).pipe(
    filter((ready) => ready),
    take(1),
    map(() => {
      // Chỉ cho vào khi đã đăng nhập VÀ email đã xác thực (email_confirmed_at).
      if (auth.isAuthenticated() && auth.isEmailConfirmed()) return true;
      return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
    }),
  );
};

/** Ngược lại: đã đăng nhập thì không cho vào /login, /register. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return toObservable(auth.ready).pipe(
    filter((ready) => ready),
    take(1),
    map(() => (auth.isAuthenticated() ? router.createUrlTree(['/files']) : true)),
  );
};

/** Điều hướng trang chủ: đã đăng nhập -> /files; chưa thì hiển thị Landing ngay tại '/' (không redirect). */
export const rootGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return toObservable(auth.ready).pipe(
    filter((ready) => ready),
    take(1),
    map(() => {
      if (auth.isAuthenticated() && auth.isEmailConfirmed()) {
        return router.createUrlTree(['/files']);
      }
      return true;
    }),
  );
};
