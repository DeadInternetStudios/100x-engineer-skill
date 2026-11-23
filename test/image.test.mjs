import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodePng, inspectImage } from '../lib/image.mjs';
import { blankPng, encodePng, gradientPng } from './png.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), '100x-image-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function save(name, buffer) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return file;
}

test('a real screenshot is accepted with its size', () => {
  const info = inspectImage(save('real.png', gradientPng(400, 300)));
  assert.deepEqual(info.problems, []);
  assert.equal(info.type, 'png');
  assert.equal(info.width, 400);
  assert.equal(info.height, 300);
  assert.ok(info.dominantShare < 0.1);
});

test('every PNG row filter decodes to the pixels that went in', () => {
  const pixel = (x, y) => [(x * 5 + y) % 256, (y * 9) % 256, (x * y) % 256, 255];
  const plain = decodePng(encodePng(64, 40, pixel));
  const mixed = decodePng(encodePng(64, 40, pixel, { mixedFilters: true }));
  assert.equal(mixed.problem, undefined);
  assert.ok(mixed.pixels.equals(plain.pixels));
  for (const [x, y] of [[0, 0], [63, 39], [17, 22], [5, 31]]) {
    assert.deepEqual([...mixed.pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)], pixel(x, y));
  }
});

test('a page that was never up shows as a blank image', () => {
  const info = inspectImage(save('blank.png', blankPng()));
  assert.match(info.problems.join(' '), /looks blank/);
});

test('a text file, a tiny image, a cut off file and a missing file are refused', () => {
  assert.match(inspectImage(save('hosts.png', Buffer.from('127.0.0.1 localhost\n'.repeat(5)))).problems[0], /is not a PNG, JPEG, WebP or GIF image/);
  assert.match(inspectImage(save('tiny.png', encodePng(8, 8, () => [0, 0, 0, 255]))).problems.join(' '), /is only 8 by 8 pixels/);
  const whole = gradientPng(300, 300);
  assert.match(inspectImage(save('cut.png', whole.subarray(0, whole.length - 40))).problems.join(' '), /cut off/);
  assert.match(inspectImage(path.join(dir, 'nothing.png')).problems[0], /cannot be read/);
});

test('JPEG and GIF headers give their size without a decoder', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x01, 0x90, 0x03]), Buffer.alloc(30)]);
  const jpegInfo = inspectImage(save('photo.jpg', jpeg));
  assert.equal(`${jpegInfo.width}x${jpegInfo.height}`, '400x600');
  assert.deepEqual(jpegInfo.problems, []);
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x90, 0x01, 0x2c, 0x01]), Buffer.alloc(30)]);
  assert.equal(inspectImage(save('loop.gif', gif)).width, 400);
});
