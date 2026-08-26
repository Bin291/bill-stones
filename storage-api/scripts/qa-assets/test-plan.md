# AI Search — Test Plan (QA)

Bộ kiểm thử cho tính năng Hybrid AI Search (Text + Image), mục 8.E. Chuyển thể
từ đề xuất test-suite của người dùng, điều chỉnh theo đúng kiến trúc thực tế
đang chạy (xem `search.service.ts`).

## 1. Hệ thống dưới test (SUT)

- 3 nhánh song song, hợp nhất bằng Reciprocal Rank Fusion (RRF):
  - **dense**: BazaarLink/Gemini text-embedding (768d) — ngữ nghĩa tổng quát.
  - **bge**: BAAI/bge-m3 qua HuggingFace (1024d) — ngữ nghĩa đa ngôn ngữ.
  - **fts**: Postgres tsvector + unaccent — khớp từ khoá chính xác (tên file +
    nội dung), accent-insensitive.
- Ảnh: không có nhánh embedding ảnh riêng (CLIP/SigLIP không còn được HF
  Inference Providers host serverless — xem `HYBRID_SEARCH.md` §4.2). Thay
  vào đó, Gemini vision sinh caption (OCR + MÔ TẢ + TỪ KHOÁ tiếng Việt +
  KEYWORDS EN) rồi caption chảy vào pipeline text bình thường.
- PDF: `pdf-parse` trích text layer; nếu PDF có bảng/hình dán dạng ảnh raster
  (không đọc được bằng text layer), bổ sung bằng cách gửi cả file cho Gemini
  vision đọc bảng/biểu đồ (1 lần/file lúc index).
- Kết quả bị lọc theo ngưỡng cosine (MIN_DENSE_STRONG=0.6, MIN_BGE_STRONG=0.65,
  hoặc đồng thuận 2 nhánh MIN_DENSE_JOINT=0.45 + MIN_BGE_JOINT=0.55) trừ khi
  có FTS hit (luôn giữ). Sau đó rerank bằng cross-encoder BAAI/bge-reranker-v2-m3
  (best-effort).
- **Phạm vi**: search luôn lọc theo `userId` — 1 user không bao giờ thấy kết
  quả của user khác (test suite này chạy trong 1 tài khoản test cô lập).

## 2. Dữ liệu test (Test Data)

| # | File | Loại | Nội dung chính |
|---|------|------|----------------|
| 1 | `meme_banana.png` | Ảnh (minh hoạ, không phải ảnh phim thật — tránh vi phạm bản quyền) | Người đàn ông cầm quả chuối vàng chĩa vào thái dương, miệng há hét, nền tối |
| 2 | `screenshot_code.png` | Ảnh (canvas render) | Screenshot code React/Next.js thật (component, hook, JSX) |
| 3 | `receipt_invoice.png` | Ảnh (canvas render) | Hoá đơn tiền điện: mã hoá đơn, các dòng chi tiết, tổng tiền |
| 4 | `red_car_banner.png` | Ảnh (minh hoạ vector) | Xe hơi màu đỏ trên đường phố ban đêm, đèn đường, ánh sáng neon |
| 5 | `infographic_ai.png` | Ảnh (canvas render) | Biểu đồ cột + chú thích ngắn về xu hướng ứng dụng AI |
| 6 | `baocao_taichinh_2025.txt` | Văn bản | Doanh thu, chi phí, "lợi nhuận gộp" |
| 7 | `system_architecture.md` | Văn bản | Saga Pattern, Outbox Pattern, Supabase, Redis |
| 8 | `danhsach_sinhvien.csv` | Văn bản | Tên, MSSV, điểm số |
| 9 | `env_config.txt` | Văn bản | Biến môi trường dạng key=value (giá trị giả) |

## 3. Ma trận từ khoá (Test Query Matrix)

