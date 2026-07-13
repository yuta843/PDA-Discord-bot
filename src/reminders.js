const MIN_REMINDER_MINUTES = 1;
const MAX_REMINDER_MINUTES = 7 * 24 * 60;
const MAX_REMINDER_TEXT_LENGTH = 500;
const MAX_ACTIVE_REMINDERS_PER_USER = 20;

function parseReminderMinutes(value) {
  const minutes = Number(value);
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_REMINDER_MINUTES ||
    minutes > MAX_REMINDER_MINUTES
  ) {
    return null;
  }
  return minutes;
}

function normalizeReminderText(value) {
  if (typeof value !== "string") return "";
  return [...value.replace(/\s+/g, " ").trim()]
    .slice(0, MAX_REMINDER_TEXT_LENGTH)
    .join("");
}

function createReminder({
  id,
  guildId,
  channelId,
  userId,
  text,
  minutes,
  createdAt = Date.now(),
}) {
  const safeMinutes = parseReminderMinutes(minutes);
  const normalizedText = normalizeReminderText(text);
  if (!id || !guildId || !channelId || !userId || !safeMinutes || !normalizedText) {
    throw new Error("A reminder requires a valid duration and message.");
  }

  return {
    id,
    guildId,
    channelId,
    userId,
    text: normalizedText,
    createdAt,
    dueAt: createdAt + safeMinutes * 60_000,
    lastAttemptAt: null,
  };
}

function isReminderDue(reminder, now = Date.now(), retryIntervalMs = 60_000) {
  if (!reminder || Number(reminder.dueAt) > now) return false;
  return !reminder.lastAttemptAt || now - Number(reminder.lastAttemptAt) >= retryIntervalMs;
}

function sortReminders(reminders) {
  return [...(Array.isArray(reminders) ? reminders : [])].sort(
    (left, right) => Number(left.dueAt) - Number(right.dueAt),
  );
}

export {
  MAX_ACTIVE_REMINDERS_PER_USER,
  MAX_REMINDER_MINUTES,
  MAX_REMINDER_TEXT_LENGTH,
  MIN_REMINDER_MINUTES,
  createReminder,
  isReminderDue,
  normalizeReminderText,
  parseReminderMinutes,
  sortReminders,
};
