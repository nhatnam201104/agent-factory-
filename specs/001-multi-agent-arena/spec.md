# Feature Specification: Văn phòng 3D Quản lý Task & Phản biện Đa Agent — Mỗi AI Session là một Nhân viên (Factory Virtual Office & Arena)

**Feature Branch**: `001-multi-agent-arena`

**Created**: 2026-11-13

**Status**: Approved for Planning

**Input**: User description: "lên kế hoạch xây dựng một môi trường, nơi mà bạn và các agent khác có thể cùng trao đổi, phản biện và phối hợp với nhau đa phương thức kết nối, có thể thông qua api key, thông qua ide ... tham khảo https://github.com/topics/multi-agent-orchestration và https://claude.ai/artifact/4Lb9KP9sNaJ44VFBkoXbUe — nơi quản lí task mỗi session của một ai ứng với một nhân viên giống vậy"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ánh xạ 1-1 Mỗi Phiên AI (Session) thành một Nhân viên trong Phòng làm việc 3D (Priority: P1)

Lập trình viên mở song song nhiều phiên làm việc AI khác nguồn (ví dụ: phiên MSW Agent hiện tại, 2 cửa sổ IDE VS Code/Cursor/Zed đang mở ở 2 nhánh khác nhau, 1 phiên CLI trong terminal và 2 chuyên gia gọi qua API Key) và muốn nhìn thấy mỗi phiên hiển thị trực quan thành **một nhân viên riêng biệt trong Phòng làm việc 3D hoạt hình**: ngồi đúng bàn làm việc thuộc phòng ban chuyên môn, hiển thị thời gian thực thao tác đang làm (đọc tệp, gõ code, chạy test), và giơ tay ngay tại bàn khi cần người dùng duyệt quyền.

**Why this priority**: Giải quyết triệt để tình trạng mở hàng chục cửa sổ terminal/IDE mà không biết phiên nào đang làm việc, phiên nào bị treo chờ xác nhận hay tốn bao nhiêu chi phí. Ánh xạ `1 Active AI Session = 1 Virtual Employee` là hạt nhân của toàn bộ không gian quản lý.

**Independent Test**: Mở 1 phiên MSW Agent, 2 phiên IDE độc lập và 1 phiên API Key; xác nhận trong Văn phòng 3D xuất hiện đúng 4 nhân viên tại 4 bàn làm việc riêng biệt, cập nhật hoạt ảnh theo trạng thái thật và mở Thẻ Kiểm tra (Inspector Card) khi nhấp vào từng nhân viên.

**Acceptance Scenarios**:

1. **Given** Văn phòng 3D đang mở, **When** một phiên AI mới kết nối qua API Key, IDE hoặc CLI, **Then** một nhân viên 3D tương ứng bước vào nhận bàn làm việc kèm thẻ tên, vai trò, huy hiệu kênh kết nối, thanh độ đầy ngữ cảnh (Context Fill %) và chi phí phiên mà không bao giờ lộ khóa bảo mật.
2. **Given** người dùng mở 2 cửa sổ/phiên làm việc độc lập từ cùng một IDE hoặc cùng một nhà cung cấp mô hình, **When** cả hai phiên đăng ký vào hệ thống, **Then** hệ thống hiển thị **2 nhân viên độc lập tại 2 bàn làm việc riêng** gắn với từng mã phiên (`session_id`), tuyệt đối không trộn lẫn trạng thái hay lịch sử công việc.
3. **Given** một nhân viên AI đang làm việc tại bàn, **When** phiên AI phía sau tạm dừng chờ xác nhận quyền chạy lệnh hoặc hỏi ý kiến người dùng, **Then** nhân viên 3D lập tức **giơ tay kèm biểu tượng cảnh báo nổi bật (✋ Needs You)**, cho phép người dùng bấm `Cho phép / Từ chối / Trả lời` ngay trên thẻ nhân viên trong Văn phòng 3D mà không cần lật tìm cửa sổ gốc.

---

### User Story 2 - Quản lý Bảng Task (Kanban) & Giao việc cho từng Nhân viên Phiên AI (Priority: P1)

