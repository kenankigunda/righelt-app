import { expect, test } from "@playwright/test";
import { ownedContexts } from "../support/owned-contexts.mjs";
import {
  acceptPendingRequest,
  createGameFromHome,
  joinAsViewer,
  openDirectGameLink,
  requestPlayerJoin,
  submitPlayableAction,
  switchGamePanel,
} from "../support/app.mjs";
import { readProjectedGame } from "../support/computer-projection.mjs";

const projected = (page, gameId) =>
  page.evaluate(readProjectedGame, { id: gameId, guest: true });

test("guest game creation, observation and reload preserve one legal move", async ({
  browser,
  baseURL,
}) => {
  const owned = ownedContexts(browser);
  try {
    const contexts = await Promise.all([0, 1, 2].map(() => owned.create()));
    const [owner, opponent, observer] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const { gameId, gameHash } = await createGameFromHome(owner);
    await openDirectGameLink(opponent, baseURL, gameHash);
    await requestPlayerJoin(opponent);
    await acceptPendingRequest(owner);
    await expect(opponent.getByTestId("game-role")).toContainText("Player 2");
    await openDirectGameLink(observer, baseURL, gameHash);
    await joinAsViewer(observer);
    await Promise.all(
      [owner, opponent, observer].map((page) => switchGamePanel(page, "board")),
    );

    const before = await projected(owner, gameId);
    const action = before.legalActions.find(
      (candidate) => candidate.type === "move" && candidate.from && candidate.to,
    );
    expect(action).toBeTruthy();
    await submitPlayableAction(owner, action);

    for (const page of [opponent, observer]) {
      await expect
        .poll(async () => (await projected(page, gameId)).gameplayRevision)
        .toBe(before.gameplayRevision + 1);
      expect((await projected(page, gameId)).board.state).toEqual(
        (await projected(owner, gameId)).board.state,
      );
    }

    await owner.reload();
    await expect(owner.getByTestId("game-shell")).toHaveAttribute(
      "data-game-id",
      gameId,
    );
    await expect(owner.getByTestId("game-role")).toContainText("Player 1");
    expect((await projected(owner, gameId)).gameplayRevision).toBe(
      before.gameplayRevision + 1,
    );
  } finally {
    await owned.close();
  }
});
