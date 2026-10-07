# SolaX Monitor trên GitHub Pages và Cloudflare Workers

Gói chuyển đổi từ web hiện tại. Giao diện công khai trên GitHub Pages không chứa dữ liệu thiết bị, khóa SolaX hoặc mã xem. API chỉ trả số liệu khi có mã truy cập hợp lệ. Mã xem chỉ nằm trong bộ nhớ của tab; tải lại hoặc khóa trang sẽ yêu cầu nhập lại.

## Trạng thái

Mã nguồn đã chuẩn bị và kiểm thử. Chưa được triển khai vào tài khoản GitHub / Cloudflare của bạn. Web Sites cũ tiếp tục hoạt động.

## Cấu trúc

- `web/`: giao diện tĩnh, chỉ thư mục này được đưa lên Pages.
- `worker/`: API lấy dữ liệu SolaX, xác thực mã truy cập và CORS.
- `.github/workflows/pages.yml`: tự triển khai giao diện khi push nhánh main.
- `tests/`: kiểm tra quyền truy cập, quy đổi đơn vị, ID lớn, chia lịch sử theo cửa sổ 12 giờ.

## Cấu hình Cloudflare

1. Cài Node.js 22.18 trở lên và chạy `npm install`.
2. Chạy `npx wrangler login` để đăng nhập Cloudflare.
3. Trong `wrangler.jsonc`, đặt `ALLOWED_ORIGIN` thành origin của Pages, ví dụ `https://TEN-TAI-KHOAN.github.io` (không có tên repository, không có dấu / cuối).
4. Chạy `npx wrangler deploy`. Worker chưa có secrets sẽ từ chối truy cập.
5. Dùng lệnh dưới đây để nhập bí mật qua lời nhắc, không ghi vào mã nguồn:

```
npx wrangler secret put SOLAX_CLIENT_ID
npx wrangler secret put SOLAX_CLIENT_SECRET
npx wrangler secret put VIEWER_TOKEN_SHA256
```

`VIEWER_TOKEN_SHA256` là SHA-256 dạng hex chữ thường của mã truy cập ngẫu nhiên dài ít nhất 32 ký tự. Tạo mã mạnh (32 byte ngẫu nhiên), giữ bản gốc trong trình quản lý mật khẩu và chỉ lưu giá trị băm trên Worker. Mã truy cập này khác Client Secret SolaX. Chia sẻ mã xem đồng nghĩa cấp quyền xem dữ liệu nhà máy. Thay giá trị băm để thu hồi mã cũ.

Không bật gói trả phí tự động. Gói Free có hạn mức; cần kiểm tra CPU và lưu lượng thực tế trong Cloudflare sau triển khai.

## Cấu hình GitHub Pages

1. Tạo repository công khai nếu dùng GitHub Free; chỉ đưa gói mã này lên, không đưa lịch sử repository Sites, tệp thông tin xác thực hoặc dữ liệu đo lên.
2. Điền địa chỉ Worker trả về sau triển khai vào `apiBaseUrl` trong `web/config.js`, ví dụ `https://solax-monitor-api.TEN.workers.dev`.
3. Push nhánh `main`.
4. Trong Settings → Pages → Source, chọn GitHub Actions; chạy workflow Publish dashboard.
5. Mở URL Pages và nhập mã truy cập riêng để xem. Kiểm tra dữ liệu hiện tại, lịch sử, xuất CSV và nút khóa trang.

## Kiểm thử

```
npm test
npx wrangler deploy --dry-run
```

## Giới hạn

- Cập nhật mỗi 60 giây khi trang đang mở. Thời điểm truy vấn khác thời điểm thiết bị gửi dữ liệu.
- Chưa xác minh số đo công tơ/tải nên không tự tính tiêu thụ.
- Bản ghi pin trống hoặc toàn 0 không được coi là pin đã cạn.
- Hiển thị ngày giờ theo UTC+7, phù hợp nhà máy hiện tại; đổi cấu hình thời gian nếu chuyển hệ thống sang vùng khác.
- GitHub Pages công khai phần giao diện và mã nguồn; dữ liệu đo vẫn yêu cầu mã truy cập tại API.
- Việc chuyển hosting không thay đổi phí hay hạn mức API SolaX.

Tài liệu: https://developers.cloudflare.com/workers/configuration/secrets/ và https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
