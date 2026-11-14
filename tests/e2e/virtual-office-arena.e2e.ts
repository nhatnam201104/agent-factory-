import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type RunningHubInstance, startHubServer } from "@factory-arena/hub-server";
import { expect, test } from "@playwright/test";

const STATIC_UI_DIR = resolve(import.meta.dirname, "../../apps/web-arena/dist");

test.describe("Factory Virtual Office & Multi-Agent Arena E2E (T046)", () => {
  let hub: RunningHubInstance;
  let stateDir: string;

  test.beforeAll(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "arena-e2e-"));
    hub = await startHubServer({
      port: 0,
      stateDir,
      staticUiDir: STATIC_UI_DIR,
      seedDemoOffice: true,
    });
  });

  test.afterAll(async () => {
    await hub.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  test("renders 3D Virtual Office, resolves hand-raise permission, spawns new IDE session, runs Council debate & Director Gate", async ({
    page,
  }) => {
    await page.goto(hub.baseUrl);
    await expect(page.getByTestId("office-3d-viewport")).toBeVisible();
    await page.getByTestId("tab-kanban").click();
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await page.getByTestId("tab-office").click();

    // Click hand-raised employee CUR-BE-03 and click Allow right inside the office
    await page.getByTestId("employee-badge-CUR-BE-03").click();
    await expect(page.getByTestId("agent-panel-allow-permission")).toBeVisible();
    await page.getByTestId("agent-panel-allow-permission").click();
    await expect(page.getByTestId("agent-panel-allow-permission")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Spawn a new IDE session -> adds 5th employee badge dynamically
    await page.getByTestId("btn-spawn-session").click();
    await expect(page.getByTestId("employee-badge-ZED-05")).toBeVisible();

    // Summon 3D War-Room Council debate -> produces DecisionRecord + DissentPanel -> awaits Human Gate
    await page.getByTestId("btn-summon-council").click();
    await page.getByTestId("tab-council").click();
    await expect(page.getByTestId("decision-record-box")).toBeVisible();
    await expect(page.getByTestId("dissent-panel")).toBeVisible();
    await page.getByTestId("tab-command").click();
    await expect(page.getByTestId("active-room-status")).toHaveText("awaiting_human_gate");

    // Verify Kanban Goal Ancestry, Worktree branch & Blackboard diff badges (T048)
    await page.getByTestId("tab-kanban").click();
    await expect(page.getByTestId("ticket-ancestry-TSK-102")).toBeVisible();
    await expect(page.getByTestId("ticket-branch-TSK-101")).toBeVisible();
    await expect(page.getByTestId("ticket-artifacts-TSK-101")).toBeVisible();

    // Director signs off at Human Gate -> transitions to executing & auto-decomposes child beads (T047)
    await page.getByTestId("tab-command").click();
    await page.getByTestId("btn-approve-human-gate").click();
    await expect(page.getByTestId("active-room-status")).toHaveText("executing");

    // Open DecisionMinutesModal to inspect decomposed beads
    await page.getByTestId("tab-council").click();
    await page.getByTestId("btn-open-decision-minutes").click();
    await expect(page.getByTestId("decision-minutes-modal")).toBeVisible();
    await expect(page.getByTestId("decomposed-beads-list")).toBeVisible();
    await page.getByTestId("btn-close-minutes").click();

    // Issue a direct command from the Director Command Center -> creates ticket & logs response
    await page.getByTestId("tab-command").click();
    await page
      .getByTestId("director-command-input")
      .fill("Viết bộ kiểm thử bảo mật cho mô-đun khóa phiên");
    await page.getByTestId("btn-send-director-command").click();
    await expect(page.getByTestId("director-command-feedback")).toBeVisible();
    await expect(page.getByTestId("employee-command-logs")).toBeVisible();

    // Verify Connect AI modal opens cleanly from top toolbar
    await page.getByTestId("btn-open-connect-ai").click();
    await expect(page.getByTestId("connect-ai-modal")).toBeVisible();
  });

  test("clicking an agent opens its quick panel to view work and assign a new task", async ({
    page,
  }) => {
    await page.goto(hub.baseUrl);
    await expect(page.getByTestId("office-3d-viewport")).toBeVisible();

    await page.locator('[data-testid^="employee-badge-"]').first().click();
    const panel = page.getByTestId("agent-quick-panel");
    await expect(panel).toBeVisible();

    const taskTitle = "Viết test e2e cho bảng giao việc nhanh";
    await page.getByTestId("agent-panel-tab-new_task").click();
    await page.getByTestId("agent-panel-task-title").fill(taskTitle);
    await page.getByTestId("agent-panel-submit").click();
    await expect(panel).toContainText(taskTitle);

    // Zoom controls change the zoom level readout
    await expect(page.getByTestId("office-zoom-level")).toHaveText("100%");
    await page.getByTestId("office-zoom-in").click();
    await expect(page.getByTestId("office-zoom-level")).not.toHaveText("100%");

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
});
