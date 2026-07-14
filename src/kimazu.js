import { readFile } from "node:fs/promises";
import sharp from "sharp";

const KIMAZU_COMMAND_PATTERN = /^\/kimazu\s*$/i;
const templateUrl = new URL("../assets/kimazu-template.jpg", import.meta.url);
const hakusihikaTemplateUrl = new URL("../assets/hakusihika-template.jpg", import.meta.url);
const DISCORD_ASSET_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const CUSTOM_EMOJI_PATTERN = /<(?:(a)?):([A-Za-z0-9_~]+):(\d+)>/g;

function isKimazuCommand(content) {
  return KIMAZU_COMMAND_PATTERN.test(content?.trim() ?? "");
}

function isKimazuMentionCommand(content, botUserId) {
  if (!botUserId) return false;
  const escapedId = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^<@!?${escapedId}>\\s+kimazui\\s*$`, "i").test(content?.trim() ?? "");
}

function isHakusihikaMentionCommand(content, botUserId) {
  if (!botUserId) return false;
  const escapedId = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^<@!?${escapedId}>\\s+hakusihika\\s*$`, "i").test(content?.trim() ?? "");
}

function isAllowedDiscordAssetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && DISCORD_ASSET_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function extractCustomEmojiTokens(text) {
  const tokens = [];
  CUSTOM_EMOJI_PATTERN.lastIndex = 0;
  for (const match of text?.matchAll(CUSTOM_EMOJI_PATTERN) ?? []) {
    tokens.push({
      token: match[0],
      animated: Boolean(match[1]),
      name: match[2],
      id: match[3],
      url: `https://cdn.discordapp.com/emojis/${match[3]}.${match[1] ? "gif" : "png"}?size=64&quality=lossless`,
    });
  }
  CUSTOM_EMOJI_PATTERN.lastIndex = 0;
  return tokens;
}

function restoreCustomEmojiTokens(cleanText, rawText) {
  const rawTokens = extractCustomEmojiTokens(rawText);
  let searchFrom = 0;
  return String(cleanText ?? "").replace(/:([A-Za-z0-9_~]+):/g, (match, name) => {
    const tokenIndex = rawTokens.findIndex(
      (item, index) => index >= searchFrom && item.name === name,
    );
    if (tokenIndex < 0) return match;
    searchFrom = tokenIndex + 1;
    return rawTokens[tokenIndex].token;
  });
}

function getStickerImageUrl(sticker) {
  const url = sticker?.url;
  if (!isAllowedDiscordAssetUrl(url) || /\.(?:json|lottie)(?:\?|$)/i.test(url)) return null;
  return url;
}

async function downloadOptionalDiscordImage(url, fetchImpl = fetch) {
  if (!isAllowedDiscordAssetUrl(url)) return null;
  try {
    return await downloadImage(url, fetchImpl);
  } catch {
    return null;
  }
}

async function downloadHakusihikaAssets(message, messageText, fetchImpl = fetch) {
  const emojiAssets = new Map();
  const emojiTokens = extractCustomEmojiTokens(messageText);
  const uniqueEmojiTokens = [...new Map(emojiTokens.map((item) => [item.token, item])).values()];
  const emojiResults = await Promise.all(
    uniqueEmojiTokens.map(async (item) => [item.token, await downloadOptionalDiscordImage(item.url, fetchImpl)]),
  );
  for (const [token, input] of emojiResults) {
    if (input) emojiAssets.set(token, input);
  }

  const stickers = [...(message?.stickers?.values?.() ?? [])]
    .map(getStickerImageUrl)
    .filter(Boolean)
    .slice(0, 2);
  const stickerInputs = (await Promise.all(stickers.map((url) => downloadOptionalDiscordImage(url, fetchImpl))))
    .filter(Boolean);

  return { emojiAssets, stickerInputs };
}

async function downloadHakusihikaImages(imageAssets, fetchImpl = fetch) {
  const urls = [...new Set((imageAssets ?? []).map((asset) => asset?.url).filter(Boolean))].slice(0, 2);
  return (await Promise.all(urls.map((url) => downloadOptionalDiscordImage(url, fetchImpl)))).filter(Boolean);
}

function cleanKimazuMessageText(text, { botUserId, botNames = [] } = {}) {
  let cleaned = text ?? "";
  if (botUserId) {
    cleaned = cleaned.replace(new RegExp(`<@!?${botUserId}>`, "g"), "");
  }
  for (const name of botNames.filter(Boolean)) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`@${escapedName}`, "gi"), "");
  }
  return cleaned.replace(/\bkimazui\b/gi, "").replace(/\s+/g, " ").trim();
}

