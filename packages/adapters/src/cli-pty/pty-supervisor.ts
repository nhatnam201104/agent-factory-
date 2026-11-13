import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { ArenaCoreContainer } from "@factory-arena/core";
import type { SessionEmployee } from "@factory-arena/protocol";
import type {
  AdapterAssignmentPayload,
  AdapterTurnResult,
  ParticipantAdapter
} from "../adapter.interface.js";

export class CLIPtyAdapter implements ParticipantAdapter {
  public readonly transportType = "cli_pty" as const;
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly waitTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly core: ArenaCoreContainer,
    private readonly permissionWaitThresholdMs: number = 30000
  ) {}

  public async connect(
    employee: SessionEmployee,
    command: string[] = [process.execPath, "-e", "process.stdin.resume()"]
  ): Promise<void> {
    if (this.processes.has(employee.id)) return;
    const [bin, ...args] = command;
    const proc = spawn(bin, args, { stdio: "pipe" });
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (/(allow\?|y\/n|permission|approve)/i.test(text)) {
        this.core.roster.reportDeskActivity({
          employeeId: employee.id,
          avatarPose: "hand_raised",
          permissionPrompt: `CLI session waiting confirmation: ${text.slice(0, 180)}`
        });
      }
    });
    this.processes.set(employee.id, proc);
  }

  public async disconnect(employeeId: string): Promise<void> {
    const timer = this.waitTimers.get(employeeId);
    if (timer) clearTimeout(timer);
    this.waitTimers.delete(employeeId);
    const proc = this.processes.get(employeeId);
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }
    this.processes.delete(employeeId);
  }

  public async heartbeat(employeeId: string): Promise<boolean> {
    const proc = this.processes.get(employeeId);
    return Boolean(proc && !proc.killed);
  }

  public async sendAssignment(
    employee: SessionEmployee,
    assignment: AdapterAssignmentPayload
  ): Promise<AdapterTurnResult> {
    const proc = this.processes.get(employee.id);
    if (proc && proc.stdin.writable) {
      proc.stdin.write(`${JSON.stringify({ prompt: assignment.prompt })}\n`);
    }
    const timer = setTimeout(() => {
      this.core.roster.reportDeskActivity({
        employeeId: employee.id,
        avatarPose: "hand_raised",
        permissionPrompt: `CLI agent ${employee.employee_code} idle > ${this.permissionWaitThresholdMs}ms (possible hidden permission prompt)`
      });
    }, this.permissionWaitThresholdMs);
    timer.unref();
    this.waitTimers.set(employee.id, timer);

    return {
      contentMarkdown: `Dispatched prompt to local CLI agent ${employee.employee_code}`,
      summary: `CLI task dispatched`,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 5
    };
  }

  public async resolvePermission(
    employeeId: string,
    permissionId: string,
    decision: "allowed" | "denied" | "answered",
    answerText?: string
  ): Promise<void> {
    const proc = this.processes.get(employeeId);
    if (proc && proc.stdin.writable) {
      const reply = answerText ?? (decision === "allowed" ? "y\n" : "n\n");
      proc.stdin.write(reply.endsWith("\n") ? reply : `${reply}\n`);
    }
    this.core.roster.resolvePermission({ permissionId, decision, answerText });
  }
}