Người dùng muốn quản lý toàn bộ đầu việc dự án trên **Bảng Quản lý Task (Kanban Board)** gắn liền với các bàn làm việc trong Văn phòng 3D: tạo phiếu việc (Task Ticket), kéo-thả giao trực tiếp cho một nhân viên phiên AI cụ thể (hoặc giao cho Nhân viên Trưởng nhóm để tự phân rã và chia cho các bàn), theo dõi tiến độ từ `Backlog → Đang làm tại bàn → Họp Review → Chờ Giám đốc duyệt → Hoàn thành` trên các nhánh mã nguồn cô lập.

**Why this priority**: Kết nối trực tiếp giao diện nhân viên văn phòng với quản trị đầu việc thực tế, đảm bảo mỗi nhân viên AI chịu trách nhiệm rõ ràng trên một phiếu việc và một không gian nhánh mã nguồn không xung đột.

**Independent Test**: Tạo 2 phiếu việc trên Bảng Kanban, kéo giao cho 2 nhân viên AI khác nhau, xác nhận cả 2 nhân viên ngồi vào bàn thực thi trên 2 nhánh Git Worktree cô lập và tự động chuyển cột thẻ việc kèm bản diff khi hoàn thành.

**Acceptance Scenarios**:

1. **Given** người dùng tạo phiếu việc mới trên Bảng Task, **When** kéo phiếu việc thả vào một nhân viên AI (hoặc thả vào bàn làm việc 3D của nhân viên đó), **Then** nhân viên nhận phiếu việc, được cấp tự động một nhánh làm việc cô lập (hoặc khóa vùng tệp được giao) và hiển thị mã phiếu việc đang xử lý ngay trên màn hình bàn làm việc.
2. **Given** một mục tiêu lớn (Epic) được giao cho Nhân viên Trưởng nhóm (ví dụ: MSW Agent đóng vai Tech Lead), **When** Trưởng nhóm tách mục tiêu thành các phiếu việc con có thứ tự phụ thuộc, **Then** các phiếu việc con hiển thị trên Bảng Kanban, được phân bổ về bàn của từng nhân viên chuyên trách và giữ liên kết truy vết ngược về mục tiêu cha.
3. **Given** hai nhân viên đang làm hai phiếu việc song song trên cùng kho mã nguồn, **When** nhân viên B định sửa tệp đang thuộc quyền giữ khóa của nhân viên A, **Then** hệ thống chặn ghi đè trực tiếp và tự động mở luồng trao đổi phối hợp giữa hai nhân viên.

---

### User Story 3 - Triệu tập Nhân viên rời Bàn vào Phòng Họp 3D để Phản biện Chéo (Priority: P1)

Khi đứng trước một phiếu việc thiết kế kiến trúc hoặc lỗi phức tạp, người dùng bấm "Triệu tập Họp Phản biện" để các nhân viên AI được chọn **đứng dậy rời bàn cá nhân, đi vào Phòng Họp Kính 3D ngồi quanh bàn họp**, thực hiện chu trình đề xuất độc lập khóa kín, chấm điểm phản biện ẩn danh có dẫn chứng và biểu quyết ra Biên bản Quyết định trước khi ai về bàn nấy để code.

**Why this priority**: Loại bỏ thiên kiến xu nịnh (sycophancy) và điểm mù đơn mô hình, đồng thời trực quan hóa sinh động quá trình hội đồng AI tranh luận và đi đến đồng thuận.

**Independent Test**: Chọn 1 phiếu việc thiết kế, triệu tập 3 nhân viên vào Phòng Họp chế độ Hội đồng, quan sát 3 nhân viên di chuyển vào bàn họp, chạy qua 4 bước (Đề xuất kín $\to$ Phản biện ẩn danh $\to$ Bỏ phiếu $\to$ Tổng hợp Biên bản) và gắn kết quả trực tiếp vào phiếu việc.

**Acceptance Scenarios**:

