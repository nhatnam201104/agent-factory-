# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Factory Virtual Office & Arena — a local-first hub where **each active AI session (MCP bridge, IDE/ACP editor, CLI, API key, remote A2A agent) maps 1:1 to a virtual employee** in a 3D office. It manages Kanban tickets on isolated Git worktrees, runs structured multi-agent deliberation (council / adversarial / roundtable) to reduce single-model blind spots, and keeps a human "Director Desk" in control of budget and approvals. Specs live in `specs/001-multi-agent-arena/` and `specs/002-open-world-office/` (written in Vietnamese).

## Commands

```bash
pnpm build                 # Build all workspaces (tsc -b project references + vite for web-arena)
pnpm typecheck             # Type-check every package/app
pnpm lint                  # Biome check over packages/ apps/ tests/
pnpm start                 # Run the CLI `start` (launches the hub on :4747)

pnpm test                  # All vitest projects (unit + contract + integration)
pnpm test:contract         # Contract tests only
pnpm test:integration      # Integration tests only
pnpm test:e2e              # Playwright E2E (tests/e2e/*.e2e.ts)

# Single test file / name
pnpm vitest run tests/integration/us3-council-deliberation.spec.ts
pnpm vitest run -t "name of test"
```

**Build before you test.** Vitest resolves `@factory-arena/*` to each package's compiled `dist/index.js` (see `vitest.workspace.ts` aliases), not to source. After editing any package, run `pnpm build` (or the affected package's `tsc -b`) before the test suite will see your changes.

## Requirements

- **Node >= 22** is mandatory — the storage layer uses the built-in `node:sqlite` (`DatabaseSync`), not a third-party driver.
- Package manager is **pnpm** (workspace monorepo). Use `pnpm --filter <name>` to target one workspace.

## Architecture

Dependency flow (also the `tsc -b` build order): `protocol → core → adapters → {hub-server, cli}`; `web-arena` depends only on `protocol`.

### `packages/protocol`
Zod schemas + TypeScript types shared across every layer and the browser UI — the single source of truth for the wire format: ledger events, A2A agent cards, `SessionEmployee`, Kanban workspace, deliberation, and MCP contracts. Changing a shape here ripples everywhere; start here when touching data models.

### `packages/core` — the engine (no network/transport code)
Everything is wired together by `createArenaCore({ stateDir })` into an `ArenaCoreContainer`. Subsystems:
- **storage/** — `openArenaDatabase` opens the SQLite DB in WAL mode and applies DDL idempotently (note the inline `ALTER TABLE` migration pattern in `sqlite-db.ts`). `EventLedger` is an append-only event log on disk.
- **security/** — `CredentialVault` (AES-256-GCM encrypted secrets), `SecretScrubber` (redacts secrets from logs/events), `ssrf-guard`, `cli-command-policy`. Secrets must never reach the client or the ledger unscrubbed.
- **office/** — `OfficeRosterService` (session→employee registration & desk activity), `PayrollBudgetGuard` (token/cost ceilings, throws `BudgetExceededError`), `HeartbeatScheduler`.
- **workspace/** — `GitWorktreeManager` (isolated branches per ticket), `FileLeaseRegistry` (prevents two sessions writing overlapping file globs, throws `LeaseConflictError`), `KanbanTaskService`, `RalphRetrySupervisor`.
- **engine/** — deliberation: `CouncilStateMachine` (4-stage sealed-proposal → anonymized cross-critique → vote → decision record), `AdversarialEngine`, `RoundtableRouter`, `WeightedVotingResolver`.
- **blackboard/** — `SharedBlackboardStore` holds large diffs/logs off-ticket; `LogCrusher` + `PromptContextSlicer` keep prompt context small by referencing artifacts instead of inlining them.

### `packages/adapters` — transport bridges into core
One adapter per connection kind, all over the same `adapter.interface.ts`: `MCPBridgeAdapter` (+ stdio proxy and the MCP tool servers in `mcp-bridge/`), `ACPBridgeAdapter` (IDE editors), `APIKeyAdapter`, `CLIPtyAdapter` (PTY-driven CLIs), `A2ARemoteAdapter` (remote agents).

### `apps/hub-server` — Hono HTTP + WebSocket
`createHubApp` / `startHubServer` compose core + adapters and expose: REST under `/api/v1/*`, `/mcp` (Streamable HTTP JSON-RPC), `/acp`, `/.well-known/agent.json` (A2A card), a realtime WS stream (`ws/realtime-stream.ts`), and static serving of the built `web-arena` UI. Security model lives here: loopback-only CORS, cross-origin/`sec-fetch-site` rejection, and a timing-safe session-token guard on `/api/*`, `/mcp`, `/acp`. When bound beyond loopback, a random API token is generated and required (`resolveHubApiToken`). `seedDemoOffice` populates a demo roster/tickets on first run.

### `apps/cli` (`factory-arena`)
Thin command layer over core/hub: `start`, `mcp-stdio`, `connect-ide`, `vault add|list`, `employee list`, `room create`. All logic is in `runCli` in `packages/cli/src/index.ts`.

### `apps/web-arena` — React 19 + Three.js (Vite)
The 3D office UI. `scene3d/` is the Three.js open-world office rendering; the pure geometry/camera modules (`layout`, `deskAssignment`, `zoneSeating`, `cameraFit`) are unit-tested in node without WebGL, while `cameraRig`/`sceneRuntime` are the `three`-side counterparts. `kanban/`, `council/`, `inspector/`, `layout/` are the 2D React surfaces; `lib/apiClient.ts` talks to the hub. Built output is served by the hub in production.

### `apps/vscode-bridge`
VS Code extension that auto-registers the local MCP/ACP endpoints and shows the session's desk/ticket status.

## Testing layout

- `tests/unit` — fast, node env.
- `tests/contract` — validate adapters/routes against `protocol` schemas (20s timeout).
- `tests/integration` — exercise the real core/hub/sqlite together; run serially (`fileParallelism: false`, 30s timeout). Named by user story (`us1`/`us2`/`us3`).
- `tests/e2e` — Playwright against the running hub + web UI.

## Conventions

- Biome formats and lints (2-space indent, 100-col). `noExplicitAny` is intentionally **off**.
- ESM throughout (`"type": "module"`); import sibling files with explicit `.js` extensions (NodeNext resolution), e.g. `import { X } from "./foo.js"`.
- State persists under the `--state-dir` (default `.factory-arena/`, override via `FACTORY_ARENA_STATE_DIR`): `arena.db`, `events/`, `artifacts/`, `worktrees/`.
