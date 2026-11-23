import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

// An 8 bit RGBA PNG. pixelAt(x, y) returns [r, g, b, a]. mixedFilters cycles through all five PNG row filters.
export function encodePng(width, height, pixelAt, { mixedFilters = false } = {}) {
  const stride = width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) Buffer.from(pixelAt(x, y)).copy(raw, y * stride + x * 4);
  const lines = [];
  for (let y = 0; y < height; y += 1) {
    const filter = mixedFilters ? y % 5 : 0;
    const line = Buffer.alloc(stride + 1);
    line[0] = filter;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? raw[y * stride + x - 4] : 0;
      const up = y > 0 ? raw[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? raw[(y - 1) * stride + x - 4] : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      line[x + 1] = (raw[y * stride + x] - predicted) & 255;
    }
    lines.push(line);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(lines))), chunk('IEND', Buffer.alloc(0))]);
}

export const gradientPng = (width = 400, height = 300) => encodePng(width, height, (x, y) => [Math.floor((x * 255) / width), Math.floor((y * 255) / height), (x * 7 + y * 3) % 256, 255]);
export const blankPng = (width = 400, height = 300) => encodePng(width, height, () => [250, 250, 250, 255]);
