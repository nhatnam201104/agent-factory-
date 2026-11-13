# Factory Multi-Agent Arena Constitution

## Core Principles

### I. Protocol-First & Multi-Transport Agnosticism
Mọi tác tử (Agent) — dù kết nối qua API Key trực tiếp (OpenAI-compatible, Anthropic, Gemini, Ollama), qua IDE Bridge (VS Code / JetBrains / Zed thông qua Agent Client Protocol - ACP hoặc MCP), qua tiến trình CLI/PTY cục bộ, hay qua HTTP Webhook/A2A — đều được chuẩn hóa về một giao diện chung `ParticipantAdapter` và đăng ký năng lực qua `AgentCard`. Không khóa chặt (vendor lock-in) vào bất kỳ một framework hay nhà cung cấp mô hình đơn lẻ nào.

### II. Structured Deliberation & Anti-Groupthink (Tranh luận có cấu trúc & Chống hùa theo)
Mọi phiên phản biện (Debate / Council) phải tuân thủ chu trình tách biệt ngữ cảnh:
1. **Divergence (Độc lập phát biểu)**: Các Agent đưa ra đề xuất đầu tiên trong ngữ cảnh cô lập để tránh hiệu ứng neo (anchoring bias) và xu nịnh (sycophancy).
2. **Anonymized Cross-Critique (Phản biện ẩn danh)**: Các đề xuất được ẩn danh (`Proposal A/B/C`) kèm rubric chấm điểm và bằng chứng trích dẫn (`file:line`, test log) trước khi bình chọn.
3. **Convergence & Synthesis (Hội tụ & Tổng hợp)**: Moderator/Judge tổng hợp điểm đồng thuận, bảo lưu ý kiến phản biện thiểu số (dissent log) và xuất biên bản quyết định (`DecisionRecord`).

### III. Workspace & Execution Isolation (Cô lập không gian làm việc)
Khi nhiều Agent cùng phối hợp viết code hoặc sửa lỗi trên một kho mã nguồn, tuyệt đối không để nhiều Agent ghi đè trực tiếp lên cùng một nhánh làm việc cùng lúc. Hệ thống bắt buộc cấp phát **Git Worktree riêng biệt** hoặc **File Lease Lock** cho từng Agent thực thi, và chỉ hợp nhất thông qua bước kiểm chứng (Verification Gate / Diff Review).

### IV. Context Hygiene & Event-Sourced Ledger (Vệ sinh ngữ cảnh & Sổ cái sự kiện)
Để chống suy thoái ngữ cảnh (context rot) khi nhiều Agent trao đổi dài hơi, trạng thái phiên làm việc phải được lưu trữ bền vững dưới dạng **Event-Sourced Append-Only Ledger** bên ngoài cửa sổ prompt. Mỗi Agent ở từng bước chỉ nhận lát cắt ngữ cảnh tối thiểu cần thiết (Active Bead + Shared Blackboard Artifacts + Tóm tắt vòng trước).

### V. Security, Zero Secret Leakage & Human-in-the-Loop Gates
API Key và thông tin xác thực của từng người dùng/IDE được lưu trữ tại **Credential Vault** cục bộ mã hóa (`AES-256-GCM`), tuyệt đối không bao giờ phát tán vào luồng hội thoại chung giữa các Agent, log sự kiện hay commit Git. Các hành động rủi ro cao (chạy lệnh hủy hoại, merge nhánh chính, gọi dịch vụ bên ngoài tốn chi phí vượt ngưỡng) phải qua cổng phê duyệt của con người (Human Gate) hoặc ngân sách định mức (Token/Turn Budget).

## Technical & Operational Constraints

- **Độ trễ điều phối nội bộ**: Overhead định tuyến bản tin trên Event Bus nội bộ `< 50ms` (p95) cho kết nối cục bộ.
- **Khả năng chịu lỗi (Fault Tolerance)**: Một Agent bị timeout, mất kết nối IDE hoặc hết hạn mức API Key không được làm sập phiên tranh luận; hệ thống tự động hạ cấp duyên dáng (graceful degradation), bảo toàn tiến trình bằng checkpoint và cho phép thay thế/retry sạch (Ralph-style clean retry).
- **Khả năng quan sát (Observability)**: Mọi lượt phát biểu, lời gọi công cụ MCP, điểm chấm chéo, chi phí token và độ trễ đều được ghi vết có cấu trúc (JSONL + SQLite) để kiểm toán lại toàn bộ quá trình ra quyết định.

## Development Workflow & Quality Gates

- **Spec-Driven & Contract-First**: Mọi giao thức kết nối mới (API Adapter, IDE Extension/ACP, MCP Server, A2A Endpoint) phải được định nghĩa JSON Schema / OpenAPI trong `contracts/` trước khi viết code thực thi.
- **Kiểm thử tích hợp thực tế**: Kiểm thử luồng điều phối, khóa file/worktree và máy trạng thái tranh luận phải chạy trên các adapter thực hoặc deterministic loop cục bộ, kiểm chứng đầy đủ các kịch bản tranh chấp (race conditions, tie-breaking, deadlocks).

## Governance

Hiến pháp này là kim chỉ nam kiến trúc cao nhất của dự án **Factory**. Mọi bản kế hoạch (`plan.md`), phân rã công việc (`tasks.md`) và mã nguồn triển khai đều phải vượt qua bước đối chiếu **Constitution Check** trước khi phê duyệt. Mọi sự gia tăng độ phức tạp trái với các nguyên tắc trên phải được giải trình rõ ràng trong bảng Complexity Tracking.

**Version**: 1.0.0 | **Ratified**: 2026-11-13 | **Last Amended**: 2026-11-13