function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapMessageText(text, maxCharacters = 17, maxLines = 3) {
  const normalized = (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n") || "（メッセージ本文なし）";
  const allCharacters = [...normalized.replaceAll("\n", "")];
  const requiredLines = Math.min(maxLines, Math.max(1, Math.ceil(allCharacters.length / maxCharacters)));
  const balancedLength = Math.min(maxCharacters, Math.ceil(allCharacters.length / requiredLines));
  const lines = [];

  for (const paragraph of normalized.split("\n")) {
    let remaining = [...paragraph];
    while (remaining.length && lines.length < maxLines) {
      let take = Math.min(balancedLength, remaining.length);
      if (take < remaining.length && /^[、。！？!?）)」』】]/.test(remaining[take])) take += 1;
      lines.push(remaining.slice(0, take).join(""));
      remaining = remaining.slice(take);
    }
    if (lines.length >= maxLines) break;
  }

  const visibleCharacters = lines.reduce((sum, line) => sum + [...line].length, 0);
  if (visibleCharacters < allCharacters.length) {
    lines[maxLines - 1] = `${[...lines[maxLines - 1]].slice(0, maxCharacters - 1).join("")}…`;
  }
  return lines;
}

async function createKimazuImage(avatarInput, { templateInput, messageText = "" } = {}) {
  const template = templateInput ?? (await readFile(templateUrl));
  const metadata = await sharp(template).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("Kimazu template has no dimensions");

  const avatarSize = Math.round(width * 0.235);
  const borderSize = Math.max(6, Math.round(width * 0.008));
  const x = Math.round(width * 0.055);
  const y = Math.round(height * 0.08);
  const circle = Buffer.from(
    `<svg width="${avatarSize}" height="${avatarSize}">` +
      `<circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="white"/>` +
    `</svg>`,
  );
  const border = Buffer.from(
    `<svg width="${avatarSize + borderSize * 2}" height="${avatarSize + borderSize * 2}">` +
      `<circle cx="${avatarSize / 2 + borderSize}" cy="${avatarSize / 2 + borderSize}" ` +
        `r="${avatarSize / 2 + borderSize / 2}" fill="white" fill-opacity="0.96"/>` +
    `</svg>`,
  );
  const avatar = await sharp(avatarInput)
    .resize(avatarSize, avatarSize, { fit: "cover" })
    .composite([{ input: circle, blend: "dest-in" }])
    .png()
    .toBuffer();
  const textLines = wrapMessageText(messageText, 14, 6);
  const boxWidth = Math.round(width * 0.34);
  const boxHeight = 28 + textLines.length * 27;
  const boxX = Math.round(width * 0.018);
  const boxY = Math.min(height - boxHeight - 12, y + avatarSize + 12);
  const textOverlay = Buffer.from(
    `<svg width="${width}" height="${height}">` +
      `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="16" ` +
        `fill="white" fill-opacity="0.88" stroke="#333" stroke-opacity="0.2" stroke-width="2"/>` +
      `<text x="${boxX + 16}" y="${boxY + 27}" font-family="Noto Sans JP, Yu Gothic, Meiryo, sans-serif" ` +
        `font-size="20" font-weight="600" fill="#202124">` +
        textLines.map((line, index) =>
          `<tspan x="${boxX + 16}" dy="${index === 0 ? 0 : 27}">${escapeXml(line)}</tspan>`,
        ).join("") +
      `</text>` +
    `</svg>`,
  );

  return sharp(template)
    .composite([
      { input: border, left: x - borderSize, top: y - borderSize },
      { input: avatar, left: x, top: y },
      { input: textOverlay, left: 0, top: 0 },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

function formatMessageTime(timestamp) {
  if (!timestamp) return "";
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function estimateTextWidth(text, fontSize) {
  return [...String(text ?? "")].reduce(
    (width, character) =>
      width + (/[ᄀ-ᅟ⺀-꓏가-힯豈-﫿぀-ヿ＀-￯]/u.test(character)
        ? fontSize
        : fontSize * 0.58),
    0,
  );
}

function truncateTextToWidth(text, maxWidth, fontSize) {
  const value = String(text ?? "");
  if (estimateTextWidth(value, fontSize) <= maxWidth) return value;
  const ellipsis = "…";
  let result = "";
  for (const character of value) {
    if (estimateTextWidth(`${result}${character}${ellipsis}`, fontSize) > maxWidth) break;
    result += character;
  }
  return `${result}${ellipsis}`;
}

function getEmojiAsset(emojiAssets, token) {
  if (emojiAssets instanceof Map) return emojiAssets.get(token);
  return emojiAssets?.[token];
}

function createDiscordVisualTokens(text, emojiAssets) {
  const tokens = [];
  const appendText = (value) => {
    for (const character of value) {
      tokens.push(character === "\n" ? { type: "newline" } : { type: "text", value: character });
    }
  };
  let cursor = 0;
  CUSTOM_EMOJI_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(CUSTOM_EMOJI_PATTERN)) {
    appendText(text.slice(cursor, match.index));
    if (getEmojiAsset(emojiAssets, match[0])) {
      tokens.push({ type: "emoji", token: match[0] });
    } else {
      appendText(match[0]);
    }
    cursor = match.index + match[0].length;
  }
  appendText(text.slice(cursor));
  CUSTOM_EMOJI_PATTERN.lastIndex = 0;
  return tokens;
}

function visualTokenWidth(token, fontSize) {
  if (token.type === "emoji") return fontSize * 1.8 + 5;
  return token.value === " " ? fontSize * 0.5 : fontSize;
}

function wrapDiscordVisualTokens(tokens, maxWidth, fontSize, maxLines) {
  const lines = [[]];
  let lineWidth = 0;
  for (const token of tokens) {
    if (token.type === "newline") {
      lines.push([]);
      lineWidth = 0;
      continue;
    }
    const tokenWidth = visualTokenWidth(token, fontSize);
    if (lineWidth > 0 && lineWidth + tokenWidth > maxWidth) {
      lines.push([]);
      lineWidth = 0;
    }
    if (token.type === "text" && token.value === " " && lineWidth === 0) continue;
    lines.at(-1).push(token);
    lineWidth += tokenWidth;
  }

  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  const lastLine = visible.at(-1) ?? [];
  const ellipsis = { type: "text", value: "…" };
  let lastWidth = lastLine.reduce((sum, token) => sum + visualTokenWidth(token, fontSize), 0);
  while (lastLine.length && lastWidth + visualTokenWidth(ellipsis, fontSize) > maxWidth) {
    lastWidth -= visualTokenWidth(lastLine.pop(), fontSize);
  }
  lastLine.push(ellipsis);
  return visible;
}

async function toPngDataUri(input) {
  const png = await sharp(input).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function fitImageInside(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  if (!sourceWidth || !sourceHeight || maxWidth <= 0 || maxHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  };
}

async function createHakusihikaImage({
  templateInput,
  messageText = "",
  authorName = "Discord",
  timestamp,
  avatarInput,
  emojiAssets = new Map(),
  stickerInputs = [],
  imageInputs = [],
  renderScale = 2,
} = {}) {
  const template = templateInput ?? (await readFile(hakusihikaTemplateUrl));
  const metadata = await sharp(template).metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (!sourceWidth || !sourceHeight) throw new Error("Hakusihika template has no dimensions");
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 2;
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const scaleX = width / 616;
  const scaleY = height / 346;
  const paper = {
    topLeft: { x: 0, y: 76 * scaleY },
    topRight: { x: 346 * scaleX, y: 78 * scaleY },
    bottomRight: { x: 346 * scaleX, y: 321 * scaleY },
    bottomLeft: { x: 0, y: 305 * scaleY },
  };
  const paperPath = [
    `M ${paper.topLeft.x} ${paper.topLeft.y}`,
    `L ${paper.topRight.x} ${paper.topRight.y}`,
    `L ${paper.bottomRight.x} ${paper.bottomRight.y}`,
    `L ${paper.bottomLeft.x} ${paper.bottomLeft.y}`,
    "Z",
  ].join(" ");

  const drawingScale = Math.min(scaleX, scaleY);
  const bodyFontSize = 19 * drawingScale;
  const emojiSize = bodyFontSize * 1.8;
  const lineHeight = Math.max(bodyFontSize * 1.3, emojiSize * 1.04);
  const bodyX = 18 * scaleX;
  const bodyY = 151 * scaleY;
  const contentWidth = 302 * scaleX;
  const contentHeight = paper.bottomLeft.y - bodyY - 18 * scaleY;
  const maxLines = Math.max(3, Math.floor(contentHeight / lineHeight));
  const rawMessageText = String(messageText ?? "").trim();
  const placeholderText = new Set(["メッセージなし", "画像・ファイル付きメッセージ"]);
  const mediaOnly = imageInputs.length > 0 && (!rawMessageText || placeholderText.has(rawMessageText));
  const stickerOnly = imageInputs.length === 0 && stickerInputs.length === 1 && (!rawMessageText || placeholderText.has(rawMessageText));
  const displayMessage = mediaOnly || stickerOnly ? "" : rawMessageText || "メッセージなし";
  const visualTokens = createDiscordVisualTokens(displayMessage, emojiAssets);
  const textLines = displayMessage
    ? wrapDiscordVisualTokens(visualTokens, contentWidth, bodyFontSize, maxLines)
    : [];
  const emojiDataUris = new Map();
  for (const token of visualTokens.filter((item) => item.type === "emoji")) {
    if (emojiDataUris.has(token.token)) continue;
    const input = getEmojiAsset(emojiAssets, token.token);
    if (input) emojiDataUris.set(token.token, await toPngDataUri(input));
  }

  const headerX = avatarInput ? 64 * scaleX : 18 * scaleX;
  const headerY = 104 * scaleY;
  const authorFontSize = 16 * drawingScale;
  const timestampFontSize = 12 * drawingScale;
  const timestampText = formatMessageTime(timestamp);
  const headerRight = 326 * scaleX;
  const timestampWidth = timestampText ? estimateTextWidth(timestampText, timestampFontSize) : 0;
  const fullAuthorName = String(authorName || "Discord");
  const headerGap = 12 * scaleX;
  const desiredTimestampX = headerX + estimateTextWidth(fullAuthorName, authorFontSize) + headerGap;
  const timestampX = timestampText
    ? Math.min(desiredTimestampX, headerRight - timestampWidth)
    : headerRight;
  const displayAuthorName = truncateTextToWidth(
    fullAuthorName,
    Math.max(50 * scaleX, timestampX - headerX - headerGap),
    authorFontSize,
  );
  const bodyParts = [];
  for (const [lineIndex, line] of textLines.entries()) {
    let x = bodyX;
    const y = bodyY + lineIndex * lineHeight;
    let textRun = "";
    let textRunX = x;
    const flushTextRun = () => {
      if (!textRun) return;
      bodyParts.push(
        `<text x="${textRunX}" y="${y}" font-family="Segoe UI Emoji, Noto Color Emoji, Yu Gothic, Meiryo, sans-serif" ` +
          `font-size="${bodyFontSize}" fill="#36322e">${escapeXml(textRun)}</text>`,
      );
      textRun = "";
    };
    for (const token of line) {
      if (token.type === "text") {
        if (!textRun) textRunX = x;
        textRun += token.value;
        x += visualTokenWidth(token, bodyFontSize);
        continue;
      }
      flushTextRun();
      if (token.type === "emoji" && emojiDataUris.has(token.token)) {
        bodyParts.push(
          `<image x="${x}" y="${y - emojiSize * 0.86}" width="${emojiSize}" height="${emojiSize}" ` +
            `href="${emojiDataUris.get(token.token)}" preserveAspectRatio="xMidYMid meet"/>`,
        );
      }
      x += visualTokenWidth(token, bodyFontSize);
    }
    flushTextRun();
  }

  const imageData = [];
  for (const input of imageInputs.slice(0, 2)) {
    const [uri, metadata] = await Promise.all([toPngDataUri(input), sharp(input).metadata()]);
    imageData.push({
      uri,
      width: metadata.width ?? 1,
      height: metadata.height ?? 1,
    });
  }
  const mediaY = displayMessage ? bodyY + textLines.length * lineHeight + 5 * scaleY : 130 * scaleY;
  const imageCount = imageData.length;
  const mediaGap = 8 * scaleX;
  const imageColumnWidth = imageCount
    ? (contentWidth - mediaGap * (imageCount - 1)) / imageCount
    : 0;
  const imageSpace = paper.bottomLeft.y - mediaY - 8 * scaleY;
  const imageParts = [];
  let imageBottom = mediaY;
  for (const [index, image] of imageData.entries()) {
    const fitted = fitImageInside(image.width, image.height, imageColumnWidth, imageSpace);
    const x = bodyX + index * (imageColumnWidth + mediaGap) + (imageColumnWidth - fitted.width) / 2;
    imageParts.push(
      `<rect x="${x}" y="${mediaY}" width="${fitted.width}" height="${fitted.height}" rx="${8 * drawingScale}" ` +
        `fill="#e7e0d7"/>` +
        `<image x="${x}" y="${mediaY}" width="${fitted.width}" height="${fitted.height}" href="${image.uri}" ` +
        `preserveAspectRatio="xMidYMid meet"/>`,
    );
    imageBottom = Math.max(imageBottom, mediaY + fitted.height);
  }

  const stickerParts = [];
  const stickerY = imageCount
    ? imageBottom + 8 * scaleY
    : stickerOnly
      ? 130 * scaleY
      : mediaY;
  const stickerSpace = paper.bottomLeft.y - stickerY - 8 * scaleY;
  const stickerCount = Math.min(stickerInputs.length, 2);
  const stickerGap = 8 * scaleX;
  const stickerWidth = stickerCount
    ? (contentWidth - stickerGap * (stickerCount - 1)) / stickerCount
    : 0;
  const stickerSize = Math.min(stickerWidth, stickerSpace);
  if (stickerSize > 12) {
    for (const [index, input] of stickerInputs.slice(0, 2).entries()) {
      const uri = await toPngDataUri(input);
      const x = bodyX + index * (stickerSize + stickerGap);
      stickerParts.push(
        `<image x="${x}" y="${stickerY}" width="${stickerSize}" height="${stickerSize}" ` +
          `href="${uri}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    }
  }

  const paperOverlay = Buffer.from(
    `<svg width="${width}" height="${height}"><path d="${paperPath}" fill="#fffaf0" fill-opacity="0.96"/></svg>`,
  );
  const textOverlay = Buffer.from(
    `<svg width="${width}" height="${height}">` +
      `<text x="${headerX}" y="${headerY}" font-family="Segoe UI, Yu Gothic, Meiryo, sans-serif" ` +
        `font-size="${authorFontSize}" font-weight="700" fill="#6337a6">${escapeXml(displayAuthorName)}</text>` +
      (timestampText
        ? `<text x="${timestampX}" y="${headerY}" font-family="Segoe UI, Yu Gothic, Meiryo, sans-serif" ` +
          `font-size="${timestampFontSize}" fill="#777">${escapeXml(timestampText)}</text>`
        : "") +
      bodyParts.join("") +
      imageParts.join("") +
      stickerParts.join("") +
    `</svg>`,
  );

  const composite = [{ input: paperOverlay }];
  if (avatarInput) {
    const avatarSize = Math.round(38 * drawingScale);
    const avatarX = Math.round(16 * scaleX);
    const avatarY = Math.round(87 * scaleY);
    const borderSize = Math.max(2, Math.round(3 * drawingScale));
    const circle = Buffer.from(
      `<svg width="${avatarSize}" height="${avatarSize}"><circle cx="${avatarSize / 2}" ` +
        `cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="white"/></svg>`,
    );
    const avatar = await sharp(avatarInput)
      .resize(avatarSize, avatarSize, { fit: "cover" })
      .composite([{ input: circle, blend: "dest-in" }])
      .png()
      .toBuffer();
    const border = Buffer.from(
      `<svg width="${avatarSize + borderSize * 2}" height="${avatarSize + borderSize * 2}">` +
        `<circle cx="${avatarSize / 2 + borderSize}" cy="${avatarSize / 2 + borderSize}" ` +
          `r="${avatarSize / 2 + borderSize / 2}" fill="white" fill-opacity="0.96"/></svg>`,
    );
    composite.push(
      { input: border, left: avatarX - borderSize, top: avatarY - borderSize },
      { input: avatar, left: avatarX, top: avatarY },
    );
  }
  composite.push({ input: textOverlay });
  return sharp(template)
    .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .composite(composite)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function downloadImage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Avatar download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export {
  createHakusihikaImage,
  createKimazuImage,
  cleanKimazuMessageText,
  downloadHakusihikaAssets,
  downloadHakusihikaImages,
  downloadImage,
  extractCustomEmojiTokens,
  fitImageInside,
  isAllowedDiscordAssetUrl,
  isKimazuCommand,
  restoreCustomEmojiTokens,
  isHakusihikaMentionCommand,
  isKimazuMentionCommand,
  wrapMessageText,
};
