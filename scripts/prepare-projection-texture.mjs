import sharp from 'sharp';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error('Usage: node scripts/prepare-projection-texture.mjs <source-image> <destination.webp>');
}

const image = sharp(source).removeAlpha();
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
let minX = info.width;
let minY = info.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    const offset = (y * info.width + x) * info.channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    if (r + g + b >= 744) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
}
if (maxX < minX || maxY < minY) throw new Error('No foreground was detected in the source image.');
const margin = 0;
const left = Math.max(0, minX - margin);
const top = Math.max(0, minY - margin);
const width = Math.min(info.width - left, maxX - minX + 1 + margin * 2);
const height = Math.min(info.height - top, maxY - minY + 1 + margin * 2);

await sharp(source)
  .extract({ left, top, width, height })
  .resize({ height: 1_024, withoutEnlargement: true })
  .webp({ quality: 88, smartSubsample: true })
  .toFile(destination);

console.log(JSON.stringify({ source: { width: info.width, height: info.height }, crop: { left, top, width, height } }));
