# Ôn vấn đáp sơ đồ truyền và nhận dữ liệu 2.3

Diễn giải các luồng trong sơ đồ 2.3
CB01 — xanh dương: Web gửi mở/đóng → Node-RED → MQTT BROKER (HiveMQ) → ESP32 → PWM servo. Chiều ngược trả trạng thái đã nhận/xử lý lệnh; không xác nhận thanh chắn đã mở thật vì chưa có cảm biến vị trí.

CB02 — xanh lá: ESP32 gửi TRIG đến 3 HC-SR04; ECHO của từng cảm biến qua 3 kênh chuyển mức 5V → 3,3V rồi vào ESP32. Trạng thái A1–A3 và số ô trống đi qua HiveMQ, Node-RED tới Web.

NC01 — cam: DHT11 gửi dữ liệu số qua DATA, chu kỳ đọc 2 giây. ESP32 giải mã nhiệt độ và bật/tắt buzzer theo ngưỡng. Cảnh báo tại chỗ không phụ thuộc Web, broker hoặc Internet.

NC04 — tím: ESP32 gửi nhiệt độ/thời điểm qua HiveMQ đến Node-RED. Node-RED lưu trạng thái A1–A3, nhiệt độ, sự kiện trống → có xe / có xe → trống và thời điểm lên Supabase PostgreSQL. Mẫu đầu tiên thiết lập trạng thái, không tính là lượt vào. Lượt vào/ra được tổng hợp từ lịch sử chuyển trạng thái.

NC05 — nâu: Web yêu cầu biểu đồ → Node-RED truy vấn lịch sử Supabase theo thời gian → Supabase trả dữ liệu → Node-RED tổng hợp và trả ba biểu đồ: số ô có xe, lượt vào/ra từng ô, nhiệt độ.

NC08 — xanh ngọc: Web gửi câu hỏi → Node-RED lấy hiện trạng và lịch sử Supabase phù hợp → gửi câu hỏi kèm dữ liệu cho Gemini → nhận câu trả lời hoặc lỗi → trả kết quả về Web.

NC07: ESP32 gửi cảnh báo nhiệt qua HiveMQ → Node-RED chống gửi lặp → Gmail SMTP → hộp thư người nhận. Cần Node-RED và Internet, không cần mở Dashboard.

NC09: Web gửi email/mật khẩu cho Node-RED → Supabase Auth xác thực và lưu tài khoản trong auth.users của PostgreSQL. Node-RED lưu access/refresh token mã hóa trên laptop và gửi cookie HttpOnly chứa mã phiên ngẫu nhiên cho trình duyệt. Các lần truy cập sau kiểm tra phiên, tự refresh token khi cần. Đăng xuất hủy phiên. Không lưu bảng hồ sơ bổ sung.
