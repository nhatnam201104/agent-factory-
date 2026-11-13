# Phase 0 Architecture Research & Technical Decisions: Factory Multi-Agent Arena

**Feature**: `001-multi-agent-arena` | **Date**: 2026-11-13

Tài liệu này giải quyết toàn bộ các lựa chọn kiến trúc kỹ thuật cho nền tảng hợp tác, phản biện và điều phối đa Agent đa phương thức (**Factory Arena**), kế thừa bằng chứng thực tiễn từ khảo sát `.specify/assessments/multi-agent-arena/research.md`.

---

## 1. Kiến trúc Kết nối Đa phương thức (Unified Multi-Transport Adapter Layer)

- **Decision**: Thiết kế tầng **Gateway & Adapter Bus** chuẩn hóa mọi thành viên về một giao diện bất đồng bộ duy nhất `ParticipantAdapter`, hỗ trợ đồng thời **5 phương thức kết nối (Transports)**:
  1. **`APIKeyAdapter` (Direct LLM Providers)**: Gọi trực tiếp qua chuẩn OpenAI-compatible (`/v1/chat/completions`, `/v1/responses`), Anthropic Messages API, Gemini API và Ollama/vLLM nội bộ; được cấp kèm bộ công cụ đọc kho mã nguồn tối giản (Read-only Repo Tools + Blackboard Tools) để các model thuần API vẫn đọc được `file:line` thực tế khi phản biện.
  2. **`MCPBridgeAdapter` (Universal IDE & MSW Agent Bridge)**: Factory Hub đóng vai trò một **MCP Server chuẩn (Streamable HTTP / SSE + stdio proxy)** xuất bản bộ công cụ hợp tác (`arena_join_room`, `arena_poll_events`, `arena_submit_proposal`, `arena_submit_critique`, `arena_vote`, `arena_claim_bead`, `arena_publish_artifact`). Nhờ đó, **MSW Agent**, **VS Code**, **Cursor**, **Windsurf**, **Zed** hay bất kỳ IDE Agent nào có hỗ trợ MCP đều kết nối ngay lập tức với 1 dòng cấu hình mà không cần sửa đổi mã nguồn IDE (học từ `Fmarzochi/EGC` và `desplega-ai/agent-swarm`).
  3. **`ACPBridgeAdapter` (Native Code Editor Protocol)**: Tích hợp `@agentclientprotocol/sdk` (JSON-RPC 2.0 v1) để kết nối hai chiều trực tiếp với các trình soạn thảo hỗ trợ **Agent Client Protocol (ACP)** (như Zed, JetBrains, Neovim và VS Code extension mỏng), cho phép hiển thị luồng phản biện và diff trực tiếp ngay bên trong khung soạn thảo.
  4. **`CLIPtyAdapter` (Local Terminal Coding Agents)**: Khởi chạy và điều phối các công cụ CLI Agent cục bộ (như `opencode`, `aider`, hoặc script tùy chỉnh) thông qua tiến trình con quản lý luồng JSON-RPC / PTY có kiểm soát idempotency và phát hiện treo xin quyền sau 20–30 giây (học từ `y5ez3g/facadecode`).
  5. **`A2ARemoteAdapter` (Cross-Server Agent-to-Agent Protocol)**: Công bố `/.well-known/agent.json` (**Agent Card**) và endpoint JSON-RPC 2.0 + SSE theo chuẩn **Linux Foundation A2A** để kết nối với các Agent chạy trên máy khác hoặc framework khác (LangGraph, CrewAI, AutoGen) mà vẫn bảo toàn tính đóng gói nội bộ (opacity).

