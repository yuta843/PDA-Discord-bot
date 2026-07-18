import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isReminderDue } from "./reminders.js";
import {
  DAILY_COOLDOWN_MS,
  MAX_BALANCE,
  STARTING_BALANCE,
  WORK_COOLDOWN_MS,
  createDailyProgress,
  getDailyQuestStatus,
  getDailyReward,
  getDateKey,
  getPreviousDateKey,
  getWorkReward,
  normalizeDailyProgress,
  normalizePositiveInteger,
  resolveRoulette,
} from "./economy.js";

const COMMUNITY_DATA_VERSION = 1;
const QUOTE_HISTORY_LIMIT = 500;
const ECONOMY_TRANSACTION_LIMIT = 2_000;
const STAT_KEYS = Object.freeze([
  "messages",
  "relays",
  "relayedImages",
  "aiReplies",
  "gachaPulls",
  "pollsCreated",
  "pollVotes",
  "remindersCreated",
]);

function createEmptyCounters() {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
}

function normalizeCounters(value) {
  const counters = createEmptyCounters();
  for (const key of STAT_KEYS) {
    const number = Number(value?.[key]);
    if (Number.isFinite(number) && number >= 0) counters[key] = Math.floor(number);
  }
  return counters;
}

function createEmptyData() {
  return {
    version: COMMUNITY_DATA_VERSION,
    polls: {},
    reminders: {},
    stats: {},
    quotes: {},
    economy: {},
  };
}

function createEmptyWallet() {
  return {
    balance: STARTING_BALANCE,
    totalEarned: 0,
    totalSpent: 0,
    dailyStreak: 0,
    lastDailyAt: null,
    lastWorkAt: null,
    dailyProgress: createDailyProgress(),
  };
}

function normalizeWallet(value, dateKey = getDateKey()) {
  const wallet = createEmptyWallet();
  if (!value || typeof value !== "object") return wallet;

  for (const key of ["balance", "totalEarned", "totalSpent", "dailyStreak"]) {
    const number = Number(value[key]);
    if (Number.isSafeInteger(number) && number >= 0) {
      wallet[key] = key === "dailyStreak"
        ? Math.min(number, 7)
        : Math.min(number, MAX_BALANCE);
    }
  }
  for (const key of ["lastDailyAt", "lastWorkAt"]) {
    const timestamp = Number(value[key]);
    if (Number.isSafeInteger(timestamp) && timestamp > 0) wallet[key] = timestamp;
  }
  wallet.dailyProgress = normalizeDailyProgress(value.dailyProgress, dateKey);
  return wallet;
}

function normalizeEconomy(value) {
  const economy = {};
  if (!value || typeof value !== "object") return economy;

  for (const [guildId, guildEconomy] of Object.entries(value)) {
    if (!guildEconomy || typeof guildEconomy !== "object") continue;
    const users = {};
    if (guildEconomy.users && typeof guildEconomy.users === "object") {
      for (const [userId, wallet] of Object.entries(guildEconomy.users)) {
        users[userId] = normalizeWallet(wallet);
      }
    }
    const transactions = Array.isArray(guildEconomy.transactions)
      ? guildEconomy.transactions
        .filter((transaction) => transaction && typeof transaction === "object")
        .slice(-ECONOMY_TRANSACTION_LIMIT)
        .map((transaction) => ({ ...transaction }))
      : [];
    economy[guildId] = { users, transactions };
  }
  return economy;
}

