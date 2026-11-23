import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { appendRow, cell, readRows, startRow } from '../lib/decisions.mjs';
import { cli, sandbox } from './helpers.mjs';

test('the first row writes the header once', () => {
  const box = sandbox();
  const file = path.join(box.dir, 'd.tsv');
  appendRow(file, { phase: 'build', decision: 'one', why: 'because' });
  appendRow(file, { phase: 'build', decision: 'two', why: 'because' });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines[0], 'ts\tphase\tdecision\twhy\tevidence\tresult');
  assert.equal(lines.length, 3);
  assert.equal(lines.filter((l) => l.startsWith('ts\t')).length, 1);
  box.cleanup();
});

test('cells are flattened to one line and spreadsheet formulas are defused', () => {
  assert.equal(cell('a\tb\nc'), 'a b c');
  assert.equal(cell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(cell('-1 row'), "'-1 row");
  assert.equal(cell('plain'), 'plain');
});

test('a row without phase, decision or why is refused', () => {
  const box = sandbox();
  const file = path.join(box.dir, 'd.tsv');
  assert.throws(() => appendRow(file, { phase: 'build', decision: 'x' }), /needs why/);
  assert.equal(fs.existsSync(file), false);
  box.cleanup();
});

test('missing evidence is stored as a guess and missing result as open', () => {
  const box = sandbox();
  const file = path.join(box.dir, 'd.tsv');
  appendRow(file, { phase: 'build', decision: 'x', why: 'y' });
  const [row] = readRows(file);
  assert.equal(row.evidence, 'guess, no evidence yet');
  assert.equal(row.result, 'open');
  box.cleanup();
});

test('a row an agent appended by hand with too few columns does not stop status or the log', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const file = path.join(box.project, '.100x', 'decisions.tsv');
  fs.appendFileSync(file, 'garbage\nlooks like a row\tbuild\n');
  assert.deepEqual(readRows(file).map((row) => Object.keys(row)), [['ts', 'phase', 'decision', 'why', 'evidence', 'result'], ['ts', 'phase', 'decision', 'why', 'evidence', 'result']]);
  const status = cli(['status'], { cwd: box.project, env: box.env });
  assert.equal(status.code, 0, status.err);
  assert.match(status.out, /Decisions\s+2\./);
  const tail = cli(['log', '--tail', '2'], { cwd: box.project, env: box.env });
  assert.equal(tail.code, 0, tail.err);
  assert.match(tail.out, /garbage/);
  box.cleanup();
});

test('a start row names the range of rows before it', () => {
  const box = sandbox();
  const file = path.join(box.dir, 'd.tsv');
  startRow(file, 'run-a', { now: new Date('2026-01-01T00:00:00Z') });
  appendRow(file, { phase: 'build', decision: 'x', why: 'y' }, { now: new Date('2026-01-01T01:00:00Z') });
  startRow(file, 'run-b', { now: new Date('2026-01-02T00:00:00Z') });
  const rows = readRows(file);
  assert.match(rows[0].decision, /Rows before this one, none/);
  assert.match(rows[2].decision, /2026-01-01T00:00:00Z to 2026-01-01T01:00:00Z/);
  assert.equal(rows[2].evidence, 'run-b');
  box.cleanup();
});

test('log command finds the project file and tails it', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const sub = path.join(box.project, 'src');
  fs.mkdirSync(sub);
  const add = cli(['log', 'core', 'Chose the card layout', 'It scans fastest on a phone', 'screenshot 390x844', 'ship'], { cwd: sub, env: box.env });
  assert.equal(add.code, 0, add.err);
  const tail = cli(['log', '--tail', '5'], { cwd: sub, env: box.env });
  assert.match(tail.out, /Chose the card layout/);
  assert.match(tail.out, /It scans fastest on a phone/);
  box.cleanup();
});

test('the tail shows the clock of this machine and the file keeps UTC', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const file = path.join(box.project, '.100x', 'decisions.tsv');
  fs.appendFileSync(file, '2026-11-18T23:47:14Z\tcore\tHeld the line\tbecause\tmeasured\tkeep\n');
  const tail = cli(['log', '--tail', '1'], { cwd: box.project, env: { ...box.env, TZ: 'Asia/Tokyo' } });
  assert.match(tail.out, /^2026-11-19 08:47:14 +core +Held the line/);
  assert.match(fs.readFileSync(file, 'utf8'), /2026-11-18T23:47:14Z\tcore/);
  box.cleanup();
});

test('log command outside a project explains what to do', () => {
  const box = sandbox();
  const result = cli(['log', 'build', 'x', 'y'], { cwd: box.project, env: box.env });
  assert.notEqual(result.code, 0);
  assert.match(result.err, /100x init/);
  box.cleanup();
});
