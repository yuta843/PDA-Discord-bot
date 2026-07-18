import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERATED_IMAGE_FORWARD_CHANNEL_ID,
  copyGeneratedImage,
  forwardGeneratedImage,
  resolveGeneratedImageForwardChannelId,
} from "../src/generated-image-forward.js";

test("forwards both generated image formats to the configured channel", async () => {
  const image = Buffer.from("image");
  const sent = [];
  const fetched = [];
  const client = {
    channels: {
      fetch: async (channelId) => {
        fetched.push(channelId);
        return {
          isTextBased: () => true,
          send: async (payload) => {
            sent.push(payload);
            return { id: "forwarded" };
          },
        };
      },
    },
  };

  for (const fileName of ["kimazu.jpg", "hakusihika.png"]) {
    const result = await forwardGeneratedImage(client, image, fileName);
    assert.equal(result.id, "forwarded");
  }
  assert.deepEqual(fetched, [GENERATED_IMAGE_FORWARD_CHANNEL_ID, GENERATED_IMAGE_FORWARD_CHANNEL_ID]);
  assert.deepEqual(sent.map((payload) => payload.files[0].name), ["kimazu.jpg", "hakusihika.png"]);
  assert.deepEqual(sent.map((payload) => payload.files[0].attachment), [image, image]);
  assert.notEqual(sent[0].files[0].attachment, image);
  assert.notEqual(sent[1].files[0].attachment, image);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});

test("rejects a channel that cannot receive messages", async () => {
  const client = { channels: { fetch: async () => ({ isTextBased: () => false }) } };
  await assert.rejects(
    forwardGeneratedImage(client, Buffer.from("image"), "hakusihika.png"),
    /not writable/,
  );
});

test("does not share the Sharp output buffer with the Discord transfer", () => {
  const image = Buffer.from("image");
  const copied = copyGeneratedImage(image);

  image.fill(0);
  assert.deepEqual(copied, Buffer.from("image"));
  assert.notEqual(copied, image);
});

test("rejects an empty or non-binary generated image", () => {
  assert.throws(() => copyGeneratedImage(Buffer.alloc(0)), /empty/);
  assert.throws(() => copyGeneratedImage("image"), /Buffer/);
});

test("uses the relay target override when no explicit channel is supplied", () => {
  const previous = process.env.TARGET_CHANNEL_ID;
  process.env.TARGET_CHANNEL_ID = "987654321";
  try {
    assert.equal(resolveGeneratedImageForwardChannelId(), "987654321");
    assert.equal(resolveGeneratedImageForwardChannelId("123456789"), "123456789");
  } finally {
    if (previous === undefined) delete process.env.TARGET_CHANNEL_ID;
    else process.env.TARGET_CHANNEL_ID = previous;
  }
});
