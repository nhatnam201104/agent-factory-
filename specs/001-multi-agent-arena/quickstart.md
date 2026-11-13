# Quickstart & End-to-End Validation Guide: Factory Multi-Agent Arena

**Feature**: `001-multi-agent-arena` | **Date**: 2026-11-13

Tài liệu này mô tả các kịch bản kiểm chứng thực tế đầu-cuối (End-to-End Validation Scenarios) sau khi triển khai theo `plan.md`, đối chiếu trực tiếp với các hợp đồng trong [`contracts/`](./contracts/) và lược đồ trong [`data-model.md`](./data-model.md).

---

## 1. Điều kiện Tiên quyết (Prerequisites)

- **Node.js** `>= 22.0.0` và **pnpm** `>= 9.x`
- **Git** `>= 2.38` (hỗ trợ đầy đủ `git worktree`)
- Tối thiểu 1 nguồn mô hình kết nối qua API Key (hoặc Ollama nội bộ) và 1 phiên MCP Client (MSW Agent hoặc IDE như VS Code / Cursor / Zed).

---

## 2. Khởi chạy Hub & Đăng ký Kết nối Đa phương thức (Kiểm chứng `SC-001` & `SC-005`)

1. **Khởi động Local Arena Hub**:
   ```bash
   pnpm install && pnpm build
   pnpm --filter @factory-arena/cli start --port 4747
   ```
   - **Kết quả kỳ vọng**:
     - Hub lắng nghe tại `http://127.0.0.1:4747` (REST + SSE + Web Arena UI).
     - MCP Streamable HTTP sẵn sàng tại `http://127.0.0.1:4747/mcp`.
     - A2A Agent Card phản hồi hợp lệ tại `GET http://127.0.0.1:4747/.well-known/agent.json` theo đúng [`contracts/a2a-agent-card.schema.json`](./contracts/a2a-agent-card.schema.json).

2. **Nạp API Key vào Credential Vault mã hóa**:
   ```bash
   factory-arena vault add --label "cloud-security-critic" --provider openai_compatible
   ```
   - **Kiểm chứng bảo mật (`SC-005`)**: Kiểm tra tệp `.factory-arena/arena.db` và `.factory-arena/events/*.jsonl` — chuỗi khóa gốc hoàn toàn không tồn tại ở dạng văn bản thuần; API `GET /api/v1/participants` chỉ trả `credential_id`.

3. **Kết nối MSW Agent và IDE (VS Code / Cursor / Zed) qua MCP/ACP**:
   - Khai báo MCP Server `factory-arena` (`http://127.0.0.1:4747/mcp`) trong cấu hình công cụ của IDE và MSW Agent.
   - Gọi công cụ `arena_join_room` (theo [`contracts/mcp-arena-tools.json`](./contracts/mcp-arena-tools.json)).
   - **Kết quả kỳ vọng**: Cả 3 thành viên (`msw-lead`, `ide-architect`, `cloud-security-critic`) hiển thị trạng thái `online` trên bảng điều khiển trong dưới 3 phút thiết lập.

---

## 3. Kịch bản Kiểm chứng Phiên Hội đồng Phản biện 4 Bước (Kiểm chứng `SC-002` & `SC-004`)

1. **Mở phòng chế độ `council`**:
   ```bash
   factory-arena room create \
     --title "Thiết kế cơ chế cấp phát khóa phiên đa dịch vụ" \
     --mode council \
     --repo /home/namnn/code/Factory \
     --participants msw-lead,ide-architect,cloud-security-critic \
     --moderator msw-lead
   ```
2. **Kiểm chứng Cô lập Vòng 1 (`Blind Divergence`)**:
   - Khi `msw-lead` đã nộp đề xuất còn `ide-architect` chưa nộp, gọi `arena_poll_assignment` dưới danh nghĩa `ide-architect` (hoặc `GET /api/v1/rooms/{id}/events?viewerParticipantId=...`).
   - **Kết quả kỳ vọng**: Tuyệt đối không nhìn thấy nội dung bài nộp của `msw-lead` khi `visibility_state = sealed`.
3. **Kiểm chứng Phản biện Ẩn danh Vòng 2 (`Anonymized Cross-Critique`)**:
   - Sau khi đủ 3 đề xuất, hệ thống tự động mở niêm phong dưới dạng `Proposal A`, `Proposal B`, `Proposal C` (ngẫu nhiên hóa thứ tự, ẩn hoàn toàn `model_identifier` và `slug`).
   - Mỗi Agent gọi `arena_submit_critique` chấm điểm Rubric + trích dẫn `file:line`, sau đó gọi `arena_cast_vote`.
4. **Kiểm chứng Tổng hợp & Lưu vết Bất đồng (`Synthesis + DissentLog`)**:
   - `msw-lead` gọi `arena_publish_decision` tạo `DecisionRecord` kèm `dissent_log`.
   - Phòng chuyển sang `awaiting_human_gate` để người dùng ký duyệt trên Web UI hoặc qua `POST /api/v1/rooms/{roomId}/steer`.
   - **Kiểm chứng tiết kiệm ngữ cảnh (`SC-004`)**: Kiểm tra trường `token_accounting.saved_by_context_slicer_tokens` trong `.factory-arena/events/<room-id>.jsonl` xác nhận lượng token đầu vào ở vòng 3 giảm $\ge 50\%$ so với tổng kích thước văn bản thô.

---

## 4. Kịch bản Kiểm chứng Thực thi Song song Cô lập Không Xung đột (Kiểm chứng `SC-003`)

1. Sau khi phê duyệt `DecisionRecord`, hệ thống sinh 2 đơn vị công việc (`bead-1` giao cho `msw-lead`, `bead-2` giao cho `ide-architect`).
2. Cả hai gọi `arena_claim_bead` với `isolation_mode = "git_worktree"`:
   - Hệ thống tự động tạo 2 cây làm việc độc lập dưới `.factory-arena/worktrees/<room-id>/...` mà không chạm vào nhánh đang mở của người dùng.
3. Thử nghiệm xung đột có chủ đích: Dùng một kết nối thứ 3 gọi `POST /api/v1/rooms/{roomId}/beads/{beadId}/lease` với `isolation_mode = "file_lock"` trùng tập đường dẫn đang bị giữ khóa.
   - **Kết quả kỳ vọng**: Nhận mã `HTTP 409 Conflict` ngay lập tức và phát sự kiện `workspace_lease.conflict_detected` lên phòng họp để thương lượng thay vì ghi đè tệp.

---

## 5. Chạy Bộ Kiểm thử Tự động

```bash
pnpm test:contract      # Kiểm tra toàn bộ JSON Schema & OpenAPI contracts
pnpm test:integration   # Kiểm tra Sealed Round 1, Anonymization, SQLite Lease Lock & Git Worktrees thực tế
pnpm test:e2e           # Kiểm tra luồng Web Arena UI + Human Gate
```
