const AI_STYLE_ALLOWED_USER_ID = "1068329268397998161";

function parseAiSettingsAllowedUserIds(value = "") {
  return new Set(
    String(value)
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^\d{5,25}$/.test(id)),
  );
}

function canChangeAiSettings(userId, allowedUserIds, { canManageGuild = false } = {}) {
  if (canManageGuild) return true;
  if (!(allowedUserIds instanceof Set) || allowedUserIds.size === 0) return true;
  return typeof userId === "string" && allowedUserIds.has(userId);
}

function canChangeAiStyle(userId) {
  return typeof userId === "string" && userId === AI_STYLE_ALLOWED_USER_ID;
}

export {
  AI_STYLE_ALLOWED_USER_ID,
  canChangeAiSettings,
  canChangeAiStyle,
  parseAiSettingsAllowedUserIds,
};
