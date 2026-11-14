import type {
  A2ARemoteAdapter,
  ACPBridgeAdapter,
  APIKeyAdapter,
  CLIPtyAdapter,
  MCPBridgeAdapter,
} from "@factory-arena/adapters";
import {
  type ArenaCoreContainer,
  BudgetExceededError,
  type VoteTallyResult,
} from "@factory-arena/core";
import {
  type SessionEmployee,
  TicketPrioritySchema,
  isoNow,
  prefixedUlid,
} from "@factory-arena/protocol";
import { Hono } from "hono";
import { z } from "zod";
import {
  type CouncilBrief,
  abortFailedCouncil,
  collectProposal,
  crossCritique,
} from "./council-orchestration.js";

/** Entries kept in memory; history endpoints only ever return the newest 50. */
const MAX_COMMAND_HISTORY = 500;
const MAX_DEFAULT_COUNCIL_SIZE = 4;

export interface CommandLogEntry {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  transport_type: string;
  ticket_id: string | null;
  prompt: string;
  response_markdown: string;
  execution_mode:
    | "live_llm"
    | "mcp_queue"
    | "acp_bridge"
    | "cli_pty"
    | "a2a_remote"
    | "simulated_no_key";
  cost_usd: number;
  latency_ms: number;
  created_at: string;
}

export interface CommandRoutesDeps {
  core: ArenaCoreContainer;
  mcpAdapter: MCPBridgeAdapter;
  acpAdapter: ACPBridgeAdapter;
  apiKeyAdapter: APIKeyAdapter;
  cliPtyAdapter: CLIPtyAdapter;
  a2aAdapter: A2ARemoteAdapter;
}

