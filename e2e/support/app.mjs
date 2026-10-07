import { expect, test } from "@playwright/test";

const historyMoveItems = (page) => page.locator('[data-testid="history-move-item"]');

const locatorIsVisible = async (locator) => {
  if ((await locator.count()) === 0) {
    return false;
  }
  return locator.first().isVisible();
};

const getVisibleJoinSurface = async (page) => {
  if (await locatorIsVisible(page.getByTestId("invite-join-viewer"))) {
    return "invite-gate";
  }

  if (await locatorIsVisible(page.getByTestId("join-viewer"))) {
    return "join-panel";
  }

  if (await locatorIsVisible(page.getByTestId("invite-gate"))) {
    return "invite-gate";
  }

  if (await locatorIsVisible(page.getByTestId("join-invite-heading"))) {
    return "join-panel";
  }

  return null;
};

export const buildAppUrl = (baseURL, hash = "#/") => `${baseURL}${hash}`;

export const createIsolatedPage = async (browser) => {
  const use = test.info().project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor });
  const page = await context.newPage();
  return { context, page };
};

export const setOfflineState = async (page, offline) => {
  await page.context().setOffline(offline);
  await expect
    .poll(async () => page.evaluate(() => navigator.onLine), {
      message: `Expected browser navigator.onLine to become ${offline ? "false" : "true"}`,
    })
    .toBe(!offline);
};

export const closeHostInvitation = async page => {
  // Authentication can close before its deferred game continuation mounts.
  await page.getByTestId("game-shell").waitFor({state:"visible"});
  const close = page.getByRole("button", {name:"Close invite", exact:true});
  if (await close.isVisible()) await close.click();
};

// Selected from source capabilities before proof starts. A missing expected
// introduction fails; it must never silently fall back to the legacy flow.
export const continueFriendIntroduction = async (page, {friendIntroduction = false} = {}) => {
  if (!friendIntroduction) return;
  const story=page.getByRole('dialog',{name:'Friend',exact:true});
  await story.waitFor({state:'visible'});
  await story.getByRole('button',{name:'Start a friend game',exact:true}).click();
};

export const createGameFromHome = async (page, capabilities = {friendIntroduction:true}) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/shell/games";
  });
  await page.getByTestId("home-create-game").click();
  await continueFriendIntroduction(page, capabilities);
  await expect(page.getByRole("dialog", { name: "Invite a friend" })).toBeVisible();
  const createResponse = await createResponsePromise;
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await closeHostInvitation(page);
  await expect(page.getByTestId("game-role")).toContainText("Player 1");

  const url = new URL(page.url());
  const match = url.hash.match(/^#\/game\/([^?]+)/);
  if (!match) {
    throw new Error(`Expected game hash after creation, received ${url.hash}`);
  }

  const createBody = await createResponse.json();
  // A successful create response can precede local WebSocket reconciliation.
  // This shared action is gated by the same local recovery state as board input.
  await expect(page.locator('[data-action="play-as-both-players"]')).toBeEnabled();
  await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
  // Responsive controls must be observed after entry finishes, not during
  // the temporary cover/reveal state that can hide and replace their nodes.
  await expect(page.locator("[data-shell-transition-phase]")).toHaveAttribute("data-shell-transition-phase", "idle");

  return {
    gameHash: url.hash,
    gameId: decodeURIComponent(match[1]),
    serverGameId: createBody?.game?.id ?? null,
  };
};

export const createGamesViaApi = async (page, count) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await waitForLegacyIdentity(page);

  return page.evaluate(async (gameCount) => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    if (!identityId) {
      throw new Error("Expected identity id in local storage before creating games");
    }

    const createdGameIds = [];
    for (let index = 0; index < gameCount; index += 1) {
      const response = await fetch("/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, selfPlayMode: false }),
      });
      const body = await response.json();
      if (!response.ok || !body?.game?.id) {
        throw new Error(`Game creation failed: ${response.status} ${JSON.stringify(body)}`);
      }
      createdGameIds.push(body.game.id);
    }
    return createdGameIds;
  }, count);
};

