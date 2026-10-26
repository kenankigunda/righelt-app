/** Pending controls belong to a game, transport and account generation.
 * Keeping old work reachable never gives it authority over a newly viewed game.
 */
export function createComputerControlWork() {
  const transports = new WeakMap();
  return ({transport, accountGeneration, game}) => {
    let accounts = transports.get(transport);
    if (!accounts) { accounts = new Map(); transports.set(transport, accounts); }
    let games = accounts.get(accountGeneration);
    if (!games) { games = new Map(); accounts.set(accountGeneration, games); }
    const gameId = game?.id ?? null;
    let work = games.get(gameId);
    if (!work) {
      work = {leaseWork:null, leaseWorkAction:null, resumeWork:null, controlWork:0};
      games.set(gameId, work);
    }
    return work;
  };
}
