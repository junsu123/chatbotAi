# Mộc Tâm AI V1.1 — Facebook Messenger + OpenAI

Web app Node.js / Next.js / PostgreSQL / Redis / Docker cho Facebook Page Messenger. V1.1 bổ sung **Facebook OAuth**: quản trị viên Page chỉ cần bấm **Kết nối với Facebook**, đăng nhập và cấp quyền; hệ thống tự lấy Page ID, tên Page và Page Access Token rồi lưu vào database.

## Chạy bằng Docker

```bash
cp .env.example .env
nano .env
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose up -d
sudo docker compose ps
curl http://127.0.0.1:4000/health
```

API, worker và web dùng chung image `chatbotai-app:latest` để giảm dung lượng build.

## Các biến môi trường chính

```dotenv
DATABASE_URL=postgresql://moc:YOUR_DB_PASSWORD@postgres:5432/mocai?schema=public
POSTGRES_PASSWORD=YOUR_DB_PASSWORD
REDIS_URL=redis://redis:6379
ADMIN_KEY=YOUR_LONG_ADMIN_KEY

META_APP_ID=YOUR_META_APP_ID
META_APP_SECRET=YOUR_META_APP_SECRET
META_VERIFY_TOKEN=YOUR_WEBHOOK_VERIFY_TOKEN
META_OAUTH_STATE_SECRET=YOUR_LONG_RANDOM_OAUTH_SECRET
META_REDIRECT_URI=https://ai.example.com/auth/facebook/callback
META_OAUTH_SCOPES=pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement
META_GRAPH_VERSION=v23.0
PUBLIC_WEB_URL=http://localhost:3000

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
DEMO_MODE=true
NEXT_PUBLIC_API_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:3000
```

`META_REDIRECT_URI` phải khớp chính xác redirect URI đã cấu hình trong Meta App. Khi kết nối Facebook thật, callback OAuth và `/webhook` cần được Meta truy cập qua **HTTPS công khai**.

## Facebook OAuth V1.1

Luồng sử dụng:

1. Người dùng mở **Fanpage → Kết nối với Facebook**.
2. Backend tạo Facebook OAuth URL có `state` ký HMAC và thời hạn 15 phút.
3. Người dùng đăng nhập Facebook và cấp quyền Page.
4. Meta redirect về `/auth/facebook/callback`.
5. Backend đổi authorization code lấy User Access Token, thử đổi sang long-lived token, gọi `/me/accounts` để lấy các Page quản lý.
6. Backend lưu Page ID, tên Page và Page Access Token vào PostgreSQL.
7. Backend thử subscribe từng Page vào webhook `messages,messaging_postbacks`.
8. Dashboard tự tải lại danh sách Page. Các Page mới được nhập ở trạng thái AI tắt; bật AI sau khi kiểm tra.

Các scope mặc định: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`. Tùy loại Meta App và đối tượng người dùng, các quyền này có thể cần Advanced Access/App Review trước khi người ngoài vai trò App có thể sử dụng.

## Cấu hình Meta App

Trong Meta for Developers:

- Tạo/chọn App phù hợp với Facebook Login và Messenger.
- Lấy **App ID** và **App Secret** đưa vào `.env`.
- Thêm OAuth Redirect URI chính xác, ví dụ `https://ai.tenmien.com/auth/facebook/callback`.
- Cấu hình Messenger Webhook, ví dụ `https://ai.tenmien.com/webhook`, với Verify Token bằng `META_VERIFY_TOKEN`.
- Cấp/được phê duyệt các quyền Page cần thiết.

Không yêu cầu người dùng cuối vào Graph API Explorer hay tự copy Page Access Token.

## Truy cập nội bộ bằng SSH tunnel

Docker mặc định chỉ bind localhost:

- Web: `127.0.0.1:3000`
- API: `127.0.0.1:4000`

Trên Windows có Google Cloud CLI:

```powershell
gcloud compute ssh TEN_VM --zone=ZONE --project=PROJECT_ID -- -N -L 3000:127.0.0.1:3000 -L 4000:127.0.0.1:4000
```

Sau đó mở `http://localhost:3000`.

Lưu ý: SSH tunnel đủ để quản trị dashboard, nhưng **không đủ cho Facebook OAuth/Webhook**, vì Meta cần callback HTTPS công khai. Hãy dùng Nginx/Caddy + domain + TLS cho phần `/auth/facebook/callback` và `/webhook`.

## Bảo mật / giới hạn MVP

V1.1 vẫn là MVP. `ADMIN_KEY` được lưu trong sessionStorage phía trình duyệt, Page Access Token đang lưu plaintext trong database, chưa có RBAC/user accounts, token encryption-at-rest, rate limit, audit log và cơ chế refresh/re-auth hoàn chỉnh. Trước production cần bổ sung các lớp này và sao lưu PostgreSQL.

Không commit `.env`, App Secret, Page Access Token hoặc OpenAI API Key lên GitHub.