export const getCurrentGameIdFromPage = async (page) => {
  const url = new URL(page.url());
  const match = url.hash.match(/^#\/game\/([^?]+)/);
  if (!match) {
    throw new Error(`Expected game hash in page URL, received ${url.hash}`);
  }
  return decodeURIComponent(match[1]);
};

// The home shell renders before startup decides whether legacy transport is
// enabled. These general-suite API fixtures require that decision to finish.
export const waitForLegacyIdentity = async (page) => {
  await expect.poll(
    () => page.evaluate(() => window.localStorage.getItem("righelt.identity.id.v1") ?? ""),
    { message: "Expected legacy test identity after startup" },
  ).toMatch(/\S/);
};

export const importScenarioGame = async (page, scenario, baseURL) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await waitForLegacyIdentity(page);

  const { gameId } = await page.evaluate(async (payload) => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    if (!identityId) {
      throw new Error("Expected identity id in local storage before importing scenario");
    }

    const response = await fetch("/api/shell/scenarios/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, scenario: payload.scenario }),
    });
    const body = await response.json();
    if (!response.ok || !body?.game?.id) {
      throw new Error(`Scenario import failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return { gameId: body.game.id };
  }, { scenario });

  const gameHash = `#/game/${encodeURIComponent(gameId)}`;
  await page.goto(buildAppUrl(baseURL, gameHash));
  await expect(page.getByTestId("game-shell")).toBeVisible();
  return { gameId, gameHash };
};

export const openDirectGameLink = async (page, baseURL, gameHash) => {
  await page.goto(buildAppUrl(baseURL, gameHash));
  await expect
    .poll(async () => getVisibleJoinSurface(page), {
      message: "Expected either the invite gate or in-game join panel to render for a new device",
    })
    .not.toBeNull();
};

export const joinAsViewer = async (page) => {
  if (await getVisibleJoinSurface(page) === "invite-gate") {
    await page.getByTestId("invite-join-viewer").click();
  } else {
    await page.getByTestId("join-viewer").click();
  }
  await expect(page.getByTestId("game-role")).toContainText("Viewer");
};

export const requestPlayerJoin = async (page) => {
  if (await getVisibleJoinSurface(page) === "invite-gate") {
    await page.getByTestId("invite-join-player").click();
  } else {
    await page.getByTestId("join-player").click();
  }
  await expect(page.getByTestId("game-role")).toContainText("Viewer");
  await expect(page.getByTestId("pending-player-request-notice")).toBeVisible();
};

export const acceptPendingRequest = async (page) => {
  await expect(page.getByTestId("approval-gate")).toBeVisible();
  await page.getByTestId("accept-request").click();
  await expect(page.getByTestId("approval-gate")).toHaveCount(0);
};

export const ignorePendingRequest = async (page) => {
  await expect(page.getByTestId("approval-gate")).toBeVisible();
  await page.getByTestId("ignore-request").click();
  await expect(page.getByTestId("approval-gate")).toHaveCount(0);
};

export const getHistoryMoveCount = async (page) => historyMoveItems(page).count();

export const expectHistoryMoveCountToIncrease = async (page, initialCount) => {
  await expect
    .poll(async () => getHistoryMoveCount(page), {
      message: "Expected browser history move count to increase",
    })
    .toBeGreaterThan(initialCount);
};

export const expectHistoryMoveCountToEqualOrExceed = async (page, expectedCount) => {
  await expect
    .poll(async () => getHistoryMoveCount(page), {
      message: `Expected browser history move count to reach at least ${expectedCount}`,
    })
    .toBeGreaterThanOrEqual(expectedCount);
};

const getFirstPlayableAction = async (page) =>
  page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
    if (!identityId || !match) {
      return null;
    }

    const gameId = decodeURIComponent(match[1]);
    const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
    const body = await response.json();
    const legalActions = Array.isArray(body?.game?.legalActions) ? body.game.legalActions : [];
    return legalActions.find((action) => action?.from && action?.to) ?? null;
  });

export const selectPlayableAction = async (page, action) => {
  const cell = position => page.locator(`[data-testid="game-board"] .cell[data-row="${position.row}"][data-col="${position.col}"]`);
  const target = cell(action.to);
  await cell(action.from).click();
  const supportsHover = await page.locator('html').getAttribute('data-hover-capability') === 'hover';
  if (supportsHover) await target.hover();
  else await target.click();
  await expect(target, "The supported pointer interaction must select the legal destination before confirmation").toHaveClass(/(?:^|\s)target(?:\s|$)/, { timeout: 2000 });
  return target;
};

export const submitPlayableAction = async (page, action) => {
  const target = await selectPlayableAction(page, action);
  await target.click();
};

