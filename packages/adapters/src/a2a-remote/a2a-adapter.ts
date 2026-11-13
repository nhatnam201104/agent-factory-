import { assertSafeRemoteUrl } from "@factory-arena/core";
import {
  type AgentCard,
  AgentCardSchema,
  type SessionEmployee
} from "@factory-arena/protocol";
import type {
  AdapterAssignmentPayload,
  AdapterTurnResult,
  ParticipantAdapter
} from "../adapter.interface.js";

export class A2ARemoteAdapter implements ParticipantAdapter {
  public readonly transportType = "a2a_remote" as const;
  private readonly remoteCards = new Map<string, AgentCard>();

  constructor(
    private readonly hubBaseUrl: string = "http://127.0.0.1:4747",
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public buildHubAgentCard(): AgentCard {
    return AgentCardSchema.parse({
      name: "Factory Virtual Office & Multi-Agent Arena",
      description:
        "Local-first 3D Virtual Office & Multi-Agent Deliberation Hub supporting MCP, ACP v1, API Key Workers, CLI PTY, and Linux Foundation A2A.",
      url: this.hubBaseUrl,
      version: "1.0.0",
      protocolVersion: "0.3.0",
      provider: {
        organization: "Factory Arena",
        transport: "a2a_remote"
      },
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
        acpProtocolVersion: 1,
        workspaceAccess: "isolated_worktree"
      },
      authentication: {
        schemes: ["Bearer", "LocalSessionToken"]
      },
      defaultInputModes: ["text/markdown", "application/json"],
      defaultOutputModes: ["text/markdown", "application/json"],
      skills: [
        {
          id: "council-deliberation",
          name: "4-Stage Anonymous Council Deliberation",
          description:
            "Orchestrates blind divergence, anonymized rubric cross-critique, weighted voting, and synthesis with DissentLog.",
          tags: ["multi-agent", "debate", "council", "architecture"]
        },
        {
          id: "isolated-kanban-execution",
          name: "Kanban Task Execution with Git Worktrees",
          description:
            "Assigns atomic tickets to 1:1 session employees on isolated Git worktrees or file leases.",
          tags: ["kanban", "git-worktree", "coding-agents"]
        }
      ]
    });
  }

  public async connect(
    employee: SessionEmployee,
    options: { allowLoopback?: boolean } = {}
  ): Promise<void> {
    if (employee.agent_card) {
      assertSafeRemoteUrl(employee.agent_card.url, {
        allowLoopbackForLocalAgent: options.allowLoopback
      });
      this.remoteCards.set(employee.id, AgentCardSchema.parse(employee.agent_card));
    }
  }

  public async disconnect(employeeId: string): Promise<void> {
    this.remoteCards.delete(employeeId);
  }

  public async heartbeat(employeeId: string): Promise<boolean> {
    return this.remoteCards.has(employeeId);
  }

  public async resolvePermission(): Promise<void> {
    // Handled via A2A tasks/sendSubscribe updates
  }

  public async sendAssignment(
    employee: SessionEmployee,
    assignment: AdapterAssignmentPayload
  ): Promise<AdapterTurnResult> {
    const card = this.remoteCards.get(employee.id);
    if (!card) {
      throw new Error(`No A2A AgentCard registered for employee ${employee.employee_code}`);
    }
    const start = Date.now();
    const resp = await this.fetchImpl(card.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `a2a_${Date.now()}`,
        method: "tasks/send",
        params: {
          id: assignment.ticketId ?? assignment.roomId,
          message: {
            role: "user",
            parts: [{ type: "text", text: assignment.prompt }]
          }
        }
      })
    });
    if (!resp.ok) {
      throw new Error(`A2A remote agent returned HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as Record<string, any>;
    const text = String(
      data.result?.artifacts?.[0]?.parts?.[0]?.text ??
        data.result?.status?.message?.parts?.[0]?.text ??
        JSON.stringify(data.result ?? {})
    );
    return {
      contentMarkdown: text,
      summary: text.slice(0, 280),
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - start
    };
  }
}