- **Rationale**: Không một giao thức đơn lẻ nào bao phủ hết mọi loại Agent hiện nay. Kết hợp bộ ba chuẩn mở **MCP (cho IDE & Tooling) + ACP (cho Editor UI) + A2A (cho Liên mạng Agent)** cộng với **API Key Adapter** giúp MSW Agent và mọi công cụ bên ngoài hội tụ mượt mà trên cùng một bàn tròn.
- **Alternatives considered**:
  - *Chỉ dùng thư viện Python nội bộ (LangGraph / CrewAI / AutoGen thuần)*: Bị loại vì chỉ gọi được API Key, không thể kéo phiên Agent đang mở sẵn trong IDE của lập trình viên hay MSW Agent hiện tại vào tranh luận.
  - *Chỉ dùng điều khiển màn hình Terminal / GUI Scraping*: Bị loại vì mong manh, tốn tài nguyên và dễ gãy khi IDE cập nhật giao diện.

---

## 2. Máy trạng thái Phản biện & Ra quyết định (Deliberation & Anti-Groupthink Engine)

- **Decision**: Triển khai **Deterministic Deliberation State Machine** hỗ trợ 4 giao thức làm việc có thể chuyển đổi theo độ phức tạp bài toán:
  1. **`council` (Hội đồng Phản biện Ẩn danh 4 bước — Mặc định cho Thiết kế & Kiến trúc)**:
     - **Stage 1 — Blind Divergence**: Phát đề bài + lát cắt ngữ cảnh chuẩn hóa cho $N$ Agent song song. Khoang dữ liệu của mỗi Agent bị khóa kín (`sealed`), không ai thấy bài nháp của ai cho tới khi tất cả nộp hoặc hết timeout vòng 1.
     - **Stage 2 — Anonymized Cross-Critique**: Trộn ngẫu nhiên các đề xuất thành `Proposal A`, `Proposal B`, `Proposal C` (xóa sạch tên model/vendor). Mỗi Agent chấm điểm theo Rubric có trọng số (`correctness`, `security`, `maintainability`, `complexity`, `evidence_quality`) và bắt buộc đính kèm trích dẫn (`file_path:line` hoặc artifact ID).
     - **Stage 3 — Rebuttal & Voting (Tối đa 1–2 vòng phản hồi)**: Tác giả từng phương án được quyền bảo vệ luận điểm hoặc hợp nhất ý hay từ phản biện, sau đó toàn bộ thành viên bỏ phiếu xếp hạng có trọng số (Weighted Ranked-Choice / Approval Voting).
     - **Stage 4 — Synthesis & Dissent Preservation**: Điều phối viên (Moderator — có thể là MSW Agent, một Judge Model chỉ định, hoặc chính Người dùng) giải ẩn danh, lập `DecisionRecord` gồm phương án chốt, danh sách sửa đổi tiếp thu và mục bắt buộc **`DissentLog`** (ghi nhận các rủi ro thiểu số chưa được giải quyết).
  2. **`adversarial` (Tranh biện Đối kháng Proposer ↔ Red-Team Critic)**: Một Agent đóng vai Người đề xuất/Triển khai, một hoặc nhiều Agent đóng vai Phản biện Bảo mật/Hiệu năng xoay vòng tối đa $K$ lượt (mặc định $K=3$) cho tới khi không còn lỗi mức `HIGH/CRITICAL` hoặc chạm cổng Người dùng.
  3. **`roundtable` (Thảo luận Bàn tròn Có điều phối)**: Trò chuyện đa chiều theo lượt dành cho gỡ rối nhanh (brainstorming/debugging), sử dụng bộ định tuyến lượt phát biểu (`TurnRouter`) ưu tiên Agent được `@mention` hoặc có điểm năng lực khớp nhất.
  4. **`execution_mesh` (Phân rã Bead & Thực thi Song song)**: Chuyển `DecisionRecord` thành DAG các **Task Beads** độc lập, cấp phát Git Worktree + File Lease cho từng Agent thực thi và kiểm chứng chéo trước khi gộp.

- **Rationale**: Kết hợp cơ chế ẩn danh chống hùa theo từ `claude-council` / `LoopTroop` với kết quả thực nghiệm ACL 2025 (Voting mạnh cho bài toán suy luận kỹ thuật, Consensus mạnh cho tổng hợp tri thức) và giới hạn cứng số vòng ($R \le 3$) để ngăn chặn hiện tượng bội chi token.
- **Alternatives considered**:
  - *GroupChat tự do không cấu trúc (kiểu AutoGen đời đầu)*: Dễ dẫn đến vòng lặp xã giao ("Tôi hoàn toàn đồng ý với bạn"), trôi ngữ cảnh và tốn gấp nhiều lần token mà không ra quyết định rõ ràng.

