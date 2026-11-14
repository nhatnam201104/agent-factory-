import { createInterface } from "node:readline";
import type { ArenaCoreContainer } from "@factory-arena/core";
import {
  MCPCheckinDeskInputSchema,
  MCPReportDeskActivityInputSchema,
  type SessionEmployee,
} from "@factory-arena/protocol";
import type {
  AdapterAssignmentPayload,
  AdapterTurnResult,
  ParticipantAdapter,
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

export interface MCPStdioProxyOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  hubUrl?: string;
  adapter?: MCPBridgeAdapter;
  allowLocalFallback?: boolean;
  fetchImpl?: typeof fetch;
}

export interface MCPStdioProxyHandle {
  close: () => void;
  closed: Promise<void>;
}

export interface QueuedMcpDirective {
  id: string;
  employee_id: string;
  room_id: string;
  ticket_id?: string;
  prompt: string;
  created_at: string;
}

export class MCPBridgeAdapter implements ParticipantAdapter {
  public readonly transportType = "mcp_bridge" as const;
  private readonly connectedSessions = new Set<string>();
  private readonly pendingDirectives = new Map<string, QueuedMcpDirective[]>();

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

  public drainDirectives(employeeIdOrCode: string): QueuedMcpDirective[] {
    const emp = this.core.roster.getEmployeeById(employeeIdOrCode);
    const key = emp?.id ?? employeeIdOrCode;
    const items = this.pendingDirectives.get(key) ?? [];
    this.pendingDirectives.delete(key);
    return items;
  }

  public peekDirectives(employeeIdOrCode: string): QueuedMcpDirective[] {
    const emp = this.core.roster.getEmployeeById(employeeIdOrCode);
    const key = emp?.id ?? employeeIdOrCode;
    return [...(this.pendingDirectives.get(key) ?? [])];
  }

