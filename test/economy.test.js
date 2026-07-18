import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DAILY_COOLDOWN_MS,
  WORK_COOLDOWN_MS,
  getDailyReward,
  getRouletteColor,
  resolveRoulette,
} from "../src/economy.js";
import { CommunityStore } from "../src/community-store.js";

function withStore(callback) {
  const directory = mkdtempSync(join(tmpdir(), "miq-economy-"));
  const store = new CommunityStore({
    filePath: join(directory, "community-data.json"),
    debounceMs: 0,
  });
  try {
    return callback(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("calculates daily streak bonus and roulette colors", () => {
  assert.deepEqual(getDailyReward({ streak: 3, randomInt: (min) => min }), {
    base: 100,
    streak: 3,
    streakBonus: 20,
    amount: 120,
  });
  assert.equal(getRouletteColor(0), "green");
  assert.equal(getRouletteColor(1), "red");
  assert.equal(getRouletteColor(2), "black");
});

test("resolves red and exact-number roulette bets", () => {
  const red = resolveRoulette({
    amount: 100,
    choice: "red",
    randomInt: () => 1,
  });
  assert.equal(red.won, true);
  assert.equal(red.payout, 200);
  assert.equal(red.netChange, 100);

  const number = resolveRoulette({
    amount: 100,
    choice: "number",
    number: 0,
    randomInt: () => 0,
  });
  assert.equal(number.won, true);
  assert.equal(number.payout, 3_600);
  assert.equal(number.netChange, 3_500);
});

test("persists daily and work rewards with cooldowns", () => {
  withStore((store) => {
    const firstDay = Date.parse("2026-07-14T00:00:00+09:00");
    const daily = store.claimDaily({
      guildId: "guild-1",
      userId: "user-1",
      now: firstDay,
      randomInt: (min) => min,
    });
    assert.equal(daily.ok, true);
    assert.equal(daily.reward.amount, 100);
    assert.equal(store.getWallet("guild-1", "user-1").balance, 600);

    const duplicateDaily = store.claimDaily({
      guildId: "guild-1",
      userId: "user-1",
      now: firstDay + 1_000,
      randomInt: (min) => min,
    });
    assert.equal(duplicateDaily.reason, "cooldown");
    assert.equal(duplicateDaily.retryAfterMs, DAILY_COOLDOWN_MS - 1_000);

    const work = store.claimWork({
      guildId: "guild-1",
      userId: "user-1",
      now: firstDay,
      randomInt: (min) => min,
    });
    assert.equal(work.reward, 30);
    assert.equal(store.getWallet("guild-1", "user-1").dailyProgress.work, 1);

    const duplicateWork = store.claimWork({
      guildId: "guild-1",
      userId: "user-1",
      now: firstDay + 1_000,
      randomInt: (min) => min,
    });
    assert.equal(duplicateWork.reason, "cooldown");
    assert.equal(duplicateWork.retryAfterMs, WORK_COOLDOWN_MS - 1_000);
  });
});

test("supports transfers, roulette settlement, and daily quest rewards", () => {
  withStore((store) => {
    const now = Date.parse("2026-07-14T00:00:00+09:00");
    const transfer = store.transferEconomy({
      guildId: "guild-1",
      fromUserId: "user-1",
      toUserId: "user-2",
      amount: 100,
      transactionId: "pay-1",
      now,
    });
    assert.equal(transfer.ok, true);
    assert.equal(store.getWallet("guild-1", "user-1").balance, 400);
    assert.equal(store.getWallet("guild-1", "user-2").balance, 600);
    assert.equal(store.transferEconomy({
      guildId: "guild-1",
      fromUserId: "user-1",
      toUserId: "user-2",
      amount: 100,
      transactionId: "pay-1",
      now,
    }).reason, "duplicate");

    const roulette = store.playRoulette({
      guildId: "guild-1",
      userId: "user-1",
      amount: 100,
      choice: "red",
      transactionId: "roulette-1",
      randomInt: () => 1,
      now,
    });
    assert.equal(roulette.ok, true);
    assert.equal(roulette.wallet.balance, 500);

    store.claimWork({ guildId: "guild-1", userId: "user-1", now, randomInt: (min) => min });
    store.claimWork({
      guildId: "guild-1",
      userId: "user-1",
      now: now + WORK_COOLDOWN_MS,
      randomInt: (min) => min,
    });
    store.recordEconomyActivity({ guildId: "guild-1", userId: "user-1", activity: "pollVotes", now });
    const quests = store.claimDailyQuests({ guildId: "guild-1", userId: "user-1", now });
    assert.equal(quests.awards.length, 2);
    assert.equal(quests.totalAwarded, 175);
  });
});
