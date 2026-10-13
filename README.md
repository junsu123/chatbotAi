# Mộc Tâm AI V2.1 Commercial

Nền tảng SaaS Facebook Messenger AI cho nhiều khách hàng. V2.1 thay mô hình **ví / credit** của V2.0 bằng **gói thuê bao + AI Usage Quota + add-on lượt AI**.

Người dùng không có số dư tiền, không nạp tiền vào ví, không rút/chuyển tiền. Họ mua một gói dịch vụ có thời hạn và hạn mức AI Unit. Mỗi AI Unit là đơn vị quyền sử dụng dịch vụ, hết hiệu lực theo kỳ thuê bao.

## Tính năng V2.1

- Đăng ký / đăng nhập bằng session HttpOnly.
- Phân quyền `SUPER_ADMIN` / `USER`.
- Super Admin được tạo bằng lệnh terminal, không hard-code mật khẩu.
- Multi-tenant: mỗi user chỉ thấy Page, hội thoại và sản phẩm của mình.
- Facebook OAuth: user đăng nhập Facebook, hệ thống tự lấy Page Access Token.
- Page Access Token và OpenAI API Key mã hóa AES-256-GCM.
- Gói thuê bao có: giá VND, AI Unit, số ngày, giới hạn Fanpage bật AI.
- Add-on chỉ bổ sung AI Unit vào kỳ thuê bao đang hoạt động.
- Worker reserve AI Unit trước khi gọi OpenAI và settle theo token usage thực tế.
- Hết gói / hết quota thì không gọi OpenAI.
- Super Admin không bị giới hạn quota nhưng chi phí OpenAI vẫn được ghi nhận để theo dõi.
- Đơn dịch vụ có trạng thái `PENDING / PAID / CANCELLED`; giai đoạn đầu Super Admin xác nhận thanh toán thủ công.
- Không triển khai chức năng rút tiền, chuyển tiền hoặc số dư tiền người dùng.

## Bảng giá mặc định

### Thuê bao 30 ngày

| Gói | Giá | AI Unit | Fanpage bật AI |
|---|---:|---:|---:|
| Mini | 99.000đ | 3.000 | 1 |
| Shop | 199.000đ | 8.000 | 3 |
| Pro | 399.000đ | 20.000 | 10 |
| Business | 799.000đ | 50.000 | 30 |

### Add-on

| Add-on | Giá | AI Unit |
|---|---:|---:|
| Add-on 2.000 | 59.000đ | 2.000 |
| Add-on 5.000 | 129.000đ | 5.000 |
| Add-on 10.000 | 229.000đ | 10.000 |

Add-on hết hiệu lực cùng gói thuê bao hiện tại, không chuyển sang kỳ sau.

## Cách tính AI Unit

Mặc định:

```text
1 AI Unit / mỗi 2.500 token tổng (input + output)
tối thiểu 1 AI Unit / câu trả lời
tối đa 3 AI Unit / câu trả lời
```

Các giá trị này thay đổi được trong Dashboard Super Admin → OpenAI.

Worker thực hiện:

```text
Tin Messenger
  → kiểm tra thuê bao đang hoạt động
  → ước lượng và reserve AI Unit
  → gọi OpenAI
  → đọc token usage thực tế
  → quy đổi 1–N AI Unit
  → settle quota + hoàn phần reserve dư
  → ghi AiUsage + QuotaTransaction
  → gửi trả lời Facebook
```

Super Admin được bypass quota để quản trị/test nội bộ, nhưng token usage và chi phí OpenAI vẫn được ghi nhận.

## Nâng cấp từ V1 / V2.0

Schema V2.1 **giữ lại các bảng Wallet/Credit của V2.0 ở dạng legacy nhưng ứng dụng không dùng hoặc hiển thị chúng nữa**, nhằm tránh `prisma db push` tự động drop dữ liệu trong lúc nâng cấp. Có thể xóa các bảng legacy bằng migration riêng sau khi đã backup và xác nhận không còn cần dữ liệu cũ.

## 1. Cập nhật code

```bash
cd ~/chatbotAi
git pull
```

## 2. Cấu hình `.env`

Giữ `DATABASE_URL`, `POSTGRES_PASSWORD`, Redis và Meta hiện tại. Đảm bảo có:

```dotenv
MASTER_ENCRYPTION_KEY=YOUR_64_HEX_CHARACTER_KEY
SESSION_DAYS=30
COOKIE_SECURE=false
```

Tạo khóa mã hóa:

```bash
openssl rand -hex 32
```

Khi production có HTTPS:

```dotenv
COOKIE_SECURE=true
PUBLIC_WEB_URL=https://ai.tenmiencuaban.com
CORS_ORIGIN=https://ai.tenmiencuaban.com
META_REDIRECT_URI=https://ai.tenmiencuaban.com/auth/facebook/callback
```

OpenAI API Key không cần để trong `.env`; Super Admin nhập trong Dashboard → OpenAI.

## 3. Build nhanh bằng Docker cache

Dockerfile V2.1 được chia thành các stage độc lập để tránh build lại phần không thay đổi:

