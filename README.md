# Mộc Tâm AI V2.0 Commercial

Nền tảng SaaS Facebook Messenger AI cho nhiều khách hàng. V2.0 có đăng ký/đăng nhập, phân quyền `SUPER_ADMIN` / `USER`, ví tín dụng, ledger giao dịch, gói nạp, duyệt nạp thủ công, tính phí AI theo token thực tế, Facebook OAuth theo từng user và OpenAI API Key do Super Admin quản lý.

## Điểm chính V2.0

- Không dùng `ADMIN_KEY` để đăng nhập nữa.
- Super Admin được tạo từ terminal bằng lệnh tương tác; mật khẩu không cần ghi vào source code.
- Mỗi user có Wallet riêng và chỉ thấy Page / hội thoại / sản phẩm của mình.
- Page Access Token và OpenAI API Key được mã hóa AES-256-GCM bằng `MASTER_ENCRYPTION_KEY`.
- Worker reserve credit trước khi gọi OpenAI, sau đó settle theo token usage thực tế.
- Hết credit thì không gọi OpenAI.
- Super Admin có thể cộng/trừ credit, khóa user, duyệt nạp, tạo gói credit, cấu hình model / giá token / tỷ giá / markup / minimum charge.
- Gói mặc định: 50k→50k, 100k→110k, 200k→230k, 500k→600k, 1tr→1.25tr credit.

## 1. Cập nhật server

```bash
cd ~/chatbotAi
git pull
```

## 2. Bổ sung cấu hình V2 vào `.env`

Giữ nguyên `DATABASE_URL`, `POSTGRES_PASSWORD`, Redis và Meta hiện tại. Thêm các biến sau:

```dotenv
MASTER_ENCRYPTION_KEY=YOUR_64_HEX_CHARACTER_KEY
SESSION_DAYS=30
COOKIE_SECURE=false
```

Tạo khóa mã hóa trên Linux:

```bash
openssl rand -hex 32
```

Dán kết quả 64 ký tự hex vào `MASTER_ENCRYPTION_KEY`.

Khi chạy production bằng HTTPS, đổi:

```dotenv
COOKIE_SECURE=true
PUBLIC_WEB_URL=https://ai.tenmiencuaban.com
CORS_ORIGIN=https://ai.tenmiencuaban.com
META_REDIRECT_URI=https://ai.tenmiencuaban.com/auth/facebook/callback
```

`OPENAI_API_KEY` trong `.env` không còn cần thiết ở V2.0. Super Admin nhập key trong Dashboard → OpenAI; key được mã hóa trước khi lưu database.

## 3. Build và cập nhật database

```bash
sudo docker compose build api
sudo docker compose up -d postgres redis
sudo docker compose run --rm api npx prisma db push
```

Schema V2 giữ các cột V1 cần thiết để nâng cấp an toàn. `ownerId` của Page cũ là nullable trong bước chuyển đổi; lệnh tạo Super Admin bên dưới sẽ nhận quyền sở hữu các Page V1 chưa có owner.

## 4. Tạo Super Admin từ terminal

Chạy:

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

Mật khẩu được hash bằng scrypt. Chạy lại cùng lệnh và cùng email nếu cần đổi mật khẩu Super Admin.

Lệnh này đồng thời:

- tạo Wallet cho Super Admin;
- seed cài đặt billing mặc định;
- seed 5 gói tín dụng mặc định;
- gán Page V1 chưa có chủ sở hữu cho Super Admin;
- xóa session cũ của tài khoản admin khi đổi mật khẩu.

## 5. Khởi động V2.0

```bash
sudo docker compose up -d
sudo docker compose ps
curl http://127.0.0.1:4000/health
```

API thành công sẽ trả phiên bản `2.0.0`.

Nếu đang dùng SSH tunnel:

```powershell
gcloud compute ssh TEN_VM --zone=ZONE --project=PROJECT_ID -- -N -L 3000:127.0.0.1:3000 -L 4000:127.0.0.1:4000
```

Mở `http://localhost:3000` và đăng nhập bằng tài khoản Super Admin vừa tạo.

## 6. Cấu hình OpenAI bằng Super Admin

Vào **OpenAI** trong sidebar và nhập:

- API Key;
- model;
- giá input USD / 1 triệu token;
- giá output USD / 1 triệu token;
- tỷ giá USD/VND;
- markup;
- minimum credit / lượt;
- max output tokens.

Mặc định V2 dùng `gpt-4.1-mini`, input `0.40 USD / 1M`, output `1.60 USD / 1M`, tỷ giá `25,910`, markup `3.5`, minimum `20 credit` và max output `400` token. Tất cả đều đổi được từ Dashboard, không cần sửa code.

## 7. Cơ chế billing

Worker thực hiện:

```text
Tin Messenger
  → kiểm tra Page + user
  → tính reserve theo context và max output
  → trừ balance, chuyển sang reserved
  → gọi OpenAI
  → đọc prompt_tokens / completion_tokens
  → tính giá vốn VND
  → nhân markup, áp minimum charge
  → hoàn phần reserve dư hoặc trừ phần thiếu
  → ghi AiUsage + CreditTransaction
  → gửi trả lời qua Facebook
```

Nếu không đủ credit, Worker không gọi OpenAI và ghi thông báo hệ thống vào hội thoại.

## 8. Nạp credit V2.0

V2.0 hiện triển khai luồng thương mại giai đoạn đầu:

1. User chọn gói và tạo yêu cầu nạp.
2. Hệ thống sinh `paymentCode`.
3. Super Admin kiểm tra thanh toán thực tế.
4. Vào **Duyệt nạp** → **Duyệt**.
5. Hệ thống dùng transaction database để đổi trạng thái order và cộng credit đúng một lần.

Bước tiếp theo có thể tích hợp payOS / VietQR để webhook tự duyệt order. Không nên bật auto-credit trước khi có xác minh chữ ký webhook và idempotency theo transaction ID.

## 9. Facebook OAuth

User vào **Fanpage → Kết nối với Facebook**. OAuth state chứa user ID đã ký HMAC nên callback biết Page thuộc khách hàng nào. Nếu một Facebook Page đã thuộc user khác, hệ thống không tự cướp quyền sở hữu Page đó.

Production cần public HTTPS:

```text
https://ai.tenmiencuaban.com/auth/facebook/callback
https://ai.tenmiencuaban.com/webhook
```

và Meta App phải có các quyền Page/Messenger phù hợp.

## 10. Lưu ý production

Trước khi bán rộng rãi nên hoàn thiện thêm: domain + HTTPS reverse proxy, backup PostgreSQL tự động, email verification / password reset, rate limit phân tán qua Redis, audit log quản trị, thanh toán tự động có xác minh webhook, monitoring, chính sách hoàn tiền, điều khoản sử dụng và cơ chế bảo vệ dữ liệu khách hàng.

Không commit `.env`, `MASTER_ENCRYPTION_KEY`, Meta App Secret, Page Token hoặc OpenAI API Key lên GitHub.