---

## 3. Ngăn xếp Công nghệ Lõi & Lưu trữ (Runtime, Storage & Event Bus)

- **Decision**:
  - **Runtime & Ngôn ngữ**: **TypeScript 5.x trên Node.js 22 LTS (tương thích Bun)** tổ chức theo cấu trúc Monorepo (`pnpm workspaces`).
  - **Giao thức Web & Realtime**: **Fastify / Hono** kết hợp **WebSocket + Server-Sent Events (SSE)** cho luồng sự kiện thời gian thực tới Web Arena UI, VS Code Extension và các Agent từ xa.
  - **SDK Chuẩn**: `@modelcontextprotocol/sdk` (MCP Server/Client), `@agentclientprotocol/sdk` (ACP Editor Bridge), `zod` (kiểm tra JSON Schema nghiêm ngặt tại biên nhận tin).
  - **Lưu trữ bền vững Local-First**: **SQLite ở chế độ WAL (`better-sqlite3` / Drizzle ORM)** lưu trạng thái phòng, thành viên, phiếu bầu, khóa tệp (`WorkspaceLease`) kết hợp **Append-Only JSONL Event Log** cho toàn bộ lịch sử sự kiện và kho tệp hiện vật (`.factory-arena/artifacts/`) cùng kho khóa mã hóa **`AES-256-GCM`** (sử dụng `node:crypto` + OS Keychain / Master Passphrase).

- **Rationale**: Hệ sinh thái SDK chính thức của MCP, ACP và VS Code Extension đều ưu tiên TypeScript hạng nhất; SQLite WAL đáp ứng hàng nghìn sự kiện/giây trên máy cục bộ với độ trễ `< 5ms`, không yêu cầu cài đặt cơ sở dữ liệu rời (zero external infrastructure) ở chế độ cá nhân nhưng dễ dàng nâng cấp sang PostgreSQL + Redis khi chạy chế độ Team Server (tương tự mô hình `Synapse AI`).
- **Alternatives considered**:
  - *Bắt buộc Docker + Postgres + Redis ngay từ bản Local*: Quá nặng cho lập trình viên muốn khởi chạy nhanh bằng 1 lệnh `npx factory-arena start` để kết nối IDE và MSW Agent.

---

## 4. Cô lập Không gian làm việc & Phục hồi Lỗi (Git Worktree, File Lease & Ralph Recovery)

- **Decision**:
  - **Hai lớp chống xung đột mã nguồn**:
    1. **Git Worktree Manager**: Tự động tạo nhánh và thư mục `.factory-arena/worktrees/<room-id>/<bead-id>-<agent-id>/` cho mỗi Agent được giao quyền viết code.
    2. **Advisory File Lease Registry**: Với các IDE Agent đang mở trực tiếp trên nhánh chính của người dùng và không muốn chuyển thư mục, Hub cấp quyền thuê tệp có thời hạn (`Lease TTL`, gia hạn qua heartbeat) tương tự Session Mesh của `EGC` để chặn Agent khác sửa đè cùng tập tệp.
  - **Ralph-Style Clean Retry**: Khi một Bead thực thi thất bại quá $M$ lần thử (mặc định $M=2$), Hub trích xuất bản tóm tắt lỗi nén gọn (`< 500 tokens`), reset sạch Git worktree về commit gốc, hủy bỏ lịch sử hội thoại bị nhiễu và khởi tạo lượt chạy mới (hoặc chuyển sang Agent khác có thế mạnh phù hợp hơn).

- **Rationale**: Đảm bảo tiêu chí `SC-003` (0% hỏng mã nguồn gốc khi chạy đa Agent song song) và ngăn chặn hiện tượng "degenerate retries" (càng sửa trong phiên cũ càng nát).
- **Alternatives considered**:
  - *Cho phép nhiều Agent sửa chung một thư mục làm việc chỉ dựa vào quy ước prompt*: Không đáng tin cậy vì LLM thường sửa lan sang các file phụ trợ (`package.json`, `types.ts`) gây xung đột tức thì.

