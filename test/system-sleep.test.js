import test from "node:test";
import assert from "node:assert/strict";
import { getNextSleepAt, parseSleepTime } from "../src/system-sleep.js";

test("parses a valid daily sleep time", () => {
  assert.deepEqual(parseSleepTime("01:00"), { hour: 1, minute: 0 });
  assert.throws(() => parseSleepTime("25:00"));
});

test("schedules later today before the configured time", () => {
  const now = new Date(2026, 6, 12, 0, 30, 0);
  const next = getNextSleepAt("01:00", now);
  assert.equal(next.getDate(), 12);
  assert.equal(next.getHours(), 1);
});

test("schedules tomorrow after the configured time", () => {
  const now = new Date(2026, 6, 12, 1, 30, 0);
  const next = getNextSleepAt("01:00", now);
  assert.equal(next.getDate(), 13);
  assert.equal(next.getHours(), 1);
});
