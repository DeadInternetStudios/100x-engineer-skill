import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.mjs';

// Every local link and picture in the README points at something that exists, spelled with the same case as on disk (GitHub is
// case sensitive, a Mac is not), and every #anchor, here or in another markdown file, names a heading there.
// GitHub shows a broken picture as a small icon and a broken link as a 404, and nothing else catches either before a push.
const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const strip = (markdown) => markdown.replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
const headings = (markdown) => new Set(strip(markdown).split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, ''))));

export function localTargets(markdown) {
  const text = strip(markdown);
  const found = [
    ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/\b(?:src|srcset|href)=(["'])([^"']+)\1/g)].map((m) => m[2]),
  ];
  return found.filter((t) => !/^(https?:|mailto:)/.test(t));
}

// The path exists with exactly this spelling, one folder at a time.
function exactly(root, relative) {
  let dir = root;
  for (const part of relative.split('/').filter((p) => p && p !== '.')) {
    if (part === '..') { dir = path.dirname(dir); continue; }
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory() || !fs.readdirSync(dir).includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}

export function problems(markdown, root, from = root) {
  const here = headings(markdown);
  const out = [];
  for (const target of localTargets(markdown)) {
    const [file, anchor] = target.split('#');
    if (!file) { if (!here.has(anchor)) out.push(`no heading for #${anchor}`); continue; }
    const relative = path.relative(root, path.resolve(from, decodeURIComponent(file))).split(path.sep).join('/');
    if (!exactly(root, relative)) { out.push(`missing ${file}`); continue; }
    if (anchor && file.endsWith('.md') && !headings(fs.readFileSync(path.join(root, relative), 'utf8')).has(anchor)) out.push(`no heading for ${target}`);
  }
  return out;
}

test('every local link and picture in the README resolves, and every #anchor names a heading', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(localTargets(readme).length > 20, 'the README has its pictures and links');
  // The language row links translations that are written before the repo goes public. While there is no i18n/ folder at all, they are
  // the only links allowed to be missing. Once the folder exists, or with README_PUBLISH=1 (the check before a push), every one must.
  const waiting = !fs.existsSync(path.join(ROOT, 'i18n')) && process.env.README_PUBLISH !== '1';
  const left = problems(readme, ROOT).filter((p) => !(waiting && /^missing i18n\/README\.[a-z-]+\.md$/.test(p)));
  assert.deepEqual(left, []);
});

test('the check finds broken pictures and links in every form the README could use them', () => {
  const planted = [
    '![x](docs/img/nope.png)',
    '<img src="docs/img/diagrams/gone.svg">',
    "<img src='docs/img/single.png'>",
    '![y][r]',
    '[r]: docs/img/reference.png',
    '<img src="docs/img/Diagrams/prompt-step.svg">',
    '[a](#no-such-heading)',
    '[p](docs/pipeline.md#no-such-heading)',
    '# Real heading',
    '[b](#real-heading)',
    '[c](docs/pipeline.md)',
  ].join('\n');
  assert.deepEqual(problems(planted, ROOT).sort(), [
    'missing docs/img/Diagrams/prompt-step.svg',
    'missing docs/img/diagrams/gone.svg',
    'missing docs/img/nope.png',
    'missing docs/img/reference.png',
    'missing docs/img/single.png',
    'no heading for #no-such-heading',
    'no heading for docs/pipeline.md#no-such-heading',
  ]);
});

test('every picture tag in the README is well formed, so a quote inside alt text cannot cut it short', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const tags = readme.match(/<img\b[^>]*>/g) ?? [];
  assert.ok(tags.length > 10);
  const bad = tags.filter((tag) => !/^<img(\s+[\w-]+="[^"]*")+\s*\/?>$/.test(tag));
  assert.deepEqual(bad, []);
});

test('every translated README links and shows only things that exist, and links back to the English one', () => {
  const dir = path.join(ROOT, 'i18n');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^README\.[a-z-]+\.md$/.test(name)) : [];
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.deepEqual(problems(text, ROOT, dir), [], name);
    assert.ok(text.includes('href="../README.md"'), `${name} links back to the English README`);
    const tags = text.match(/<img\b[^>]*>/g) ?? [];
    assert.deepEqual(tags.filter((tag) => !/^<img(\s+[\w-]+="[^"]*")+\s*\/?>$/.test(tag)), [], `${name} has a malformed picture tag`);
  }
});
