const GAY_REACTIONS = Object.freeze(["🇬", "🇦", "🇾"]);
const RANDOM_FUN_REACTIONS = Object.freeze(["😂", "🤣", "💀", "🔥", "😭", "🗿", "🤡", "👏"]);

function scoreFunnyMessage(message) {
  const content = message?.content?.trim() ?? "";
  let score = 0;
  score += (content.match(/(?:草|笑|ｗ|w{2,}|lol|lmao)/gi) ?? []).length * 5;
  score += (content.match(/[!?！？]{2,}/g) ?? []).length * 2;
  score += (content.match(/\p{Extended_Pictographic}/gu) ?? []).length * 2;
  if (message?.attachments?.size > 0) score += 3;
  if (message?.embeds?.length > 0) score += 2;
  if (content.length >= 8 && content.length <= 180) score += 2;
  return score;
}

function selectFunniestMessage(messages) {
  const candidates = [...messages].filter((message) => message && !message.author?.bot);
  if (!candidates.length) return null;
  return candidates.reduce((best, message) =>
    scoreFunnyMessage(message) > scoreFunnyMessage(best) ? message : best,
  );
}

function pickRandomFunReaction(random = Math.random) {
  const index = Math.min(Math.floor(random() * RANDOM_FUN_REACTIONS.length), RANDOM_FUN_REACTIONS.length - 1);
  return RANDOM_FUN_REACTIONS[Math.max(index, 0)];
}

async function applyGayReactions(message, { random = Math.random } = {}) {
  const randomReaction = pickRandomFunReaction(random);
  for (const reaction of [...GAY_REACTIONS, randomReaction]) {
    await message.react(reaction);
  }
  return randomReaction;
}

export {
  GAY_REACTIONS,
  RANDOM_FUN_REACTIONS,
  applyGayReactions,
  pickRandomFunReaction,
  scoreFunnyMessage,
  selectFunniestMessage,
};
