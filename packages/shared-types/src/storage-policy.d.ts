export const STORAGE_GENERATION_HEADER: string;
export const STORAGE_GENERATION_QUERY: string;
export const STORAGE_POLICY: Readonly<{
  coldDays:number;
  sweepGames:number;
  restoreDrainSteps:number;
  cleanupRows:number;
  maintenanceObjects:number;
  chunkRows:number;
  maximumStateBytes:number;
  maximumChunkBytes:number;
  warnFraction:number;
  stopFraction:number;
  d1Bytes:number;
  archiveBytes:number;
  archiveClassA:number;
  archiveClassB:number;
}>;
