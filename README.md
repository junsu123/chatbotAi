# Mộc Tâm AI V1.0 — Node.js / Next.js / Docker

MVP cho Facebook Page Messenger: nhận webhook Meta, lưu hội thoại, worker AI, danh mục sản phẩm, quản lý Page và giao diện tiếng Việt.

## Cài đặt trên Debian/Ubuntu có Docker Compose

```bash
cp .env.example .env
nano .env
# Sửa POSTGRES_PASSWORD, DATABASE_URL, ADMIN_KEY, META_VERIFY_TOKEN.
# Mật khẩu POSTGRES_PASSWORD phải trùng mật khẩu trong DATABASE_URL.
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100
curl http://127.0.0.1:4000/health
```

Cổng 3000 và 4000 chỉ bind localhost để tránh công khai giao diện quản trị chưa hoàn thiện. Từ Windows, mở SSH tunnel (đã cài gcloud):

```powershell
gcloud compute ssh TEN_VM --zone=ZONE --project=PROJECT_ID -- -N -L 3000:127.0.0.1:3000 -L 4000:127.0.0.1:4000
```

Truy cập `http://localhost:3000`, nhập `ADMIN_KEY` trong `.env`.

## Thử nghiệm
1. Tại **Fanpage**, thêm Page ID giả (ví dụ `demo-page`) và bật AI.
2. Tại **Sản phẩm**, thêm tên và mô tả sản phẩm.
3. Vào **Thử nghiệm**, gửi tin nhắn; kiểm tra kết quả tại **Hộp thư**.
4. Nếu không có `OPENAI_API_KEY`, worker trả lời bằng tin nhắn demo. Nếu có API key, AI gọi OpenAI thật ngay cả trong chế độ demo.

## Kết nối Facebook thật
- Cần Meta App, quyền Messenger phù hợp, Page Access Token, và HTTPS công khai cho `/webhook`.
- `GET /webhook` xác minh `META_VERIFY_TOKEN`; `POST /webhook` kiểm tra chữ ký `X-Hub-Signature-256` dựa trên `META_APP_SECRET`.
- Thêm Page ID thật và Page Access Token qua Dashboard; bật AI sau khi kiểm tra kỹ.
- Chỉ gửi phản hồi trong phạm vi chính sách và cửa sổ tin nhắn Meta cho phép.

## Phạm vi và hạn chế bảo mật của V1.0
**Chỉ chạy trong môi trường nội bộ/qua SSH tunnel, chưa triển khai public.** MVP dùng khóa quản trị lưu trong sessionStorage, Page Token lưu trong DB chưa mã hóa, chưa có đăng nhập người dùng, RBAC, rate limit, chống lặp outbound khi retry sau khi Meta đã nhận, khóa xử lý theo hội thoại, gửi tin thủ công, hỗ trợ ảnh/đính kèm hoặc quản lý chi phí API. Trước production cần khắc phục các điểm này, thiết lập HTTPS và sao lưu DB. Không chia sẻ file `.env` hoặc token.

Lưu ý: nếu thay `NEXT_PUBLIC_API_URL` (địa chỉ API mà **trình duyệt** có thể truy cập), cần build lại image `web`: `sudo docker compose up -d --build web`. `NEXT_PUBLIC_API_URL=http://localhost:4000` là đúng khi dùng SSH tunnel có cả hai cổng.
