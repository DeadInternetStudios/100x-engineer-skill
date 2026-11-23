import fs from 'node:fs';
import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
const SAMPLE_BUDGET = 60000;

export const MIN_SIDE = 200;
export const BLANK_SHARE = 0.99;

function chunksOf(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (end + 4 > buffer.length) break;
    chunks.push({ type, data: buffer.subarray(offset + 8, end) });
    offset = end + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y > 0 ? out[row - stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? out[row - stride + x - bpp] : 0;
      const value = raw[line + x];
      let result;
      if (filter === 0) result = value;
      else if (filter === 1) result = value + left;
      else if (filter === 2) result = value + up;
      else if (filter === 3) result = value + ((left + up) >> 1);
      else if (filter === 4) result = value + paeth(left, up, upLeft);
      else return null;
      out[row + x] = result & 255;
    }
  }
  return out;
}

// Pixels of an 8 bit, non interlaced PNG as bytes, or a reason it was not decoded.
export function decodePng(buffer) {
  const chunks = chunksOf(buffer);
  const header = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!header || header.data.length < 13) return { problem: 'has no PNG header' };
  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const depth = header.data[8];
  const colorType = header.data[9];
  const interlaced = header.data[12] === 1;
  const found = { width, height };
  if (!chunks.some((chunk) => chunk.type === 'IEND')) return { ...found, problem: 'is cut off before the end of the file' };
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  } catch {
    return { ...found, problem: 'has damaged pixel data' };
  }
  const channels = CHANNELS[colorType];
  if (depth !== 8 || interlaced || !channels) return found;
  if (raw.length !== (width * channels + 1) * height) return { ...found, problem: 'has damaged pixel data' };
  const pixels = unfilter(raw, width, height, channels);
  return pixels ? { ...found, channels, pixels } : { ...found, problem: 'has damaged pixel data' };
}

function dominantShare({ pixels, channels, width, height }) {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / SAMPLE_BUDGET));
  const counts = new Map();
  let sampled = 0;
  for (let index = 0; index < total; index += step) {
    const key = pixels.readUIntBE(index * channels, channels);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    sampled += 1;
  }
  let best = 0;
  for (const count of counts.values()) if (count > best) best = count;
  return best / sampled;
}

function inspectPng(buffer) {
  const { problem, pixels, channels, width, height } = decodePng(buffer);
  const info = { type: 'png', width, height, problems: problem ? [problem] : [] };
  if (pixels) info.dominantShare = dominantShare({ pixels, channels, width, height });
  return info;
}

function inspectJpeg(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return { type: 'jpeg', problems: ['has a damaged JPEG header'] };
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame) return { type: 'jpeg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), problems: [] };
    offset += 2 + length;
  }
  return { type: 'jpeg', problems: ['has no JPEG frame header'] };
}

function inspectWebp(buffer) {
  const kind = buffer.toString('latin1', 12, 16);
  const info = { type: 'webp', problems: [] };
  if (kind === 'VP8 ' && buffer.length >= 30) {
    info.width = buffer.readUInt16LE(26) & 0x3fff;
    info.height = buffer.readUInt16LE(28) & 0x3fff;
  } else if (kind === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    info.width = (bits & 0x3fff) + 1;
    info.height = ((bits >> 14) & 0x3fff) + 1;
  } else if (kind === 'VP8X' && buffer.length >= 30) {
    info.width = buffer.readUIntLE(24, 3) + 1;
    info.height = buffer.readUIntLE(27, 3) + 1;
  } else {
    info.problems.push('has no WebP frame header');
  }
  return info;
}

export function inspectImage(file) {
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    return { type: null, problems: ['cannot be read'] };
  }
  if (buffer.length < 30) return { type: null, problems: ['is too small to be an image'] };
  let info;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) info = inspectPng(buffer);
  else if (buffer[0] === 0xff && buffer[1] === 0xd8) info = inspectJpeg(buffer);
  else if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') info = inspectWebp(buffer);
  else if (buffer.toString('latin1', 0, 3) === 'GIF') info = { type: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), problems: [] };
  else return { type: null, problems: ['is not a PNG, JPEG, WebP or GIF image'] };
  if (info.width !== undefined && (info.width < MIN_SIDE || info.height < MIN_SIDE)) info.problems.push(`is only ${info.width} by ${info.height} pixels. A hero is a real screenshot, at least ${MIN_SIDE} by ${MIN_SIDE}`);
  if (info.dominantShare >= BLANK_SHARE) info.problems.push(`looks blank, ${Math.round(info.dominantShare * 100)}% of it is one color. The page was probably not up when it was taken`);
  return info;
}
