import {readPlayableAction} from "./read-playable-action.mjs";
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

export const switchGamePanel = async (page, key) => {
  if (await page.locator('#app').getAttribute('data-shell-layout-mode') !== 'narrow') return;
  const tab = page.locator(`[data-action="switch-game-panel"][data-panel="${key}"]`);
  // An already selected panel needs no navigation click. The controls can be
  // collapsed while the current panel stays visible and ready.
  if (await tab.getAttribute('aria-pressed') !== 'true') {
    const reveal = page.getByRole('button',{name:'Show game navigation',exact:true});
    // Refresh the idle window even when the bar is about to hide.
    if (await reveal.count()) await reveal.click();
    await tab.click();
  }
  await expect(tab).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>page.locator(`[data-mobile-panel="${key}"]`).evaluate(el=>el.closest('.game-shell-track').getAnimations().some(animation=>animation.playState==='running'||animation.pending)),{message:'Expected the panel transition to finish'}).toBe(false);
  await expect.poll(()=>page.locator(`[data-mobile-panel="${key}"]`).evaluate(el=>Math.abs(el.getBoundingClientRect().left-el.closest('.game-shell-track-wrap').getBoundingClientRect().left)),{message:'Expected the selected panel to finish its horizontal transition'}).toBeLessThanOrEqual(1);
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
  // This general-suite fixture starts after guest startup succeeds. A cold
  // bootstrap can fail and retry while the shell already displays its cards.
  await waitForLegacyIdentity(page);
  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/shell/games";
  });
  await page.getByTestId("home-create-game").click();
  await continueFriendIntroduction(page, capabilities);
  const createResponse = await createResponsePromise;
  expect(createResponse.status(), `Game creation failed (request ${createResponse.headers()['x-righelt-request-id'] || 'unavailable'})`).toBe(200);
  await expect(page.getByRole("dialog", { name: "Invite a friend" })).toBeVisible();
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

export const importScenarioGame = async (page, scenario, baseURL, { open = true } = {}) => {
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
  if (open) {
    await page.goto(buildAppUrl(baseURL, gameHash));
    await expect(page.getByTestId("game-shell")).toBeVisible();
  }
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
  const surface=await getVisibleJoinSurface(page);
  const button=page.getByTestId(surface==='invite-gate'?'invite-join-player':'join-player');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const gameId=await button.getAttribute('data-game-id');
  expect(gameId).toBeTruthy();
  // The role assertion measures publication after the actual join is accepted,
  // independently of request transport latency. The workflow budget is unchanged.
  const joined = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname===`/api/shell/games/${gameId}/join`, {timeout:10000});
  await button.click();
  const response=await joined;
  expect(response.status()).toBe(200);
  const body=await response.json();
  expect(body.ok).toBe(true);
  expect(body.game?.id).toBe(gameId);
  expect(body.game?.myRole).toBe('Viewer');
  expect(body.game?.pendingPlayerRequestSeat).toBeTruthy();
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

const getFirstPlayableAction = async (page) => page.evaluate(readPlayableAction);

export const ensureActionActorSelected = async (source) => {
  // A late authoritative snapshot can restore a mandatory actor after a blank
  // square cleared it. Clicking that selected piece again toggles its overlay.
  if (!await source.evaluate(element => element.classList.contains("source"))) await source.click();
  await expect(source).toHaveClass(/(?:^|\s)source(?:\s|$)/);
};

export const selectPlayableAction = async (page, action) => {
  const cell = position => page.locator(`[data-testid="game-board"] .cell[data-row="${position.row}"][data-col="${position.col}"]`);
  const target = cell(action.to);
  const source = cell(action.from);
  // Continuations select their required actor automatically. Clicking it again
  // cycles the overlay away from action previews instead of selecting a move.
  if (!["retreat", "follow"].includes(action.type) && !await source.evaluate(el => el.classList.contains("source"))) await source.click();
  // Complete piece previews are asynchronous. The runtime deliberately ignores
  // a destination tap while that check is pending, so wait before selecting it.
  await expect(page.locator('#shell-board-preview-label')).not.toHaveAttribute('aria-busy', 'true');
  const supportsHover = await page.locator('html').getAttribute('data-hover-capability') === 'hover';
  // A single forced follow can already select its destination. Its next tap
  // confirms the move, so do not submit it while trying to select it.
  if (supportsHover) {
    // A blocked tap can leave the pointer on this square during recovery.
    // Enter it again so the runtime receives a fresh hover event.
    await page.mouse.move(0, 0);
    await target.hover();
  } else if (!await target.evaluate(el => el.classList.contains("target"))) await target.click();
  await expect(target, "The supported pointer interaction must select the legal destination before confirmation").toHaveClass(/(?:^|\s)target(?:\s|$)/, { timeout: 2000 });
  return target;
};

export const submitPlayableAction = async (page, action) => {
  const target = await selectPlayableAction(page, action);
  // A shared control or fresh complete-move check can fence confirmation
  // after hover or a tap prepared the destination.
  // Wait for visual readiness, then perform exactly one native confirmation.
  // Admission can change during the click; the runtime still checks it live.
  await expect.poll(() => target.evaluate(node => {
    const message=document.getElementById('shell-board-preview-label');
    return Boolean(message && message.getAttribute('aria-busy')!=='true' && node.classList.contains('target') && !node.classList.contains('unselectable'));
  }),{timeout:2000,message:'Complete move checks and the prepared destination must be ready at confirmation'}).toBe(true);
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
    await switchGamePanel(page, "board");
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
  // Deliberately reveal the panel instead of scrolling a transformed offscreen pane.
  await expect(page.locator("#app")).toHaveAttribute("data-shell-layout-mode", /^(narrow|wide)$/);
  if (await page.locator("#app").getAttribute("data-shell-layout-mode") === "narrow") {
    await switchGamePanel(page, "history");
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
  await historyMoveItems(page).nth(moveIndex).locator('[data-action="launch-history-branch"]').click();
  await page.getByRole('dialog', { name: 'Create a new game here' }).getByRole('button', { name: 'Start game' }).click();
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
  await historyMoveItems(page).nth(moveIndex).locator('[data-action="launch-history-branch"]').click();
  await page.getByRole('dialog', { name: 'Create a new game here' }).getByRole('button', { name: 'Start game' }).click();
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
