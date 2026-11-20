# Smart Parking — nhóm 22

Code theo proposal: ESP32, 3 HC-SR04 A1–A3, servo SG90, DHT11 và buzzer; Node-RED Dashboard, HiveMQ, Supabase, Gemini và Gmail SMTP.

## Chạy

Yêu cầu Node.js 22 trở lên. Chạy `npm install`, cấu hình `.env` dựa trên `.env.example`, sau đó `npm run check` và `npm start`.

- Editor: http://localhost:1884/editor/
- Đăng ký/đăng nhập: http://localhost:1884/auth/login
- Dashboard: http://localhost:1884/dashboard/parking

Editor chỉ mở trên laptop chạy Node-RED. Điện thoại cùng LAN dùng IP laptop thay localhost và cần firewall cho phép cổng 1884. Khởi động lại sau khi sửa `.env`.

**Thiết lập từng bước:** [Supabase, Gmail, HiveMQ và đấu dây](docs/SETUP_SUPABASE_GMAIL.md).

## Chức năng

| ID | Luồng | Phụ trách |
|---|---|---|
| CB01 | Web → Node-RED → HiveMQ → ESP32 → servo mở/đóng thủ công | Dương Châu Phát |
| CB02 | 3 HC-SR04 → ESP32 → HiveMQ → Node-RED → Web A1–A3, số trống | Nguyễn Đức Nhật Phát |
| NC01 | DHT11 → ESP32 → buzzer tại chỗ, chạy cả khi mất mạng | Nguyễn Đức Nhật Phát |
| NC04 | Node-RED → Supabase PostgreSQL, lịch sử theo thời điểm | Dương Châu Phát |
| NC05 | Supabase → Node-RED → 3 biểu đồ: ô có xe, lượt vào/ra từng ô, nhiệt độ | Dương Châu Phát |
| NC07 | Cảnh báo nhiệt → MQTT → Node-RED → Gmail SMTP → email nhận | Nguyễn Đức Nhật Phát |
| NC08 | Câu hỏi → Node-RED lấy hiện trạng/lịch sử Supabase → Gemini → câu trả lời | Dương Châu Phát |
| NC09 | Supabase Auth lưu tài khoản PostgreSQL, xác thực và bảo vệ Dashboard/API | Nguyễn Đức Nhật Phát |

Dashboard một trang gồm bãi xe, điều khiển, chatbot, nhóm biểu đồ có ba tab nhỏ; tự xếp dọc khi màn hình hẹp. Không có LCD, gauge nhiệt độ, Telegram, ntfy hoặc báo cáo email theo lịch. Các nút inject mô phỏng chỉ dành cho xem giao diện, mặc định tắt và không ghi Cloud/điều khiển thiết bị.

## Cấu trúc code

Repository GitHub nên đặt tại thư mục `IoT`, với cây source như sau. Những thư mục được tạo khi chạy hoặc dùng làm bản nháp không cần đưa lên repository.

```text
IoT/
├── README.md                       # Tổng quan, cấu trúc và cách chạy
├── .gitignore                      # Loại file bí mật, thư viện và dữ liệu local
├── .env.example                    # Cấu hình mẫu, không chứa khóa thật
├── package.json                    # Thư viện và lệnh npm của toàn project
├── package-lock.json               # Phiên bản thư viện, cần commit
├── node-red/
│   ├── flows.json                  # Source luồng và giao diện Dashboard
│   └── settings.js                 # Khởi động, nạp dịch vụ và bảo vệ truy cập
├── lib/
│   ├── supabase-service.cjs         # Tài khoản, phiên đăng nhập, đọc/ghi lịch sử
│   └── email-alarm.cjs              # Email cảnh báo nhiệt và chống gửi lặp
├── firmware/
│   ├── firmware.ino                # Chương trình ESP32
│   └── config.example.h            # Wi-Fi, HiveMQ và chứng chỉ mẫu
├── supabase/
│   └── schema.sql                  # Bảng PostgreSQL, chỉ mục và quyền truy cập
├── tests/
│   ├── supabase-migration.cjs       # Kiểm thử nghiệp vụ bằng dịch vụ giả lập
│   └── runtime-smoke.cjs            # Kiểm tra Node-RED chạy thật trong môi trường cô lập
├── tools/
│   ├── check-project.cjs           # Điểm chạy bộ kiểm thử nghiệp vụ
│   └── start-node-red.ps1          # Khởi động Node-RED nền trên Windows
└── docs/
    ├── SETUP_SUPABASE_GMAIL.md      # Hướng dẫn cấu hình và đấu dây
    └── ON_VAN_DAP_LUONG_DU_LIEU_2_3.md
```

