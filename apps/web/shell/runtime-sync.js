export const shouldSkipBoardRuntimeReload = ({
  runtimeSnapshotKey,
  runtimeLegalActionsKey,
  snapshotKey,
  legalActionsKey,
  mountedOverlayKey,
  overlayKey,
  resetSelection,
}) =>
  runtimeSnapshotKey === snapshotKey &&
  runtimeLegalActionsKey === legalActionsKey &&
  mountedOverlayKey === overlayKey &&
  resetSelection !== true;
