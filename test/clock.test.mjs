import assert from 'node:assert/strict';
import test from 'node:test';
import { clockStatus, describe, parseDeadline, setClock } from '../lib/clock.mjs';
import { cli, sandbox } from './helpers.mjs';

const at = (h, m = 0) => new Date(2026, 10, 16, h, m, 0, 0);

test('a deadline can be typed the way a person says it', () => {
  const now = at(13, 0);
  assert.deepEqual(parseDeadline('+90m', now), at(14, 30));
  assert.deepEqual(parseDeadline('+2h', now), at(15, 0));
  assert.deepEqual(parseDeadline('in 1h30m', now), at(14, 30));
  assert.deepEqual(parseDeadline('17:30', now), at(17, 30));
  assert.deepEqual(parseDeadline('for 10 hours', now), new Date(now.getTime() + 10 * 3600000), 'the owner\'s own words, as the trigger table spells them');
  assert.deepEqual(parseDeadline('For 2 days', now), new Date(now.getTime() + 48 * 3600000));
  assert.deepEqual(parseDeadline('until 6am', now), new Date(2026, 10, 17, 6, 0, 0, 0));
  assert.deepEqual(parseDeadline('by 5pm', now), at(17, 0));
  assert.deepEqual(parseDeadline('in 60 minutes', now), at(14, 0));
  assert.deepEqual(parseDeadline('5pm', now), at(17, 0));
  assert.deepEqual(parseDeadline('5:30 PM', now), at(17, 30));
  assert.deepEqual(parseDeadline('50 hours', now), new Date(now.getTime() + 50 * 3600000));
  assert.deepEqual(parseDeadline('2 days', now), new Date(now.getTime() + 48 * 3600000));
  assert.deepEqual(parseDeadline('1 week', now), new Date(now.getTime() + 7 * 24 * 3600000));
  assert.deepEqual(parseDeadline('90 minutes', now), at(14, 30));
  assert.deepEqual(parseDeadline('12am', now), new Date(2026, 10, 17, 0, 0, 0, 0), 'midnight has passed today, so it means tomorrow');
  assert.deepEqual(parseDeadline('07:00', now), new Date(2026, 10, 17, 7, 0, 0, 0), 'a time that has passed today means tomorrow');
  assert.equal(parseDeadline('2026-11-20T09:00:00Z', now).toISOString(), '2026-11-20T09:00:00.000Z');
  for (const bad of ['', 'soon', '25:00', '7', '+x']) assert.throws(() => parseDeadline(bad, now), /Could not read|not a time of day/, bad);
});

test('the clock command takes the owner\'s words unchanged, with a fill clock', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const result = cli(['clock', 'set', 'for 10 hours', '--fill'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Use all of it/);
  assert.match(cli(['clock', 'status'], { cwd: box.project, env: box.env }).out, /10 h 0 min left|9 h 59 min left/);
  box.cleanup();
});

test('the clock says how much is left and how much is used', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const root = box.project;
  assert.equal(clockStatus(root).state, 'none');
  const start = at(13, 0);
  setClock(root, '+120m', start);
  const mid = clockStatus(root, at(14, 0));
  assert.deepEqual([mid.state, mid.leftMinutes, mid.totalMinutes, mid.usedPercent, mid.deadlineLocal], ['running', 60, 120, 50, '15:00']);
  assert.match(describe(mid), /1 h 0 min left of 120 min, 50% used\. Deadline 15:00\./);
  const late = clockStatus(root, at(15, 20));
  assert.deepEqual([late.state, late.leftMinutes, late.usedPercent], ['passed', -20, 100]);
  assert.match(describe(late), /passed 20 minutes ago/);
  box.cleanup();
});

test('the clock command sets, reads and clears, and refuses nonsense', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const run = (...args) => cli(['clock', ...args], { cwd: box.project, env: box.env });
  assert.match(run().out, /No clock is set/);
  assert.equal(run('set').code === 0, false);
  assert.notEqual(run('set', 'whenever').code, 0);
  assert.match(run('set', '+45m').out, /Clock set\. 4[45] min left of 45 min/);
  const json = JSON.parse(run('--json').out);
  assert.equal(json.state, 'running');
  assert.ok(json.leftMinutes >= 44 && json.leftMinutes <= 45);
  assert.match(run('clear').out, /Clock cleared/);
  assert.match(run().out, /No clock is set/);
  box.cleanup();
});
