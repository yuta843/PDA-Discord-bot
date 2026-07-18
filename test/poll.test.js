import test from "node:test";
import assert from "node:assert/strict";
import {
  castPollVote,
  closePoll,
  createPoll,
  formatPollContent,
  getPollCounts,
  isPollExpired,
} from "../src/poll.js";

function poll(overrides = {}) {
  return createPoll({
    id: "poll-1",
    guildId: "guild-1",
    channelId: "channel-1",
    messageId: "message-1",
    createdBy: "user-1",
    question: "どちら？",
    options: ["A", "B", "C"],
    createdAt: 1_000,
    durationMinutes: 10,
    ...overrides,
  });
}

test("creates a bounded active poll and counts votes", () => {
  const value = poll();
  assert.equal(value.status, "active");
  assert.equal(value.expiresAt, 601_000);

  assert.equal(castPollVote(value, "user-1", 1, 2_000).changed, true);
  assert.equal(castPollVote(value, "user-2", 1, 3_000).changed, true);
  assert.deepEqual(getPollCounts(value), [0, 2, 0]);
});

test("allows a user to change their vote without duplicating it", () => {
  const value = poll();
  castPollVote(value, "user-1", 0, 2_000);
  const result = castPollVote(value, "user-1", 2, 3_000);

  assert.equal(result.changed, true);
  assert.deepEqual(getPollCounts(value), [0, 0, 1]);
  assert.equal(castPollVote(value, "user-1", 2, 4_000).changed, false);
});

test("rejects votes after expiry and formats closed polls", () => {
  const value = poll();
  assert.equal(isPollExpired(value, value.expiresAt), true);
  assert.deepEqual(castPollVote(value, "user-1", 0, value.expiresAt), {
    ok: false,
    reason: "expired",
  });

  closePoll(value, value.expiresAt);
  assert.match(formatPollContent(value, value.expiresAt), /投票終了/);
});

test("requires at least two non-empty options", () => {
  assert.throws(
    () => poll({ options: ["only one", "   "] }),
    /at least two options/,
  );
});
