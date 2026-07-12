import test from "node:test";
import assert from "node:assert/strict";
import { AnkSessionStore, parseAnkCommand } from "../src/ank.js";

test("parses ank start, status, and stop commands", () => {
  assert.deepEqual(parseAnkCommand("!ank 3"), { type: "start", targetCount: 3 });
  assert.deepEqual(parseAnkCommand("!ank status"), { type: "status" });
  assert.deepEqual(parseAnkCommand("!ank stop"), { type: "stop" });
  assert.deepEqual(parseAnkCommand("!ank 0"), { type: "invalid" });
  assert.equal(parseAnkCommand("hello"), null);
});

test("selects exactly the requested upcoming message number", () => {
  const sessions = new AnkSessionStore();
  sessions.start("channel", 3, "starter", 1000);

  assert.equal(sessions.accept("channel", 2000).complete, false);
  assert.equal(sessions.accept("channel", 3000).complete, false);
  const selected = sessions.accept("channel", 4000);

  assert.equal(selected.complete, true);
  assert.equal(selected.targetCount, 3);
  assert.equal(sessions.get("channel", 5000), null);
});

test("expires ank sessions", () => {
  const sessions = new AnkSessionStore({ timeoutMs: 1000 });
  sessions.start("channel", 2, "starter", 1000);

  assert.equal(sessions.get("channel", 2001), null);
});

test("keeps ank sessions isolated by channel", () => {
  const sessions = new AnkSessionStore();
  sessions.start("channel-a", 1, "starter", 1000);

  assert.equal(sessions.get("channel-b", 1001), null);
  assert.equal(sessions.get("channel-a", 1001).targetCount, 1);
});
