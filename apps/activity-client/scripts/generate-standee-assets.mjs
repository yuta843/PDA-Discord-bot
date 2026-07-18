import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const assetDirectory = fileURLToPath(new URL('.', import.meta.url));
const inputPath = path.resolve(assetDirectory, '../../../../HNRpFsjbYAAZGbr.jpg');
const sourcePath = (await fileExists(inputPath))
  ? inputPath
  : path.resolve(assetDirectory, 'standee.jpg');

const { data, info } = await sharp(sourcePath)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
if (channels !== 3) throw new Error(`Expected RGB input, received ${channels} channels`);

const pixelCount = width * height;
const background = new Uint8Array(pixelCount);
const queue = new Int32Array(pixelCount);
let queueStart = 0;
let queueEnd = 0;

const indexOf = (x, y) => y * width + x;
const isNearWhite = (pixelIndex) => {
  const offset = pixelIndex * channels;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const minimum = Math.min(red, green, blue);
  const spread = Math.max(red, green, blue) - minimum;
  return minimum >= 245 && spread <= 18;
};

const enqueueIfBackground = (pixelIndex) => {
  if (background[pixelIndex] || !isNearWhite(pixelIndex)) return;
  background[pixelIndex] = 1;
  queue[queueEnd++] = pixelIndex;
};

for (let x = 0; x < width; x += 1) {
  enqueueIfBackground(indexOf(x, 0));
  enqueueIfBackground(indexOf(x, height - 1));
}
for (let y = 1; y < height - 1; y += 1) {
  enqueueIfBackground(indexOf(0, y));
  enqueueIfBackground(indexOf(width - 1, y));
}

while (queueStart < queueEnd) {
  const pixelIndex = queue[queueStart++];
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  if (x > 0) enqueueIfBackground(pixelIndex - 1);
  if (x < width - 1) enqueueIfBackground(pixelIndex + 1);
  if (y > 0) enqueueIfBackground(pixelIndex - width);
  if (y < height - 1) enqueueIfBackground(pixelIndex + width);
}

const alpha = new Uint8Array(pixelCount);
const rgba = Buffer.alloc(pixelCount * 4);
for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
  const sourceOffset = pixelIndex * channels;
  const outputOffset = pixelIndex * 4;
  const red = data[sourceOffset];
  const green = data[sourceOffset + 1];
  const blue = data[sourceOffset + 2];
  const minimum = Math.min(red, green, blue);
  const spread = Math.max(red, green, blue) - minimum;
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  const touchesBackground = [
    x > 0 && background[pixelIndex - 1],
    x < width - 1 && background[pixelIndex + 1],
    y > 0 && background[pixelIndex - width],
    y < height - 1 && background[pixelIndex + width],
  ].some(Boolean);

  let pixelAlpha = 255;
  if (background[pixelIndex]) {
    pixelAlpha = 0;
  } else if (touchesBackground && minimum > 210 && spread < 70) {
    pixelAlpha = Math.max(0, Math.min(255, Math.round((240 - minimum) * 9)));
  }

  alpha[pixelIndex] = pixelAlpha;
  rgba[outputOffset] = red;
  rgba[outputOffset + 1] = green;
  rgba[outputOffset + 2] = blue;
  rgba[outputOffset + 3] = pixelAlpha;
}

const writeRgba = (fileName, buffer = rgba) => sharp(buffer, {
  raw: { width, height, channels: 4 },
}).png().toFile(path.join(assetDirectory, fileName));

const writeMask = (fileName, values) => sharp(values, {
  raw: { width, height, channels: 1 },
}).png().toFile(path.join(assetDirectory, fileName));

const ellipseValue = (x, y, centerX, centerY, radiusX, radiusY) => {
  const distance = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2;
  return distance >= 1 ? 0 : Math.round(Math.min(1, (1 - distance) * 5) * 255);
};