---

## 5. Vệ sinh Ngữ cảnh & Nén Nhiễu (Context Hygiene & Token Crusher)

- **Decision**:
  - Tách biệt hoàn toàn **Event Stream** (lưu đầy đủ trên đĩa) và **Prompt Context Builder** (chỉ lắp ghép đúng những gì Agent cần cho bước hiện tại).
  - Mọi hiện vật lớn hơn `2 KB` (diff, test log, kiến trúc đề xuất dài) được ghi thành `BlackboardArtifact` có mã băm SHA-256; trong hội thoại chỉ truyền bản tóm tắt cấu trúc + con trỏ `artifact://art_...` để Agent nào cần đọc sâu mới gọi công cụ `arena_read_artifact` lấy đúng phân đoạn.
  - Bộ lọc đầu ra tự động cắt bỏ log cài đặt/build dư thừa, giữ lại dòng lỗi và stack trace cốt lõi, đạt mục tiêu tiết kiệm $\ge 50\%$ token từ vòng thứ 3 trở đi (`SC-004`).

- **Rationale**: Khắc phục trực tiếp ngưỡng suy thoái 40% cửa sổ ngữ cảnh được ghi nhận trong nghiên cứu.
- **Alternatives considered**:
  - *Truyền nguyên văn toàn bộ lịch sử chat của mọi Agent vào mỗi lượt gọi*: Khiến chi phí tăng theo hàm bậc hai $O(N^2 \times R^2)$ và làm giảm trí thông minh suy luận của mô hình ở các vòng cuối.

---

## 6. Không gian Phòng làm việc 3D Hoạt hình & Đồng bộ Session-Employee (`Three.js` + `Kanban`)

- **Decision**:
  - Áp dụng quy tắc **1 Active AI Session = 1 `SessionEmployee`** (khóa duy nhất qua `session_fingerprint = transport + workspace_uri + client_session_id`). Mở 2 cửa sổ Cursor và 1 phiên MSW Agent sẽ hiển thị đúng 3 nhân viên độc lập ngồi tại 3 bàn làm việc, tự động gắn lại đúng bàn nếu IDE tải lại.
  - Kết xuất không gian 3D bằng **Three.js / `@react-three/fiber`** theo phong cách **Isometric Low-Poly 60fps** gồm 4 khu: **Engineering Desks** (màn hình máy tính đổi màu theo trạng thái gõ code/test), **Kanban Task Wall** (kéo-thả giao `TaskTicket` cho từng nhân viên), **Glass War Room** (nhân vật tự động đi bộ từ bàn cá nhân vào ngồi quanh bàn họp khi mở phiên `council`/`adversarial`), và **Director Desk** (nơi người dùng duyệt Human Gate và trả lời các nhân viên đang **✋ Giơ tay**).
  - Cung cấp công tắc chuyển đổi tức thì `3D Office View` $\leftrightarrow$ `2D Kanban & Council Split View` đọc chung một luồng trạng thái WebSocket.

- **Rationale**: Mang lại khả năng bao quát không gian tức thì (nhìn lướt 1 giây biết ngay nhân viên phiên nào đang làm task nào, ai đang họp, ai giơ tay bị kẹt chờ quyền) kế thừa tinh hoa từ artifact *Phòng làm việc 3D hoạt hình*, `Claude-Office`, `Claw3D` và `Paperclip`, nhưng gắn chặt 100% với trạng thái kỹ thuật thật và máy trạng thái phản biện ẩn danh.
- **Alternatives considered**:
  - *Engine game nặng (Unity WebGL / Unreal Pixel Streaming)*: Tốn hàng trăm MB tải trang và ngốn GPU không cần thiết trên máy lập trình viên.
  - *Chỉ có bảng log chữ truyền thống*: Khó nhận diện nhanh trạng thái song song và các phiên bị treo chờ quyền khi vận hành 5–10 phiên AI cùng lúc.
