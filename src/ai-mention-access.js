const AI_MENTION_ALLOWED_BOT_IDS = new Set([
  "1420463943549321256",
  "909232542639607859",
  "1526014470806048839",
]);

function canReceiveAiMentionFrom(author) {
  return Boolean(author && (!author.bot || AI_MENTION_ALLOWED_BOT_IDS.has(author.id)));
}

export { AI_MENTION_ALLOWED_BOT_IDS, canReceiveAiMentionFrom };
