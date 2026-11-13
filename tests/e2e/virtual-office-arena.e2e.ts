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
      seedDemoOffice: true
    });
  });

  test.afterAll(async () => {
    await hub.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  test("renders 3D Virtual Office, resolves hand-raise permission, spawns new IDE session, runs Council debate & Director Gate", async ({
    page
  }) => {
    await page.goto(hub.baseUrl);
    await expect(page.getByTestId("office-3d-viewport")).toBeVisible();
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    // Click hand-raised employee CUR-BE-03 and click Allow right inside the office
    await page.getByTestId("employee-badge-CUR-BE-03").click();
    await expect(page.getByTestId("btn-allow-permission")).toBeVisible();
    await page.getByTestId("btn-allow-permission").click();
    await expect(page.getByTestId("btn-allow-permission")).toHaveCount(0);

    // Spawn a new IDE session -> adds 5th employee badge dynamically
    await page.getByTestId("btn-spawn-session").click();
    await expect(page.getByTestId("employee-badge-ZED-05")).toBeVisible();

    // Summon 3D War-Room Council debate -> produces DecisionRecord + DissentLog -> awaits Human Gate
    await page.getByTestId("btn-summon-council").click();
    await expect(page.getByTestId("decision-record-box")).toBeVisible();
    await expect(page.getByTestId("active-room-status")).toHaveText("awaiting_human_gate");

    // Director signs off at Human Gate -> transitions to executing
    await page.getByTestId("btn-approve-human-gate").click();
    await expect(page.getByTestId("active-room-status")).toHaveText("executing");
  });
});
