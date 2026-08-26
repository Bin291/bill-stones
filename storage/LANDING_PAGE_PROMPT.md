# Prompt: Redesign trang Landing (BillPrime)

Copy toàn bộ nội dung dưới đây, dán cho Claude (Claude Code / claude.ai) để nó
thiết kế + code lại trang landing.

---

## Bối cảnh dự án

Đây là Angular 20+ standalone app tên **BillPrime** — app lưu trữ file cá
nhân (kiểu Google Drive) với tính năng nổi bật nhất là **AI Hybrid Search**:
tìm file bằng ngôn ngữ tự nhiên, đọc được cả OCR trong ảnh, bảng biểu trong
PDF, và tìm được bằng tiếng Anh lẫn tiếng Việt dù nội dung gốc là tiếng Việt.
Đây chính là điểm bán hàng (USP) — landing page phải làm nổi bật tính năng
này chứ không chỉ nói chung chung "lưu trữ đám mây".

Trang landing hiện tại nằm ở `src/app/features/landing/landing.ts` +
`landing.html` + `landing.css`, đã có sẵn 1 section con là **Bento Shutter**
(`features/landing/bento-shutter/`) — 1 lưới thẻ bento với hiệu ứng "shutter"
khi cuộn tới, dùng GSAP. **Giữ nguyên component này, chỉ chèn nó vào đúng vị
trí trong bố cục section mới**, không viết lại từ đầu.

## Định hướng thẩm mỹ (tham khảo ảnh đính kèm — landing "Sift")

- Nền tối (navy/đen ánh tím, gradient rất nhẹ, không phẳng lì).
- 1 quầng sáng gradient tím/xanh lam mờ phía sau headline (radial glow),
  không dùng ảnh nền, dựng bằng CSS gradient.
- Chữ tiêu đề to, trắng, một cụm từ trong tiêu đề được tô màu tím sáng
  (accent) để nhấn — không in đậm cả câu.
- 2 nút CTA cạnh nhau: nút chính nền tím đặc (filled), nút phụ viền mỏng nền
  trong suốt (outline).
- Điểm nhấn quan trọng nhất: **1 "search demo card"** nổi giữa hero, mô
  phỏng trực tiếp tính năng AI Search thật của app — 1 thanh input với gợi ý
  đang gõ dở, bên dưới là 2-3 dòng kết quả (icon loại file + tên file + dòng
  mô tả ngắn khớp lý do tìm ra + % khớp bên phải, dòng đang được hover/chọn
  sáng hơn). Đây không phải trang trí — đây là bằng chứng sản phẩm hoạt động
  thật, nên nội dung demo phải match with UX thật của trang `/search` hiện
  tại (badge % + `matchedBy`).
- Toàn bộ giao diện phẳng, bo góc vừa phải (12-16px), không đổ bóng nặng.

## Bố cục trang (nhiều section, theo thứ tự)

1. **Top Nav** (đã có) — logo bên trái, giữa là các link (Tính năng, Bảo
   mật, Bảng giá), bên phải **"Đăng nhập"** (link) + **"Dùng thử miễn phí"**
   (nút nổi bật). Sticky khi cuộn, nền mờ dần (backdrop-blur) khi qua khỏi
   hero.
2. **Hero** — headline 2 dòng theo tinh thần "Lưu mọi thứ — AI tìm ra tất
   cả", dòng phụ nêu rõ 3 khả năng thật: đọc chữ trong ảnh (OCR), đọc được
   cả bảng số liệu ẩn trong PDF dạng ảnh chụp, tìm bằng tiếng Anh dù nội
   dung gốc tiếng Việt. 2 CTA + search demo card mô tả ở trên.
3. **Dải tính năng ngắn** — 3-4 thẻ nhỏ, mỗi thẻ 1 icon + tiêu đề ngắn + 1
   câu mô tả: "Tìm theo ý nghĩa, không cần đúng từ", "Đọc chữ trong ảnh &
   PDF", "Tìm được bằng cả tiếng Anh lẫn tiếng Việt", "Riêng tư theo từng
   tài khoản — không ai thấy file của bạn".
4. **Cách hoạt động** — 3 bước dạng timeline ngang hoặc dọc: (1) Tải file
   lên bình thường như Drive, (2) AI tự đọc & lập chỉ mục nội dung ở nền,
   (3) Gõ câu hỏi tự nhiên, tìm ra ngay. Có 1 đường nối SVG chạy giữa 3 mốc.
5. **Bento Shutter** (component có sẵn) — chèn nguyên component, không sửa
   logic bên trong, chỉ style margin/khoảng cách cho khớp nhịp cuộn tổng
   thể.
6. **Bảo mật & riêng tư** — 1 đoạn ngắn + icon khoá: dữ liệu cô lập theo
   user (Row Level Security), không có tìm kiếm chéo giữa các tài khoản.
