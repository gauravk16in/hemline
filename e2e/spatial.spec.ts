import { test, expect } from "@playwright/test";
import { seed, createDraft, command } from "../lib/domain";

// UI contract checks use intercepted snapshots; no provider calls or public data.
test("ward map selects the encounter, switches views, and submits reviewed text", async ({
  page,
}) => {
  const ward = seed();
  let message: { text: string; transferId: string | null } | null = null;
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/api/messages"))
      message = route.request().postDataJSON();
    await route.fulfill({
      json: route.request().url().endsWith("/api/ward")
        ? { ...ward, adapter: "fixture", tracingConfigured: false }
        : { ok: true },
    });
  });
  await page.goto("/");
  const canvas = await page
    .getByRole("region", { name: "Interactive hospital map" })
    .boundingBox();
  const viewport = page.viewportSize()!;
  expect(canvas).toMatchObject({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  const bed = page.getByRole("button", { name: /Bed 18, Mira Rao/ });
  await bed.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#message")).toHaveValue(
    /Mira Rao, encounter enc-04, Bed 18/,
  );
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Transfer history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Interactive hospital map" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(message).toMatchObject({ transferId: null });
  expect(message!.text).toContain("enc-04");
});

test("floating panel preserves authorized readiness commands and recovery guidance", async ({
  page,
}) => {
  const ward = seed();
  const transfer = createDraft(ward, "enc-04", ward.now + 1800000);
  command(
    ward,
    transfer.id,
    {
      type: "CONFIRM_REQUEST",
      expectedRevision: transfer.revision,
      payload: {},
    },
    "nurse",
  );
  let received: unknown;
  await page.route("**/api/**", async (route) => {
    if (route.request().url().includes("/commands"))
      received = route.request().postDataJSON();
    await route.fulfill({
      json: route.request().url().endsWith("/api/ward")
        ? { ...ward, adapter: "fixture", tracingConfigured: false }
        : { ok: true },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Bed 18, Mira Rao/ }).click();
  await page
    .getByRole("button", { name: "Confirm patient readiness", exact: true })
    .click();
  await expect
    .poll(() => received)
    .toEqual({
      type: "CONFIRM_READINESS",
      expectedRevision: transfer.revision,
      payload: { requirement: "nurse" },
    });
  transfer.control = "ESCALATED";
  await page.reload();
  await page.getByRole("button", { name: /Bed 18, Mira Rao/ }).click();
  await expect(
    page.getByText(
      "Pause the clock. Coordinator resumes this transfer before staff can update readiness.",
    ),
  ).toBeVisible();
});

test("mobile remains scrollable without horizontal overflow and voice has text fallback", async ({
  page,
}) => {
  const ward = seed();
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: { ...ward, adapter: "fixture", tracingConfigured: false },
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Bed 18, Mira Rao/ }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Dictate message" }).click();
  await expect(page.locator(".live-error[role=alert]")).toContainText(
    "Speech recognition is unavailable",
  );
  await expect(page.locator("#message")).toBeEditable();
  await page.screenshot({
    path: "evidence/spatial-mobile-tested.png",
    fullPage: true,
  });
});
