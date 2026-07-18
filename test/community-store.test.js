import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommunityStore } from "../src/community-store.js";

function withStore(callback) {
  const directory = mkdtempSync(join(tmpdir(), "miq-community-"));
  const filePath = join(directory, "community-data.json");
  const store = new CommunityStore({ filePath, debounceMs: 0 });
  try {
    return callback(store, filePath);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("persists polls, reminders, stats, and quotes", () => {
  withStore((store, filePath) => {
    store.setPoll({ id: "poll-1", status: "active" });
    store.setReminder({ id: "reminder-1", guildId: "guild-1", userId: "user-1", dueAt: 1 });
    store.incrementStats({ guildId: "guild-1", userId: "user-1", event: "messages" });
    store.addQuote("guild-1", { id: "quote-1", imageCount: 2 });
    store.flush();

    const reloaded = new CommunityStore({ filePath, debounceMs: 0 });
    assert.equal(reloaded.getPoll("poll-1").status, "active");
    assert.equal(reloaded.getReminder("reminder-1").userId, "user-1");
    assert.equal(reloaded.getStats("guild-1", "user-1").totals.messages, 1);
    assert.equal(reloaded.getQuotes("guild-1")[0].imageCount, 2);
    reloaded.close();
  });
});

test("keeps stats isolated by guild and user", () => {
  withStore((store) => {
    store.incrementStats({ guildId: "guild-a", userId: "user-a", event: "gachaPulls", amount: 10 });
    store.incrementStats({ guildId: "guild-b", userId: "user-a", event: "gachaPulls", amount: 2 });

    assert.equal(store.getStats("guild-a", "user-a").totals.gachaPulls, 10);
    assert.equal(store.getStats("guild-a", "user-b").user.gachaPulls, 0);
    assert.equal(store.getStats("guild-b", "user-a").totals.gachaPulls, 2);
  });
});

test("returns due reminders and caps quote history", () => {
  withStore((store) => {
    store.setReminder({ id: "due", dueAt: 100, lastAttemptAt: null });
    store.setReminder({ id: "future", dueAt: 1_000, lastAttemptAt: null });
    assert.deepEqual(store.listDueReminders(100).map(({ id }) => id), ["due"]);

    for (let index = 0; index < 505; index += 1) {
      store.addQuote("guild-1", { id: String(index) });
    }
    assert.equal(store.getQuotes("guild-1", 500).length, 500);
    assert.equal(store.getQuotes("guild-1", 1)[0].id, "504");
  });
});

test("recovers from invalid JSON without throwing", () => {
  withStore((store, filePath) => {
    store.close();
    writeFileSync(filePath, "not-json", "utf8");
    const recovered = new CommunityStore({ filePath });
    assert.deepEqual(recovered.getStats("guild-1").totals, {
      messages: 0,
      relays: 0,
      relayedImages: 0,
      aiReplies: 0,
      gachaPulls: 0,
      pollsCreated: 0,
      pollVotes: 0,
      remindersCreated: 0,
    });
    recovered.close();
  });
});
