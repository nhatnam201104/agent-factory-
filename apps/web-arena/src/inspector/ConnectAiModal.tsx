import type { CredentialMetadata, Department, ProviderKind } from "@factory-arena/protocol";
import type React from "react";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient.js";

export interface ConnectAiModalProps {
  open: boolean;
  credentials: CredentialMetadata[];
  employeeCount: number;
  onClose: () => void;
  onRecruited: () => Promise<void>;
}

export function ConnectAiModal({
  open,
  credentials,
  employeeCount,
  onClose,
  onRecruited,
}: ConnectAiModalProps) {
  const [tab, setTab] = useState<"api_key" | "mcp_ide">("api_key");
  const [provider, setProvider] = useState<ProviderKind>("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [existingCredId, setExistingCredId] = useState("");
  const [displayName, setDisplayName] = useState("Architect GPT-4o");
  const [employeeCode, setEmployeeCode] = useState(`API-0${employeeCount + 1}`);
  const [department, setDepartment] = useState<Department>("architecture");
  const [jobTitle, setJobTitle] = useState("Principal AI Engineer");
  const [modelId, setModelId] = useState("gpt-4o-mini");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    setEmployeeCode(`API-0${employeeCount + 1}`);
  }, [employeeCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleProviderChange = (next: ProviderKind) => {
    setProvider(next);
    if (next === "ollama") {
      setBaseUrl("http://127.0.0.1:11434/v1");
      setModelId("qwen2.5-coder:7b");
      setDisplayName("Local Ollama Coder");
      if (!apiKey) setApiKey("ollama");
    } else if (next === "anthropic") {
      setBaseUrl("");
      setModelId("claude-3-7-sonnet-latest");
      setDisplayName("Claude Architect");
    } else if (next === "gemini") {
      setBaseUrl("");
      setModelId("gemini-2.5-flash");
      setDisplayName("Gemini Reviewer");
    } else {
      setBaseUrl("");
      setModelId("gpt-4o-mini");
      setDisplayName("OpenAI Engineer");
    }
  };

  const handleRecruitApiEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMsg(null);
    try {
      let credId = existingCredId;
      if (!credId) {
        const secretToSave = apiKey.trim() || (provider === "ollama" ? "ollama" : "");
        if (!secretToSave) {
          throw new Error("Vui lòng nhập API Key (hoặc chọn Credential đã lưu trong Vault).");
        }
        const vaultRes = await apiFetch("/api/v1/vault/credentials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: `${displayName} (${provider})`,
            provider_kind: provider,
            raw_secret: secretToSave,
            base_url: baseUrl.trim() || undefined,
          }),
        });
        const vaultJson = await vaultRes.json();
        if (!vaultRes.ok) {
          throw new Error(vaultJson.error ?? "Không thể lưu khóa vào Credential Vault");
        }
        credId = vaultJson.id;
      }

      const cleanCode = employeeCode
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]+/g, "-");
      const partRes = await apiFetch("/api/v1/participants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employee_code: cleanCode || `API-0${employeeCount + 1}`,
          display_name: displayName.trim() || "AI Worker",
          department,
          job_title: jobTitle.trim() || "AI Specialist",
          transport_type: "api_key",
          credential_id: credId,
          model_identifier: modelId.trim() || "gpt-4o-mini",
          system_instructions: systemPrompt.trim() || undefined,
        }),
      });
      const partJson = await partRes.json();
      if (!partRes.ok) {
        throw new Error(partJson.error ?? "Không thể tạo nhân viên AI");
      }

      setApiKey("");
      await onRecruited();
      onClose();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const mcpHttpConfig = JSON.stringify(
    {
      mcpServers: {
        "factory-arena": {
          type: "streamable-http",
          url: `${window.location.origin}/mcp`,
        },
      },
    },
    null,
    2,
  );

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Kết nối và Cấu hình Nhân viên AI"
      data-testid="connect-ai-modal"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        margin: 0,
        border: "none",
        color: "var(--text)",
        zIndex: 70,
        background: "var(--overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          width: "min(660px, 100%)",
          maxHeight: "88vh",
          overflowY: "auto",
          border: "1px solid var(--accent)",
        }}
      >
        <h2>
          <span>🔌 Kết nối & Tuyển Nhân viên AI vào Văn phòng 3D</span>
          <button type="button" className="btn" onClick={onClose}>
            ✕ Đóng
          </button>
        </h2>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            className={`btn${tab === "api_key" ? " btn-primary" : ""}`}
            onClick={() => setTab("api_key")}
          >
            🔑 Kết nối API Key / Local Ollama
          </button>
          <button
            type="button"
            className={`btn${tab === "mcp_ide" ? " btn-primary" : ""}`}
            onClick={() => setTab("mcp_ide")}
          >
            💻 Kết nối IDE (Cursor / VS Code / MCP)
          </button>
        </div>

        {tab === "api_key" ? (
          <form onSubmit={handleRecruitApiEmployee} style={{ fontSize: "0.82rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>Nhà cung cấp (Provider)</span>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as ProviderKind)}
                  style={{
                    background: "var(--field)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 8px",
                  }}
                >
                  <option value="openai_compatible">
                    OpenAI / OpenRouter / Groq / vLLM (Compatible)
                  </option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="ollama">Local Ollama (Chạy miễn phí trên máy)</option>
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>Model ID</span>
                <input
                  type="text"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="gpt-4o-mini / qwen2.5-coder:7b..."
                  style={{
                    background: "var(--field)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 8px",
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>Tên hiển thị trên đầu nhân vật 3D</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  style={{
                    background: "var(--field)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 8px",
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>Mã nhân viên (VD: API-05)</span>
                <input
                  type="text"
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  required
                  style={{
                    background: "var(--field)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 8px",
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>Phòng ban</span>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as Department)}
                  style={{
                    background: "var(--field)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 8px",
                  }}
                >
                  <option value="architecture">Architecture</option>
                  <option value="backend">Backend</option>
                  <option value="frontend">Frontend</option>
                  <option value="security_qa">Security & QA</option>
                  <option value="devops">DevOps</option>
                  <option value="leadership">Leadership</option>
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>Chức danh (Job Title)</span>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  style={{
                    background: "var(--field)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 8px",
                  }}
                />
              </label>
            </div>

            {credentials.length > 0 ? (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
                <span>Dùng lại khóa đã lưu trong Vault (tùy chọn)</span>
                <select
                  value={existingCredId}
                  onChange={(e) => setExistingCredId(e.target.value)}
                  style={{
                    background: "var(--field)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 8px",
                  }}
                >
                  <option value="">-- Nhập API Key mới bên dưới --</option>
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>
                      🔐 {c.label} ({c.provider_kind})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {!existingCredId ? (
              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>API Key (Mã hóa AES-256-GCM trong Vault)</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={provider === "ollama" ? "ollama (không cần key)" : "sk-..."}
                    style={{
                      background: "var(--field)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "7px 8px",
                    }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Custom Base URL (OpenRouter / Ollama / Proxy)</span>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="Mặc định theo nhà cung cấp"
                    style={{
                      background: "var(--field)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "7px 8px",
                    }}
                  />
                </label>
              </div>
            ) : null}

            <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
              <span>Chỉ dẫn vai trò gốc (System Prompt — tùy chọn)</span>
              <input
                type="text"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="VD: Bạn là chuyên gia kiểm toán bảo mật khắt khe, luôn trích dẫn mã nguồn..."
                style={{
                  background: "var(--field)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "7px 8px",
                }}
              />
            </label>

            {statusMsg ? (
              <div style={{ marginTop: 10, color: "var(--danger)" }}>⚠️ {statusMsg}</div>
            ) : null}

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy}
                data-testid="btn-submit-connect-ai"
              >
                {busy ? "Đang kết nối..." : "✅ Lưu Vault & Đưa Nhân viên vào Bàn 3D"}
              </button>
            </div>
          </form>
        ) : (
          <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
            <p style={{ marginTop: 0 }}>
              1. Dán cấu hình sau vào tệp <code>.cursor/mcp.json</code> hoặc{" "}
              <code>.vscode/mcp.json</code> của IDE:
            </p>
            <pre
              style={{
                background: "var(--field)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                overflowX: "auto",
                fontSize: "0.78rem",
              }}
            >
              {mcpHttpConfig}
            </pre>
            <p>
              2. Trong khung chat của IDE / Agent, nhắn lệnh điểm danh để hiện nhân vật 3D:
              <br />
              <code>
                Gọi tool arena_checkin_desk với employee_code=&quot;CUR-01&quot;,
                department=&quot;backend&quot;, job_title=&quot;Backend Dev&quot;
              </code>
            </p>
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>
              3. Khi bạn gõ lệnh giao việc cho nhân viên MCP ngay trên giao diện Web này, IDE có thể
              gọi tool <code>arena_poll_desk_directives</code> để lấy lệnh về thực thi.
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
}
