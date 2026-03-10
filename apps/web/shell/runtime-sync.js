export const shouldSkipBoardRuntimeReload = ({
  runtimeSnapshotKey,
  runtimeLegalActionsKey,
  snapshotKey,
  legalActionsKey,
  mountedSelectionActionKey,
  selectionActionKey,
  resetSelection,
}) =>
  runtimeSnapshotKey === snapshotKey &&
  runtimeLegalActionsKey === legalActionsKey &&
  mountedSelectionActionKey === selectionActionKey &&
  resetSelection !== true;
