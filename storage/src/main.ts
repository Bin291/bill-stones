import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Cấm kéo (drag) MỌI THỨ ra khỏi trang — ảnh, thẻ file/folder, văn bản chọn…
// Không ảnh hưởng khu vực kéo-thả để TẢI LÊN: đó là 'drop'/'dragover' cho tệp
// kéo từ NGOÀI trình duyệt vào (OS file drag), khác hẳn 'dragstart' (chỉ phát
// sinh khi kéo 1 phần tử NẰM SẴN trong trang) — app cũng không dùng 'dragstart'
// cho bất kỳ tính năng nội bộ nào nên chặn toàn bộ là an toàn.
document.addEventListener('dragstart', (e) => e.preventDefault());

// Chặn menu chuột phải MẶC ĐỊNH của trình duyệt ở MỌI nơi (ảnh, link, vùng
// trống…) — TRỪ chuột phải vào thẻ file/folder: nơi đó đã có menu tuỳ biến
// riêng và tự gọi stopPropagation() nên sự kiện không lọt tới đây.
document.addEventListener('contextmenu', (e) => e.preventDefault());

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
