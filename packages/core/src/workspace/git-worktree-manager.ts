import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ProvisionedWorktree {
  worktreePath: string;
  branchName: string;
}

export class GitWorktreeManager {
  constructor(private readonly worktreesBaseDir: string) {
    mkdirSync(this.worktreesBaseDir, { recursive: true });
  }

  public provisionWorktree(params: {
    repoRootPath: string;
    baseBranch?: string;
    roomId: string;
    ticketId: string;
    employeeCode: string;
  }): ProvisionedWorktree {
    const safeRoom = params.roomId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeTicket = params.ticketId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeEmp = params.employeeCode.replace(/[^a-zA-Z0-9_-]/g, "_");

    const branchName = `arena/${safeRoom}/${safeTicket}-${safeEmp}`;
    const worktreePath = resolve(
      join(this.worktreesBaseDir, safeRoom, `${safeTicket}-${safeEmp}`)
    );

    if (existsSync(worktreePath)) {
      return { worktreePath, branchName };
    }

    mkdirSync(join(this.worktreesBaseDir, safeRoom), { recursive: true });
    const baseRef = params.baseBranch ?? "HEAD";

    execFileSync("git", ["worktree", "add", "-B", branchName, worktreePath, baseRef], {
      cwd: params.repoRootPath,
      stdio: "pipe"
    });

    return { worktreePath, branchName };
  }

  public resetWorktreeClean(worktreePath: string, targetRef: string = "HEAD"): void {
    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree path does not exist: ${worktreePath}`);
    }
    execFileSync("git", ["reset", "--hard", targetRef], {
      cwd: worktreePath,
      stdio: "pipe"
    });
    execFileSync("git", ["clean", "-fd"], {
      cwd: worktreePath,
      stdio: "pipe"
    });
  }

  public removeWorktree(repoRootPath: string, worktreePath: string): void {
    if (!existsSync(worktreePath)) return;
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: repoRootPath,
        stdio: "pipe"
      });
    } catch {
      rmSync(worktreePath, { recursive: true, force: true });
      execFileSync("git", ["worktree", "prune"], { cwd: repoRootPath, stdio: "pipe" });
    }
  }
}
