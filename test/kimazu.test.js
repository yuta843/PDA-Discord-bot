import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  createHakusihikaImage,
  cleanKimazuMessageText,
  createKimazuImage,
  downloadHakusihikaAssets,
  downloadHakusihikaImages,
  downloadImage,
  extractCustomEmojiTokens,
  fitImageInside,
  isAllowedDiscordAssetUrl,
  isKimazuCommand,
  isHakusihikaMentionCommand,
  isKimazuMentionCommand,
  restoreCustomEmojiTokens,
  wrapMessageText,
} from "../src/kimazu.js";

test("recognizes only the kimazu message command", () => {
  assert.equal(isKimazuCommand("/kimazu"), true);
  assert.equal(isKimazuCommand("  /KIMAZU  "), true);
  assert.equal(isKimazuCommand("/kimazu someone"), false);
  assert.equal(isKimazuCommand("hello"), false);
});

test("recognizes kimazui addressed to the bot", () => {
  assert.equal(isKimazuMentionCommand("<@123456> kimazui", "123456"), true);
  assert.equal(isKimazuMentionCommand("<@!123456> KIMAZUI", "123456"), true);
  assert.equal(isKimazuMentionCommand("<@999999> kimazui", "123456"), false);
  assert.equal(isKimazuMentionCommand("kimazui", "123456"), false);
});

test("recognizes hakusihika addressed to the bot", () => {
  assert.equal(isHakusihikaMentionCommand("<@123456> hakusihika", "123456"), true);
  assert.equal(isHakusihikaMentionCommand("<@!123456> HAKUSIHIKA", "123456"), true);
  assert.equal(isHakusihikaMentionCommand("<@999999> hakusihika", "123456"), false);
  assert.equal(isHakusihikaMentionCommand("hakusihika", "123456"), false);
});

test("extracts safe Discord custom emoji assets", () => {
  assert.deepEqual(extractCustomEmojiTokens("A <:wave:123> <a:spin:456>"), [
    {
      token: "<:wave:123>",
      animated: false,
      name: "wave",
      id: "123",
      url: "https://cdn.discordapp.com/emojis/123.png?size=64&quality=lossless",
    },
    {
      token: "<a:spin:456>",
      animated: true,
      name: "spin",
      id: "456",
      url: "https://cdn.discordapp.com/emojis/456.gif?size=64&quality=lossless",
    },
  ]);
  assert.equal(isAllowedDiscordAssetUrl("https://cdn.discordapp.com/emojis/123.png"), true);
  assert.equal(isAllowedDiscordAssetUrl("https://example.test/emojis/123.png"), false);
  assert.equal(
    restoreCustomEmojiTokens("こんにちは :wave:", "こんにちは <:wave:123>"),
    "こんにちは <:wave:123>",
  );
});

test("removes the bot mention and command word from image text", () => {
  assert.equal(
    cleanKimazuMessageText("<@123456> kimazui これは本文", {
      botUserId: "123456",
      botNames: ["miq bot"],
    }),
    "これは本文",
  );
  assert.equal(
    cleanKimazuMessageText("@miq bot これは本文", { botNames: ["miq bot"] }),
    "これは本文",
  );
});

test("composites the avatar and preserves the template dimensions", async () => {
  const template = await sharp({
    create: { width: 986, height: 557, channels: 3, background: "white" },
  }).jpeg().toBuffer();
  const avatar = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "red" },
  }).png().toBuffer();

  const result = await createKimazuImage(avatar, {
    templateInput: template,
    messageText: "これは返信先のメッセージです",
  });
  const metadata = await sharp(result).metadata();
  const pixel = await sharp(result).extract({ left: 170, top: 275, width: 1, height: 1 }).raw().toBuffer();

  assert.equal(metadata.width, 986);
  assert.equal(metadata.height, 557);
  assert.ok(pixel[0] > 200 && pixel[1] < 60 && pixel[2] < 60);
});

test("writes hakusihika text onto the paper template", async () => {
  const template = await sharp({
    create: { width: 986, height: 557, channels: 3, background: "white" },
  }).jpeg().toBuffer();

  const result = await createHakusihikaImage({
    templateInput: template,
    messageText: "これは白紙に書くメッセージです",
    renderScale: 1,
  });
  const metadata = await sharp(result).metadata();
  const stats = await sharp(result).stats();

  assert.equal(metadata.width, 986);
  assert.equal(metadata.height, 557);
  assert.ok(stats.isOpaque);
});

