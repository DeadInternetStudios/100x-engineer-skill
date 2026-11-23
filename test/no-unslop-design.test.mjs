import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { commandNames } from '../lib/commands/index.mjs';
import { cli, ROOT, sandbox } from './helpers.mjs';

// unslop-design left 100x. It has its own repository and its own install, so nothing here ships it, runs it or sends an agent to it.
// The name stays only where it is history, a test of the old install, or the two sentences in the install and usage docs that say it moved out.
// The audit folder is caught as `.100x/audit`, with or without what comes after it, and built from parts, path.join(root, '.100x', 'audit').
// `~/.100x/audit.key` is the key that signs a shots run and is not the folder, so it is let through. Other ways to split a name are not
// caught by reading text, and no test can prove one absent. A reviewer reading the diff is what is left for those.
const NAME = /unslop[\s_./-]*design|X100_UNSLOP_DESIGN|100x[\s-]+design\b|\.100x\/audit(?!\.key|[\w-])|["'`]\.100x["'`]\s*,\s*["'`]audit["'`]/i;

// Whole files that may name it.
const HISTORY = new Set([
  'docs/decisions.tsv', // the log of what was decided, append only
  'test/install.test.mjs', // the test that an install from before the removal is tidied
  'test/no-unslop-design.test.mjs',
]);

// Sentences that may name it, word for word. A line is read with these taken out, and what is left may not name it.
const SENTENCES = {
  'docs/using.md': [
    '`unslop-design` is a separate skill in [its own repository](https://github.com/DeadInternetStudios/unslop-design). 100x does not ship it or run it. Install it from there if you want it.',
  ],
  'docs/install.md': [
    'An older install that linked `unslop-design` loses that link the next time you run the installer, and gets back the one you had made before.',
  ],
};

// vendor/ ships in the package, so only the pinned unslop-text inside it is left unread.
const unread = (file) => file.startsWith('vendor/unslop-text/') || file.startsWith('.100x/');

const files = () => {
  const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  return listed.status === 0 ? listed.stdout.split('\n').filter(Boolean) : null;
};

test('the name of unslop-design is only in the log, the test of the old install and the two sentences in the install and usage docs, in contents and in file names', { skip: files() === null && 'not a git checkout' }, () => {
  const found = [];
  for (const file of files()) {
    if (unread(file) || HISTORY.has(file)) continue;
    if (NAME.test(file)) found.push(`${file} is named for it`);
    if (fs.lstatSync(path.join(ROOT, file), { throwIfNoEntry: false })?.isFile() !== true) continue;
    for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
      const rest = (SENTENCES[file] ?? []).reduce((text, sentence) => text.replace(sentence, ''), line);
      if (NAME.test(rest)) found.push(`${file} names it: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(found, []);
});

test('there is no design command, no pinned copy, no pin and no audit file for unslop-design', () => {
  assert.equal(commandNames.includes('design'), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'vendor', 'unslop-design')), false);
  assert.equal('unslop-design' in JSON.parse(fs.readFileSync(path.join(ROOT, 'companions.json'), 'utf8')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'lib', 'audits.mjs')), false);
});

test('a new run makes no audit folder', () => {
  const box = sandbox();
  assert.equal(cli(['init', '--no-git'], { cwd: box.project, env: box.env }).code, 0);
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'audit')), false);
  box.cleanup();
});
