// One-time generator for placeholder icons (run: node tools/gen-icons.mjs).
// Writes solid amber rounded squares with white "crumb" dots as raw PNGs —
// no image libraries needed. Replace with real branding before store upload.
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = [217, 119, 6]; // amber
const BG_DARK = [180, 83, 9];
const CRUMB = [255, 251, 235];

function makeIcon(size) {
  const radius = size * 0.22;
  const crumbs = [
    [0.32, 0.34, 0.11],
    [0.62, 0.28, 0.075],
    [0.52, 0.58, 0.135],
    [0.3, 0.68, 0.07],
    [0.72, 0.68, 0.095],
  ];
  return png(size, (x, y) => {
    // rounded-rect mask
    const cx = Math.max(radius - x, x - (size - 1 - radius), 0);
    const cy = Math.max(radius - y, y - (size - 1 - radius), 0);
    if (cx * cx + cy * cy > radius * radius) return [0, 0, 0, 0];
    // diagonal two-tone background
    let [r, g, b] = x + y > size ? BG_DARK : BG;
    for (const [fx, fy, fr] of crumbs) {
      const dx = x - fx * size;
      const dy = y - fy * size;
      if (dx * dx + dy * dy < fr * size * (fr * size)) {
        [r, g, b] = CRUMB;
        break;
      }
    }
    return [r, g, b, 255];
  });
}

await mkdir("src/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(`src/icons/icon${size}.png`, makeIcon(size));
  console.log(`wrote src/icons/icon${size}.png`);
}
