import { readFile } from "node:fs/promises";
import sharp from "sharp";

const KIMAZU_COMMAND_PATTERN = /^\/kimazu\s*$/i;
const templateUrl = new URL("../assets/kimazu-template.jpg", import.meta.url);

function isKimazuCommand(content) {
  return KIMAZU_COMMAND_PATTERN.test(content?.trim() ?? "");
}

function isKimazuMentionCommand(content, botUserId) {
  if (!botUserId) return false;
  const escapedId = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^<@!?${escapedId}>\\s+kimazui\\s*$`, "i").test(content?.trim() ?? "");
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

async function downloadImage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Avatar download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export {
  createKimazuImage,
  cleanKimazuMessageText,
  downloadImage,
  isKimazuCommand,
  isKimazuMentionCommand,
  wrapMessageText,
};