const faceMask = new Uint8Array(pixelCount);
const motionMask = new Uint8Array(pixelCount);
const depthMask = new Uint8Array(pixelCount);
for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
  if (!alpha[pixelIndex]) continue;
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  const face = ellipseValue(x, y, width * 0.505, height * 0.145, width * 0.095, height * 0.105);
  const hair = y < height * 0.58 && x > width * 0.19 && x < width * 0.82 ? 180 : 0;
  const upperBody = y >= height * 0.16 && y < height * 0.55 ? 145 : 0;
  const foreground = (x < width * 0.36 || x > width * 0.58) && y > height * 0.18 && y < height * 0.5 ? 210 : 0;
  const lowerBody = y >= height * 0.55 ? 75 : 0;
  motionMask[pixelIndex] = Math.max(face, hair, upperBody, foreground, lowerBody);

  if (face) faceMask[pixelIndex] = face;
  if (y < height * 0.58 && x > width * 0.16 && x < width * 0.84) depthMask[pixelIndex] = 105;
  if (y >= height * 0.18 && y < height * 0.58) depthMask[pixelIndex] = Math.max(depthMask[pixelIndex], 155);
  if (face) depthMask[pixelIndex] = Math.max(depthMask[pixelIndex], 225);
  if ((x > width * 0.26 && x < width * 0.7) && y > height * 0.2 && y < height * 0.48) {
    depthMask[pixelIndex] = Math.max(depthMask[pixelIndex], 245);
  }
  if (y >= height * 0.58) depthMask[pixelIndex] = Math.max(depthMask[pixelIndex], 80);
  if (y > height * 0.84) depthMask[pixelIndex] = Math.max(depthMask[pixelIndex], 180);
}

const shadow = Buffer.alloc(pixelCount * 4);
for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  const distance = ((x - width * 0.5) / (width * 0.2)) ** 2
    + ((y - height * 0.975) / (height * 0.018)) ** 2;
  const shadowAlpha = distance >= 1 ? 0 : Math.round((1 - distance) * 96);
  const outputOffset = pixelIndex * 4;
  shadow[outputOffset] = 23;
  shadow[outputOffset + 1] = 32;
  shadow[outputOffset + 2] = 51;
  shadow[outputOffset + 3] = shadowAlpha;
}

await Promise.all([
  writeRgba('standee-cutout.png'),
  writeMask('standee-silhouette-mask.png', alpha),
  writeMask('standee-motion-mask.png', motionMask),
  writeMask('standee-depth-mask.png', depthMask),
  writeMask('standee-face-mask.png', faceMask),
  sharp(shadow, { raw: { width, height, channels: 4 } })
    .blur(12)
    .png()
    .toFile(path.join(assetDirectory, 'standee-contact-shadow.png')),
]);

const manifest = {
  version: 1,
  source: 'HNRpFsjbYAAZGbr.jpg / standee.jpg',
  coordinateSpace: { width, height, origin: 'top-left', units: 'source-pixels' },
  strategy: 'single-texture-parallax',
  assets: {
    cutout: 'standee-cutout.png',
    silhouetteMask: 'standee-silhouette-mask.png',
    motionMask: 'standee-motion-mask.png',
    depthMask: 'standee-depth-mask.png',
    faceMask: 'standee-face-mask.png',
    contactShadow: 'standee-contact-shadow.png',
  },
  recommendedMotion: {
    idle: 'Apply low-amplitude transform/warp to the cutout using motionMask and depthMask; keep the contact shadow fixed.',
    look: 'Use faceMask as a subtle local rotation/scale anchor. Eye or mouth redraw assets are still required for true blinking or lip sync.',
    hair: 'Use motionMask as a conservative sway region. Hair is not independently separated because the source has no hidden backfill.',
  },
  limitations: [
    'The source is a single JPEG, so hidden pixels behind hair, hands, books, and clothing cannot be recovered faithfully.',
    'The white background is removed by border-connected color segmentation; pale hair and clothing edges remain intentionally conservative.',
    'This asset pack enables Live2D-like parallax and breathing, not a complete deformable Live2D model.',
  ],
};
await fs.writeFile(path.join(assetDirectory, 'standee-motion-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
