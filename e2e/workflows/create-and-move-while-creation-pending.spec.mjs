import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
} from "../support/app.mjs";

test("creator can move immediately after creating an optimistic game without sync failure", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await createGameFromHome(page);
    const initialHistoryCount = await getHistoryMoveCount(page);

    await makeAnyLegalMove(page, "p1");

    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected the newly created optimistic game to accept the first move",
      })
      .toBeGreaterThan(initialHistoryCount);

    await expect(page.getByText("Move sync failed before confirmation. The board was restored to the last authoritative state.")).toHaveCount(0);
    await expect(page.getByText("Move confirmation is retrying. The board stays optimistic until the server confirms.")).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});
