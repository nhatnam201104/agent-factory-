import type { ArenaCoreContainer } from "@factory-arena/core";
import {
  MCPCheckinDeskInputSchema,
  MCPReportDeskActivityInputSchema,
  type SessionEmployee
} from "@factory-arena/protocol";
import type {
  AdapterAssignmentPayload,
  AdapterTurnResult,
  ParticipantAdapter
} from "../adapter.interface.js";
import { handleCouncilMcpTool } from "./mcp-council-tools.js";
import { handleKanbanMcpTool } from "./mcp-kanban-tools.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPBridgeAdapter implements ParticipantAdapter {
  public readonly transportType = "mcp_bridge" as const;
  private readonly connectedSessions = new Set<string>();

  constructor(private readonly core: ArenaCoreContainer) {}

  public async connect(employee: SessionEmployee): Promise<void> {
    this.connectedSessions.add(employee.id);
  }

  public async disconnect(employeeId: string): Promise<void> {
    this.connectedSessions.delete(employeeId);
  }

  public async heartbeat(employeeId: string): Promise<boolean> {
    return this.connectedSessions.has(employeeId);
  }

  public async sendAssignment(
    employee: SessionEmployee,
    assignment: AdapterAssignmentPayload
  ): Promise<AdapterTurnResult> {
    this.core.roster.reportDeskActivity({
      employeeId: employee.id,
      avatarPose: "typing_code",
      lastToolCallSummary: `queued MCP assignment for ${assignment.roomId}`
    });
    return {
      contentMarkdown: `Assignment queued for MCP client ${employee.employee_code}`,
      summary: `Queued on MCP session ${employee.employee_code}`,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 1
    };
  }

  public async resolvePermission(
    _employeeId: string,
    permissionId: string,
    decision: "allowed" | "denied" | "answered",
    answerText?: string
  ): Promise<void> {
    this.core.roster.resolvePermission({
      permissionId,
      decision,
      answerText
    });
  }

  public listTools() {
    return [
      { name: "arena_checkin_desk", description: "Check in active AI session to a 3D desk" },
      { name: "arena_report_desk_activity", description: "Sync pose, context %, or hand-raise" },
      { name: "arena_join_room", description: "Join a deliberation War Room" },
      { name: "arena_poll_assignment", description: "Poll visibility-gated round assignment" },
      { name: "arena_submit_proposal", description: "Submit Round-1/Rebuttal proposal" },
      { name: "arena_submit_critique", description: "Submit rubric critique on Proposal A..N" },
      { name: "arena_cast_vote", description: "Cast ranked-choice vote" },
      { name: "arena_publish_decision", description: "Publish synthesized DecisionRecord" },
      { name: "arena_publish_artifact", description: "Store artifact on Shared Blackboard" },
      { name: "arena_read_artifact", description: "Read artifact content by ID" },
      { name: "arena_claim_bead", description: "Claim Kanban ticket with isolated Git worktree" }
    ];
  }

  public invokeTool(toolName: string, args: Record<string, unknown>): unknown {
    if (toolName === "arena_checkin_desk") {
      const input = MCPCheckinDeskInputSchema.parse(args);
      const emp = this.core.roster.registerOrRebindSession({
        session_fingerprint: input.session_fingerprint,
        employee_code: input.employee_code,
        display_name: input.display_name ?? input.employee_code,
        department: input.department,
        job_title: input.job_title,
        transport_type: "mcp_bridge",
        workspace_uri: input.workspace_uri
      });
      this.connectedSessions.add(emp.id);
      return emp;
    }

    if (toolName === "arena_report_desk_activity") {
      const input = MCPReportDeskActivityInputSchema.parse(args);
      return this.core.roster.reportDeskActivity({
        employeeId: input.employee_id,
        avatarPose: input.avatar_pose,
        lastToolCallSummary: input.last_tool_call_summary,
        contextFillPct: input.context_fill_pct,
        permissionPrompt: input.permission_prompt
      });
    }

    const councilResult = handleCouncilMcpTool(this.core, toolName, args);
    if (councilResult !== undefined) return councilResult;

    const kanbanResult = handleKanbanMcpTool(this.core, toolName, args);
    if (kanbanResult !== undefined) return kanbanResult;

    throw new Error(`Unknown Arena MCP tool: ${toolName}`);
  }

  public handleJsonRpc(req: JsonRpcRequest): JsonRpcResponse {
    const id = req.id ?? null;
    try {
      if (req.method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-03-26",
            serverInfo: { name: "factory-arena-mcp", version: "1.0.0" },
            capabilities: { tools: {} }
          }
        };
      }
      if (req.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: this.listTools() }
        };
      }
      if (req.method === "tools/call") {
        const name = String(req.params?.name ?? "");
        const toolArgs = (req.params?.arguments ?? {}) as Record<string, unknown>;
        const output = this.invokeTool(name, toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output
          }
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unsupported JSON-RPC method: ${req.method}` }
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err)
        }
      };
    }
  }
}
