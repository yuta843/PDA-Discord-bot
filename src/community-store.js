import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isReminderDue } from "./reminders.js";

const COMMUNITY_DATA_VERSION = 1;
const QUOTE_HISTORY_LIMIT = 500;
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
  };
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
}

export {
  COMMUNITY_DATA_VERSION,
  CommunityStore,
  QUOTE_HISTORY_LIMIT,
  STAT_KEYS,
  createEmptyCounters,
  normalizeData,
};