`node-red/package.json` là metadata thư mục Node-RED; cài thư viện và chạy lệnh npm từ thư mục gốc `IoT`. File `.env` thật, `firmware/config.h`, `data/`, `node_modules/` và các file credentials được giữ trên máy, không đưa lên GitHub.

- `node-red/flows.json`: luồng nghiệp vụ, giao diện, đăng nhập, biểu đồ và chatbot.
- `node-red/settings.js`: nạp môi trường, middleware bảo vệ HTTP và Socket.IO.
- `lib/supabase-service.cjs`: Supabase Auth/Data REST API; phiên cookie ngẫu nhiên HttpOnly, token lưu mã hóa trên laptop; tự refresh trong thời hạn phiên 8 giờ.
- `lib/email-alarm.cjs`: Gmail SMTP, đợt cảnh báo và chống lặp lưu bền vững.
- `supabase/schema.sql`: bảng lịch sử và quyền truy cập server-only. Tài khoản do Auth quản lý, không có bảng hồ sơ bổ sung.
- `firmware/firmware.ino`: 3 siêu âm, servo, DHT11 và buzzer.

Lịch sử `parking_events`: `id`, `kind`, `received_at` (ms, laptop nhận), `payload`, `created_at`. Ghi ID ổn định để retry không tạo bản sao; hàng đợi `data/outbox` giữ qua restart. Biểu đồ ô đọc 500 mốc gần nhất; nhiệt độ 1000 mốc gần nhất; lượt vào/ra đọc phân trang toàn bộ lịch sử ô trong ngày theo giờ Việt Nam và một mốc trước đầu ngày. Không tính mẫu đầu hoặc chuyển qua trạng thái chưa xác định là lượt xe.

## MQTT

| Topic | Chiều | Payload |
|---|---|---|
| parking/status | ESP32 → Node-RED | JSON `slots:[1,0,-1]`, boot, seq; 1 có xe, 0 trống, -1 chưa xác định |
| parking/temperature | ESP32 → Node-RED | JSON temperatureC, alarm, buzzer, sensorValid; đọc mỗi 2 giây |
| parking/availability | ESP32 → Node-RED | online/offline, Last Will |
| parking/barrier/set | Node-RED → ESP32 | open/close, không retain |
| parking/barrier/state | ESP32 → Node-RED | xác nhận nhận lệnh, không đo góc thực |

Bỏ qua telemetry retain; sau 15 giây không có dữ liệu, hiện trạng hết hạn và chặn lệnh servo. Còi xử lý tại ESP32, email cần Node-RED và Internet. DHT11 chỉ dùng nhiệt độ 0–50°C, ngưỡng thử 50/45°C. Không có cảm biến chống kẹp hoặc tự mở thanh chắn.

## NC09

Đăng ký/đăng nhập qua Node-RED → Supabase Auth. Auth lưu tài khoản trong `auth.users` PostgreSQL. Nếu bật xác nhận email, người dùng xác nhận trước khi đăng nhập. Browser chỉ nhận cookie HttpOnly; access/refresh token và Secret key không gửi cho Dashboard. Node-RED xác minh người dùng và làm mới token khi cần; đăng xuất hủy phiên local ngay cả khi Cloud lỗi. Mọi tài khoản đăng ký hợp lệ có quyền dùng Dashboard, chưa phân vai.

## Thiết lập trên máy mới

Sau khi clone repository, mở Terminal trong thư mục chứa `package.json`:

```powershell
npm ci
Copy-Item .env.example .env
Copy-Item firmware/config.example.h firmware/config.h
```

Chỉ sao chép cấu hình mẫu khi chưa có file cấu hình thật, tránh ghi đè cấu hình đang dùng. Điền `.env` trên máy riêng:

