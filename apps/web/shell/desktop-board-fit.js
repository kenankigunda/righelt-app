export const DESKTOP_BOARD_FIT = Object.freeze({ cells: 10, gap: 4, mouseCell: 36, coarseCell: 44, bottomInset: 16 });

/** Keep squares usable, then scroll in short windows. A narrow desktop column
 * still limits the floor so the existing responsive grid never scrolls sideways. */
export function desktopBoardSide({ viewportHeight, flowTop, chromeHeight, availableWidth, coarse = false }) {
  if (![viewportHeight, flowTop, chromeHeight, availableWidth].every(Number.isFinite) || availableWidth <= 0) return null;
  const cell = coarse ? DESKTOP_BOARD_FIT.coarseCell : DESKTOP_BOARD_FIT.mouseCell;
  const floor = DESKTOP_BOARD_FIT.cells * cell + (DESKTOP_BOARD_FIT.cells - 1) * DESKTOP_BOARD_FIT.gap;
  const budget = viewportHeight - flowTop - chromeHeight - DESKTOP_BOARD_FIT.bottomInset;
  return Math.floor(Math.max(Math.min(floor, availableWidth), Math.min(availableWidth, budget)));
}

// Offset geometry ignores scroll, sticky clamping and temporary entry transforms.
const flowTop = element => {
  let top = 0;
  for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
  return top;
};

export function createDesktopBoardFit({ appEl, requestLayout, onSizeChange = () => {} }) {
  const view = appEl.ownerDocument.defaultView;
  let panel = null, wrap = null, lastSide = null, destroyed = false;
  const schedule = () => { if (!destroyed && panel?.isConnected) requestLayout(); };
  const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : null;
  const fonts = appEl.ownerDocument.fonts;
  const clear = () => {
    observer?.disconnect();
    fonts?.removeEventListener('loadingdone', schedule);
    wrap?.style.removeProperty('--desktop-board-side');
    panel = null;
    wrap = null;
    lastSide = null;
  };
  return {
    // Called synchronously inside the shell's existing layout rAF, before sticky checks.
    sync({ wide, onlyNew = false }) {
      if (destroyed) return false;
      const nextPanel = wide ? appEl.querySelector('[data-shell-panel="board"]') : null;
      const track = nextPanel?.closest('.game-shell-track');
      const column = nextPanel?.closest('[data-shell-sticky-target="board"]');
      const nextWrap = nextPanel?.querySelector('.board-wrap');
      const board = nextWrap?.querySelector('.board');
      if (!nextPanel || !track || !column || !nextWrap || !board) { clear(); return false; }
      if (onlyNew && panel === nextPanel && wrap === nextWrap) return false;
      if (panel !== nextPanel || wrap !== nextWrap) {
        clear(); panel = nextPanel; wrap = nextWrap;
        fonts?.addEventListener('loadingdone', schedule);
        void fonts?.ready?.then(() => { if (panel === nextPanel) schedule(); });
        for (const element of [panel, track, appEl.querySelector('.shell-header'), panel.querySelector('.board-heading-slot'), panel.querySelector('.board-message-slot'), panel.querySelector('.overlay-key')]) {
          if (element) observer?.observe(element);
        }
      }
      const style = view.getComputedStyle(panel);
      const availableWidth = panel.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
      const side = desktopBoardSide({
        viewportHeight: view.innerHeight,
        flowTop: flowTop(track) + flowTop(panel) - flowTop(column),
        chromeHeight: panel.offsetHeight - board.offsetHeight,
        availableWidth,
        coarse: view.matchMedia?.('(pointer: coarse)').matches === true,
      });
      if (side == null || (side === lastSide && wrap.style.getPropertyValue('--desktop-board-side') === `${side}px`)) return false;
      const previousWidth = board.offsetWidth;
      const previousHeight = board.offsetHeight;
      lastSide = side;
      wrap.style.setProperty('--desktop-board-side', `${side}px`);
      if (board.offsetWidth !== previousWidth || board.offsetHeight !== previousHeight) onSizeChange();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clear();
      fonts?.removeEventListener('loadingdone', schedule);
    },
  };
}
