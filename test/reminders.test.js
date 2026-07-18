import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REMINDER_MINUTES,
  createReminder,
  isReminderDue,
  parseReminderMinutes,
  sortReminders,
} from "../src/reminders.js";

test("validates relative reminder durations", () => {
  assert.equal(parseReminderMinutes(1), 1);
  assert.equal(parseReminderMinutes(MAX_REMINDER_MINUTES), MAX_REMINDER_MINUTES);
  assert.equal(parseReminderMinutes(0), null);
  assert.equal(parseReminderMinutes(MAX_REMINDER_MINUTES + 1), null);
});

test("creates a reminder with a due timestamp", () => {
  const reminder = createReminder({
    id: "reminder-1",
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    text: "会議を確認する",
    minutes: 10,
    createdAt: 1_000,
  });

  assert.equal(reminder.dueAt, 601_000);
  assert.equal(isReminderDue(reminder, 600_999), false);
  assert.equal(isReminderDue(reminder, 601_000), true);
});

test("does not retry a failed reminder too frequently", () => {
  const reminder = createReminder({
    id: "reminder-1",
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    text: "通知",
    minutes: 1,
    createdAt: 1_000,
  });
  reminder.lastAttemptAt = reminder.dueAt;

  assert.equal(isReminderDue(reminder, reminder.dueAt + 59_999), false);
  assert.equal(isReminderDue(reminder, reminder.dueAt + 60_000), true);
});

test("sorts reminders by due time", () => {
  const sorted = sortReminders([{ dueAt: 3 }, { dueAt: 1 }, { dueAt: 2 }]);
  assert.deepEqual(sorted.map(({ dueAt }) => dueAt), [1, 2, 3]);
});
