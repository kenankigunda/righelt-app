type AlarmStorage = {
  setAlarm?: (time: number | Date) => Promise<void> | void;
  deleteAlarm?: () => Promise<void> | void;
};

/** Keep an earlier expiry check instead of rewriting an alarm on every pulse. */
export class SessionAlarm {
  private scheduledAt: number | null | undefined;

  fired() {
    this.scheduledAt = null;
  }

  async sync(storage: AlarmStorage | undefined, nextExpiryAt: number | null, now: number) {
    if (!storage?.setAlarm || !storage.deleteAlarm) return;
    if (nextExpiryAt === null) {
      if (this.scheduledAt !== null) {
        // A rejected response may follow a committed storage operation.
        this.scheduledAt = undefined;
        await storage.deleteAlarm();
        this.scheduledAt = null;
      }
      return;
    }
    if (this.scheduledAt != null && this.scheduledAt > now && this.scheduledAt <= nextExpiryAt) return;
    // Expiry uses a strict cutoff. At equality, check on the next millisecond
    // rather than repeatedly scheduling an alarm for the current instant.
    const scheduledAt = Math.max(nextExpiryAt, now + 1);
    this.scheduledAt = undefined;
    await storage.setAlarm(scheduledAt);
    this.scheduledAt = scheduledAt;
  }
}
