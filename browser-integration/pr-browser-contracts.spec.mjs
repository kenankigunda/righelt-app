import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [390, 1440]) {
  test(`native account focus and accessibility at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForFunction(() => window.fixtureReady);
    const trigger = page.getByRole("button", { name: "Open account" });
    await page.locator("body").focus();
    await page.keyboard.press(
      info.project.name === "webkit" && process.platform === "darwin"
        ? "Alt+Tab"
        : "Tab",
    );
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input").first()).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="account-dialog"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });
}

test("production command journal survives close, reopen and removal", async ({ page }) => {
  await page.goto("/browser-integration/support/board-message.html");
  const result = await page.evaluate(async () => {
    const databaseName = `righelt-pr-contract-${crypto.randomUUID()}`;
    const { createCommandJournal } = await import("/apps/web/shell/command-journal.js");
    const { commandFingerprint } = await import("/apps/web/generated/packages/shared-types/src/sync-protocol.js");
    const command = {
      protocolVersion: 2,
      gameId: "game",
      identityId: "identity",
      clientCommandId: "v2:pr-contract",
      kind: "end_turn",
      payload: {},
      expectedState: { board: "board" },
      expectedGameplayRevision: 0,
      expectedTurnIndex: 0,
    };
    command.fingerprint = await commandFingerprint(command);
    const first = createCommandJournal({ databaseName });
    await first.admit(command);
    await first.close();
    const reopened = createCommandJournal({ databaseName });
    const before = await reopened.list("identity");
    await reopened.remove(command);
    const after = await reopened.list("identity");
    await reopened.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
    return { before, after };
  });
  expect(result.before).toHaveLength(1);
  expect(result.before[0].clientCommandId).toBe("v2:pr-contract");
  expect(result.after).toEqual([]);
});

test("production account authority retires before cross-tab rehydration", async ({
  context,
  page,
}) => {
  const peer = await context.newPage();
  try {
    await Promise.all([
      page.goto("/browser-integration/support/board-message.html"),
      peer.goto("/browser-integration/support/board-message.html"),
    ]);
    await page.evaluate(async () => {
      const { createAccountController } = await import("/apps/web/shell/account-controller.js");
      const session = {
        authenticated: true,
        account: { id: "alice", username: "alice", displayName: "Alice" },
        contextId: "a".repeat(64),
        expiresAt: Date.now() + 60_000,
      };
      globalThis.authorityTransitions = [];
      globalThis.authorityController = createAccountController({
        fetcher: async (url) => Response.json(
          url.endsWith("/bootstrap")
            ? { authProtocolVersion: 2, accountsRequired: true }
            : { ok: true, ...session },
        ),
        onTransition: (state) => globalThis.authorityTransitions.push(state),
      });
      await globalThis.authorityController.start();
    });
    await peer.evaluate(() => {
      globalThis.authorityContractChannel = new BroadcastChannel("righelt.accounts.v1");
      globalThis.authorityContractChannel.postMessage({ type: "changed", pendingLogout: false });
    });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          generationAdvanced: globalThis.authorityController.snapshot().generation > 0,
          retiredBeforeHydration: globalThis.authorityTransitions.some(
            (state) => !state.session.authenticated,
          ),
        })),
      )
      .toEqual({ generationAdvanced: true, retiredBeforeHydration: true });
  } finally {
    await page.evaluate(() => globalThis.authorityController?.destroy()).catch(() => {});
    await peer
      .evaluate(() => globalThis.authorityContractChannel?.close())
      .catch(() => {});
    await peer.close();
  }
});

test("empty full and mini board squares keep their recess without center dots", async ({ page }) => {
  await page.goto("/browser-integration/support/board-message.html");
  await page.setContent(`
    <link rel="stylesheet" href="/apps/web/styles.css">
    <link rel="stylesheet" href="/apps/web/shell/shell.css">
    <div class="board">
      <div class="cell"><span class="piece-empty" aria-hidden="true"></span></div>
    </div>
    <div class="board mini-board-preview-board">
      <div class="cell"><span class="piece-empty" aria-hidden="true"></span></div>
    </div>
  `);

  const treatments = await page.locator(".cell").evaluateAll(cells => cells.map(cell => {
    const empty = cell.querySelector(".piece-empty");
    return {
      centerContent: getComputedStyle(empty, "::before").content,
      emptyWidth: getComputedStyle(empty).width,
      cellShadow: getComputedStyle(cell).boxShadow,
    };
  }));

  expect(treatments).toEqual([
    expect.objectContaining({ centerContent: "none", emptyWidth: "10px" }),
    expect.objectContaining({ centerContent: "none", emptyWidth: "6px" }),
  ]);
  for (const treatment of treatments) expect(treatment.cellShadow).toContain("inset");
});