1. **Given** người dùng phát động cuộc họp phản biện trên một phiếu việc cho ít nhất 2 nhân viên AI, **When** bắt đầu Vòng Đề xuất Độc lập (Divergence), **Then** các nhân viên di chuyển vào bàn Phòng Họp 3D và soạn đề xuất trong vách ngăn ngữ cảnh kín (không ai nhìn thấy bài của ai trước khi khóa vòng 1).
2. **Given** tất cả đề xuất vòng 1 đã thu thập xong, **When** chuyển sang Vòng Phản biện Chéo (Cross-Critique), **Then** hệ thống ẩn danh tên mô hình/nhân viên thành `Phương án A`, `Phương án B`... theo thứ tự ngẫu nhiên để từng nhân viên chỉ ra lỗ hổng logic/bảo mật và chấm điểm tiêu chí kèm dẫn chứng cụ thể.
3. **Given** các lượt phản biện và bỏ phiếu hoàn tất, **When** Nhân viên Chủ trì tổng hợp, **Then** hệ thống xuất Biên bản Quyết định (`DecisionRecord`) kèm mục bắt buộc "Ý kiến Bảo lưu" (`DissentLog`), gửi lên Bàn Giám đốc (Human Gate) duyệt và tự động trả các nhân viên về bàn cá nhân để triển khai các phiếu việc con.

---

### User Story 4 - Điều hành từ Bàn Giám đốc, Kiểm soát Bảng lương Token & Nhịp tim (Priority: P2)

Người dùng từ vị trí Bàn Giám đốc (Director Desk) theo dõi toàn cảnh văn phòng 3D, kiểm soát ngân sách tiêu thụ theo từng nhân viên/phòng ban, cài đặt lịch trực định kỳ (Heartbeat) và có thể ra chỉ thị nóng (Steer) hoặc dừng khẩn cấp bất kỳ nhân viên nào.

**Why this priority**: Đảm bảo con người giữ quyền kiểm soát tối cao về định hướng sản phẩm, an toàn hệ thống và chi phí vận hành khi chạy nhiều phiên AI cùng lúc.

**Independent Test**: Đặt hạn mức ngân sách và giới hạn 3 vòng họp, thực hiện thao tác bơm chỉ dẫn trực tiếp từ Bàn Giám đốc giữa vòng 2 và xác nhận mọi nhân viên trong phòng họp cập nhật ngay ở lượt kế tiếp.

**Acceptance Scenarios**:

1. **Given** mỗi nhân viên hoặc phòng họp có trần ngân sách và số vòng tối đa, **When** chạm ngưỡng giới hạn, **Then** đồng hồ trên bàn nhân viên đổi màu cảnh báo, tự động tạm dừng mở vòng mới và xin ý kiến tại Bàn Giám đốc.
2. **Given** người dùng muốn đổi hướng xử lý của một nhân viên tại bàn hoặc cả nhóm trong phòng họp, **When** người dùng gửi "Chỉ đạo trực tiếp" hoặc duyệt tại Human Gate, **Then** các nhân viên liên quan lập tức áp dụng ràng buộc mới ở bước tiếp theo.

### Edge Cases

