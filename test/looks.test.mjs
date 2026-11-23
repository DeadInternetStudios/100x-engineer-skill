import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.mjs';

const FIELDS = ['Feel', 'Palette', 'Type', 'Shape', 'Motion', 'Signature', 'Best for', 'Beware'];

const channel = (hex, i) => {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

export function parseWorlds(markdown) {
  return markdown.split(/^## \d+\. /m).slice(1).map((section) => {
    const [name, ...rest] = section.split('\n');
    const body = rest.join('\n');
    const fields = Object.fromEntries([...body.matchAll(/^- \*\*([^.]+)\.\*\* (.+)$/gm)].map((m) => [m[1], m[2]]));
    const palette = Object.fromEntries([...(fields.Palette ?? '').matchAll(/(\w+) `(#[0-9A-Fa-f]{6})`/g)].map((m) => [m[1], m[2]]));
    return { name: name.trim(), fields, palette };
  });
}

export function paletteProblems({ palette }) {
  const problems = [];
  for (const key of ['bg', 'panel', 'ink', 'mute', 'accent']) if (!palette[key]) problems.push(`no ${key} token`);
  if (problems.length) return problems;
  const need = (label, ratio, min) => {
    if (ratio < min) problems.push(`${label} is ${ratio.toFixed(2)}, needs ${min}`);
  };
  need('ink on bg', contrast(palette.ink, palette.bg), 10);
  need('mute on bg', contrast(palette.mute, palette.bg), 4.5);
  need('mute on panel', contrast(palette.mute, palette.panel), 4.5);
  need('accent on bg', contrast(palette.accent, palette.bg), 3);
  need('accent on panel', contrast(palette.accent, palette.panel), 3);
  return problems;
}

const worlds = parseWorlds(fs.readFileSync(path.join(ROOT, 'skills', '100x', 'references', 'looks.md'), 'utf8'));

test('the menu has thirteen worlds, each complete and different', () => {
  assert.equal(worlds.length, 13);
  for (const world of worlds) for (const field of FIELDS) assert.ok(world.fields[field], `${world.name} has no ${field}`);
  assert.equal(new Set(worlds.map((w) => w.name)).size, worlds.length);
  assert.equal(new Set(worlds.map((w) => w.palette.bg + w.palette.accent)).size, worlds.length, 'no two worlds share a background and accent');
});

test('every palette meets its contrast limits', () => {
  for (const world of worlds) assert.deepEqual(paletteProblems(world), [], world.name);
});

test('the contrast check catches a weak palette', () => {
  const weak = parseWorlds('## 1. Washed out\n\n- **Palette.** bg `#FFFFFF`, panel `#F5F5F5`, ink `#777777`, mute `#BBBBBB`, accent `#FFEE88`.\n')[0];
  const problems = paletteProblems(weak);
  assert.ok(problems.some((p) => p.startsWith('ink on bg')), problems.join('; '));
  assert.ok(problems.some((p) => p.startsWith('mute on bg')));
  assert.ok(problems.some((p) => p.startsWith('accent on bg')));
});

test('a known pair matches the published contrast ratio', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
});
