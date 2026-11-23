import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { clockStatus, describe, fillGate, reserveMinutesFor, setClock, stopClock } from '../lib/clock.mjs';
import { tickPrompt } from '../lib/watchdog.mjs';
import { cli, sandbox } from './helpers.mjs';
import { makeProject } from './projects.mjs';

const at = (h, m = 0) => new Date(2026, 10, 16, h, m, 0, 0);
const run = (box, ...args) => cli(args, { cwd: box.project, env: box.env });
const clockFileOf = (box) => path.join(box.project, '.100x', 'clock.json');

// Pretend the clock was set `hoursAgo` hours back, so the work time is over or not without waiting.
function ageClock(box, { setAgoHours, hours }) {
  const record = JSON.parse(fs.readFileSync(clockFileOf(box), 'utf8'));
  const now = Date.now();
  record.setAt = new Date(now - setAgoHours * 3600000).toISOString();
  record.deadline = new Date(now - setAgoHours * 3600000 + hours * 3600000).toISOString();
  fs.writeFileSync(clockFileOf(box), JSON.stringify(record));
}

test('a fill clock keeps the last tenth, at most an hour, for finishing', () => {
  assert.equal(reserveMinutesFor(600), 60);
  assert.equal(reserveMinutesFor(300), 30);
  assert.equal(reserveMinutesFor(2), 1);
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  setClock(box.project, '+10h', at(8), { fill: true });
  const early = clockStatus(box.project, at(9));
  assert.deepEqual([early.fill, early.reserveMinutes, early.workUntilLocal, early.workLeftMinutes], [true, 60, '17:00', 480]);
  assert.match(describe(early), /Use all of it\. Work until 17:00, then 60 min to finish\. finish refuses before then\./);
  const late = clockStatus(box.project, at(17, 30));
  assert.equal(late.workLeftMinutes, 0);
  assert.match(describe(late), /The work time is over\. finish is allowed now\./);
  box.cleanup();
});

test('the gate stays shut until the work time is over, and a plain deadline never shuts it', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  setClock(box.project, '+3h', at(8));
  assert.equal(fillGate(box.project, at(8, 10)).ok, true, 'no fill, no gate');
  setClock(box.project, '+10h', at(8), { fill: true });
  const shut = fillGate(box.project, at(12));
  assert.equal(shut.ok, false);
  assert.match(shut.message, /5 h 0 min of work left, until 17:00/);
  assert.match(shut.message, /references\/fill\.md/);
  assert.equal(fillGate(box.project, at(17, 1)).ok, true);
  box.cleanup();
});

test('stopping early needs a fill clock and a reason, and the status keeps the reason', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  setClock(box.project, '+3h', at(8));
  assert.throws(() => stopClock(box.project, 'done', at(9)), /No fill clock is running/);
  setClock(box.project, '+10h', at(8), { fill: true });
  assert.throws(() => stopClock(box.project, '  ', at(9)), /Say why/);
  stopClock(box.project, 'the API key is missing and nothing else is left', at(9));
  const status = clockStatus(box.project, at(9, 5));
  assert.equal(status.stopped.reason, 'the API key is missing and nothing else is left');
  assert.equal(fillGate(box.project, at(9, 5)).ok, true);
  box.cleanup();
});

test('the clock command takes --fill and stop', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  assert.notEqual(run(box, 'clock', 'stop', 'why').code, 0, 'no fill clock yet');
  assert.match(run(box, 'clock', 'set', '+10h', '--fill').out, /Use all of it\./);
  assert.equal(JSON.parse(run(box, 'clock', '--json').out).fill, true);
  assert.notEqual(run(box, 'clock', 'stop').code, 0, 'a reason is required');
  assert.match(run(box, 'clock', 'stop', 'nothing', 'left').out, /Fill clock stopped early: nothing left/);
  box.cleanup();
});

test('finish refuses before the work time is over and the report counts the work after it', () => {
  const box = sandbox();
  makeProject(box);
  run(box, 'clock', 'set', '+10h', '--fill');
  const refused = run(box, 'finish');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /use all the time\. 9 h \d+ min of work left/);
  assert.match(run(box, 'finish', '--check').out, /error\s+The clock says use all the time/);
  assert.equal(cli(['registry', 'list', '--json'], { env: box.env }).out.trim(), '[]', 'a refused run is not registered');
  ageClock(box, { setAgoHours: 11, hours: 10 });
  const done = run(box, 'finish');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Work: 10 h of 10 h asked for, 0 rounds\n/);
  assert.match(done.out, /warn\s+600 minutes of work but only 0 rounds logged/);
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8'), /Work: 10 h of 10 h asked for/);
  box.cleanup();
});

