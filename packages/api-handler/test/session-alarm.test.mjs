import test from "node:test";
import assert from "node:assert/strict";
import { SessionAlarm } from "../src/session-alarm.ts";

const harness = () => {
  let scheduled = null, writes = 0, deletes = 0, fail = false;
  const storage = {
    async setAlarm(time) {
      if (fail) { fail = false; throw Error("alarm unavailable"); }
      scheduled = Number(time); writes++;
    },
    async deleteAlarm() {
      if (fail) { fail = false; throw Error("alarm unavailable"); }
      scheduled = null; deletes++;
    },
  };
  return { alarm: new SessionAlarm(), storage, get scheduled() { return scheduled; },
    get writes() { return writes; }, get deletes() { return deletes; }, fail() { fail = true; } };
};

test("successive heartbeats keep the existing earlier check without repeated alarm writes", async () => {
  const h = harness();
  await h.alarm.sync(h.storage, 95_000, 0);
  for (let time = 5_000; time <= 90_000; time += 5_000) await h.alarm.sync(h.storage, time + 95_000, time);
  assert.equal(h.scheduled, 95_000);
  assert.equal(h.writes, 1);
  h.alarm.fired();
  await h.alarm.sync(h.storage, 185_000, 95_000);
  assert.equal(h.scheduled, 185_000);
  assert.equal(h.writes, 2);
});

test("an earlier session expiry advances the check, and last-session removal clears it once", async () => {
  const h = harness();
  await h.alarm.sync(h.storage, 95_000, 0);
  await h.alarm.sync(h.storage, 80_000, 10_000);
  assert.equal(h.scheduled, 80_000);
  await h.alarm.sync(h.storage, null, 15_000);
  await h.alarm.sync(h.storage, null, 20_000);
  assert.equal(h.scheduled, null);
  assert.equal(h.deletes, 1);
});

test("a restarted owner establishes its alarm and never assumes an unknown alarm is absent", async () => {
  const h = harness();
  await h.alarm.sync(h.storage, 95_000, 0);
  const restarted = new SessionAlarm();
  await restarted.sync(h.storage, 100_000, 5_000);
  assert.equal(h.scheduled, 100_000);
  const emptyRestart = new SessionAlarm();
  await emptyRestart.sync(h.storage, null, 6_000);
  assert.equal(h.scheduled, null);
  assert.equal(h.deletes, 1);
});

test("failed writes and deletes remain retryable without claiming an unsaved schedule", async () => {
  const h = harness();
  h.fail();
  await assert.rejects(h.alarm.sync(h.storage, 95_000, 0), /unavailable/);
  await h.alarm.sync(h.storage, 95_000, 0);
  assert.equal(h.writes, 1);
  h.fail();
  await assert.rejects(h.alarm.sync(h.storage, null, 5_000), /unavailable/);
  assert.equal(h.scheduled, 95_000);
  await h.alarm.sync(h.storage, null, 5_000);
  assert.equal(h.scheduled, null);
});

test("strict-cutoff equality schedules a future check, including immediately after firing", async () => {
  const h = harness();
  await h.alarm.sync(h.storage, 95_000, 95_000);
  assert.equal(h.scheduled, 95_001);
  h.alarm.fired();
  await h.alarm.sync(h.storage, 95_001, 95_001);
  assert.equal(h.scheduled, 95_002);
});

test("a lost deletion response cannot strand a newly active session without an alarm", async () => {
  const alarm = new SessionAlarm();
  let scheduled = null, loseDeletion = false;
  const storage = {
    setAlarm(time) { scheduled = Number(time); },
    deleteAlarm() {
      scheduled = null;
      if (loseDeletion) { loseDeletion = false; throw Error("lost response after deletion"); }
    },
  };
  await alarm.sync(storage, 95_000, 0);
  loseDeletion = true;
  await assert.rejects(alarm.sync(storage, null, 5_000), /lost response/);
  await alarm.sync(storage, 105_000, 10_000);
  assert.equal(scheduled, 105_000, "newly active sessions must retain a durable expiry check");
});
