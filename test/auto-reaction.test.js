import test from "node:test";
import assert from "node:assert/strict";
import { selectActiveMessage, selectActiveMessages } from "../src/auto-reaction.js";

function entries(channelId, count, startAt = 1000) {
  return Array.from({ length: count }, (_, index) => [
    `${channelId}-${index}`,
    {
      createdAt: startAt + index,
      message: { channelId, id: `${channelId}-${index}` },
    },
  ]);
}

test("selects only from channels with five recent messages", () => {
  const messages = new Map([
    ...entries("quiet", 4),
    ...entries("active", 5),
    ["old", { createdAt: 1, message: { channelId: "active", id: "old" } }],
  ]);

  const selected = selectActiveMessage(messages, {
    now: 2000,
    windowMs: 60_000,
    minActivity: 5,
    random: () => 0,
  });

  assert.equal(selected.message.channelId, "active");
});

test("returns no reaction target when activity is below the threshold", () => {
  const messages = new Map(entries("quiet", 4));

  assert.equal(
    selectActiveMessage(messages, { now: 2000, windowMs: 60_000, minActivity: 5 }),
    null,
  );
});

test("selects multiple unique messages for a reaction batch", () => {
  const messages = new Map(entries("active", 5));
  const selected = selectActiveMessages(messages, {
    count: 3,
    now: 2000,
    windowMs: 60_000,
    minActivity: 5,
    random: () => 0,
  });

  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((entry) => entry.message.id)).size, 3);
});
