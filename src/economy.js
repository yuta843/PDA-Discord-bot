import { randomInt as cryptoRandomInt } from "node:crypto";

const COIN_NAME = "miq coin";
const COIN_SYMBOL = "🪙";
const STARTING_BALANCE = 500;
const MAX_BALANCE = 1_000_000_000;

const DAILY_COOLDOWN_MS = 24 * 60 * 60_000;
const DAILY_MIN_REWARD = 100;
const DAILY_MAX_REWARD = 200;
const DAILY_MAX_STREAK = 7;
const DAILY_STREAK_BONUS = 10;

const WORK_COOLDOWN_MS = 30 * 60_000;
const WORK_MIN_REWARD = 30;
const WORK_MAX_REWARD = 150;

const MAX_ROULETTE_BET = 1_000;
const MAX_TRANSFER_AMOUNT = 100_000;
const ROULETTE_MAX_NUMBER = 36;

const DAILY_QUESTS = Object.freeze([
  Object.freeze({
    key: "work",
    label: "/work を2回実行する",
    target: 2,
    reward: 100,
  }),
  Object.freeze({
    key: "pollVotes",
    label: "投票に1回参加する",
    target: 1,
    reward: 75,
  }),
  Object.freeze({
    key: "ankWins",
    label: "!ankで1回選出される",
    target: 1,
    reward: 150,
  }),
]);

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getDateKey(timestamp = Date.now()) {
  return TOKYO_DATE_FORMATTER.format(new Date(timestamp));
}

function getPreviousDateKey(dateKey) {
  const match = String(dateKey ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return date.toISOString().slice(0, 10);
}

function randomInclusive(min, max, randomInt = cryptoRandomInt) {
  return randomInt(min, max + 1);
}

function normalizePositiveInteger(value, max = MAX_BALANCE) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) return null;
  return number;
}

function createDailyProgress(dateKey = getDateKey()) {
  return {
    dateKey,
    work: 0,
    pollVotes: 0,
    ankWins: 0,
    claimed: {},
  };
}

function normalizeDailyProgress(value, dateKey = getDateKey()) {
  const progress = createDailyProgress(dateKey);
  if (!value || typeof value !== "object" || value.dateKey !== dateKey) return progress;

  for (const key of ["work", "pollVotes", "ankWins"]) {
    const number = Number(value[key]);
    if (Number.isSafeInteger(number) && number >= 0) progress[key] = number;
  }
  if (value.claimed && typeof value.claimed === "object") {
    for (const quest of DAILY_QUESTS) {
      if (value.claimed[quest.key] === true) progress.claimed[quest.key] = true;
    }
  }
  return progress;
}

function getDailyReward({ streak = 1, randomInt = cryptoRandomInt } = {}) {
  const safeStreak = Math.min(Math.max(Number(streak) || 1, 1), DAILY_MAX_STREAK);
  const base = randomInclusive(DAILY_MIN_REWARD, DAILY_MAX_REWARD, randomInt);
  const streakBonus = (safeStreak - 1) * DAILY_STREAK_BONUS;
  return {
    base,
    streak: safeStreak,
    streakBonus,
    amount: base + streakBonus,
  };
}

function getWorkReward({ randomInt = cryptoRandomInt } = {}) {
  return randomInclusive(WORK_MIN_REWARD, WORK_MAX_REWARD, randomInt);
}

function getRouletteColor(number) {
  if (number === 0) return "green";
  return RED_NUMBERS.has(number) ? "red" : "black";
}

function resolveRoulette({ amount, choice, number, randomInt = cryptoRandomInt } = {}) {
  const safeAmount = normalizePositiveInteger(amount, MAX_ROULETTE_BET);
  if (!safeAmount) throw new Error(`Roulette bet must be between 1 and ${MAX_ROULETTE_BET}.`);
  if (!["red", "black", "number"].includes(choice)) {
    throw new Error("Roulette choice must be red, black, or number.");
  }

  const safeNumber = choice === "number" ? normalizePositiveInteger(Number(number) + 1, 37) - 1 : null;
  if (choice === "number" && (safeNumber === null || safeNumber < 0 || safeNumber > ROULETTE_MAX_NUMBER)) {
    throw new Error("A number bet must choose a number from 0 to 36.");
  }

  const rolledNumber = randomInt(0, ROULETTE_MAX_NUMBER + 1);
  const color = getRouletteColor(rolledNumber);
  const won = choice === "number" ? rolledNumber === safeNumber : color === choice;
  const payoutMultiplier = choice === "number" ? 36 : 2;
  const payout = won ? safeAmount * payoutMultiplier : 0;
  const netChange = won ? payout - safeAmount : -safeAmount;

  return {
    amount: safeAmount,
    choice,
    number: safeNumber,
    rolledNumber,
    color,
    won,
    payout,
    netChange,
    payoutMultiplier,
  };
}

function getDailyQuestStatus(progress, dateKey = getDateKey()) {
  const normalized = normalizeDailyProgress(progress, dateKey);
  return DAILY_QUESTS.map((quest) => ({
    ...quest,
    progress: Math.min(normalized[quest.key], quest.target),
    completed: normalized[quest.key] >= quest.target,
    claimed: normalized.claimed[quest.key] === true,
  }));
}

function formatCoinAmount(value) {
  return `${COIN_SYMBOL} ${Number(value ?? 0).toLocaleString("ja-JP")}`;
}

export {
  COIN_NAME,
  COIN_SYMBOL,
  DAILY_COOLDOWN_MS,
  DAILY_MAX_REWARD,
  DAILY_MAX_STREAK,
  DAILY_MIN_REWARD,
  DAILY_QUESTS,
  DAILY_STREAK_BONUS,
  MAX_BALANCE,
  MAX_ROULETTE_BET,
  MAX_TRANSFER_AMOUNT,
  ROULETTE_MAX_NUMBER,
  STARTING_BALANCE,
  WORK_COOLDOWN_MS,
  WORK_MAX_REWARD,
  WORK_MIN_REWARD,
  createDailyProgress,
  formatCoinAmount,
  getDailyQuestStatus,
  getDailyReward,
  getDateKey,
  getPreviousDateKey,
  getRouletteColor,
  getWorkReward,
  normalizeDailyProgress,
  normalizePositiveInteger,
  resolveRoulette,
};
