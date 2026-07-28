// Icon generator (run: node tools/gen-icons.mjs) — writes raw PNGs with no
// image libraries. Design: a round cookie with chocolate chips, a bite taken
// from the top-right, and crumbs trailing off — "CrumbSweep". Rendered with
// 4x4 supersampling for smooth edges at every size.
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

const SS = 4; // supersamples per axis

function png(size, colorAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const [cr, cg, cb, ca] = colorAt(u, v);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      raw.set(
        alpha > 0
          ? [r / a, g / a, b / a, alpha].map(Math.round)
          : [0, 0, 0, 0],
        row + 1 + x * 4,
      );
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

const DOUGH = [230, 152, 54];
const DOUGH_RIM = [193, 117, 26];
const CHIP = [96, 47, 15];
const CLEAR = [0, 0, 0, 0];

const COOKIE = { x: 0.48, y: 0.54, r: 0.44 };
const BITE = { x: 0.82, y: 0.2, r: 0.19 };
const CHIPS = [
  [0.3, 0.4, 0.085],
  [0.55, 0.56, 0.095],
  [0.32, 0.7, 0.07],
  [0.6, 0.3, 0.065],
  [0.5, 0.82, 0.06],
  [0.72, 0.66, 0.07],
];
const CRUMBS = [
  [0.9, 0.09, 0.045],
  [0.96, 0.26, 0.035],
  [0.79, 0.025, 0.03],
];

const dist = (u, v, x, y) => Math.hypot(u - x, v - y);

function colorAt(u, v) {
  if (dist(u, v, COOKIE.x, COOKIE.y) <= COOKIE.r) {
    if (dist(u, v, BITE.x, BITE.y) <= BITE.r) return CLEAR; // the bite
    for (const [cx, cy, cr] of CHIPS) {
      if (dist(u, v, cx, cy) <= cr) return [...CHIP, 255];
    }
    const rim = dist(u, v, COOKIE.x, COOKIE.y) > COOKIE.r * 0.87;
    return [...(rim ? DOUGH_RIM : DOUGH), 255];
  }
  for (const [cx, cy, cr] of CRUMBS) {
    if (dist(u, v, cx, cy) <= cr) return [...DOUGH, 255];
  }
  return CLEAR;
}

await mkdir("src/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(`src/icons/icon${size}.png`, png(size, colorAt));
  console.log(`wrote src/icons/icon${size}.png`);
}
