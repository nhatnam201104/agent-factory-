import type { DatabaseSync } from "node:sqlite";
import {
  type AvatarPose,
  type ConnectionStatus,
  type PermissionRequest,
  PermissionRequestSchema,
  type RegisterEmployeeInput,
  RegisterEmployeeInputSchema,
  type SessionEmployee,
  SessionEmployeeSchema,
  type SpatialZone,
  isoNow,
  prefixedUlid
} from "@factory-arena/protocol";
import type { EventLedger } from "../storage/event-ledger.js";

const DEPT_PREFIX: Record<string, string> = {
  leadership: "LEAD",
  architecture: "ARCH",
  backend: "BE",
  frontend: "FE",
  security_qa: "SEC",
  devops: "OPS"
};

export class OfficeRosterService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ledger: EventLedger
  ) {}

  public registerOrRebindSession(rawInput: RegisterEmployeeInput): SessionEmployee {
    const input = RegisterEmployeeInputSchema.parse(rawInput);
    const fingerprint =
      input.session_fingerprint ??
      `${input.transport_type}:${input.workspace_uri ?? "local"}:${input.employee_code}`;

    const existing = this.db
      .prepare(`SELECT * FROM session_employees WHERE session_fingerprint = ?`)
      .get(fingerprint) as Record<string, unknown> | undefined;

    const now = isoNow();
    if (existing) {
      this.db
        .prepare(
          `UPDATE session_employees
           SET display_name = ?, department = ?, job_title = ?, connection_status = 'online',
               spatial_zone = CASE WHEN spatial_zone = 'lounge_offline' THEN 'at_desk' ELSE spatial_zone END,
               last_heartbeat_at = ?
           WHERE id = ?`
        )
        .run(input.display_name, input.department, input.job_title, now, String(existing.id));

      const rebound = this.getEmployeeById(String(existing.id))!;
      this.ledger.append({
        roomId: "office-global",
        eventType: "employee.checked_in",
        actorSessionEmployeeId: rebound.id,
        payload: { rebound: true, desk_slot_id: rebound.desk_slot_id, employee: rebound }
      });
      return rebound;
    }

    const roleId = `role_${input.department}`;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO role_templates
          (id, department, job_title, reports_to_role_id, avatar_preset, default_capabilities_json, monthly_budget_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        roleId,
        input.department,
        input.job_title,
        input.department === "leadership" ? null : "role_leadership",
        `${input.department}-avatar`,
        JSON.stringify(input.capabilities),
        25.0
      );

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM session_employees WHERE department = ?`)
      .get(input.department) as { cnt: number };
    const slotNum = Number(countRow?.cnt ?? 0) + 1;
    const deskSlot = input.desk_slot_id ?? `DESK-${DEPT_PREFIX[input.department]}-${slotNum}`;

    const id = prefixedUlid("emp");
    const slug =
      input.slug ??
      input.employee_code
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-|-$/g, "");

    const employee = SessionEmployeeSchema.parse({
      id,
      session_fingerprint: fingerprint,
      role_template_id: roleId,
      employee_code: input.employee_code,
      slug,
      display_name: input.display_name,
      department: input.department,
      job_title: input.job_title,
      transport_type: input.transport_type,
      system_instructions: input.system_instructions,
      model_identifier: input.model_identifier,
      credential_id: input.credential_id,
      capabilities: input.capabilities,
      desk_slot_id: deskSlot,
      spatial_zone: "at_desk",
      avatar_pose: "idle",
      connection_status: "online",
      active_ticket_id: null,
      context_fill_pct: 0,
      session_cost_usd: 0,
      max_session_budget_usd: input.max_session_budget_usd ?? 5,
      last_heartbeat_at: now
    });

    this.db
      .prepare(
        `INSERT INTO session_employees
          (id, session_fingerprint, role_template_id, employee_code, slug, display_name, department, job_title,
           transport_type, system_instructions, model_identifier, credential_id, capabilities_json, agent_card_json,
           desk_slot_id, spatial_zone, avatar_pose, connection_status, active_ticket_id, context_fill_pct,
           session_cost_usd, max_session_budget_usd, last_tool_call_summary, last_heartbeat_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        employee.id,
        employee.session_fingerprint,
        employee.role_template_id,
        employee.employee_code,
        employee.slug,
        employee.display_name,
        employee.department,
        employee.job_title,
        employee.transport_type,
        employee.system_instructions ?? null,
        employee.model_identifier ?? null,
        employee.credential_id ?? null,
        JSON.stringify(employee.capabilities),
        employee.agent_card ? JSON.stringify(employee.agent_card) : null,
        employee.desk_slot_id,
        employee.spatial_zone,
        employee.avatar_pose,
        employee.connection_status,
        null,
        0,
        0,
        employee.max_session_budget_usd,
        null,
        employee.last_heartbeat_at
      );

    this.ledger.append({
      roomId: "office-global",
      eventType: "employee.checked_in",
      actorSessionEmployeeId: employee.id,
      payload: { rebound: false, desk_slot_id: employee.desk_slot_id, employee }
    });

    return employee;
  }

  public reportDeskActivity(params: {
    employeeId: string;
    avatarPose: AvatarPose;
    spatialZone?: SpatialZone;
    lastToolCallSummary?: string;
    contextFillPct?: number;
    permissionPrompt?: string;
    requestKind?: PermissionRequest["request_kind"];
    riskLevel?: PermissionRequest["risk_level"];
    ticketId?: string | null;
  }): { employee: SessionEmployee; permissionRequest?: PermissionRequest } {
    const current = this.getEmployeeById(params.employeeId);
    if (!current) {
      throw new Error(`SessionEmployee not found: ${params.employeeId}`);
    }

    const pose: AvatarPose = params.permissionPrompt ? "hand_raised" : params.avatarPose;
    const status: ConnectionStatus = params.permissionPrompt
      ? "waiting_permission"
      : pose === "idle"
        ? "online"
        : "busy";

    const now = isoNow();
    this.db
      .prepare(
        `UPDATE session_employees
         SET avatar_pose = ?,
             spatial_zone = COALESCE(?, spatial_zone),
             connection_status = ?,
             last_tool_call_summary = COALESCE(?, last_tool_call_summary),
             context_fill_pct = COALESCE(?, context_fill_pct),
             last_heartbeat_at = ?
         WHERE id = ?`
      )
      .run(
        pose,
        params.spatialZone ?? null,
        status,
        params.lastToolCallSummary ?? null,
        params.contextFillPct ?? null,
        now,
        current.id
      );

    let permissionRequest: PermissionRequest | undefined;
    if (params.permissionPrompt) {
      permissionRequest = this.raiseHandPermission({
        sessionEmployeeId: current.id,
        ticketId: params.ticketId ?? current.active_ticket_id ?? null,
        requestKind: params.requestKind ?? "shell_command",
        promptSummary: params.permissionPrompt,
        riskLevel: params.riskLevel ?? "medium"
      });
    }

    const updated = this.getEmployeeById(current.id)!;
    this.ledger.append({
      roomId: "office-global",
      eventType: "employee.pose_changed",
      actorSessionEmployeeId: updated.id,
      payload: {
        avatar_pose: updated.avatar_pose,
        spatial_zone: updated.spatial_zone,
        context_fill_pct: updated.context_fill_pct,
        last_tool_call_summary: updated.last_tool_call_summary
      }
    });

    return { employee: updated, permissionRequest };
  }

  public raiseHandPermission(params: {
    sessionEmployeeId: string;
    ticketId?: string | null;
    requestKind: PermissionRequest["request_kind"];
    promptSummary: string;
    riskLevel?: PermissionRequest["risk_level"];
  }): PermissionRequest {
    const req = PermissionRequestSchema.parse({
      id: prefixedUlid("perm"),
      session_employee_id: params.sessionEmployeeId,
      ticket_id: params.ticketId ?? null,
      request_kind: params.requestKind,
      prompt_summary: params.promptSummary,
      risk_level: params.riskLevel ?? "medium",
      status: "pending",
      created_at: isoNow(),
      resolved_at: null
    });

    this.db
      .prepare(
        `INSERT INTO permission_requests
          (id, session_employee_id, ticket_id, request_kind, prompt_summary, risk_level, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.id,
        req.session_employee_id,
        req.ticket_id ?? null,
        req.request_kind,
        req.prompt_summary,
        req.risk_level,
        req.status,
        req.created_at
      );

    this.db
      .prepare(
        `UPDATE session_employees
         SET avatar_pose = 'hand_raised', connection_status = 'waiting_permission', last_heartbeat_at = ?
         WHERE id = ?`
      )
      .run(isoNow(), req.session_employee_id);

    this.ledger.append({
      roomId: "office-global",
      eventType: "permission.requested",
      actorSessionEmployeeId: req.session_employee_id,
      payload: { permission: req }
    });

    return req;
  }

  public resolvePermission(params: {
    permissionId: string;
    decision: "allowed" | "denied" | "answered";
    answerText?: string;
    resolvedBy?: "director_ui" | "lead_agent";
  }): { permission: PermissionRequest; employee: SessionEmployee } {
    const row = this.db
      .prepare(`SELECT * FROM permission_requests WHERE id = ?`)
      .get(params.permissionId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`PermissionRequest not found: ${params.permissionId}`);
    }

    const resolvedAt = isoNow();
    const resolvedBy = params.resolvedBy ?? "director_ui";
    this.db
      .prepare(
        `UPDATE permission_requests
         SET status = ?, answer_text = ?, resolved_by = ?, resolved_at = ?
         WHERE id = ?`
      )
      .run(params.decision, params.answerText ?? null, resolvedBy, resolvedAt, params.permissionId);

    const nextPose: AvatarPose = params.decision === "denied" ? "idle" : "typing_code";
    const nextStatus: ConnectionStatus = params.decision === "denied" ? "online" : "busy";
    const empId = String(row.session_employee_id);

    this.db
      .prepare(
        `UPDATE session_employees
         SET avatar_pose = ?, connection_status = ?, last_heartbeat_at = ?
         WHERE id = ?`
      )
      .run(nextPose, nextStatus, resolvedAt, empId);

    const permission = this.getPermissionById(params.permissionId)!;
    const employee = this.getEmployeeById(empId)!;

    this.ledger.append({
      roomId: "office-global",
      eventType: "permission.resolved",
      actorSessionEmployeeId: empId,
      payload: { permission, employee_pose: employee.avatar_pose }
    });

    return { permission, employee };
  }

  public listPendingPermissions(): PermissionRequest[] {
    const rows = this.db
      .prepare(`SELECT * FROM permission_requests WHERE status = 'pending' ORDER BY created_at ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPermission(r));
  }

  public getPermissionById(id: string): PermissionRequest | null {
    const row = this.db
      .prepare(`SELECT * FROM permission_requests WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPermission(row) : null;
  }

  public sweepStaleHeartbeats(timeoutMs: number = 30000, nowMs: number = Date.now()): string[] {
    const employees = this.listEmployees();
    const degradedIds: string[] = [];
    for (const emp of employees) {
      if (emp.connection_status === "offline") continue;
      const age = nowMs - new Date(emp.last_heartbeat_at).getTime();
      if (age > timeoutMs) {
        this.db
          .prepare(
            `UPDATE session_employees
             SET connection_status = 'offline', spatial_zone = 'lounge_offline', avatar_pose = 'idle'
             WHERE id = ?`
          )
          .run(emp.id);
        degradedIds.push(emp.id);
        this.ledger.append({
          roomId: "office-global",
          eventType: "participant.status_changed",
          actorSessionEmployeeId: emp.id,
          payload: { connection_status: "offline", reason: "heartbeat_timeout" }
        });
      }
    }
    return degradedIds;
  }

  public moveEmployeesToZone(employeeIds: string[], zone: SpatialZone, pose: AvatarPose): void {
    const stmt = this.db.prepare(
      `UPDATE session_employees SET spatial_zone = ?, avatar_pose = ?, last_heartbeat_at = ? WHERE id = ?`
    );
    const now = isoNow();
    for (const id of employeeIds) {
      stmt.run(zone, pose, now, id);
    }
  }

  public setActiveTicket(employeeId: string, ticketId: string | null): void {
    this.db
      .prepare(
        `UPDATE session_employees
         SET active_ticket_id = ?, avatar_pose = CASE WHEN ? IS NOT NULL THEN 'typing_code' ELSE avatar_pose END
         WHERE id = ?`
      )
      .run(ticketId, ticketId, employeeId);
  }

  public getEmployeeById(idOrCodeOrSlug: string): SessionEmployee | null {
    const row = this.db
      .prepare(
        `SELECT * FROM session_employees WHERE id = ? OR employee_code = ? OR slug = ? LIMIT 1`
      )
      .get(idOrCodeOrSlug, idOrCodeOrSlug, idOrCodeOrSlug) as Record<string, unknown> | undefined;
    return row ? this.mapEmployee(row) : null;
  }

  public listEmployees(): SessionEmployee[] {
    const rows = this.db
      .prepare(`SELECT * FROM session_employees ORDER BY department ASC, employee_code ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapEmployee(r));
  }

  private mapEmployee(row: Record<string, unknown>): SessionEmployee {
    return SessionEmployeeSchema.parse({
      id: String(row.id),
      session_fingerprint: String(row.session_fingerprint),
      role_template_id: String(row.role_template_id),
      employee_code: String(row.employee_code),
      slug: String(row.slug),
      display_name: String(row.display_name),
      department: row.department,
      job_title: String(row.job_title),
      transport_type: row.transport_type,
      system_instructions: row.system_instructions ? String(row.system_instructions) : undefined,
      model_identifier: row.model_identifier ? String(row.model_identifier) : undefined,
      credential_id: row.credential_id ? String(row.credential_id) : undefined,
      capabilities: JSON.parse(String(row.capabilities_json)),
      agent_card: row.agent_card_json ? JSON.parse(String(row.agent_card_json)) : undefined,
      desk_slot_id: String(row.desk_slot_id),
      spatial_zone: row.spatial_zone,
      avatar_pose: row.avatar_pose,
      connection_status: row.connection_status,
      active_ticket_id: row.active_ticket_id ? String(row.active_ticket_id) : null,
      context_fill_pct: Number(row.context_fill_pct),
      session_cost_usd: Number(row.session_cost_usd),
      max_session_budget_usd: Number(row.max_session_budget_usd),
      last_tool_call_summary: row.last_tool_call_summary
        ? String(row.last_tool_call_summary)
        : undefined,
      last_heartbeat_at: String(row.last_heartbeat_at)
    });
  }

  private mapPermission(row: Record<string, unknown>): PermissionRequest {
    return PermissionRequestSchema.parse({
      id: String(row.id),
      session_employee_id: String(row.session_employee_id),
      ticket_id: row.ticket_id ? String(row.ticket_id) : null,
      request_kind: row.request_kind,
      prompt_summary: String(row.prompt_summary),
      risk_level: row.risk_level,
      status: row.status,
      answer_text: row.answer_text ? String(row.answer_text) : undefined,
      resolved_by: row.resolved_by ? (String(row.resolved_by) as "director_ui" | "lead_agent") : undefined,
      created_at: String(row.created_at),
      resolved_at: row.resolved_at ? String(row.resolved_at) : null
    });
  }
}
