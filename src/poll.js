const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 5;
const MIN_POLL_DURATION_MINUTES = 1;
const DEFAULT_POLL_DURATION_MINUTES = 60;
const MAX_POLL_DURATION_MINUTES = 7 * 24 * 60;
const MAX_POLL_QUESTION_LENGTH = 200;
const MAX_POLL_OPTION_LENGTH = 80;

function normalizePollText(value, maxLength) {
  if (typeof value !== "string") return "";
  return [...value.replace(/\s+/g, " ").trim()].slice(0, maxLength).join("");
}

function normalizePollOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((option) => normalizePollText(option, MAX_POLL_OPTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_POLL_OPTIONS);
}

function createPoll({
  id,
  guildId,
  channelId,
  messageId,
  createdBy,
  question,
  options,
  createdAt = Date.now(),
  durationMinutes = 60,
}) {
  const normalizedQuestion = normalizePollText(question, MAX_POLL_QUESTION_LENGTH);
  const normalizedOptions = normalizePollOptions(options);
  if (
    !id ||
    !guildId ||
    !channelId ||
    !messageId ||
    !createdBy ||
    !normalizedQuestion ||
    normalizedOptions.length < MIN_POLL_OPTIONS
  ) {
    throw new Error("A poll requires a question and at least two options.");
  }

  const safeDuration = Number.isInteger(durationMinutes) &&
      durationMinutes >= MIN_POLL_DURATION_MINUTES &&
      durationMinutes <= MAX_POLL_DURATION_MINUTES
    ? durationMinutes
    : DEFAULT_POLL_DURATION_MINUTES;
  return {
    id,
    guildId,
    channelId,
    messageId,
    createdBy,
    question: normalizedQuestion,
    options: normalizedOptions,
    votes: {},
    createdAt,
    expiresAt: createdAt + safeDuration * 60_000,
    status: "active",
    closedAt: null,
  };
}

function getPollCounts(poll) {
  const counts = Array.from({ length: poll?.options?.length ?? 0 }, () => 0);
  for (const optionIndex of Object.values(poll?.votes ?? {})) {
    if (Number.isInteger(optionIndex) && counts[optionIndex] !== undefined) {
      counts[optionIndex] += 1;
    }
  }
  return counts;
}

function isPollExpired(poll, now = Date.now()) {
  return poll?.status === "active" && Number(poll.expiresAt) <= now;
}

function castPollVote(poll, userId, optionIndex, now = Date.now()) {
  if (!poll || poll.status !== "active") return { ok: false, reason: "closed" };
  if (isPollExpired(poll, now)) return { ok: false, reason: "expired" };
  if (!userId || !Number.isInteger(optionIndex) || !poll.options?.[optionIndex]) {
    return { ok: false, reason: "invalid" };
  }

  const previousOptionIndex = poll.votes[userId];
  if (previousOptionIndex === optionIndex) {
    return {
      ok: true,
      changed: false,
      previousOptionIndex,
      counts: getPollCounts(poll),
    };
  }

  poll.votes[userId] = optionIndex;
  return {
    ok: true,
    changed: true,
    previousOptionIndex,
    optionIndex,
    counts: getPollCounts(poll),
  };
}

function closePoll(poll, closedAt = Date.now()) {
  if (!poll) return null;
  poll.status = "closed";
  poll.closedAt = closedAt;
  return poll;
}

function formatPollContent(poll, now = Date.now()) {
  const counts = getPollCounts(poll);
  const isClosed = poll?.status !== "active" || isPollExpired(poll, now);
  const options = (poll?.options ?? [])
    .map((option, index) => `${index + 1}. ${option} — ${counts[index] ?? 0}票`)
    .join("\n");
  const footer = isClosed
    ? "投票終了"
    : `期限: <t:${Math.floor(Number(poll.expiresAt) / 1000)}:R>`;
  return `📊 **${poll.question}**\n${options}\n\n${footer}`;
}

export {
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION_LENGTH,
  MAX_POLL_DURATION_MINUTES,
  DEFAULT_POLL_DURATION_MINUTES,
  MIN_POLL_DURATION_MINUTES,
  MIN_POLL_OPTIONS,
  castPollVote,
  closePoll,
  createPoll,
  formatPollContent,
  getPollCounts,
  isPollExpired,
  normalizePollOptions,
};
