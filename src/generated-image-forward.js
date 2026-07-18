const GENERATED_IMAGE_FORWARD_CHANNEL_ID = "1525816436625379458";

function resolveGeneratedImageForwardChannelId(channelId) {
  return String(
    channelId ?? process.env.TARGET_CHANNEL_ID ?? GENERATED_IMAGE_FORWARD_CHANNEL_ID,
  ).trim() || GENERATED_IMAGE_FORWARD_CHANNEL_ID;
}

function copyGeneratedImage(image) {
  if (Buffer.isBuffer(image)) {
    if (image.length === 0) throw new TypeError("Generated image is empty.");
    return Buffer.from(image);
  }
  if (image instanceof Uint8Array) {
    if (image.byteLength === 0) throw new TypeError("Generated image is empty.");
    return Buffer.from(image);
  }
  throw new TypeError("Generated image must be a non-empty Buffer.");
}

async function forwardGeneratedImage(
  client,
  image,
  fileName,
  { channelId } = {},
) {
  const targetChannelId = resolveGeneratedImageForwardChannelId(channelId);
  const attachment = copyGeneratedImage(image);
  const channel = await client.channels.fetch(targetChannelId);
  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    throw new Error(`Generated-image target channel is not writable: ${targetChannelId}`);
  }
  return channel.send({
    files: [{ attachment, name: fileName }],
    allowedMentions: { parse: [] },
  });
}

export {
  GENERATED_IMAGE_FORWARD_CHANNEL_ID,
  copyGeneratedImage,
  forwardGeneratedImage,
  resolveGeneratedImageForwardChannelId,
};