export const makeAnyLegalMove = async (page, ownerClass = "p1") => {
  const startingHistoryCount = await getHistoryMoveCount(page);
  const action = await getFirstPlayableAction(page);

  if (!action?.from || !action?.to) {
    throw new Error(`No playable browser action was exposed in the live game payload for ${ownerClass.toUpperCase()}`);
  }

  const sourceCell = page.locator(
    `[data-testid="game-board"] .cell[data-row="${action.from.row}"][data-col="${action.from.col}"]`,
  );
  const targetCell = page.locator(
    `[data-testid="game-board"] .cell[data-row="${action.to.row}"][data-col="${action.to.col}"]`,
  );

  // Read the actual client: describe-level and popup settings can differ from the project defaults.
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
    const boardTab = page.locator('[data-action="switch-game-panel"][data-panel="board"]');
    if (await boardTab.isVisible()) await boardTab.tap();
    await sourceCell.tap();
    await expect(sourceCell).toHaveClass(/selected-piece/);
    await expect(targetCell.locator('.move-ghost')).toBeVisible();
    // Touch selects a destination before confirming it. A sole legal destination
    // can already be selected, so never blindly send two confirmation taps.
    const hoverCapable = await page.locator('html').getAttribute('data-hover-capability') === 'hover';
    if (!hoverCapable && !(await targetCell.evaluate(cell => cell.classList.contains('target')))) {
      await targetCell.tap();
      await expect(targetCell).toHaveClass(/\btarget\b/);
    }
    await targetCell.tap();
    await expectHistoryMoveCountToIncrease(page, startingHistoryCount);
    return;
  }
  await submitPlayableAction(page, action);
  await expectHistoryMoveCountToIncrease(page, startingHistoryCount);
};

export const openHistoryAndReturnLive = async (page) => {
  await openHistoryMode(page);
  await page.getByTestId("history-return-live").click();
  await expect(page.getByTestId("history-return-live")).toHaveCount(0);
};

export const openHistoryMode = async (page, moveIndex = 0) => {
  const tab = page.locator('[data-action="switch-game-panel"][data-panel="history"]');
  // Deliberately reveal the panel instead of scrolling a transformed offscreen pane.
  await expect(page.locator("#app")).toHaveAttribute("data-shell-layout-mode", /^(narrow|wide)$/);
  if (await page.locator("#app").getAttribute("data-shell-layout-mode") === "narrow") {
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
  }
  await expect(historyMoveItems(page).nth(moveIndex)).toBeVisible();
  await historyMoveItems(page).nth(moveIndex).click();
  await expect(page.getByTestId("history-return-live")).toBeVisible();
};

export const launchHistoryBranchFromMove = async (page, moveIndex = 0) => {
  await openHistoryMode(page, moveIndex);
  const branchResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/shell/history/branch";
  });
  const popupPromise = page.waitForEvent("popup");
  await page.locator('[data-action="launch-history-branch"]').click();
  const [popup, branchResponse] = await Promise.all([popupPromise, branchResponsePromise]);
  await popup.waitForLoadState("domcontentloaded");
  const branchBody = await branchResponse.json();
  return {
    popup,
    branchBody,
    gameId: await getCurrentGameIdFromPage(popup),
  };
};

export const openPendingHistoryBranchFromMove = async (page, moveIndex = 0) => {
  await openHistoryMode(page, moveIndex);
  const popupPromise = page.waitForEvent("popup");
  await page.locator('[data-action="launch-history-branch"]').click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  return {
    popup,
    gameId: await getCurrentGameIdFromPage(popup),
  };
};

export const returnToLive = async (page) => {
  await expect(page.getByTestId("history-return-live")).toBeVisible();
  await page.getByTestId("history-return-live").click();
  await expect(page.getByTestId("history-return-live")).toHaveCount(0);
};

export const expectViewerFallbackJoinSurface = async (page) => {
  await expect
    .poll(async () => getVisibleJoinSurface(page), {
      message: "Expected a visible join surface for a fallback viewer join",
    })
    .not.toBeNull();
  if ((await page.getByTestId("join-player").count()) > 0) {
    await expect(page.getByTestId("join-player")).toBeDisabled();
  }
  if ((await page.getByTestId("invite-join-player").count()) > 0) {
    await expect(page.getByTestId("invite-join-player")).toBeDisabled();
  }
  if ((await page.getByTestId("join-viewer").count()) > 0) {
    await expect(page.getByTestId("join-viewer")).toBeVisible();
    await expect(page.getByTestId("join-viewer")).toBeEnabled();
    return;
  }
  await expect(page.getByTestId("invite-join-viewer")).toBeVisible();
  await expect(page.getByTestId("invite-join-viewer")).toBeEnabled();
};

export const closeContextQuietly = async (context) => {
  try {
    await context.close();
  } catch {
    // Ignore teardown races after Playwright aborts the test on timeout.
  }
};
