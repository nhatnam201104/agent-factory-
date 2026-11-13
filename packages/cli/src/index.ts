#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createArenaCore } from "@factory-arena/core";
import { startHubServer } from "@factory-arena/hub-server";
import type { ProviderKind } from "@factory-arena/protocol";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseFlag(args: string[], flag: string, fallback?: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return fallback;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [cmd, sub] = argv;
  const stateDir = resolve(
    parseFlag(argv, "--state-dir", process.env.FACTORY_ARENA_STATE_DIR ?? ".factory-arena")!
  );

  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(
      [
        "factory-arena CLI — Virtual 3D Office & Multi-Agent Deliberation Hub",
        "Commands:",
        "  factory-arena start [--port 4747]",
        "  factory-arena vault add --label <name> --provider <openai_compatible|anthropic|gemini|ollama> --secret <key>",
        "  factory-arena vault list",
        "  factory-arena employee list",
        "  factory-arena room create --title <title> --mode <council|adversarial|roundtable> --participants <a,b> --moderator <id>",
        "  factory-arena connect-ide [--port 4747]"
      ].join("\n")
    );
    return 0;
  }

  if (cmd === "start") {
    const port = Number(parseFlag(argv, "--port", "4747"));
    const staticUiDir = resolve(__dirname, "../../../apps/web-arena/dist");
    const hub = await startHubServer({
      port,
      stateDir,
      staticUiDir,
      seedDemoOffice: true
    });
    console.log(`Factory Virtual Office & Arena listening on ${hub.baseUrl}`);
    console.log(`MCP Streamable HTTP: ${hub.baseUrl}/mcp`);
    console.log(`A2A Agent Card:      ${hub.baseUrl}/.well-known/agent.json`);
    return 0;
  }

  if (cmd === "connect-ide") {
    const port = Number(parseFlag(argv, "--port", "4747"));
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            "factory-arena": {
              type: "streamable-http",
              url: `http://127.0.0.1:${port}/mcp`
            }
          },
          acpEndpoint: `http://127.0.0.1:${port}/acp`
        },
        null,
        2
      )
    );
    return 0;
  }

  const core = createArenaCore({ stateDir });
  try {
    if (cmd === "vault" && sub === "add") {
      const label = parseFlag(argv, "--label", "default-key")!;
      const provider = (parseFlag(argv, "--provider", "openai_compatible") ??
        "openai_compatible") as ProviderKind;
      const rawSecret =
        parseFlag(argv, "--secret") ?? process.env.FACTORY_ARENA_SECRET_INPUT ?? "";
      if (!rawSecret) {
        throw new Error("Missing --secret or FACTORY_ARENA_SECRET_INPUT");
      }
      const created = core.vault.addCredential({
        label,
        provider_kind: provider,
        raw_secret: rawSecret,
        base_url: parseFlag(argv, "--base-url")
      });
      console.log(JSON.stringify(created, null, 2));
      return 0;
    }

    if (cmd === "vault" && sub === "list") {
      console.log(JSON.stringify(core.vault.listCredentials(), null, 2));
      return 0;
    }

    if (cmd === "employee" && sub === "list") {
      console.log(JSON.stringify(core.roster.listEmployees(), null, 2));
      return 0;
    }

    if (cmd === "room" && sub === "create") {
      const title = parseFlag(argv, "--title", "Architecture Council")!;
      const mode = (parseFlag(argv, "--mode", "council") ?? "council") as
        | "council"
        | "adversarial"
        | "roundtable"
        | "execution_mesh";
      const participantsRaw = parseFlag(argv, "--participants", "")!;
      const participantIds = participantsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((codeOrId) => core.roster.getEmployeeById(codeOrId)?.id ?? codeOrId);
      const modRaw = parseFlag(argv, "--moderator", participantIds[0] ?? "human")!;
      const moderatorId = core.roster.getEmployeeById(modRaw)?.id ?? modRaw;
      const repoRootPath = parseFlag(argv, "--repo");

      const created = core.council.createRoom({
        title,
        protocolMode: mode,
        participantIds,
        moderatorId,
        repoRootPath
      });
      console.log(JSON.stringify(created, null, 2));
      return 0;
    }

    throw new Error(`Unknown command: ${argv.join(" ")}`);
  } finally {
    core.close();
  }
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
