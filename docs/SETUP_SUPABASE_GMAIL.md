# Thiết lập Supabase và Gmail cho Smart Parking

## 1. Tạo Supabase

1. Tạo project tại https://supabase.com/dashboard. Chờ database khởi tạo.
2. Trong SQL Editor, chạy toàn bộ `supabase/schema.sql` của project này.
3. Trong Connect / API Keys, lấy Project URL, Publishable key và Secret key. Điền lần lượt vào `.env`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. Nếu project chỉ có khóa cũ, dùng `SUPABASE_ANON_KEY` và `SUPABASE_SERVICE_ROLE_KEY`.
4. Trong Authentication → Providers, bật Email và cho phép đăng ký. Đặt Site URL về `http://localhost:1884/auth/login` khi chạy trên laptop.
5. Có thể giữ Confirm email: đăng ký xong, người dùng phải bấm email xác nhận rồi quay lại đăng nhập. Với thử nghiệm nội bộ, có thể tắt Confirm email; hệ thống khi đó vào Dashboard ngay sau đăng ký thành công.
6. Giữ `NODE_RED_CREDENTIAL_SECRET` ít nhất 16 ký tự và ổn định. Nếu đổi khóa này, phiên đăng nhập cũ không còn giải mã được và phải đăng nhập lại. `COOKIE_SECURE=false` dành cho HTTP trong LAN tin cậy; dùng HTTPS thì đặt `true`.

Supabase Auth tự lưu tài khoản trong `auth.users` của PostgreSQL. Không tạo bảng hồ sơ bổ sung. Bảng `public.parking_events` chỉ lưu lịch sử ô đỗ, nhiệt độ và yêu cầu thanh chắn. RLS chặn truy cập trực tiếp từ trình duyệt; chỉ Node-RED giữ Secret key để đọc/ghi.

## 2. Gmail SMTP

1. Bật Xác minh 2 bước cho Gmail gửi thư.
2. Tạo Mật khẩu ứng dụng tại https://myaccount.google.com/apppasswords. Một số tài khoản trường/cơ quan có thể bị quản trị viên tắt tính năng này.
3. Điền vào `.env`:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=465`
   - `SMTP_USER`: địa chỉ Gmail gửi.
   - `SMTP_PASS`: mật khẩu ứng dụng, bỏ các dấu cách trình bày.
   - `ALERT_TO`: địa chỉ nhận cảnh báo.
4. Khởi động lại Node-RED. Luồng NC07 tự gửi khi bắt đầu đợt nhiệt độ cao; không có lịch email báo cáo hằng ngày.

Gửi lỗi thử lại tối thiểu sau 30 giây, chỉ khi thiết bị còn gửi dữ liệu mới và đang cảnh báo. Đợt cảnh báo và trạng thái đã gửi được lưu trên laptop để hạn chế trùng sau restart. SMTP không bảo đảm exactly-once: nếu Gmail đã nhận thư nhưng kết nối đứt trước phản hồi, lần thử lại có thể tạo thư trùng. Message-ID của cùng đợt được giữ ổn định.

## 3. HiveMQ và phần cứng

Node-RED và ESP32 phải dùng cùng cluster và tài khoản MQTT có quyền publish/subscribe các topic `parking/#`. Với HiveMQ Cloud: cổng 8883, bật TLS. Node-RED: mở config node `MQTT BROKER (HiveMQ)` để kiểm tra host/port, username/password và TLS. ESP32: sao chép `firmware/config.example.h` thành `config.h`, điền Wi-Fi, host, tài khoản và root CA PEM tin cậy của cluster. Không tắt xác minh chứng chỉ để né lỗi kết nối.

File `.env` đã chuyển host sang chỗ điền HiveMQ và cổng 8883. Điền `MQTT_HOST`, `MQTT_USERNAME`, `MQTT_PASSWORD` của cluster trước khi chạy. Cổng/host/CA chỉ là cấu hình môi trường, không thay đổi chức năng.

| Thiết bị | Chân ESP32 |
|---|---|
| HC-SR04 A1 | TRIG 13, ECHO 32 |
| HC-SR04 A2 | TRIG 14, ECHO 33 |
| HC-SR04 A3 | TRIG 25, ECHO 34 |
| Servo SG90 | Signal 27 |
| DHT11 module | DATA 26, nguồn 3,3V |
| Buzzer active module | Signal 23 |

Ba ECHO đi qua ba kênh chuyển mức 5V → 3,3V. Các thiết bị nối chung GND. Servo và HC-SR04 dùng 5V; không cấp servo từ chân 3V3. Chọn đúng chân S/+/- của module buzzer; GPIO chỉ điều khiển đầu vào tín hiệu của module. Nếu servo làm ESP32 reset, cần nguồn 5V đủ dòng chung GND.

Arduino IDE cần ESP32 core, PubSubClient, ESP32Servo, DHT sensor library của Adafruit và Adafruit Unified Sensor. DHT11 đọc mỗi 2 giây, còi bật từ 50°C và tắt khi ≤45°C (ngưỡng thử nghiệm). DHT11 lỗi thì tắt còi, gửi `sensorValid:false`; Web không dùng số đo lỗi. Có thể hạ ngưỡng để thử có kiểm soát rồi khôi phục giá trị phù hợp mô hình.

## 4. Chạy và kiểm tra thật

Chạy `npm install`, `npm run check`, rồi `npm start`. Mở `http://localhost:1884/editor/` hoặc `http://localhost:1884/auth/login`.

1. Đăng ký, xác nhận email nếu bật, đăng nhập; kiểm tra tài khoản trong Authentication → Users.
2. Tải lại Dashboard vẫn giữ phiên; đăng xuất rồi thử truy cập Dashboard và gửi yêu cầu chatbot phải bị chặn.
3. Đặt xe ở từng ô A1–A3, kiểm tra đúng trạng thái và số chỗ trống. Bấm mở/đóng thanh chắn và quan sát servo; phản hồi MQTT chỉ xác nhận nhận lệnh, không đo vị trí cơ khí.
4. Kiểm tra `parking_events` xuất hiện từng mốc; ba tab biểu đồ đọc lại từ Cloud. Lượt vào/ra là chuyển trạng thái của từng ô, không phải cảm biến đếm xe qua cổng.
5. Mất Internet: sự kiện nằm trong `data/outbox`. Kết nối lại: hàng đợi gửi bù theo ID và không ghi lặp. Không xóa hàng đợi chưa gửi.
6. Tạo điều kiện thử nhiệt trong phạm vi an toàn của cảm biến: còi tại ESP32 và một email cho mỗi đợt; hạ nhiệt rồi tăng lại để kiểm tra đợt mới. Không cần mở Dashboard để nhận email. Ngắt Wi-Fi để kiểm tra còi vẫn hoạt động.
7. Hỏi chatbot về ô đỗ/nhiệt độ và đối chiếu dữ liệu. Nếu Gemini hoặc Cloud chưa cấu hình, giao diện báo lỗi thay vì tạo câu trả lời giả.

Test tự động chỉ dùng Supabase/SMTP giả lập, không gửi email thật. Kết quả đó không thay thế thử thiết bị, Gmail và Supabase thật.
