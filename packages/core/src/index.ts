import type { DatabaseSync } from "node:sqlite";
import { SharedBlackboardStore } from "./blackboard/artifact-store.js";
import { PromptContextSlicer } from "./blackboard/context-slicer.js";
import { LogCrusher } from "./blackboard/log-crusher.js";
import { AdversarialEngine, RoundtableRouter } from "./engine/adversarial.js";
import { CouncilStateMachine } from "./engine/council.js";
import { WeightedVotingResolver } from "./engine/voting.js";
import { HeartbeatScheduler } from "./office/heartbeat-scheduler.js";
import { OfficeRosterService } from "./office/office-roster.service.js";
import { PayrollBudgetGuard } from "./office/payroll-budget.service.js";
import { CredentialVault } from "./security/credential-vault.js";
import { SecretScrubber } from "./security/secret-scrubber.js";
import { EventLedger } from "./storage/event-ledger.js";
import {
  type ArenaStoragePaths,
  openArenaDatabase,
  resolveStoragePaths
} from "./storage/sqlite-db.js";
import { FileLeaseRegistry } from "./workspace/file-lease-registry.js";
import { GitWorktreeManager } from "./workspace/git-worktree-manager.js";
import { KanbanTaskService } from "./workspace/kanban-task.service.js";
import { RalphRetrySupervisor } from "./workspace/ralph-retry.js";

export * from "./security/credential-vault.js";
export * from "./security/secret-scrubber.js";
export * from "./security/ssrf-guard.js";
export * from "./storage/sqlite-db.js";
export * from "./storage/event-ledger.js";
export * from "./blackboard/artifact-store.js";
export * from "./blackboard/log-crusher.js";
export * from "./blackboard/context-slicer.js";
export * from "./office/office-roster.service.js";
export * from "./office/payroll-budget.service.js";
export * from "./office/heartbeat-scheduler.js";
export * from "./workspace/git-worktree-manager.js";

export {
  GitWorktreeManager,
  FileLeaseRegistry,
  KanbanTaskService,
  RalphRetrySupervisor,
  CouncilStateMachine,
  AdversarialEngine,
  RoundtableRouter,
  WeightedVotingResolver
};
export { LeaseConflictError, globsOverlap } from "./workspace/file-lease-registry.js";
export type { AnonymizedProposalView } from "./engine/council.js";
export type { VoteTallyResult } from "./engine/voting.js";
export type { RalphRetryOutcome } from "./workspace/ralph-retry.js";

export interface ArenaCoreContainer {
  paths: ArenaStoragePaths;
  db: DatabaseSync;
  scrubber: SecretScrubber;
  vault: CredentialVault;
  ledger: EventLedger;
  crusher: LogCrusher;
  blackboard: SharedBlackboardStore;
  slicer: PromptContextSlicer;
  roster: OfficeRosterService;
  budget: PayrollBudgetGuard;
  worktrees: GitWorktreeManager;
  leases: FileLeaseRegistry;
  kanban: KanbanTaskService;
  ralph: RalphRetrySupervisor;
  voting: WeightedVotingResolver;
  council: CouncilStateMachine;
  heartbeats: HeartbeatScheduler;
  close: () => void;
}

export function createArenaCore(options: {
  stateDir: string;
  masterPassphrase?: string;
}): ArenaCoreContainer {
  const paths = resolveStoragePaths(options.stateDir);
  const db = openArenaDatabase(paths.dbPath);
  const scrubber = new SecretScrubber();
  const vault = new CredentialVault(db, scrubber, options.masterPassphrase);
  const ledger = new EventLedger(paths.eventsDir, scrubber);
  const crusher = new LogCrusher();
  const blackboard = new SharedBlackboardStore(db, paths.artifactsDir, ledger, crusher);
  const slicer = new PromptContextSlicer();
  const roster = new OfficeRosterService(db, ledger);
  const budget = new PayrollBudgetGuard(db, roster, ledger);
  const worktrees = new GitWorktreeManager(paths.worktreesDir);
  const leases = new FileLeaseRegistry(db, worktrees, ledger);
  const kanban = new KanbanTaskService(db, roster, ledger);
  const ralph = new RalphRetrySupervisor(db, worktrees, crusher, ledger);
  const voting = new WeightedVotingResolver();
  const council = new CouncilStateMachine(
    db,
    roster,
    kanban,
    blackboard,
    slicer,
    voting,
    ledger
  );
  const heartbeats = new HeartbeatScheduler(roster, kanban);

  return {
    paths,
    db,
    scrubber,
    vault,
    ledger,
    crusher,
    blackboard,
    slicer,
    roster,
    budget,
    worktrees,
    leases,
    kanban,
    ralph,
    voting,
    council,
    heartbeats,
    close: () => {
      heartbeats.stopAll();
      db.close();
    }
  };
}
