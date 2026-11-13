import type { AgentCard, SessionEmployee, TransportType } from "@factory-arena/protocol";

export interface AdapterAssignmentPayload {
  roomId: string;
  roundId?: string;
  ticketId?: string;
  prompt: string;
  systemInstructions?: string;
}

export interface AdapterTurnResult {
  contentMarkdown: string;
  summary: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

export interface ParticipantAdapter {
  readonly transportType: TransportType;
  connect(employee: SessionEmployee): Promise<void>;
  disconnect(employeeId: string): Promise<void>;
  sendAssignment(
    employee: SessionEmployee,
    assignment: AdapterAssignmentPayload
  ): Promise<AdapterTurnResult>;
  heartbeat(employeeId: string): Promise<boolean>;
  resolvePermission(
    employeeId: string,
    permissionId: string,
    decision: "allowed" | "denied" | "answered",
    answerText?: string
  ): Promise<void>;
  getAgentCard?(employee: SessionEmployee): AgentCard;
}
