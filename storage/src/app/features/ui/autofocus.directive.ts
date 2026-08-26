import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/** Tự focus + bôi đen nội dung khi phần tử xuất hiện (đổi tên/tạo mới kiểu Explorer). */
@Directive({
  selector: '[appAutofocus]',
})
export class Autofocus implements AfterViewInit {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  ngAfterViewInit(): void {
    const node = this.el.nativeElement;
    // Chờ 1 nhịp để chắc chắn phần tử đã render + có thể focus.
    setTimeout(() => {
      node.focus();
      node.select?.();
    });
  }
}
