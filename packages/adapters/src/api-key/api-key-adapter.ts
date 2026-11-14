import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { CredentialVault, PayrollBudgetGuard } from "@factory-arena/core";
import type { SessionEmployee } from "@factory-arena/protocol";
import type {
  AdapterAssignmentPayload,
  AdapterTurnResult,
  ParticipantAdapter,
} from "../adapter.interface.js";

export class APIKeyAdapter implements ParticipantAdapter {
  public readonly transportType = "api_key" as const;
  private readonly connected = new Set<string>();

  constructor(
    private readonly vault: CredentialVault,
    private readonly budgetGuard: PayrollBudgetGuard,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async connect(employee: SessionEmployee): Promise<void> {
    if (!employee.credential_id) {
      throw new Error(
        `APIKeyAdapter requires credential_id for employee ${employee.employee_code}`,
      );
    }
    this.vault.resolveDecryptedSecret(employee.credential_id);
    this.connected.add(employee.id);
  }

  public async disconnect(employeeId: string): Promise<void> {
    this.connected.delete(employeeId);
  }

  public async heartbeat(employeeId: string): Promise<boolean> {
    return this.connected.has(employeeId);
  }

  public async resolvePermission(): Promise<void> {
    // API key workers execute stateless calls gated by PayrollBudgetGuard
  }

  public readRepoExcerpt(
    repoRoot: string,
    relativeFilePath: string,
    startLine = 1,
    endLine = 80,
  ): string {
    const resolvedRoot = resolve(repoRoot);
    const abs = resolve(resolvedRoot, relativeFilePath);
    const rel = relative(resolvedRoot, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Path traversal outside repository root is prohibited");
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return `[File not found: ${relativeFilePath}]`;
    }
    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    return lines
      .slice(Math.max(0, startLine - 1), endLine)
      .map((l, idx) => `${startLine + idx}: ${l}`)
      .join("\n");
  }

  public async sendAssignment(
    employee: SessionEmployee,
    assignment: AdapterAssignmentPayload,
  ): Promise<AdapterTurnResult> {
    if (!employee.credential_id) {
      throw new Error(`Missing credential_id on employee ${employee.id}`);
    }
    const { metadata, rawSecret } = this.vault.resolveDecryptedSecret(employee.credential_id);
    this.budgetGuard.assertWithinBudget({
      sessionEmployeeId: employee.id,
      roomId: assignment.roomId,
      credentialId: employee.credential_id,
      credentialMaxCostUsd: metadata.max_cost_usd,
    });
    const start = Date.now();
    const model = employee.model_identifier ?? "gpt-4o-mini";

    let url = metadata.base_url ?? "https://api.openai.com/v1/chat/completions";
    const headers: Record<string, string> = { "content-type": "application/json" };
    let body: Record<string, unknown>;

    if (metadata.provider_kind === "anthropic") {
      url = metadata.base_url ?? "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = rawSecret;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model,
        max_tokens: 1024,
        system: assignment.systemInstructions ?? employee.system_instructions ?? employee.job_title,
        messages: [{ role: "user", content: assignment.prompt }],
      };
    } else if (metadata.provider_kind === "gemini") {
      const base =
        metadata.base_url ??
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      url = `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(rawSecret)}`;
      body = {
        contents: [{ role: "user", parts: [{ text: assignment.prompt }] }],
      };
    } else {
      if (!url.endsWith("/chat/completions")) {
        url = `${url.replace(/\/+$/, "")}/chat/completions`;
      }
      headers.authorization = `Bearer ${rawSecret}`;
      body = {
        model,
        messages: [
          {
            role: "system",
            content:
              assignment.systemInstructions ?? employee.system_instructions ?? employee.job_title,
          },
          { role: "user", content: assignment.prompt },
        ],
      };
    }

    const resp = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Provider HTTP ${resp.status} for ${employee.employee_code}`);
    }

    const data = (await resp.json()) as Record<string, any>;
    let text = "";
    if (metadata.provider_kind === "anthropic") {
      text = String(data.content?.[0]?.text ?? "");
    } else if (metadata.provider_kind === "gemini") {
      text = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    } else {
      text = String(data.choices?.[0]?.message?.content ?? "");
    }

    const promptTokens = Number(data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 120);
    const completionTokens = Number(
      data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 180,
    );
    const estimatedCostUsd = Number(((promptTokens + completionTokens) * 0.000002).toFixed(6));

    this.budgetGuard.recordSpend({
      sessionEmployeeId: employee.id,
      roomId: assignment.roomId,
      promptTokens,
      completionTokens,
      costUsd: estimatedCostUsd,
    });

    return {
      contentMarkdown: text,
      summary: text.slice(0, 280),
      promptTokens,
      completionTokens,
      estimatedCostUsd,
      latencyMs: Date.now() - start,
    };
  }
}