test('the gate is reported even when run.json does not exist yet', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  run(box, 'clock', 'set', '+10h', '--fill');
  const refused = run(box, 'finish', '--check');
  assert.match(refused.out, /error\s+The clock says use all the time/);
  assert.match(refused.out, /error\s+\.100x\/run\.json does not exist/);
  box.cleanup();
});

test('logged rounds are counted, and an early stop is shown in the finish output', () => {
  const box = sandbox();
  // A logged row becomes the start of the run, so the matrix must not look older than it by a second boundary.
  makeProject(box, { matrix: { startedAt: new Date(Date.now() + 60000).toISOString() } });
  run(box, 'clock', 'set', '+4h', '--fill');
  ageClock(box, { setAgoHours: 1, hours: 4 });
  run(box, 'log', 'round', 'fresh eyes', 'moved the button out of the thumb corner', 'before and after shots');
  const loopDir = path.join(box.project, '.100x', 'loops', 'round-1');
  fs.mkdirSync(loopDir, { recursive: true });
  for (const [name, text] of [['ask.md', 'Fresh eyes round.\n'], ['judge.md', 'Judged by: running\nNo findings.\nDrifting: no\nBetter: yes\n'], ['answers.md', 'Nothing to fix.\n']]) fs.writeFileSync(path.join(loopDir, name), text);
  run(box, 'clock', 'stop', 'the owner woke up');
  const done = run(box, 'finish');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Work: 60 min of 4 h asked for, 1 round, stopped early: the owner woke up/);
  assert.match(done.out, /warn\s+the fill clock was stopped early\. the owner woke up/);
  box.cleanup();
});

test('a fill clock makes the tick tell the thread it may not finish early', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  setClock(box.project, '+10h', new Date(), { fill: true });
  assert.match(tickPrompt(box.project), /use all the time and work is left\. Saying the run is done is wrong\./);
  assert.match(tickPrompt(box.project), /references\/fill\.md/);
  assert.match(tickPrompt(box.project), /A judge or helper you started has not reported back\..*Still running: do nothing, say nothing and end this turn.*Never start a second one for the same loop\./);
  box.cleanup();
});

test('a clock file that cannot be read is said, not read as no clock, and no half file is left by a write', () => {
  const box = sandbox();
  makeProject(box);
  run(box, 'clock', 'set', '+10h', '--fill');
  assert.match(run(box, 'finish', '--check').out, /The clock says use all the time/);
  for (const damage of ['{corrupt', '', '{}', '{"setAt":"x","deadline":"y"}', '[]']) {
    fs.writeFileSync(clockFileOf(box), damage);
    const refused = run(box, 'finish', '--check');
    assert.equal(refused.code, 1, `${JSON.stringify(damage)} must not open the gate. ${refused.out}`);
    assert.match(refused.out, /The clock file \.100x\/clock\.json cannot be read \(.*\)\. It holds the deadline\. Set the clock again with `100x clock set <time>`, add --fill for a fill clock, or delete it on purpose with `100x clock clear`\./);
    assert.match(run(box, 'status').out, /Clock\s+The clock file \.100x\/clock\.json cannot be read/);
    assert.match(run(box, 'clock', 'stop', 'tired').err, /cannot be read/);
  }
  fs.rmSync(clockFileOf(box));
  assert.match(run(box, 'clock').out, /No clock is set/, 'no file is no clock');
  run(box, 'clock', 'set', '+10h', '--fill');
  assert.deepEqual(fs.readdirSync(path.join(box.project, '.100x')).filter((name) => name.includes('.tmp')), [], 'a write leaves no temporary file');
  box.cleanup();
});

test('status shows the fill clock while the run is open', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  run(box, 'clock', 'set', '+10h', '--fill');
  assert.match(run(box, 'status').out, /Clock\s+.*Use all of it\./);
  box.cleanup();
});

test('a night with fill needs every brief to start at once and tells each child to use all the time', () => {
  const box = sandbox();
  const night = (...args) => cli(['night', ...args], { cwd: box.project, env: box.env });
  const three = ['--brief', 'one idea', '--brief', 'two idea', '--brief', 'three idea'];
  const refused = night('start', '--until', '+10h', '--fill', ...three);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /--fill needs every brief to start at once.*Add --parallel 3/);
  cli(['config', 'set', 'subagents.atOnce', '3', '--global'], { cwd: box.project, env: box.env });
  assert.equal(night('start', '--until', '+10h', '--fill', '--parallel', '3', ...three).code, 0);
  const next = JSON.parse(night('next', '--json').out);
  assert.match(next.delegateTask.task, /Use all the time until \d\d:\d\d\. Run `100x clock set \d\d:\d\d --fill`/);
  assert.match(next.delegateTask.task, /references\/fill\.md/);
  assert.doesNotMatch(next.delegateTask.task, /20 percent/);
  box.cleanup();
});