  public async sendAssignment(
    employee: SessionEmployee,
    assignment: AdapterAssignmentPayload,
  ): Promise<AdapterTurnResult> {
    const directive: QueuedMcpDirective = {
      id: `dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      employee_id: employee.id,
      room_id: assignment.roomId,
      ticket_id: assignment.ticketId,
      prompt: assignment.prompt,
      created_at: new Date().toISOString(),
    };
    const existing = this.pendingDirectives.get(employee.id) ?? [];
    existing.push(directive);
    this.pendingDirectives.set(employee.id, existing);

    this.core.roster.reportDeskActivity({
      employeeId: employee.id,
      avatarPose: "typing_code",
      ticketId: assignment.ticketId ?? null,
      lastToolCallSummary: `Nhận lệnh mới: ${assignment.prompt.slice(0, 72)}`,
    });
    return {
      contentMarkdown: `Đã đẩy lệnh vào hàng đợi MCP của phiên **${employee.display_name}** (\`${employee.employee_code}\`). Trong IDE/Agent, gọi tool \`arena_poll_desk_directives\` với \`employee_id: "${employee.employee_code}"\` để nhận và thực thi lệnh này.`,
      summary: `Queued MCP directive for ${employee.employee_code}`,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 1,
    };
  }

  public async resolvePermission(
    _employeeId: string,
    permissionId: string,
    decision: "allowed" | "denied" | "answered",
    answerText?: string,
  ): Promise<void> {
    this.core.roster.resolvePermission({
      permissionId,
      decision,
      answerText,
    });
  }

  public listTools() {
    return [
      {
        name: "arena_checkin_desk",
        description: "Check in active AI session to a 3D desk",
        inputSchema: {
          type: "object",
          required: ["session_fingerprint", "employee_code", "department", "job_title"],
          properties: {
            session_fingerprint: { type: "string" },
            employee_code: { type: "string", pattern: "^[A-Z0-9-]+$" },
            display_name: { type: "string" },
            department: {
              type: "string",
              enum: ["leadership", "architecture", "backend", "frontend", "security_qa", "devops"],
            },
            job_title: { type: "string" },
            workspace_uri: { type: "string" },
          },
        },
      },
      {
        name: "arena_report_desk_activity",
        description: "Sync pose, context %, or hand-raise",
        inputSchema: {
          type: "object",
          required: ["employee_id", "avatar_pose"],
          properties: {
            employee_id: { type: "string" },
            avatar_pose: {
              type: "string",
              enum: [
                "idle",
                "typing_code",
                "reading_files",
                "running_tests",
                "speaking",
                "hand_raised",
              ],
            },
            last_tool_call_summary: { type: "string" },
            context_fill_pct: { type: "number", minimum: 0, maximum: 100 },
            permission_prompt: { type: "string" },
          },
        },
      },
      {
        name: "arena_join_room",
        description: "Join a deliberation War Room",
        inputSchema: {
          type: "object",
          required: ["room_id", "slug", "persona_role", "capabilities"],
          properties: {
            room_id: { type: "string" },
            slug: { type: "string", pattern: "^[a-z0-9-]+$" },
            display_name: { type: "string" },
            persona_role: { type: "string" },
            capabilities: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "propose",
                  "critique",
                  "vote",
                  "read_repo",
                  "edit_worktree",
                  "run_tests",
                  "moderate",
                ],
              },
            },
          },
        },
      },
      {
        name: "arena_poll_assignment",
        description: "Poll visibility-gated round assignment",
        inputSchema: {
          type: "object",
          required: ["room_id", "participant_id"],
          properties: {
            room_id: { type: "string" },
            participant_id: { type: "string" },
            wait_timeout_ms: { type: "integer", default: 25000, maximum: 60000 },
          },
        },
      },
      {
        name: "arena_submit_proposal",
        description: "Submit Round-1/Rebuttal proposal",
        inputSchema: {
          type: "object",
          required: ["room_id", "round_id", "participant_id", "summary", "content_markdown"],
          properties: {
            room_id: { type: "string" },
            round_id: { type: "string" },
            participant_id: { type: "string" },
            summary: { type: "string", maxLength: 1500 },
            content_markdown: { type: "string" },
            citations: {
              type: "array",
              items: {
                type: "object",
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  line_start: { type: "integer" },
                  line_end: { type: "integer" },
                  artifact_id: { type: "string" },
                },
              },
            },
          },
        },
      },
      {
        name: "arena_submit_critique",
        description: "Submit rubric critique on Proposal A..N",
        inputSchema: {
          type: "object",
          required: [
            "room_id",
            "round_id",
            "reviewer_id",
            "target_anonymous_alias",
            "rubric_scores",
            "findings",
          ],
          properties: {
            room_id: { type: "string" },
            round_id: { type: "string" },
            reviewer_id: { type: "string" },
            target_anonymous_alias: { type: "string" },
            rubric_scores: {
              type: "object",
              required: ["correctness", "security", "maintainability", "feasibility"],
              properties: {
                correctness: { type: "integer", minimum: 1, maximum: 10 },
                security: { type: "integer", minimum: 1, maximum: 10 },
                maintainability: { type: "integer", minimum: 1, maximum: 10 },
                feasibility: { type: "integer", minimum: 1, maximum: 10 },
              },
            },
            findings: {
              type: "array",
              items: {
                type: "object",
                required: ["severity", "category", "claim"],
                properties: {
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  category: {
                    type: "string",
                    enum: ["logic", "security", "performance", "edge_case", "architecture"],
                  },
                  claim: { type: "string" },
                  evidence_ref: { type: "string" },
                },
              },
            },
            strengths_summary: { type: "string" },
            blind_spots_summary: { type: "string" },
          },
        },
      },
      {
        name: "arena_cast_vote",
        description: "Cast ranked-choice vote",
        inputSchema: {
          type: "object",
          required: ["room_id", "round_id", "voter_id", "ranked_aliases", "confidence"],
          properties: {
            room_id: { type: "string" },
            round_id: { type: "string" },
            voter_id: { type: "string" },
            ranked_aliases: { type: "array", minItems: 1, items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" },
          },
        },
      },
      {
        name: "arena_publish_decision",
        description: "Publish synthesized DecisionRecord",
        inputSchema: {
          type: "object",
          required: [
            "room_id",
            "moderator_id",
            "winning_alias",
            "final_plan_markdown",
            "dissent_log",
          ],
          properties: {
            room_id: { type: "string" },
            moderator_id: { type: "string" },
            winning_alias: { type: "string" },
            final_plan_markdown: { type: "string" },
            adopted_amendments: { type: "array", items: { type: "string" } },
            dissent_log: {
              type: "array",
              items: {
                type: "object",
                required: ["issue", "raised_by_alias", "revisit_trigger"],
                properties: {
                  issue: { type: "string" },
                  raised_by_alias: { type: "string" },
                  revisit_trigger: { type: "string" },
                },
              },
            },
          },
        },
      },
      {
        name: "arena_publish_artifact",
        description: "Store artifact on Shared Blackboard",
        inputSchema: {
          type: "object",
          required: ["room_id", "author_id", "kind", "title", "content", "compact_digest"],
          properties: {
            room_id: { type: "string" },
            author_id: { type: "string" },
            kind: {
              type: "string",
              enum: ["spec", "architecture_diagram", "code_diff", "test_report", "log_excerpt"],
            },
            title: { type: "string" },
            content: { type: "string" },
            compact_digest: { type: "string", maxLength: 600 },
          },
        },
      },
      {
        name: "arena_read_artifact",
        description: "Read artifact content by ID",
        inputSchema: {
          type: "object",
          required: ["artifact_id"],
          properties: {
            artifact_id: { type: "string" },
          },
        },
      },
      {
        name: "arena_claim_bead",
        description: "Claim Kanban ticket with isolated Git worktree",
        inputSchema: {
          type: "object",
          required: ["room_id", "bead_id", "participant_id", "isolation_mode"],
          properties: {
            room_id: { type: "string" },
            bead_id: { type: "string" },
            participant_id: { type: "string" },
            isolation_mode: { type: "string", enum: ["git_worktree", "file_lock"] },
            locked_globs: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "arena_poll_desk_directives",
        description:
          "Fetch direct commands sent from the 3D Virtual Office UI to this IDE/MCP employee",
        inputSchema: {
          type: "object",
          required: ["employee_id"],
          properties: {
            employee_id: { type: "string" },
          },
        },
      },
    ];
  }

  public invokeTool(toolName: string, args: Record<string, unknown>): unknown {
    if (toolName === "arena_poll_desk_directives") {
      const employeeId = String(args.employee_id ?? "");
      if (!employeeId) {
        throw new Error("employee_id is required");
      }
      return {
        directives: this.drainDirectives(employeeId),
      };
    }

    if (toolName === "arena_checkin_desk") {
      const input = MCPCheckinDeskInputSchema.parse(args);
      const emp = this.core.roster.registerOrRebindSession({
        session_fingerprint: input.session_fingerprint,
        employee_code: input.employee_code,
        display_name: input.display_name ?? input.employee_code,
        department: input.department,
        job_title: input.job_title,
        transport_type: "mcp_bridge",
        workspace_uri: input.workspace_uri,
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
        permissionPrompt: input.permission_prompt,
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
            capabilities: { tools: {} },
          },
        };
      }
      if (req.method === "ping" || req.method.startsWith("notifications/")) {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }
      if (req.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: this.listTools() },
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
            structuredContent: output,
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unsupported JSON-RPC method: ${req.method}` },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  public startStdioServer(
    options: Omit<MCPStdioProxyOptions, "adapter"> = {},
  ): MCPStdioProxyHandle {
    return startMcpStdioProxy({
      ...options,
      adapter: this,
    });
  }
}

export function startMcpStdioProxy(options: MCPStdioProxyOptions): MCPStdioProxyHandle {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cleanHubEndpoint = options.hubUrl
    ? `${options.hubUrl.replace(/\/+$/, "").replace(/\/mcp$/, "")}/mcp`
    : null;

  const rl = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY,
    terminal: false,
  });

  let pendingQueue = Promise.resolve();

  const dispatchSingle = async (req: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const isNotification = !("id" in req) || req.id === undefined;
    if (cleanHubEndpoint) {
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        const sessionToken = process.env.FACTORY_ARENA_API_TOKEN?.trim();
        if (sessionToken) {
          headers["x-arena-session-token"] = sessionToken;
        }
        const res = await fetchImpl(cleanHubEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(req),
        });
        if (!res.ok) {
          throw new Error(`Hub MCP endpoint returned HTTP ${res.status}`);
        }
        if (isNotification) {
          return null;
        }
        return (await res.json()) as JsonRpcResponse;
      } catch (err) {
        if (options.allowLocalFallback && options.adapter) {
          return isNotification ? null : options.adapter.handleJsonRpc(req);
        }
        if (isNotification) {
          return null;
        }
        return {
          jsonrpc: "2.0",
          id: req.id ?? null,
          error: {
            code: -32001,
            message: `MCP stdio proxy failed to reach Hub (${cleanHubEndpoint}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        };
      }
    }

    if (isNotification) {
      return null;
    }

    if (options.adapter) {
      return options.adapter.handleJsonRpc(req);
    }

    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: {
        code: -32603,
        message: "No Hub URL or local MCPBridgeAdapter configured for stdio transport",
      },
    };
  };

  rl.on("line", (rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed || /^content-length:/i.test(trimmed)) {
      return;
    }
    pendingQueue = pendingQueue.then(async () => {
      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        const parseErr: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error: invalid JSON-RPC payload" },
        };
        output.write(`${JSON.stringify(parseErr)}\n`);
        return;
      }

      const response = await dispatchSingle(parsed);
      if (response) {
        output.write(`${JSON.stringify(response)}\n`);
      }
    });
  });

  const closed = new Promise<void>((resolveClosed) => {
    rl.once("close", () => {
      void pendingQueue.finally(() => resolveClosed());
    });
  });

  return {
    close: () => rl.close(),
    closed,
  };
}