export function createCommandRoutes(deps: CommandRoutesDeps): Hono {
  const { core, mcpAdapter, acpAdapter, apiKeyAdapter, cliPtyAdapter, a2aAdapter } = deps;
  const router = new Hono();
  const commandHistory: CommandLogEntry[] = [];

  router.get("/commands/history", (c) => {
    const employeeId = c.req.query("employeeId");
    const items = employeeId
      ? commandHistory.filter(
          (entry) => entry.employee_id === employeeId || entry.employee_code === employeeId,
        )
      : commandHistory;
    return c.json({ commands: items.slice(0, 50) });
  });

  router.post("/participants/:employeeId/command", async (c) => {
    const employeeIdParam = c.req.param("employeeId");
    const employee = core.roster.getEmployeeById(employeeIdParam);
    if (!employee) {
      return c.json({ error: `Không tìm thấy nhân viên: ${employeeIdParam}` }, 404);
    }

    const body = await c.req.json();
    const schema = z.object({
      prompt: z.string().min(1),
      create_ticket: z.boolean().default(true),
      ticket_id: z.string().optional(),
      priority: TicketPrioritySchema.default("p1_high"),
    });
    const parsed = schema.parse(body);
    core.budget.assertWithinBudget({ sessionEmployeeId: employee.id });

    let ticket = parsed.ticket_id ? core.kanban.getTicketById(parsed.ticket_id) : null;
    if (!ticket && parsed.create_ticket) {
      ticket = core.kanban.createTicket({
        title: parsed.prompt.length > 88 ? `${parsed.prompt.slice(0, 85)}...` : parsed.prompt,
        description_markdown: parsed.prompt,
        priority: parsed.priority,
        kanban_column: "in_progress",
        assignee_session_id: employee.id,
      });
    } else if (ticket) {
      ticket = core.kanban.updateTicket(ticket.id, {
        assignee_session_id: employee.id,
        kanban_column: "in_progress",
      });
    }

    core.roster.reportDeskActivity({
      employeeId: employee.id,
      avatarPose: "typing_code",
      ticketId: ticket?.id ?? null,
      lastToolCallSummary: `Đang xử lý lệnh: ${parsed.prompt.slice(0, 64)}`,
    });

    const assignment = {
      roomId: "office-global",
      ticketId: ticket?.id,
      prompt: parsed.prompt,
      systemInstructions: employee.system_instructions,
    };

    let responseMarkdown = "";
    let executionMode: CommandLogEntry["execution_mode"] = "mcp_queue";
    let costUsd = 0;
    let latencyMs = 1;

    try {
      if (employee.transport_type === "api_key") {
        if (employee.credential_id) {
          await apiKeyAdapter.connect(employee);
          const turn = await apiKeyAdapter.sendAssignment(employee, assignment);
          responseMarkdown = turn.contentMarkdown || "(Model trả về chuỗi rỗng)";
          executionMode = "live_llm";
          costUsd = turn.estimatedCostUsd;
          latencyMs = turn.latencyMs;
        } else {
          executionMode = "simulated_no_key";
          responseMarkdown = `⚠️ Nhân viên **${employee.display_name}** (\`${employee.employee_code}\`) là nhân viên mẫu chưa gắn khóa API.\n👉 Bấm nút **🔌 Kết nối / Cấu hình AI** trên thanh công cụ để thêm khóa OpenAI / Anthropic / Gemini hoặc Local Ollama, hệ thống sẽ gọi LLM thật ngay lập tức!`;
        }
      } else if (employee.transport_type === "mcp_bridge") {
        const turn = await mcpAdapter.sendAssignment(employee, assignment);
        responseMarkdown = turn.contentMarkdown;
        executionMode = "mcp_queue";
        latencyMs = turn.latencyMs;
      } else if (employee.transport_type === "acp_editor") {
        await acpAdapter.connect(employee);
        const turn = await acpAdapter.sendAssignment(employee, assignment);
        responseMarkdown = turn.contentMarkdown;
        executionMode = "acp_bridge";
        latencyMs = turn.latencyMs;
      } else if (employee.transport_type === "cli_pty") {
        await cliPtyAdapter.connect(employee);
        const turn = await cliPtyAdapter.sendAssignment(employee, assignment);
        responseMarkdown = turn.contentMarkdown;
        executionMode = "cli_pty";
        latencyMs = turn.latencyMs;
      } else if (employee.transport_type === "a2a_remote") {
        if (employee.agent_card) {
          await a2aAdapter.connect(employee);
          const turn = await a2aAdapter.sendAssignment(employee, assignment);
          responseMarkdown = turn.contentMarkdown;
          executionMode = "a2a_remote";
          latencyMs = turn.latencyMs;
        } else {
          executionMode = "simulated_no_key";
          responseMarkdown = `Nhân viên A2A **${employee.employee_code}** chưa cấu hình \`agent_card.url\`.`;
        }
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        throw err;
      }
      responseMarkdown = `❌ Lỗi khi gọi AI (${employee.employee_code}): ${
        err instanceof Error ? err.message : String(err)
      }`;
    }

    if (ticket && responseMarkdown) {
      core.blackboard.publishArtifact({
        ticketId: ticket.id,
        authorSessionId: employee.id,
        kind: "spec",
        title: `Kết quả thực thi lệnh (${employee.employee_code})`,
        content: `## Lệnh giao\n${parsed.prompt}\n\n## Phản hồi từ ${employee.display_name}\n${responseMarkdown}`,
        compactDigest: responseMarkdown.slice(0, 560),
      });
    }

    const entry: CommandLogEntry = {
      id: prefixedUlid("cmd"),
      employee_id: employee.id,
      employee_code: employee.employee_code,
      employee_name: employee.display_name,
      transport_type: employee.transport_type,
      ticket_id: ticket?.id ?? null,
      prompt: parsed.prompt,
      response_markdown: responseMarkdown,
      execution_mode: executionMode,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      created_at: isoNow(),
    };
    commandHistory.unshift(entry);
    if (commandHistory.length > MAX_COMMAND_HISTORY) commandHistory.length = MAX_COMMAND_HISTORY;

    return c.json({ command: entry, ticket }, 201);
  });

  router.post("/rooms/summon-council", async (c) => {
    const body = await c.req.json();
    const schema = z.object({
      title: z.string().min(1),
      problem_statement: z.string().min(1),
      participant_ids: z.array(z.string()).optional(),
      moderator_id: z.string().optional(),
      linked_ticket_id: z.string().nullable().optional(),
      create_epic_ticket: z.boolean().default(true),
    });
    const parsed = schema.parse(body);

    const allEmployees = core.roster.listEmployees();
    if (allEmployees.length < 2) {
      return c.json(
        { error: "Cần tối thiểu 2 nhân viên AI trong văn phòng để triệu tập Hội đồng Phản biện." },
        400,
      );
    }

    // Validate everything before creating any room or ticket, so a bad request leaves no debris.
    const requestedIds = parsed.participant_ids ? [...new Set(parsed.participant_ids)] : [];
    const unknownIds = requestedIds.filter((id) => !core.roster.getEmployeeById(id));
    if (unknownIds.length > 0) {
      return c.json({ error: `Không tìm thấy nhân viên: ${unknownIds.join(", ")}` }, 400);
    }
    const participants = (
      requestedIds.length >= 2
        ? requestedIds.map((id) => core.roster.getEmployeeById(id))
        : allEmployees.slice(0, Math.min(MAX_DEFAULT_COUNCIL_SIZE, allEmployees.length))
    ).filter((emp): emp is SessionEmployee => emp !== null);
    const chosenIds = participants.map((emp) => emp.id);
    const moderatorId = parsed.moderator_id ?? chosenIds[0];
    if (!moderatorId || !core.roster.getEmployeeById(moderatorId)) {
      return c.json({ error: `Không tìm thấy người điều phối: ${String(moderatorId)}` }, 400);
    }

    for (const pid of chosenIds) {
      core.budget.assertWithinBudget({ sessionEmployeeId: pid });
    }

    let createdEpicId: string | null = null;
    let linkedTicketId = parsed.linked_ticket_id ?? null;
    if (!linkedTicketId && parsed.create_epic_ticket) {
      const epic = core.kanban.createTicket({
        title: parsed.title,
        description_markdown: parsed.problem_statement,
        priority: "p0_critical",
        kanban_column: "in_war_room_debate",
        assignee_session_id: moderatorId,
      });
      createdEpicId = epic.id;
      linkedTicketId = epic.id;
    }

    const { room, round1 } = core.council.createRoom({
      title: parsed.title,
      problemStatement: parsed.problem_statement,
      linkedTicketId,
      protocolMode: "council",
      participantIds: chosenIds,
      moderatorId,
    });
    const brief: CouncilBrief = {
      roomId: room.id,
      roundId: round1.id,
      ticketId: linkedTicketId,
      title: parsed.title,
      problemStatement: parsed.problem_statement,
    };

    try {
      const awaitingLiveIds: string[] = [];
      for (const emp of participants) {
        if ((await collectProposal(deps, emp, brief)) === "awaiting_live") {
          awaitingLiveIds.push(emp.id);
        }
      }
      if (awaitingLiveIds.length > 0) {
        return c.json(
          {
            room: core.council.getRoom(room.id),
            decision: null,
            linked_ticket_id: linkedTicketId,
            awaiting_participant_ids: awaitingLiveIds,
          },
          201,
        );
      }

      const proposals = core.council.getVisibleSubmissionsForViewer(round1.id, "__peer__");
      if (proposals.length === 0) {
        throw new Error("Không thu được đề xuất nào từ các thành viên hội đồng");
      }
      const scoreTotals = await crossCritique(deps, brief, chosenIds, proposals);
      const rankedAliases = [...proposals]
        .sort(
          (a, b) =>
            (scoreTotals.get(b.anonymous_alias) ?? 0) - (scoreTotals.get(a.anonymous_alias) ?? 0),
        )
        .map((p) => p.anonymous_alias);

      let finalTally: VoteTallyResult | null = null;
      for (const voterId of chosenIds) {
        const voted = core.council.castVote({
          roomId: room.id,
          roundId: round1.id,
          voterSessionId: voterId,
          rankedAliases,
          confidence: 0.85,
          rationale: "Ranked by anonymized cross-critique rubric evaluation",
        });
        finalTally = voted.tally;
      }

      const winningAlias =
        finalTally?.winnerAlias ?? rankedAliases[0] ?? proposals[0].anonymous_alias;
      const runnerUpAlias = rankedAliases.find((alias) => alias !== winningAlias) ?? winningAlias;
      const winningProposal =
        proposals.find((p) => p.anonymous_alias === winningAlias) ?? proposals[0];
      const finalPlanMarkdown = await synthesizePlan(
        moderatorId,
        brief,
        winningAlias,
        winningProposal.content_markdown,
      );

      const decision = core.council.publishDecision({
        roomId: room.id,
        moderatorId,
        winningAlias,
        finalPlanMarkdown,
        adoptedAmendments: [
          `Kiểm thử tích hợp & kiểm tra an toàn trước khi hoàn tất "${parsed.title.slice(0, 70)}"`,
        ],
        dissentLog: [
          {
            issue: `Cần theo dõi chi phí vận hành và độ phức tạp khi mở rộng "${parsed.title.slice(0, 60)}"`,
            raised_by_alias: runnerUpAlias,
            revisit_trigger: "Khi lưu lượng hoặc quy mô module tăng gấp 3 lần",
          },
        ],
      });

      return c.json(
        { room: core.council.getRoom(room.id), decision, linked_ticket_id: linkedTicketId },
        201,
      );
    } catch (err: unknown) {
      abortFailedCouncil(core, room.id, createdEpicId);
      throw err;
    }
  });

  /** Let an LLM moderator polish the winning plan; keep the original text otherwise. */
  async function synthesizePlan(
    moderatorId: string,
    brief: CouncilBrief,
    winningAlias: string,
    winningPlan: string,
  ): Promise<string> {
    const moderator = core.roster.getEmployeeById(moderatorId);
    if (moderator?.transport_type !== "api_key" || !moderator.credential_id) return winningPlan;
    try {
      const synthTurn = await apiKeyAdapter.sendAssignment(moderator, {
        roomId: brief.roomId,
        roundId: brief.roundId,
        prompt: `Tổng hợp biên bản quyết định kiến trúc từ phương án thắng cuộc (${winningAlias}):\n${winningPlan}`,
      });
      return synthTurn.contentMarkdown.trim() || winningPlan;
    } catch (err: unknown) {
      if (err instanceof BudgetExceededError) throw err;
      return winningPlan;
    }
  }

  return router;
}
