import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  cleanKimazuMessageText,
  createKimazuImage,
  downloadImage,
  isKimazuCommand,
  isKimazuMentionCommand,
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