- **Tải lại cửa sổ IDE (Session Reconnect)**: Khi IDE reload làm ngắt kết nối tạm thời, phiên kết nối lại cùng mã định danh không gian làm việc sẽ tiếp quản lại đúng nhân viên 3D, bàn làm việc và phiếu việc đang mở thay vì tạo nhân viên trùng lặp.
- **Hòa phiếu tại bàn họp (Tie-breaking)**: Khi phiếu bầu hòa nhau (ví dụ 2–2), Chủ trì đẩy thẻ quyết định lên Bàn Giám đốc để người dùng bấm chọn phương án thắng.
- **Nhân viên treo do hộp thoại xin quyền ẩn**: Quá 30 giây chờ quyền cục bộ, nhân viên bật hiệu ứng ✋ Giơ tay màu hổ phách kèm chuông báo nhẹ; nếu đang trong phòng họp thì phòng họp vẫn có thể tiếp tục khi đủ tỷ lệ túc số (`quorum`).
- **Chuyển đổi mượt giữa 3D Office và 2D Kanban**: Người dùng có thể bật/tắt góc nhìn 3D sang góc nhìn Bảng Kanban + Biên bản phẳng bất kỳ lúc nào mà không làm gián đoạn các phiên đang chạy.
- **Bùng nổ ngữ cảnh khi đính kèm log dài**: Mọi bản diff và log kiểm thử lớn được cất vào Tủ Hồ sơ Chung (Shared Blackboard) và chỉ gắn mã tham chiếu gọn nhẹ lên phiếu việc.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hệ thống PHẢI ánh xạ **1-1 mỗi phiên AI đang hoạt động (`AgentSession`) thành một Nhân viên Ảo (`SessionEmployee`)** có bàn làm việc riêng, chức danh, phòng ban và trạng thái hoạt ảnh đồng bộ trực tiếp với hoạt động thật của phiên đó.
- **FR-002**: Hệ thống PHẢI hỗ trợ tuyển dụng/kết nối nhân viên AI đa phương thức qua ít nhất 5 kênh: (1) MSW Agent, (2) Phiên IDE (VS Code, Cursor, Zed, JetBrains...) qua giao thức công cụ/client chuẩn, (3) Mô hình qua API Key, (4) Tiến trình CLI cục bộ, và (5) Agent từ xa qua bản khai năng lực chuẩn (`Agent Card`).
- **FR-003**: Hệ thống PHẢI lưu trữ mọi khóa API và thông tin xác thực trong kho lưu trữ cục bộ mã hóa, tuyệt đối không để lộ khóa trên thẻ nhân viên, bảng công việc, luồng hội thoại hay tệp nhật ký.
- **FR-004**: Hệ thống PHẢI cung cấp giao diện **Phòng làm việc 3D hoạt hình tương tác** (xoay/thu phóng camera, chọn nhân viên, chuyển đổi tức thì với chế độ Kanban 2D) gồm 4 phân khu: Khu Bàn Nhân Viên theo phòng ban, Bảng Kanban Trung tâm, Phòng Họp Kính Phản Biện và Bàn Giám Đốc của người dùng; hỗ trợ xử lý trực tiếp yêu cầu **✋ Giơ tay xin quyền** ngay trên thẻ nhân viên.
- **FR-005**: Hệ thống PHẢI tích hợp hệ thống Quản lý Phiếu việc (Kanban Task Tickets) gắn với Sơ đồ Tổ chức (Org Chart), cho phép kéo-thả giao việc cho từng nhân viên phiên AI, phân rã mục tiêu lớn thành phiếu việc con và theo dõi trạng thái đầu-cuối.
- **FR-006**: Khi triệu tập họp phản biện trong Phòng Họp 3D, hệ thống PHẢI cưỡng chế quy trình Hội đồng 4 bước: cô lập hoàn toàn tầm nhìn ở vòng đề xuất đầu tiên, ẩn danh tên mô hình/nhân viên ở vòng chấm điểm chéo kèm dẫn chứng thực tế, biểu quyết xếp hạng và xuất Biên bản Quyết định (`DecisionRecord`) kèm mục Ý kiến Bảo lưu (`DissentLog`).
- **FR-007**: Hệ thống PHẢI cung cấp Tủ Hồ sơ Chung (Shared Blackboard) để các nhân viên đăng tải và tham chiếu tài liệu lớn bằng mã định danh gọn nhẹ thay vì nhồi toàn bộ văn bản thô vào mọi lượt trao đổi.
- **FR-008**: Hệ thống PHẢI cấp không gian nhánh mã nguồn cô lập (Git Worktree) hoặc cơ chế giữ khóa tệp có thời hạn cho mỗi nhân viên khi thực thi sửa mã trên phiếu việc được giao, kèm cơ chế khôi phục ngữ cảnh sạch khi kiểm thử thất bại lặp lại.
- **FR-009**: Hệ thống PHẢI kiểm soát ngân sách tiêu thụ theo từng nhân viên/phiếu việc (giới hạn số vòng họp, thời gian chờ, trần chi phí) và đặt Cổng Phê duyệt tại Bàn Giám đốc (Human Gate) trước khi chốt kiến trúc hoặc hợp nhất mã nguồn.
- **FR-010**: Hệ thống PHẢI lưu trữ bền vững toàn bộ lịch sử phiếu việc, biên bản họp, phiếu bầu và nhật ký công cụ của từng phiên nhân viên theo chuỗi thời gian bất biến để kiểm toán và khôi phục sau khi khởi động lại.

### Key Entities *(include if feature involves data)*

