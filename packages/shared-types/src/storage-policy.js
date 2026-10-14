/** Transport fencing is separate from immutable command fingerprints. */
export const STORAGE_GENERATION_HEADER = "X-Righelt-Storage-Generation";
export const STORAGE_GENERATION_QUERY = "storageGeneration";
export const STORAGE_POLICY = Object.freeze({
  coldDays: 7,
  sweepGames: 20,
  restoreDrainSteps: 64,
  cleanupRows: 100,
  maintenanceObjects: 2,
  chunkRows: 5,
  maximumStateBytes: 2_000_000,
  maximumChunkBytes: 1_000_000,
  warnFraction: 0.7,
  stopFraction: 0.8,
  d1Bytes: 500_000_000,
  archiveBytes: 8_000_000_000,
  archiveClassA: 800_000,
  archiveClassB: 8_000_000,
});
