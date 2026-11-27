import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chatSummary } from '../lib/report.mjs';
import { LEDGERLINE, SAMPLE } from '../scripts/readme-sample.mjs';
import { cli, ROOT } from './helpers.mjs';

const SKILLS = path.join(ROOT, 'skills');
const GUIDE = path.join(SKILLS, '100x', 'references', 'voice.md');
const guide = () => fs.readFileSync(GUIDE, 'utf8');
const modes = () => fs.readdirSync(SKILLS).filter((name) => name.startsWith('100x-')).sort();

// A skill points at the voice when it names the command that prints it. The router names the file, because it sits next to it.
const points = (name, text) => (name === '100x' ? text.includes('references/voice.md') : text.includes('`100x ref voice`'));

test('the voice guide is printed by `100x ref voice`, and says what the owner needs to steer it', () => {
  const printed = cli(['ref', 'voice']);
  assert.equal(printed.code, 0, printed.err);
  assert.equal(printed.out, guide());
  assert.ok(guide().split('\n').length <= 90, 'the guide is read on every run, so it stays under 90 lines');
  for (const heading of ['## The shape', '## Write it out in full', '## What stays as it is', '## The owner steers', '## The limit']) assert.ok(guide().includes(`${heading}\n`), `the guide has "${heading}"`);
  assert.match(guide(), /`more`/);
  assert.match(guide(), /`shorter`/);
  assert.match(guide(), /a model can ignore it/, 'the guide says what it cannot enforce');
});

test('every skill points at the voice, and the router is the one that names the file', () => {
  const names = ['100x', ...modes()];
  assert.equal(names.length, 13);
  for (const name of names) assert.ok(points(name, fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8')), `${name} points at the voice`);
});

test('a skill that loses its pointer is caught', () => {
  const text = fs.readFileSync(path.join(SKILLS, '100x-status', 'SKILL.md'), 'utf8');
  assert.ok(points('100x-status', text));
  assert.ok(!points('100x-status', text.replace(/Messages to the owner follow `100x ref voice`[^\n]*\n/, '')));
});

test('no skill grew past what it said about its own length', () => {
  const sixLines = ['100x-status', '100x-mockup', '100x-bakeoff'];
  for (const name of sixLines) assert.match(fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8'), /(at most )?[Ss]ix lines( at most)?/, `${name} keeps its six lines`);
  assert.match(fs.readFileSync(path.join(SKILLS, '100x-wrapup', 'SKILL.md'), 'utf8'), /Eight lines at most/);
});

test('every example in the guide is shorter than its wall, and short enough to read at a glance', () => {
  const rows = guide().split('\n').filter((line) => /^\| /.test(line) && !/^\| (Wall|---)/.test(line)).map((line) => line.split(/(?<!\\)\|/).slice(1, 3).map((cell) => cell.trim()));
  assert.ok(rows.length >= 5, 'a progress note, a failure, a question, a wait and a result');
  for (const [wall, short] of rows) {
    assert.ok(short.length < wall.length * 0.6, `"${short}" is under 60 percent of its wall`);
    assert.ok(short.length <= 110, `"${short}" fits a glance`);
    assert.ok(short.split('\n').length === 1, 'one line');
  }
});

test('the final message answers first: the verdict alone on line 1, then the reason, then blocks with one blank line between', () => {
  for (const run of [SAMPLE, LEDGERLINE]) {
    const text = chatSummary(run);
    const lines = text.split('\n');
    assert.equal(lines[0], `${run.title}: ready to ship.`);
    assert.equal(lines[1], run.verdictWhy);
    assert.equal(lines[2], '', 'the headline is a block of its own');
    assert.ok(!text.includes(run.pitch), 'the pitch stays in the report and the gallery');
    assert.ok(!/\n\n\n/.test(text) && !/\n$/.test(text), 'one blank line between blocks, none at the end');
    assert.ok(lines.some((line) => line === 'Try first:') && lines.some((line) => /^1\) /.test(line)), 'the steps are one a line');
    assert.ok(lines.at(-2) === '' || /^Report: /.test(lines.at(-1)) || /^Next likely asks: /.test(lines.at(-1)), 'the report and the next asks close the message');
  }
});

test('the property checker for the final message holds in every mix of optional data', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'verify', 'final-message.check.mjs')], { encoding: 'utf8', timeout: 240000 });
  assert.equal(run.status, 0, run.stdout.split('\n').filter((line) => line.startsWith('FAIL')).join('\n'));
  assert.match(run.stdout, /Exhaustive\. Every reachable state was visited/);
});

test('the final message reads the same in another language and another time zone', () => {
  const program = `import { chatSummary } from ${JSON.stringify(path.join(ROOT, 'lib', 'report.mjs'))}; import { SAMPLE } from ${JSON.stringify(path.join(ROOT, 'scripts', 'readme-sample.mjs'))}; process.stdout.write(chatSummary(SAMPLE));`;
  const built = (extra) => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env: { ...process.env, ...extra } });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  const here = chatSummary(SAMPLE);
  for (const env of [{ TZ: 'UTC', LANG: 'C', LC_ALL: 'C' }, { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, { TZ: 'America/St_Johns', LANG: 'ja_JP.UTF-8', LC_ALL: 'ja_JP.UTF-8' }]) {
    assert.equal(built(env), here, `the message changed under ${JSON.stringify(env)}`);
  }
});

test('a control code in a value never reaches the message, and a blank step takes no number', () => {
  const text = chatSummary({ ...SAMPLE, title: 'Glow\u001b[2J', moment: 'Tap\u0007 now\u0000done\u009b', tryFirst: ['Open it', '   ', 'Tap Go'] });
  assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text), 'no control character is left');
  assert.ok(text.includes('The moment: Tap now done'), 'the words stay');
  assert.deepEqual(text.split('\n').filter((line) => /^\d\) /.test(line)), ['1) Open it', '2) Tap Go']);
});
