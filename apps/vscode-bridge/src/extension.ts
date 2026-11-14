export interface VsCodeLikeContext {
  subscriptions: Array<{ dispose(): void }>;
  workspaceUri?: string;
}

export interface ArenaBridgeConfig {
  hubUrl: string;
  employeeCode: string;
  department: "leadership" | "architecture" | "backend" | "frontend" | "security_qa" | "devops";
}

export function buildIdeMcpRegistration(hubUrl = "http://127.0.0.1:4747") {
  const clean = hubUrl.replace(/\/+$/, "");
  return {
    mcpServerUrl: `${clean}/mcp`,
    acpEndpointUrl: `${clean}/acp`,
    webOfficeUrl: clean,
  };
}

export async function checkinIdeSessionToOffice(
  config: ArenaBridgeConfig,
  workspaceUri: string = process.cwd(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ employeeId: string; deskSlotId: string }> {
  const { mcpServerUrl } = buildIdeMcpRegistration(config.hubUrl);
  const resp = await fetchImpl(mcpServerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vscode-checkin-1",
      method: "tools/call",
      params: {
        name: "arena_checkin_desk",
        arguments: {
          session_fingerprint: `mcp_bridge:${workspaceUri}:${config.employeeCode}`,
          employee_code: config.employeeCode,
          display_name: `VSCode (${config.employeeCode})`,
          department: config.department,
          job_title: "VS Code Bridge Session Employee",
          workspace_uri: workspaceUri,
        },
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Arena Hub check-in failed with HTTP ${resp.status}`);
  }
  const payload = (await resp.json()) as Record<string, any>;
  const emp = payload.result?.structuredContent;
  return {
    employeeId: String(emp?.id ?? ""),
    deskSlotId: String(emp?.desk_slot_id ?? "DESK-IDE-1"),
  };
}

export function activate(context: VsCodeLikeContext): {
  registration: ReturnType<typeof buildIdeMcpRegistration>;
} {
  const registration = buildIdeMcpRegistration(
    process.env.FACTORY_ARENA_HUB_URL ?? "http://127.0.0.1:4747",
  );
  context.subscriptions.push({
    dispose: () => {
      // Cleanly detach status bar observer on window close
    },
  });
  return { registration };
}

export function deactivate(): void {}
