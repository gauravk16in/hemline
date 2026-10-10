import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomUUID() });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const response = await page.request.get("/api/ward");
    if (response.ok())
      await writeFile(
        `evidence/browser-failure-${info.line}.json`,
        JSON.stringify(await response.json(), null, 2),
      );
  }
});
test("visitor completes an explicitly simulated transfer and remains isolated", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open your demo ward" }).click();
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Interactive ward map" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare a transfer request" })
    .click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm patient & request" }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Confirm patient & request" }).click();
  await page.getByRole("button", { name: "Confirm patient readiness" }).click();
  await page
    .getByRole("button", { name: "Confirm escort", exact: true })
    .click();
  await page.getByLabel("Acting as").selectOption("receiving");
  await page
    .getByRole("button", { name: "Confirm destination readiness" })
    .click();
  await page.getByLabel("Acting as").selectOption("porter");
  await expect(page.getByRole("button", { name: "Accept offer" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Accept offer" }).click();
  await page
    .getByRole("button", { name: "Confirm patient collected", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Confirm arrival at destination",
      exact: true,
    })
    .click();
  await page.getByLabel("Acting as").selectOption("receiving");
  await page.getByRole("button", { name: "Confirm receiving handoff" }).click();
  await expect(
    page.getByText(/Handoff accepted by receiving team/).first(),
  ).toBeVisible();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/");
  await expect(
    otherPage.getByRole("button", { name: "Open your demo ward" }),
  ).toBeVisible();
  await other.close();
});

test("guided playback recovers from a persisted rejection and verifies handoff", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open your demo ward" }).click();
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.getByLabel("Demo controls").click();
  await page.getByLabel("Demo mode").selectOption("guided");
  await page.getByLabel("Failure scenario").selectOption("rejection");
  await page.getByLabel("Demo controls").click();
  await page
    .getByRole("button", { name: "Prepare a transfer request" })
    .click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Confirm patient & request" }).click();
  await expect(
    page.getByText(/Handoff accepted by receiving team/).first(),
  ).toBeVisible({ timeout: 150000 });
  const response = await page.request.get("/api/ward");
  const w = await response.json();
  await writeFile(
    "evidence/guided-browser-after.json",
    JSON.stringify(w, null, 2),
  );
  expect(w.transfers[0].offers[0].status).toBe("rejected");
  expect(w.transfers[0].offers[1].porterId).toBe("porter-2");
  expect(
    w.events.some((e: { source: string }) => e.source === "simulated staff"),
  ).toBe(true);
  await page.screenshot({ path: "evidence/ward-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "evidence/ward-mobile.png", fullPage: true });
});

test("receiving delay requires interpretation confirmation and assignment reconciliation", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open your demo ward" }).click();
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare a transfer request" })
    .click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Confirm patient & request" }).click();
  await page.getByRole("button", { name: "Confirm patient readiness" }).click();
  await page
    .getByRole("button", { name: "Confirm escort", exact: true })
    .click();
  await page.getByLabel("Acting as").selectOption("receiving");
  await page
    .getByRole("button", { name: "Confirm destination readiness" })
    .click();
  await page.getByLabel("Acting as").selectOption("porter");
  await page.getByRole("button", { name: "Accept offer" }).click();
  await page.getByLabel("Acting as").selectOption("receiving");
  await page
    .getByLabel("Staff reply or coordination question")
    .fill("Scanner delayed 15 minutes. We can receive the patient afterward.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm this interpretation" })
    .click();
  await expect(
    page.getByRole("button", { name: "Acknowledge cancellation" }),
  ).toBeHidden();
  expect(
    (await (await page.request.get("/api/ward")).json()).transfers[0].control,
  ).toBe("CANCELLING");
  await page.getByLabel("Acting as").selectOption("porter");
  await page.getByRole("button", { name: "Acknowledge cancellation" }).click();
  await page.getByLabel("Acting as").selectOption("nurse");
  await page
    .getByRole("button", { name: "Approve revised receiving window" })
    .click();
  const response = await page.request.get("/api/ward");
  const w = await response.json();
  expect(w.transfers[0].revision).toBe(2);
  expect(w.transfers[0].confirmations).toEqual({});
  expect(w.transfers[0].offers[0].status).toBe("cancelled");
  expect(w.transfers[0].phase).toBe("CONFIRMED");
});
