function selectActiveMessages(
  entries,
  {
    count = 1,
    now = Date.now(),
    windowMs = 60_000,
    minActivity = 5,
    random = Math.random,
  } = {},
) {
  const cutoff = now - windowMs;
  const messagesByChannel = new Map();

  for (const entry of entries.values()) {
    if (entry.createdAt < cutoff) continue;
    const channelId = entry.message.channelId;
    const messages = messagesByChannel.get(channelId) ?? [];
    messages.push(entry);
    messagesByChannel.set(channelId, messages);
  }

  const activeChannels = [...messagesByChannel.values()].filter(
    (messages) => messages.length >= minActivity,
  );
  const pool = activeChannels.flat();
  const selected = [];
  while (pool.length && selected.length < count) {
    selected.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return selected;
}

function selectActiveMessage(entries, options = {}) {
  return selectActiveMessages(entries, { ...options, count: 1 })[0] ?? null;
}

export { selectActiveMessage, selectActiveMessages };
