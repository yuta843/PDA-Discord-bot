const RELAY_CHANNEL_ADMIN_USER_ID = "1068329268397998161";
const DEFAULT_RELAY_CHANNEL_ID = "1525816436625379458";
const DISCORD_CHANNEL_ID_PATTERN = /^\d{17,20}$/;

function parseDiscordChannelId(value) {
  const normalized = String(value ?? "").trim();
  return DISCORD_CHANNEL_ID_PATTERN.test(normalized) ? normalized : null;
}

function isValidDiscordChannelId(value) {
  return parseDiscordChannelId(value) !== null;
}

function canConfigureRelayChannel(userId) {
  return userId === RELAY_CHANNEL_ADMIN_USER_ID;
}

export {
  DEFAULT_RELAY_CHANNEL_ID,
  DISCORD_CHANNEL_ID_PATTERN,
  RELAY_CHANNEL_ADMIN_USER_ID,
  canConfigureRelayChannel,
  isValidDiscordChannelId,
  parseDiscordChannelId,
};