- **Role Template & Department (Vị trí Chuyên môn & Phòng ban)**: Khuôn mẫu chức danh trong sơ đồ tổ chức (Tech Lead, Backend, Frontend, Security Critic, QA), quyền hạn mặc định và khu vực bàn trong văn phòng.
- **Session Employee (Nhân viên Phiên AI)**: Thực thể ánh xạ 1-1 với một phiên AI đang kết nối; lưu mã phiên, kênh kết nối, vị trí không gian 3D (Bàn số mấy / Ghế phòng họp số mấy), trạng thái hoạt ảnh (`coding`, `reading`, `testing`, `walking`, `debating`, `hand_raised`, `idle`), độ đầy ngữ cảnh và chi phí phiên.
- **Credential Profile (Hồ sơ Xác thực)**: Lưu khóa kết nối đã mã hóa tách rời hoàn toàn khỏi dữ liệu nhân viên và hội thoại.
- **Task Ticket / Bead (Phiếu Công việc Kanban)**: Đầu việc có mã phiếu, liên kết mục tiêu cha, cột trạng thái Kanban, nhân viên phụ trách (`assignee_session_id`), danh sách người phản biện, tiêu chí nghiệm thu và nhánh làm việc cô lập.
- **War-Room Meeting & Round (Phiên Họp Phản biện & Vòng tranh luận)**: Không gian họp gắn với phiếu việc tại bàn Phòng Họp 3D, quản lý khóa kín vòng 1, nhãn ẩn danh vòng 2, điểm chấm chéo, phiếu bầu và `DecisionRecord` + `DissentLog`.
- **Permission Request (Yêu cầu Giơ tay Xin quyền)**: Yêu cầu phê duyệt phát sinh từ một phiên nhân viên, hiển thị trực tiếp trên đầu nhân vật 3D và tại Bàn Giám đốc.
- **Blackboard Artifact & Workspace Lease (Hồ sơ Chung & Quyền thuê Nhánh/Tệp)**: Lưu trữ hiện vật đánh số phiên bản và khóa cô lập không gian mã nguồn cho từng nhân viên.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mở hoặc đóng bất kỳ phiên AI nào (MSW Agent, IDE, CLI, API Key) đều phản ánh thành nhân viên 3D tại bàn làm việc tương ứng với độ trễ dưới 1 giây; thiết lập xong văn phòng mẫu 3+ nhân viên đa phương thức trong dưới 3 phút.
- **SC-002**: 100% yêu cầu xin quyền hoặc trạng thái bị chặn của phiên AI đều bật tín hiệu ✋ Giơ tay trực quan và xử lý được ngay từ thẻ nhân viên trong Văn phòng 3D; 100% phiên họp Hội đồng đảm bảo khóa kín vòng 1 và ẩn danh hoàn toàn ở vòng phản biện chéo trong tối đa 3 vòng mặc định.
- **SC-003**: 0% trường hợp xảy ra xung đột ghi đè làm hỏng mã nguồn gốc khi từ 2 đến 8 nhân viên phiên AI thực thi song song các phiếu việc trên cùng một kho mã nguồn.
- **SC-004**: Giảm tối thiểu 50% lượng ngữ cảnh đầu vào dư thừa từ vòng trao đổi thứ 3 trở đi nhờ Tủ Hồ sơ Chung và lát cắt ngữ cảnh theo phiếu việc.
- **SC-005**: 0% trường hợp lộ khóa API hoặc bí mật xác thực dưới dạng văn bản thuần trên giao diện Văn phòng 3D, bảng công việc hay tệp nhật ký.

## Assumptions

- **Kết xuất 3D nhẹ kèm chế độ Kanban 2D song hành**: Văn phòng 3D chạy trực tiếp mượt mà trên trình duyệt hiện đại và khung Preview, đồng thời luôn có nút chuyển đổi tức thì sang bảng Kanban/Biên bản 2D mà không ảnh hưởng luồng điều phối.
- **Hoạt ảnh gắn chặt 100% với trạng thái kỹ thuật thật**: Nhân viên 3D chỉ gõ phím khi phiên AI thật sự đang xử lý/gọi công cụ và chỉ đi vào Phòng Họp khi tham gia phiên thảo luận thật.
- **Ưu tiên Local-First kết hợp chuẩn mở**: Dịch vụ điều phối chạy cục bộ độ trễ thấp trên máy lập trình viên, tích hợp với các IDE thương mại thông qua chuẩn giao thức công cụ/client mở mà không cần sửa đổi nội bộ từng IDE.
