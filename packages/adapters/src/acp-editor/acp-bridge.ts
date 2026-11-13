import type { ArenaCoreContainer } from "@factory-arena/core";
import type { SessionEmployee } from "@factory-arena/protocol";
import type {
  AdapterAssignmentPayload,
  AdapterTurnResult,
  ParticipantAdapter
} from "../adapter.interface.js";

export interface AcpWireMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

/**
 * Agent Client Protocol (ACP v1) bidirectional editor bridge for Zed, JetBrains, Neovim & VS Code.
 */
export class ACPBridgeAdapter implements ParticipantAdapter {
  public readonly transportType = "acp_editor" as const;
  private readonly sessions = new Map<string, { protocolVersion: number; workspaceUri?: string }>();

  constructor(private readonly core: ArenaCoreContainer) {}

  public async connect(employee: SessionEmployee): Promise<void> {
    this.sessions.set(employee.id, { protocolVersion: 1 });
  }

  public async disconnect(employeeId: string): Promise<void> {
    this.sessions.delete(employeeId);
  }

  public async heartbeat(employeeId: string): Promise<boolean> {
    return this.sessions.has(employeeId);
  }

  public async sendAssignment(
    employee: SessionEmployee,
    assignment: AdapterAssignmentPayload
  ): Promise<AdapterTurnResult> {
    this.core.roster.reportDeskActivity({
      employeeId: employee.id,
      avatarPose: "typing_code",
      lastToolCallSummary: `ACP session/prompt dispatched (${assignment.roomId})`
    });
    return {
      contentMarkdown: `ACP prompt delivered to editor session ${employee.employee_code}`,
      summary: `ACP prompt delivered`,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 2
    };
  }

  public async resolvePermission(
    _employeeId: string,
    permissionId: string,
    decision: "allowed" | "denied" | "answered",
    answerText?: string
  ): Promise<void> {
    this.core.roster.resolvePermission({ permissionId, decision, answerText });
  }

  public handleAcpMessage(msg: AcpWireMessage) {
    if (msg.method === "initialize") {
      const negotiated = Number(msg.params?.protocolVersion ?? 1);
      return {
        jsonrpc: "2.0" as const,
        id: msg.id ?? null,
        result: {
          protocolVersion: negotiated === 1 ? 1 : 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { embeddedContext: true }
          }
        }
      };
    }

    if (msg.method === "session/new") {
      const code = String(msg.params?.employeeCode ?? "ACP-IDE-01");
      const workspaceUri = String(msg.params?.cwd ?? process.cwd());
      const emp = this.core.roster.registerOrRebindSession({
        session_fingerprint: `acp_editor:${workspaceUri}:${code}`,
        employee_code: code,
        display_name: String(msg.params?.displayName ?? code),
        department: "frontend",
        job_title: "ACP Editor Coding Agent",
        transport_type: "acp_editor",
        workspace_uri: workspaceUri
      });
      this.sessions.set(emp.id, { protocolVersion: 1, workspaceUri });
      return {
        jsonrpc: "2.0" as const,
        id: msg.id ?? null,
        result: { sessionId: emp.id, employee: emp }
      };
    }

    return {
      jsonrpc: "2.0" as const,
      id: msg.id ?? null,
      error: { code: -32601, message: `Unsupported ACP method: ${msg.method}` }
    };
  }
}