function normalizeData(value) {
  const data = createEmptyData();
  if (!value || typeof value !== "object") return data;

  if (value.polls && typeof value.polls === "object") data.polls = value.polls;
  if (value.reminders && typeof value.reminders === "object") data.reminders = value.reminders;

  if (value.stats && typeof value.stats === "object") {
    for (const [guildId, guildStats] of Object.entries(value.stats)) {
      if (!guildStats || typeof guildStats !== "object") continue;
      const users = {};
      if (guildStats.users && typeof guildStats.users === "object") {
        for (const [userId, counters] of Object.entries(guildStats.users)) {
          users[userId] = normalizeCounters(counters);
        }
      }
      data.stats[guildId] = {
        totals: normalizeCounters(guildStats.totals),
        users,
      };
    }
  }

  if (value.quotes && typeof value.quotes === "object") {
    for (const [guildId, entries] of Object.entries(value.quotes)) {
      if (Array.isArray(entries)) data.quotes[guildId] = entries.slice(-QUOTE_HISTORY_LIMIT);
    }
  }
  data.economy = normalizeEconomy(value.economy);
  return data;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class CommunityStore {
  constructor({ filePath, debounceMs = 1_000 } = {}) {
    if (!filePath) throw new Error("CommunityStore filePath is required.");
    this.filePath = filePath;
    this.debounceMs = debounceMs;
    this.saveTimer = null;
    this.dirty = false;
    this.data = this.load();
  }

  load() {
    if (!existsSync(this.filePath)) return createEmptyData();
    try {
      return normalizeData(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch (error) {
      console.warn(`[community] Could not load data file: ${error.message}`);
      return createEmptyData();
    }
  }

  markDirty() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, this.debounceMs);
    this.saveTimer.unref?.();
  }

  flush() {
    if (!this.dirty) return;
    const serialized = `${JSON.stringify(this.data, null, 2)}\n`;
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      writeFileSync(temporaryPath, serialized, "utf8");
      try {
        renameSync(temporaryPath, this.filePath);
      } catch {
        writeFileSync(this.filePath, serialized, "utf8");
        rmSync(temporaryPath, { force: true });
      }
      this.dirty = false;
    } catch (error) {
      console.error(`[community] Could not save data file: ${error.message}`);
    }
  }

  close() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.flush();
  }

  getPoll(id) {
    return clone(this.data.polls[id]);
  }

  setPoll(poll) {
    this.data.polls[poll.id] = clone(poll);
    this.markDirty();
  }

  deletePoll(id) {
    if (!this.data.polls[id]) return false;
    delete this.data.polls[id];
    this.markDirty();
    return true;
  }

  listPolls() {
    return Object.values(this.data.polls).map(clone);
  }

  countUserReminders(guildId, userId) {
    return Object.values(this.data.reminders).filter(
      (reminder) => reminder.guildId === guildId && reminder.userId === userId,
    ).length;
  }

  getReminder(id) {
    return clone(this.data.reminders[id]);
  }

  setReminder(reminder) {
    this.data.reminders[reminder.id] = clone(reminder);
    this.markDirty();
  }

  deleteReminder(id) {
    if (!this.data.reminders[id]) return false;
    delete this.data.reminders[id];
    this.markDirty();
    return true;
  }

  listReminders({ guildId, userId } = {}) {
    return Object.values(this.data.reminders)
      .filter((reminder) =>
        (!guildId || reminder.guildId === guildId) &&
        (!userId || reminder.userId === userId),
      )
      .map(clone);
  }

  listDueReminders(now = Date.now()) {
    return Object.values(this.data.reminders)
      .filter((reminder) => isReminderDue(reminder, now))
      .map(clone);
  }

  getStats(guildId, userId = null) {
    const guildStats = this.data.stats[guildId];
    if (!guildStats) return { totals: createEmptyCounters(), user: userId ? createEmptyCounters() : null };
    return {
      totals: normalizeCounters(guildStats.totals),
      user: userId ? normalizeCounters(guildStats.users[userId]) : null,
    };
  }

  incrementStats({ guildId, userId, event, amount = 1 }) {
    if (!guildId || !STAT_KEYS.includes(event)) return false;
    const safeAmount = Number(amount);
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) return false;
    const guildStats = this.data.stats[guildId] ?? {
      totals: createEmptyCounters(),
      users: {},
    };
    guildStats.totals[event] += safeAmount;
    if (userId) {
      guildStats.users[userId] ??= createEmptyCounters();
      guildStats.users[userId][event] += safeAmount;
    }
    this.data.stats[guildId] = guildStats;
    this.markDirty();
    return true;
  }

  addQuote(guildId, quote) {
    if (!guildId || !quote) return;
    const entries = this.data.quotes[guildId] ?? [];
    entries.push(clone(quote));
    this.data.quotes[guildId] = entries.slice(-QUOTE_HISTORY_LIMIT);
    this.markDirty();
  }

  getQuotes(guildId, count = 10) {
    const safeCount = Math.max(1, Math.min(Number(count) || 10, QUOTE_HISTORY_LIMIT));
    return (this.data.quotes[guildId] ?? []).slice(-safeCount).reverse().map(clone);
  }

  ensureWallet(guildId, userId, dateKey = getDateKey()) {
    if (!guildId || !userId) throw new Error("guildId and userId are required.");
    this.data.economy[guildId] ??= { users: {}, transactions: [] };
    this.data.economy[guildId].users ??= {};
    this.data.economy[guildId].transactions ??= [];
    this.data.economy[guildId].users[userId] = normalizeWallet(
      this.data.economy[guildId].users[userId],
      dateKey,
    );
    return this.data.economy[guildId].users[userId];
  }

  getWallet(guildId, userId) {
    if (!guildId || !userId) return createEmptyWallet();
    return clone(this.data.economy[guildId]?.users?.[userId] ?? createEmptyWallet());
  }

  getLeaderboard(guildId, limit = 10) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 20));
    return Object.entries(this.data.economy[guildId]?.users ?? {})
      .map(([userId, wallet]) => ({
        userId,
        balance: normalizeWallet(wallet).balance,
      }))
      .sort((left, right) => right.balance - left.balance)
      .slice(0, safeLimit);
  }

  findEconomyTransaction(transactionId) {
    if (!transactionId) return null;
    for (const guildEconomy of Object.values(this.data.economy)) {
      const transaction = guildEconomy.transactions?.find(
        (entry) =>
          entry.transactionId === transactionId ||
          entry.transactionId?.startsWith(`${transactionId}:`),
      );
      if (transaction) return clone(transaction);
    }
    return null;
  }

  appendEconomyTransaction(guildId, transaction) {
    const guildEconomy = this.data.economy[guildId];
    guildEconomy.transactions.push(clone(transaction));
    guildEconomy.transactions = guildEconomy.transactions.slice(-ECONOMY_TRANSACTION_LIMIT);
  }

  applyWalletDelta({
    guildId,
    userId,
    amount,
    reason,
    type = "adjustment",
    transactionId,
    now = Date.now(),
  }) {
    const safeAmount = Number(amount);
    if (!Number.isSafeInteger(safeAmount) || safeAmount === 0) {
      return { ok: false, reason: "invalid_amount", wallet: this.getWallet(guildId, userId) };
    }
    if (transactionId && this.findEconomyTransaction(transactionId)) {
      return { ok: false, reason: "duplicate", wallet: this.getWallet(guildId, userId) };
    }

    const wallet = this.ensureWallet(guildId, userId, getDateKey(now));
    if (safeAmount < 0 && wallet.balance < Math.abs(safeAmount)) {
      return { ok: false, reason: "insufficient_funds", wallet: clone(wallet) };
    }
    if (safeAmount > 0 && wallet.balance > MAX_BALANCE - safeAmount) {
      return { ok: false, reason: "balance_limit", wallet: clone(wallet) };
    }

    wallet.balance += safeAmount;
    if (safeAmount > 0) wallet.totalEarned += safeAmount;
    if (safeAmount < 0) wallet.totalSpent += Math.abs(safeAmount);
    this.appendEconomyTransaction(guildId, {
      transactionId: transactionId ?? `economy-${guildId}-${userId}-${now}`,
      userId,
      type,
      reason,
      amount: safeAmount,
      balanceAfter: wallet.balance,
      createdAt: now,
    });
    this.markDirty();
    return { ok: true, amount: safeAmount, wallet: clone(wallet) };
  }

  claimDaily({ guildId, userId, now = Date.now(), randomInt } = {}) {
    const today = getDateKey(now);
    const wallet = this.ensureWallet(guildId, userId, today);
    const lastDailyAt = Number(wallet.lastDailyAt) || 0;
    const retryAfterMs = Math.max(lastDailyAt + DAILY_COOLDOWN_MS - now, 0);
    if (retryAfterMs > 0) {
      return { ok: false, reason: "cooldown", retryAfterMs, wallet: clone(wallet) };
    }

    const previousDate = lastDailyAt > 0 ? getDateKey(lastDailyAt) : null;
    const streak = previousDate && previousDate === getPreviousDateKey(today)
      ? Math.min(wallet.dailyStreak + 1, 7)
      : 1;
    const reward = getDailyReward({ streak, randomInt });
    const result = this.applyWalletDelta({
      guildId,
      userId,
      amount: reward.amount,
      reason: "daily",
      type: "daily",
      transactionId: `${guildId}:${userId}:daily:${today}`,
      now,
    });
    if (!result.ok) return result;

    const currentWallet = this.ensureWallet(guildId, userId, today);
    currentWallet.dailyStreak = streak;
    currentWallet.lastDailyAt = now;
    currentWallet.dailyProgress = normalizeDailyProgress(currentWallet.dailyProgress, today);
    this.markDirty();
    return {
      ...result,
      wallet: clone(currentWallet),
      reward,
      streak,
      nextClaimAt: now + DAILY_COOLDOWN_MS,
    };
  }

  claimWork({ guildId, userId, now = Date.now(), randomInt } = {}) {
    const today = getDateKey(now);
    const wallet = this.ensureWallet(guildId, userId, today);
    const lastWorkAt = Number(wallet.lastWorkAt) || 0;
    const retryAfterMs = Math.max(lastWorkAt + WORK_COOLDOWN_MS - now, 0);
    if (retryAfterMs > 0) {
      return { ok: false, reason: "cooldown", retryAfterMs, wallet: clone(wallet) };
    }

    const reward = getWorkReward({ randomInt });
    const result = this.applyWalletDelta({
      guildId,
      userId,
      amount: reward,
      reason: "work",
      type: "work",
      transactionId: `${guildId}:${userId}:work:${now}`,
      now,
    });
    if (!result.ok) return result;

    const currentWallet = this.ensureWallet(guildId, userId, today);
    currentWallet.lastWorkAt = now;
    currentWallet.dailyProgress = normalizeDailyProgress(currentWallet.dailyProgress, today);
    currentWallet.dailyProgress.work += 1;
    this.markDirty();
    return {
      ...result,
      wallet: clone(currentWallet),
      reward,
      nextWorkAt: now + WORK_COOLDOWN_MS,
    };
  }

  recordEconomyActivity({ guildId, userId, activity, now = Date.now() } = {}) {
    if (!["pollVotes", "ankWins"].includes(activity)) return false;
    const today = getDateKey(now);
    const wallet = this.ensureWallet(guildId, userId, today);
    wallet.dailyProgress = normalizeDailyProgress(wallet.dailyProgress, today);
    wallet.dailyProgress[activity] += 1;
    this.markDirty();
    return true;
  }

  getDailyQuests(guildId, userId, now = Date.now()) {
    const wallet = this.getWallet(guildId, userId);
    const dateKey = getDateKey(now);
    return {
      dateKey,
      tasks: getDailyQuestStatus(wallet.dailyProgress, dateKey),
    };
  }

  claimDailyQuests({ guildId, userId, now = Date.now() } = {}) {
    const dateKey = getDateKey(now);
    const wallet = this.ensureWallet(guildId, userId, dateKey);
    wallet.dailyProgress = normalizeDailyProgress(wallet.dailyProgress, dateKey);
    const tasks = getDailyQuestStatus(wallet.dailyProgress, dateKey);
    const awards = [];

    for (const task of tasks) {
      if (!task.completed || task.claimed) continue;
      const result = this.applyWalletDelta({
        guildId,
        userId,
        amount: task.reward,
        reason: `quest:${task.key}`,
        type: "quest",
        transactionId: `${guildId}:${userId}:quest:${dateKey}:${task.key}`,
        now,
      });
      if (!result.ok) continue;
      wallet.dailyProgress.claimed[task.key] = true;
      awards.push({ key: task.key, label: task.label, amount: task.reward });
    }

    if (awards.length > 0) this.markDirty();
    return {
      awards,
      totalAwarded: awards.reduce((sum, award) => sum + award.amount, 0),
      tasks: getDailyQuestStatus(wallet.dailyProgress, dateKey),
      wallet: clone(wallet),
    };
  }

  transferEconomy({ guildId, fromUserId, toUserId, amount, transactionId, now = Date.now() } = {}) {
    const safeAmount = normalizePositiveInteger(amount, 100_000);
    if (!safeAmount || !fromUserId || !toUserId || fromUserId === toUserId) {
      return { ok: false, reason: "invalid_transfer" };
    }
    if (this.findEconomyTransaction(transactionId)) {
      return { ok: false, reason: "duplicate" };
    }

    const dateKey = getDateKey(now);
    const sender = this.ensureWallet(guildId, fromUserId, dateKey);
    const recipient = this.ensureWallet(guildId, toUserId, dateKey);
    if (sender.balance < safeAmount) {
      return { ok: false, reason: "insufficient_funds", wallet: clone(sender) };
    }
    if (recipient.balance > MAX_BALANCE - safeAmount) {
      return { ok: false, reason: "balance_limit", wallet: clone(sender) };
    }

    sender.balance -= safeAmount;
    sender.totalSpent += safeAmount;
    recipient.balance += safeAmount;
    recipient.totalEarned += safeAmount;
    this.appendEconomyTransaction(guildId, {
      transactionId: `${transactionId}:out`,
      userId: fromUserId,
      type: "transfer_out",
      reason: "pay",
      amount: -safeAmount,
      balanceAfter: sender.balance,
      counterpartyId: toUserId,
      createdAt: now,
    });
    this.appendEconomyTransaction(guildId, {
      transactionId: `${transactionId}:in`,
      userId: toUserId,
      type: "transfer_in",
      reason: "pay",
      amount: safeAmount,
      balanceAfter: recipient.balance,
      counterpartyId: fromUserId,
      createdAt: now,
    });
    this.markDirty();
    return {
      ok: true,
      amount: safeAmount,
      sender: clone(sender),
      recipient: clone(recipient),
    };
  }

  playRoulette({ guildId, userId, amount, choice, number, transactionId, now = Date.now(), randomInt } = {}) {
    if (this.findEconomyTransaction(transactionId)) {
      return { ok: false, reason: "duplicate" };
    }
    const wallet = this.ensureWallet(guildId, userId, getDateKey(now));
    const roulette = resolveRoulette({ amount, choice, number, randomInt });
    if (wallet.balance < roulette.amount) {
      return { ok: false, reason: "insufficient_funds", wallet: clone(wallet) };
    }

    const result = this.applyWalletDelta({
      guildId,
      userId,
      amount: roulette.netChange,
      reason: `roulette:${roulette.choice}`,
      type: "roulette",
      transactionId,
      now,
    });
    if (!result.ok) return result;
    return { ...result, roulette };
  }
}

export {
  COMMUNITY_DATA_VERSION,
  CommunityStore,
  ECONOMY_TRANSACTION_LIMIT,
  QUOTE_HISTORY_LIMIT,
  STAT_KEYS,
  createEmptyCounters,
  createEmptyWallet,
  normalizeData,
  normalizeEconomy,
  normalizeWallet,
};