test("uses a high-resolution PNG for the default hakusihika output", async () => {
  const result = await createHakusihikaImage({ messageText: "高解像度テスト" });
  const metadata = await sharp(result).metadata();

  assert.equal(metadata.width, 1232);
  assert.equal(metadata.height, 678);
  assert.equal(metadata.format, "png");
});

test("renders Discord-style author data and custom emoji assets", async () => {
  const template = await sharp({
    create: { width: 616, height: 339, channels: 3, background: "white" },
  }).jpeg().toBuffer();
  const avatar = await sharp({
    create: { width: 64, height: 64, channels: 4, background: "blue" },
  }).png().toBuffer();
  const emoji = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "red" },
  }).png().toBuffer();

  const result = await createHakusihikaImage({
    templateInput: template,
    messageText: "絵文字 <:wave:123> つき",
    authorName: "SHIMA",
    timestamp: new Date("2026-07-13T13:25:00.000Z"),
    avatarInput: avatar,
    emojiAssets: new Map([["<:wave:123>", emoji]]),
    renderScale: 1,
  });
  const metadata = await sharp(result).metadata();

  assert.equal(metadata.width, 616);
  assert.equal(metadata.height, 339);
});

test("renders attached images in the Discord-style paper message", async () => {
  const template = await sharp({
    create: { width: 616, height: 339, channels: 3, background: "white" },
  }).jpeg().toBuffer();
  const attachedImage = await sharp({
    create: { width: 160, height: 100, channels: 3, background: "orange" },
  }).png().toBuffer();

  const result = await createHakusihikaImage({
    templateInput: template,
    messageText: "",
    imageInputs: [attachedImage],
    renderScale: 1,
  });
  const metadata = await sharp(result).metadata();

  assert.equal(metadata.width, 616);
  assert.equal(metadata.height, 339);
});

test("fits wide images without forcing them into a square", () => {
  assert.deepEqual(fitImageInside(400, 200, 300, 180), { width: 300, height: 150 });
  assert.deepEqual(fitImageInside(200, 400, 300, 180), { width: 90, height: 180 });
});

test("downloads only Discord emoji and static sticker assets", async () => {
  const input = new Uint8Array([1, 2, 3]);
  const fetchImpl = async (url) =>
    new Response(input, { status: url.includes("discordapp") ? 200 : 404 });
  const result = await downloadHakusihikaAssets(
    {
      stickers: new Map([
        ["safe", { url: "https://media.discordapp.net/stickers/1.png" }],
        ["unsafe", { url: "https://example.test/stickers/2.png" }],
      ]),
    },
    "<:wave:123>",
    fetchImpl,
  );

  assert.equal(result.emojiAssets.has("<:wave:123>"), true);
  assert.equal(result.stickerInputs.length, 1);
});

test("downloads attached Discord images only", async () => {
  const fetchImpl = async (url) =>
    new Response(new Uint8Array([1, 2, 3]), { status: url.includes("discordapp") ? 200 : 404 });
  const result = await downloadHakusihikaImages(
    [
      { url: "https://cdn.discordapp.com/attachments/1/2/photo.png" },
      { url: "https://example.test/photo.png" },
    ],
    fetchImpl,
  );

  assert.equal(result.length, 1);
});

test("wraps and truncates long reply text", () => {
  assert.deepEqual(wrapMessageText("abcdefgh", 4, 3), ["abcd", "efgh"]);
  assert.deepEqual(wrapMessageText("一行目\n二行目", 10, 3), ["一行目", "二行目"]);
  assert.equal(wrapMessageText("あいうえお、かきくけこ", 5, 3).some((line) => /^[、。]/.test(line)), false);
  assert.deepEqual(wrapMessageText("abcdefghijkl", 4, 2), ["abcd", "efg…"]);
});

test("downloads an avatar into a buffer", async () => {
  const result = await downloadImage("https://example.test/avatar.png", async () =>
    new Response(new Uint8Array([1, 2, 3])),
  );
  assert.deepEqual(result, Buffer.from([1, 2, 3]));
});
