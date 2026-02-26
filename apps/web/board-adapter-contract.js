/**
 * @typedef {{ row: number, col: number }} BoardCoord
 * @typedef {{ selectedPieceId: string | null, source: BoardCoord | null, target: BoardCoord | null }} BoardSelection
 *
 * Runtime contract for pluggable board adapters.
 * The app shell depends only on this surface.
 *
 * @typedef {object} GameBoardAdapter
 * @property {string} id
 * @property {() => {live: boolean, history: boolean, tutorial: boolean, offlineLocal: boolean}} getCapabilities
 * @property {(options: {
 *   boardEl: HTMLElement,
 *   overlayLinesEl: SVGElement,
 *   onCellClick: (coord: BoardCoord) => void,
 * }) => void} mount
 * @property {() => void} unmount
 * @property {(snapshot: unknown, coord: BoardCoord) => unknown | null} getPieceAt
 * @property {(snapshot: unknown, pieceId: string | null) => unknown | null} getPieceById
 * @property {(input: {
 *   snapshot: unknown,
 *   selection: BoardSelection,
 *   selectedPieceMoves: unknown[],
 *   currentActionType: string,
 *   clickedCoord: BoardCoord,
 * }) => { selection: BoardSelection, nextActionType: string }} nextSelectionForCell
 * @property {(input: {
 *   snapshot: unknown,
 *   selection: BoardSelection,
 *   selectedPieceMoves: unknown[],
 * }) => void} render
 * @property {(snapshot: unknown) => string} getCommanderSupplySummary
 * @property {(input: {
 *   snapshot: unknown,
 *   selectedPieceId: string | null,
 *   selectedPieceMoves: unknown[],
 * }) => null | {
 *   details: Record<string, unknown>,
 *   actions: Array<{ type: string, from: BoardCoord | null, to: BoardCoord | null }>,
 * }} getSelectedPieceSummary
 */

/**
 * @param {unknown} adapter
 * @returns {asserts adapter is GameBoardAdapter}
 */
export function assertGameBoardAdapter(adapter) {
  const requiredMethods = [
    "getCapabilities",
    "mount",
    "unmount",
    "getPieceAt",
    "getPieceById",
    "nextSelectionForCell",
    "render",
    "getCommanderSupplySummary",
    "getSelectedPieceSummary",
  ];

  if (!adapter || typeof adapter !== "object") {
    throw new Error("Board adapter must be an object");
  }

  for (const method of requiredMethods) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`Board adapter missing method: ${method}`);
    }
  }
}
