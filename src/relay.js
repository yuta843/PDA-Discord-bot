const IMAGE_CONTENT_TYPE = /^image\//i;
const OCTET_STREAM_CONTENT_TYPE = "application/octet-stream";
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>]+/gi;
const ALLOWED_DISCORD_ASSET_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

function isAllowedDiscordAssetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_DISCORD_ASSET_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function getUrlExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i);
    return match ? `.${match[1].toLowerCase()}` : ".png";
  } catch {
    return ".png";
  }
}

function cleanFileName(name) {
  if (!name || typeof name !== "string") return null;
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || null;
}

function normalizeContentType(contentType) {
  return String(contentType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function isImageAttachment(attachment) {
  if (!attachment?.url || !isAllowedDiscordAssetUrl(attachment.url)) return false;
  const contentType = normalizeContentType(attachment.contentType);
  if (contentType) {
    if (IMAGE_CONTENT_TYPE.test(contentType)) return true;
    if (contentType !== OCTET_STREAM_CONTENT_TYPE) return false;
  }
  return IMAGE_EXTENSION.test(attachment.name ?? attachment.url.split("?")[0]);
}

function isUnknownAttachment(attachment) {
  const contentType = normalizeContentType(attachment?.contentType);
  if (
    !attachment?.url ||
    !isAllowedDiscordAssetUrl(attachment.url) ||
    (contentType && contentType !== OCTET_STREAM_CONTENT_TYPE) ||
    isImageAttachment(attachment)
  ) {
    return false;
  }
  const name = attachment.name ?? attachment.url.split("?")[0];
  return !/\.[a-z0-9]{1,8}$/i.test(name);
}

function isLikelyImageUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      isAllowedDiscordAssetUrl(url) &&
      (IMAGE_EXTENSION.test(parsed.pathname) || ALLOWED_DISCORD_ASSET_HOSTS.has(parsed.hostname))
    );
  } catch {
    return false;
  }
}

function getImageAssets(message, { includeUnknownAttachments = false } = {}) {
  const assets = [];

  for (const attachment of message.attachments?.values?.() ?? []) {
    if (
      !isImageAttachment(attachment) &&
      !(includeUnknownAttachments && isUnknownAttachment(attachment))
    ) {
      continue;
    }
    assets.push({
      url: attachment.url,
      name: cleanFileName(attachment.name) ?? `quote${getUrlExtension(attachment.url)}`,
    });
  }

  for (const embed of message.embeds ?? []) {
    const url = embed.image?.url ?? embed.thumbnail?.url;
    if (!url || !isAllowedDiscordAssetUrl(url)) continue;
    assets.push({ url, name: `quote${getUrlExtension(url)}` });
  }

  for (const rawUrl of message.content?.match(URL_PATTERN) ?? []) {
    const url = rawUrl.replace(/[),.;!?]+$/, "");
    if (!isLikelyImageUrl(url)) continue;
    assets.push({ url, name: `quote${getUrlExtension(url)}` });
  }

  const seen = new Set();
  return assets.filter((asset) => {
    if (seen.has(asset.url)) return false;
    seen.add(asset.url);
    return true;
  });
}

function isQuoteBotAuthor(author, quoteBotId) {
  return Boolean(author?.bot && quoteBotId && author.id === quoteBotId);
}

function getImageUrls(message) {
  return getImageAssets(message).map((asset) => asset.url);
}

function shouldRelay(
  message,
  { quoteBotId, quoteBotName = "", sourceChannelIds = [] },
) {
  if (!message?.guildId || !isQuoteBotAuthor(message.author, quoteBotId, quoteBotName)) {
    return false;
  }
  if (sourceChannelIds.length && !sourceChannelIds.includes(message.channelId)) {
    return false;
  }
  const hasUnknownAttachment = [...(message.attachments?.values?.() ?? [])].some(
    isUnknownAttachment,
  );
  return getImageAssets(message).length > 0 || hasUnknownAttachment;
}

export {
  ALLOWED_DISCORD_ASSET_HOSTS,
  getImageAssets,
  getImageUrls,
  isImageAttachment,
  isAllowedDiscordAssetUrl,
  isQuoteBotAuthor,
  shouldRelay,
};
