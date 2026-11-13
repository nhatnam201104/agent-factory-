import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaCore } from "@factory-arena/core";
import { describe, expect, it } from "vitest";

describe("US2 Integration: Real Git Worktree Isolation & Ralph-Style Clean Retry (T025)", () => {
  it("isolates 2 concurrent agents in real Git worktrees with zero main-checkout corruption and clean-resets on failure", () => {
    const rootTmp = mkdtempSync(join(tmpdir(), "arena-git-wt-"));
    const repoDir = join(rootTmp, "sample-repo");
    const stateDir = join(rootTmp, "state");

    execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "pipe" });
    execFileSync("git", ["-C", repoDir, "config", "user.email", "test@factory.local"]);
    execFileSync("git", ["-C", repoDir, "config", "user.name", "Factory Test"]);
    writeFileSync(join(repoDir, "shared.ts"), "export const VERSION = 1;\n", "utf8");
    execFileSync("git", ["-C", repoDir, "add", "."]);
    execFileSync("git", ["-C", repoDir, "commit", "-m", "initial commit"], { stdio: "pipe" });

    const core = createArenaCore({ stateDir });
    try {
      const emp1 = core.roster.registerOrRebindSession({
        employee_code: "DEV-1",
        display_name: "Dev 1",
        department: "backend",
        job_title: "Backend Dev",
        transport_type: "mcp_bridge"
      });
      const emp2 = core.roster.registerOrRebindSession({
        employee_code: "DEV-2",
        display_name: "Dev 2",
        department: "frontend",
        job_title: "Frontend Dev",
        transport_type: "mcp_bridge"
      });

      const t1 = core.kanban.createTicket({
        title: "Backend task",
        repo_root_path: repoDir,
        base_branch: "main",
        assignee_session_id: emp1.id
      });
      const t2 = core.kanban.createTicket({
        title: "Frontend task",
        repo_root_path: repoDir,
        base_branch: "main",
        assignee_session_id: emp2.id
      });

      const lease1 = core.leases.acquireLease({
        roomId: "room-wt",
        ticketId: t1.id,
        sessionEmployeeId: emp1.id,
        employeeCode: emp1.employee_code,
        repoRootPath: repoDir,
        baseBranch: "main",
        isolationMode: "git_worktree"
      });
      const lease2 = core.leases.acquireLease({
        roomId: "room-wt",
        ticketId: t2.id,
        sessionEmployeeId: emp2.id,
        employeeCode: emp2.employee_code,
        repoRootPath: repoDir,
        baseBranch: "main",
        isolationMode: "git_worktree"
      });

      expect(lease1.worktree_path).toBeTruthy();
      expect(lease2.worktree_path).toBeTruthy();
      expect(lease1.worktree_path).not.toBe(lease2.worktree_path);

      // Both agents edit shared.ts simultaneously in their isolated worktrees
      writeFileSync(join(lease1.worktree_path!, "shared.ts"), "export const VERSION = 201;\n");
      writeFileSync(join(lease1.worktree_path!, "dirty-temp.txt"), "untracked broken attempt\n");
      writeFileSync(join(lease2.worktree_path!, "shared.ts"), "export const VERSION = 302;\n");

      // Main user working copy remains 100% untouched (SC-003)
      expect(readFileSync(join(repoDir, "shared.ts"), "utf8")).toBe("export const VERSION = 1;\n");

      // Trigger Ralph-Style Clean Retry on lease1 -> dirty edits & untracked files wiped cleanly
      const retry = core.ralph.handleFailure({
        roomId: "room-wt",
        ticket: t1,
        worktreePath: lease1.worktree_path,
        rawFailureLog: "Downloading pkg...\nError: Test suite failed at auth.spec.ts:44\n"
      });
      expect(retry.action).toBe("clean_retried");
      expect(retry.retryCount).toBe(1);
      expect(readFileSync(join(lease1.worktree_path!, "shared.ts"), "utf8")).toBe(
        "export const VERSION = 1;\n"
      );
      expect(existsSync(join(lease1.worktree_path!, "dirty-temp.txt"))).toBe(false);
    } finally {
      core.close();
      rmSync(rootTmp, { recursive: true, force: true });
    }
  });
});