| Nhóm biến | Mục đích |
|---|---|
| `PORT` | Cổng Node-RED, mặc định 1884 |
| `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD` | Kết nối HiveMQ; TLS cấu hình trong node broker |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Supabase Auth và Data API; URL gốc không có `/rest/v1` |
| `NODE_RED_CREDENTIAL_SECRET` | Khóa riêng, ổn định để bảo vệ credentials và phiên trên máy chủ |
| `COOKIE_SECURE` | `false` cho HTTP nội bộ; `true` khi dùng HTTPS |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_TO` | Gmail SMTP và người nhận cảnh báo |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Dịch vụ chatbot |

Chạy SQL trong `supabase/schema.sql` bằng Supabase SQL Editor. Bật Email trong Supabase Auth; nếu nhóm chỉ dùng email/mật khẩu và không yêu cầu xác nhận, tắt **Confirm email**. Điền Wi-Fi, HiveMQ và CA tin cậy vào `firmware/config.h`, cài thư viện Arduino theo tài liệu setup rồi nạp lên ESP32.

```powershell
npm run check
npm run check:runtime
npm start
```

`npm start` chạy ở Terminal hiện tại. Hoặc dùng `powershell -File tools/start-node-red.ps1` để chạy nền trên Windows; không chạy cả hai cùng lúc trên một cổng. Chỉ import `flows.json` vào một Node-RED khác là chưa đủ: cần cả `settings.js`, `lib/`, thư viện npm và cấu hình môi trường.

## Kiểm thử và giới hạn

`npm run check` kiểm tra flow/Vue, 3 ô, lỗi cảm biến, chặn servo với dữ liệu cũ, hàng đợi retry, truy vấn phân trang, xác thực/refresh/logout và chống lặp Gmail bằng dịch vụ giả lập. Không gửi MQTT hoặc email thật. Nhóm cần tạo Supabase, chạy SQL, điền khóa, Gmail App Password và HiveMQ; kiểm thử thật theo tài liệu setup. Không coi chạy test giả lập là kết nối dịch vụ thành công.

`npm run check:runtime` đã qua trên Node-RED thật trong thư mục test cô lập, bao gồm bảo vệ Dashboard HTTP/Socket.IO, chatbot, Origin và đăng xuất. Lần kiểm tra firmware ngày 20/11/2026 dùng ESP32 core 4.0.0, PubSubClient 2.8.0, ESP32Servo 3.2.1 và DHT 1.4.7 bị Windows Application Control chặn công cụ biên dịch (mã 4551); chưa xác nhận build thành công hoặc chạy phần cứng thật.

## Chuyển từ bản cũ và đóng gói

Firebase và thông báo nhanh không còn được runtime sử dụng. Bản trước lưu trong `data/migration-backup/supabase-20261120`. File `service-account.json` cũ không được đọc; không đưa file này, `.env`, `data`, `node_modules`, `firmware/config.h` hoặc `flows_cred.json` vào ZIP source. Dữ liệu Firebase cũ không tự nhập vào Supabase; hàng đợi local chưa gửi vẫn được chuyển tiếp theo ID. Dùng source mới, không dùng ZIP source cũ còn trong thư mục.

## Đưa source lên GitHub

`.gitignore` đã loại các file cấu hình thật, dữ liệu chạy, bản nháp `tmp/`, tài liệu xuất `output/`, ZIP cũ và cấu hình Mosquitto cũ. Các file này vẫn được giữ trên máy. `data/` có hàng đợi chưa đồng bộ, phiên và trạng thái chống gửi email lặp nên không xóa toàn bộ để dọn source.

Tạo repository trống trên GitHub, sau đó chạy trong **đúng thư mục `D:\IoT`**, không phải gốc ổ D:

```powershell
cd D:\IoT
git init
git add .
git status
git diff --cached --stat
```

Kiểm tra danh sách trước khi commit: không được có `.env`, `config.h`, `service-account.json`, `flows_cred.json`, `data/` hoặc khóa thật trong source. `.gitignore` không tự bỏ một file đã được Git theo dõi từ trước; nếu có file như vậy, dùng `git rm --cached -- <đường-dẫn-file>` để bỏ khỏi Git nhưng giữ trên máy. Nếu khóa đã từng được push, cần thay khóa đó; chỉ thêm `.gitignore` không xóa khóa khỏi lịch sử Git.

Khi danh sách đúng:

```powershell
git commit -m "Add Smart Parking project"
git branch -M main
git remote add origin https://github.com/TEN_TAI_KHOAN/TEN_REPOSITORY.git
git push -u origin main
```

Thay URL remote bằng repository của nhóm. Nếu đã có remote `origin`, kiểm tra bằng `git remote -v` rồi dùng `git remote set-url origin <URL>` khi cần. Không đưa mật khẩu hay token vào URL remote.

Khi sửa flow qua Editor, nhấn **Deploy**, kiểm tra thay đổi trong `node-red/flows.json`, chạy lại kiểm thử rồi commit source. Cấu hình riêng của mỗi thành viên nằm trong `.env` và `config.h` của máy đó.

Tham khảo: https://supabase.com/docs/guides/auth/architecture · https://supabase.com/docs/guides/api · https://nodered.org/docs/user-guide/writing-functions
