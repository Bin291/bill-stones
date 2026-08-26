# Kiến trúc hệ thống — Order Service

## Tổng quan

Order Service là một microservice chịu trách nhiệm xử lý đơn hàng trong hệ
thống thương mại điện tử. Dịch vụ giao tiếp với Payment Service và Inventory
Service qua message queue, đảm bảo tính nhất quán dữ liệu giữa các service
độc lập mà không cần transaction phân tán kiểu 2-phase-commit.

## Saga Pattern

Để xử lý transaction xuyên nhiều service, hệ thống áp dụng **Saga Pattern**
theo mô hình choreography: mỗi service tự phát sự kiện khi hoàn tất bước của
mình, các service khác lắng nghe và phản ứng. Nếu một bước thất bại (ví dụ
Inventory Service báo hết hàng), Saga sẽ kích hoạt các bước bù trừ
(compensating transaction) để hoàn tác các bước đã thực hiện trước đó, ví dụ
hoàn tiền đã trừ ở Payment Service.

## Outbox Pattern

Để đảm bảo việc ghi dữ liệu vào database và việc publish sự kiện lên message
queue diễn ra atomically, dịch vụ dùng **Outbox Pattern**: ghi sự kiện vào
bảng `outbox` trong CÙNG transaction với thay đổi dữ liệu nghiệp vụ, sau đó
một relay process riêng đọc bảng outbox và publish lên Kafka. Cách này tránh
được vấn đề dual-write (ghi DB thành công nhưng publish message thất bại).

## Cơ sở dữ liệu & lưu trữ

- **Supabase** (Postgres) làm datastore chính, dùng Row Level Security (RLS)
  để cô lập dữ liệu giữa các tenant.
- **Redis** dùng làm cache cho các truy vấn đọc nhiều (hot path), đồng thời
  làm backing store cho BullMQ job queue xử lý các tác vụ nền như gửi email
  xác nhận đơn hàng.

## Sơ đồ luồng

Client -> API Gateway -> Order Service -> (ghi DB + outbox trong 1
transaction) -> Outbox Relay -> Kafka -> Payment Service / Inventory
Service -> phản hồi qua event -> Order Service cập nhật trạng thái đơn hàng.