7. **CTA cuối trang** — lặp lại lời kêu gọi hành động ở quy mô lớn hơn, có
   nút **"Đăng nhập"** / **"Tạo tài khoản miễn phí"** nổi bật (đây là yêu cầu
   bắt buộc: phải có lối vào đăng nhập cả ở ĐẦU trang [Top Nav] lẫn CUỐI
   trang [section này], không chỉ 1 chỗ).
8. **Footer** — logo, vài link phụ, copyright.

## Yêu cầu bắt buộc: MỖI section đều phải có scroll animation

Nghiên cứu kỹ thuật (đã tổng hợp sẵn, dùng luôn không cần research lại):

- **Nền tảng**: GSAP + plugin `ScrollTrigger` để bind animation vào tiến độ
  cuộn (`scrub: true` hoặc `scrub: 1`), không dùng animation tự chạy độc lập
  với cuộn.
- **Làm mượt cuộn**: dùng thư viện **Lenis** (nhẹ, phổ biến nhất hiện nay)
  làm nền tảng smooth-scroll toàn trang trước, rồi mới gắn GSAP lên trên —
  tránh giật khi các section có animation nặng.
- **Từng loại hiệu ứng theo section**:
  - Hero: chữ + CTA fade-up khi load trang (không cần chờ scroll); riêng
    search-demo-card có hiệu ứng float nhẹ liên tục (không phụ thuộc
    scroll) + khi cuộn qua, quầng sáng phía sau dịch chuyển nhẹ (parallax).
  - Dải tính năng: các thẻ fade-up so le (stagger) khi cuộn tới, dùng
    `ScrollTrigger.batch`.
  - Cách hoạt động: đường nối SVG vẽ dần bằng `stroke-dashoffset` chạy theo
    scroll (`scrub`), mỗi mốc bật sáng khi đường vẽ tới.
  - Bento Shutter: giữ nguyên hiệu ứng sẵn có của component.
  - Bảo mật: fade-up đơn giản + icon khoá có hiệu ứng "khoá lại" nhỏ khi
    section vào viewport.
  - CTA cuối: scale nhẹ từ 0.95 -> 1 kèm fade khi cuộn tới, tạo cảm giác
    "điểm nhấn kết thúc".
- **Container cuộn (Scroll Track) + Sticky Pinning**: chỉ dùng `pin: true`
  cho section thật sự cần "khoá màn hình" để diễn hoạt (ví dụ hero hoặc
  bước "cách hoạt động" nếu muốn hiệu ứng cầu kỳ hơn) — đừng lạm dụng pin
  cho mọi section vì sẽ gây cảm giác nặng nề.
- **Hiệu năng**: chỉ animate `transform` (translate/scale/rotate) và
  `opacity`. KHÔNG animate `width`/`height`/`margin` (gây reflow). Thêm
  `will-change: transform` cho phần tử đang animate.
- **Khả năng truy cập**: tôn trọng `prefers-reduced-motion` — khi user bật,
  tắt hết animation cuộn, hiển thị nội dung tĩnh đầy đủ ngay lập tức.

## Ràng buộc kỹ thuật (khớp coding convention hiện tại của repo)

- Angular 20+ standalone components (không set `standalone: true`, đó là
  mặc định).
- Dùng `input()`/`output()` thay vì decorator, `signal()`/`computed()` cho
  state, `ChangeDetectionStrategy.OnPush`.
- Không dùng `ngClass`/`ngStyle` — dùng class/style binding trực tiếp.
- Ảnh tĩnh dùng `NgOptimizedImage`.
- Phải pass AXE checks + WCAG AA (tương phản màu, focus visible, ARIA khi
  cần).
- GSAP đã là thói quen sẵn có trong repo (xem `bento-shutter.ts`) — tiếp
  tục dùng GSAP + `ScrollTrigger`, thêm `lenis` nếu cần smooth-scroll toàn
  trang (kiểm tra xem đã có trong `package.json` chưa trước khi thêm mới).

## Việc CẦN làm

1. Thiết kế lại `landing.html`/`landing.css`/`landing.ts` theo đúng bố cục
   8 section ở trên, giữ nguyên component Bento Shutter.
2. Viết animation cuộn cho từng section theo đúng mô tả ở mục "Yêu cầu bắt
   buộc" — không được để section nào đứng yên khi cuộn tới.
3. Nội dung chữ viết bằng tiếng Việt, giọng văn tự nhiên, không sến, không
   dịch máy — tham khảo văn phong hiện có trong `core/i18n/dictionaries.ts`.
4. Không tự ý đổi cấu trúc route (`/landing`) hay các link Đăng nhập/Đăng ký
   đang trỏ tới `/login`, `/register`.