| Nhóm | Query | Kỳ vọng | Mục đích |
|---|---|---|---|
| 1. Visual (đối tượng/màu) | `chuối` | meme_banana.png | Nhận diện đối tượng |
| 1 | `quả chuối màu vàng` | meme_banana.png | Đối tượng + thuộc tính màu |
| 1 | `xe hơi đỏ ban đêm` | red_car_banner.png | Đối tượng + màu + bối cảnh |
| 2. OCR trong ảnh | (1 dòng code đặc trưng, vd tên hook `useEffect`) | screenshot_code.png | Đọc chữ trong ảnh |
| 2 | `tổng tiền` | receipt_invoice.png | Trích số/chữ nhỏ trong hoá đơn |
| 2 | `mã hoá đơn` | receipt_invoice.png | Trích nhãn trong hoá đơn |
| 3. Ngữ nghĩa/cảm xúc | `phẫn nộ`, `hét lớn` | meme_banana.png | Tìm theo cảm xúc biểu cảm |
| 3 | `meme hài hước` | meme_banana.png | Tìm theo thể loại |
| 3 | `kiến trúc hệ thống`, `cơ sở dữ liệu` | system_architecture.md | Tìm tài liệu theo chủ đề |
| 3 | `lợi nhuận gộp` | baocao_taichinh_2025.txt | Tìm theo thuật ngữ tài chính |
| 4. Đa ngôn ngữ/kỹ thuật | `banana` | meme_banana.png | EN query -> nội dung VI (nhờ KEYWORDS EN) |
| 4 | `red car night` | red_car_banner.png | EN query -> nội dung VI |
| 4 | `Saga Pattern` | system_architecture.md | Thuật ngữ kỹ thuật khớp chính xác |
| 4 | `Supabase Redis` | system_architecture.md | Thuật ngữ kỹ thuật khớp chính xác |
| Bổ sung | tên 1 sinh viên trong CSV | danhsach_sinhvien.csv | FTS trên dữ liệu bảng/CSV |
| Bổ sung | 1 key trong env_config.txt | env_config.txt | FTS trên định dạng key=value |

## 4. Tiêu chí Pass/Fail

- **Pass**: file kỳ vọng xuất hiện trong `results`, **top-3** (không bắt buộc
  top-1 cho query gián tiếp/đa ngôn ngữ — RRF không đảm bảo thứ tự tuyệt đối
  giữa các nhánh khi điểm gần nhau).
- **Fail**: file kỳ vọng không xuất hiện trong top-10, hoặc endpoint lỗi.
- Ghi lại `similarity` (%) và `matchedBy` (`dense`/`bge`/`fts`) cho mỗi kết
  quả pass — dùng để đánh giá nhánh nào thực sự đóng góp.
- Thời gian phản hồi: ghi nhận (không đặt ngưỡng cứng — embedding + rerank
  qua API ngoài vốn dao động theo cold-start của provider).

## 5. Edge cases (độ bền — robustness)

| Edge case | Query ví dụ | Kỳ vọng |
|---|---|---|
| Không dấu | `xe hoi do ban dem` | Vẫn ra `red_car_banner.png` (unaccent FTS + dense/bge không nhạy dấu) |
| Sai chính tả nhẹ | `chuois` (thừa s), `chuoi` (thiếu dấu) | Dense/bge vẫn có thể ra do embedding chịu lỗi chính tả nhẹ — không đảm bảo FTS |
| Leet-speak số/chữ trộn | (không áp dụng cho bộ file này — đã test riêng ở `e2e-hybrid-search-test.js` với "s0 7") | — |
| Từ đồng nghĩa | `xe ô tô` thay vì `xe hơi` | Cùng nghĩa — kỳ vọng dense/bge vẫn khớp `red_car_banner.png` |
| Từ lóng/thông tục | `quả chuối` vs `trái chuối` (2 vùng miền) | Cả 2 nên ra cùng 1 kết quả nếu Gemini caption dùng 1 trong 2 — đây là điểm CÓ THỂ fail, cần ghi nhận |
| Nhiễu (precision) | `màu vàng` (chung chung) | Có thể match NHIỀU ảnh có tông vàng (banana, infographic có màu vàng...) — không phải bug, nhưng cần xem thứ hạng có hợp lý không |

## 6. Cách chạy

Script tự động: `scripts/e2e-qa-test-suite.js` — tạo user test riêng, upload
9 file trên, chờ index, chạy toàn bộ ma trận câu 3, in bảng pass/fail +
similarity/matchedBy, dọn dẹp (xoá file + user test) khi xong.