- `package*.json` không đổi → không chạy lại `npm install`;
- chỉ sửa `server/*` → không build lại Next.js và không chạy lại Prisma generate;
- chỉ sửa `prisma/*` → chỉ regenerate Prisma, web build vẫn dùng cache;
- chỉ sửa `web/*` → build lại Next.js nhưng vẫn dùng npm cache và `.next/cache` của BuildKit;
- API / worker / web tiếp tục dùng chung một image `chatbotai-app:latest`.

Build/deploy bình thường:

```bash
cd ~/chatbotAi
git pull
sudo docker compose build api
sudo docker compose up -d --no-build
```

Lần đầu sau khi đổi sang Dockerfile tối ưu vẫn có thể lâu vì cache chưa tồn tại. Từ lần thứ hai, các bước không đổi phải hiện `CACHED` và nhanh hơn rõ rệt.

**Không dùng thường xuyên** các lệnh sau vì chúng xóa cache và làm lần build kế tiếp chậm như build mới:

```bash
sudo docker compose build --no-cache api
sudo docker builder prune -af
sudo docker system prune -af
```

Chỉ prune khi ổ đĩa thực sự thiếu dung lượng. Có thể kiểm tra trước bằng:

```bash
df -h /
sudo docker system df
```

## 4. Nâng cấp database

```bash
sudo docker compose up -d postgres redis
sudo docker compose run --rm api npx prisma db push
```

Không dùng `--accept-data-loss` nếu Prisma cảnh báo xóa dữ liệu mà bạn chưa kiểm tra.

## 5. Tạo / cập nhật Super Admin

```bash
sudo docker compose run --rm api npm run admin:create
```

Terminal sẽ hỏi:

```text
Email admin:
Tên hiển thị [Super Admin]:
Mật khẩu (>=10 ký tự):
Nhập lại mật khẩu:
```

Lệnh này:

- tạo hoặc cập nhật Super Admin;
- xóa session cũ của tài khoản admin sau khi đổi mật khẩu;
- seed cài đặt OpenAI mặc định;
- seed 4 gói thuê bao + 3 add-on mặc định;
- gán Page cũ chưa có owner cho Super Admin;
- không tạo ví tiền.

## 6. Khởi động V2.1

```bash
sudo docker compose up -d --no-build
sudo docker compose ps
curl http://127.0.0.1:4000/health
```

Kết quả API phải có:

```json
{"ok":true,"service":"moc-tam-ai-api","version":"2.1.0"}
```

## 7. Cấu hình OpenAI

Đăng nhập Super Admin → **OpenAI** và cấu hình:

- API Key;
- model;
- input USD / 1M token;
- output USD / 1M token;
- tỷ giá USD/VND để theo dõi chi phí;
- max output tokens;
- token / 1 AI Unit;
- max AI Unit / một câu trả lời.

Giá token OpenAI trong dashboard chỉ dùng để theo dõi chi phí thật và biên lợi nhuận. Khách hàng mua gói dịch vụ theo AI Unit, không mua token hoặc số dư tiền.

## 8. Luồng mua dịch vụ

Giai đoạn đầu:

```text
User chọn gói
  → hệ thống tạo ServiceOrder + paymentCode
  → khách thanh toán theo hướng dẫn bán hàng
  → Super Admin kiểm tra tiền đã nhận
  → Đơn dịch vụ → Duyệt
  → hệ thống kích hoạt Subscription hoặc Add-on
```

Khi mua gói thuê bao mới, gói đang hoạt động được kết thúc và gói mới có hiệu lực ngay. Add-on chỉ có thể kích hoạt khi user đang có thuê bao hoạt động.

Sau này có thể tích hợp payOS/VNPay/VietQR để xác nhận đơn tự động. Payment webhook phải kiểm tra chữ ký và idempotency trước khi tự kích hoạt dịch vụ.

## 9. Quản trị khách hàng

Super Admin có thể:

- khóa / mở user;
- gán gói thuê bao thủ công;
- cộng AI Unit bổ sung vào gói hiện tại;
- trừ AI Unit bổ sung đã cấp trước đó;
- duyệt / hủy đơn dịch vụ;
- tạo, ẩn, sửa gói;
- xem doanh thu đơn đã duyệt;
- xem chi phí OpenAI thực tế và số AI Unit đã sử dụng.

## 10. Facebook OAuth

User vào **Fanpage → Kết nối với Facebook**. Production cần public HTTPS:

```text
https://ai.tenmiencuaban.com/auth/facebook/callback
https://ai.tenmiencuaban.com/webhook
```

Meta App cần các quyền Page/Messenger phù hợp và có thể cần App Review / Advanced Access trước khi khách hàng ngoài vai trò App sử dụng.

## 11. Trước khi bán rộng rãi

Cần hoàn thiện thêm: domain + HTTPS reverse proxy, backup PostgreSQL tự động, email verification/password reset, rate limit qua Redis, audit log quản trị, payment webhook có chữ ký, monitoring, chính sách hoàn tiền, điều khoản sử dụng và chính sách bảo vệ dữ liệu.

Không commit `.env`, `MASTER_ENCRYPTION_KEY`, Meta App Secret, Page Token hoặc OpenAI API Key lên GitHub.
