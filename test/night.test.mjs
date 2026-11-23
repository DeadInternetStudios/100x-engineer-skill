import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox, write } from './helpers.mjs';

const json = (box, args) => JSON.parse(cli(['night', ...args, '--json'], { cwd: box.project, env: box.env }).out);
const night = (box, ...args) => cli(['night', ...args], { cwd: box.project, env: box.env });

function start(box, extra = []) {
  const result = night(box, 'start', '--until', '+8h', '--brief', 'An idle game about a lighthouse keeper', '--brief', 'A tiny budget tracker', '--brief', 'An idle game about a lighthouse keeper', ...extra);
  assert.equal(result.code, 0, result.err);
}

const finish = (dir, verdict) => {
  write(path.join(dir, '.100x', 'finished.json'), '{}');
  write(path.join(dir, '.100x', 'run.json'), JSON.stringify({ title: 'Done thing', verdict }));
};

test('start makes one folder per brief, keeps equal briefs apart and reads the wake time', () => {
  const box = sandbox();
  start(box);
  const status = json(box, ['status']);
  assert.deepEqual(status.projects.map((p) => p.slug), ['idle-game-lighthouse-keeper', 'tiny-budget-tracker', 'idle-game-lighthouse-keeper-2']);
  assert.deepEqual(status.counts, { waiting: 3, running: 0, finished: 0, blocked: 0 });
  assert.equal(status.parallel, 1);
  for (const p of status.projects) assert.match(fs.readFileSync(path.join(p.dir, 'brief.md'), 'utf8'), /\w/);
  assert.ok(status.leftMinutes > 470 && status.leftMinutes <= 480);
  box.cleanup();
});

test('next hands out one child at a time with the overnight model, up to the limit', () => {
  const box = sandbox();
  cli(['config', 'role', 'overnight', '--provider', 'p', '--model', 'night-model', '--option', 'effort=max', '--global'], { cwd: box.project, env: box.env });
  cli(['config', 'set', 'subagents.atOnce', '2', '--global'], { cwd: box.project, env: box.env });
  start(box);
  const first = json(box, ['next']);
  assert.equal(first.slug, 'idle-game-lighthouse-keeper');
  const task = first.delegateTask;
  assert.deepEqual([task.role, task.isolation, task.mode], ['implementation', 'shared', 'async']);
  assert.deepEqual(task.target, { providerInstanceId: 'p', model: 'night-model', options: { effort: 'max' } });
  assert.match(task.task, /brief\.md/);
  assert.match(task.task, /Call the 100x skill on the brief/);
  assert.match(task.task, /call the 100x-wrapup skill/);
  assert.match(task.task, /Never deploy to production/);
  assert.equal(night(box, 'record', first.slug, 'task-1').code, 0);
  const second = json(box, ['next']);
  assert.equal(second.slug, 'tiny-budget-tracker');
  night(box, 'record', second.slug, 'task-2');
  assert.match(json(box, ['next']).none, /2 running, the most at once is 2/);
  box.cleanup();
});

test('a brief started with --mockup calls the mockup skill: its own clock, no judge, no deadline or fill rules', () => {
  const box = sandbox();
  cli(['config', 'set', 'subagents.atOnce', '2', '--global'], { cwd: box.project, env: box.env });
  assert.equal(night(box, 'start', '--until', '+8h', '--brief', 'A tiny budget tracker', '--mockup', 'A pocket tip splitter').code, 0);
  const normal = json(box, ['next']).delegateTask.task;
  assert.match(normal, /Call the 100x skill on the brief/);
  assert.match(normal, /call the 100x-wrapup skill/);
  assert.match(normal, /The judge of the review is the only other agent you start/);
  assert.doesNotMatch(normal, /mockup/);
  night(box, 'record', 'tiny-budget-tracker', 'task-1');
  const mockup = json(box, ['next']).delegateTask.task;
  assert.match(mockup, /Call the 100x-mockup skill on the brief/);
  assert.match(mockup, /100x clock set \+15m/);
  assert.match(mockup, /It still ends with `100x finish`/);
  assert.match(mockup, /Start no other agent/);
  assert.doesNotMatch(mockup, /100x-wrapup|--fill|The judge of the review/);
  assert.match(night(box, 'status').out, /waiting +pocket-tip-splitter \(mockup\)/, 'the plan says which brief is a mockup');
  assert.deepEqual(json(box, ['status']).projects.map((p) => p.mode), [undefined, 'mockup']);
  box.cleanup();
});

test('a mockup child that died starts its mockup again, with the mockup rules, and is not sent to continue a STATE.md that was never updated', () => {
  const box = sandbox();
  cli(['config', 'set', 'subagents.atOnce', '2', '--global'], { cwd: box.project, env: box.env });
  night(box, 'start', '--until', '+8h', '--brief', 'A tiny budget tracker', '--mockup', 'A pocket tip splitter');
  night(box, 'record', 'pocket-tip-splitter', 'task-1');
  const retry = json(box, ['next', '--retry', 'pocket-tip-splitter']).delegateTask.task;
  assert.match(retry, /The first try at this mockup ended early\. Call the 100x-mockup skill on the brief in /);
  assert.match(retry, /100x init --fresh/);
  assert.match(retry, /100x clock set \+15m/);
  assert.doesNotMatch(retry, /100x-continue|STATE\.md|100x-wrapup|The judge of the review/, 'a mockup never updates STATE.md, so there is nothing for continue to follow');
  night(box, 'record', 'tiny-budget-tracker', 'task-2');
  const normal = json(box, ['next', '--retry', 'tiny-budget-tracker']).delegateTask.task;
  assert.match(normal, /Call the 100x-continue skill and carry on from \.100x\/STATE\.md/, 'a normal child still resumes');
  assert.doesNotMatch(normal, /100x-mockup/);
  box.cleanup();
});

test('no word in a brief picks the mode: a brief that says mockup, overnight or wrap up is a normal build', () => {
  const box = sandbox();
  cli(['config', 'set', 'subagents.atOnce', '2', '--global'], { cwd: box.project, env: box.env });
  night(box, 'start', '--until', '+8h', '--brief', 'A mockup tool for designers, to wrap up a status page overnight', '--brief', 'An overnight oats tracker. Resume builder. Explain mode.');
  const status = json(box, ['status']);
  assert.deepEqual(status.projects.map((p) => p.mode), [undefined, undefined]);
  assert.deepEqual(status.projects.map((p) => p.slug), ['mockup-tool-designers-wrap', 'overnight-oats-tracker-resume']);
  const first = json(box, ['next']).delegateTask.task;
  night(box, 'record', status.projects[0].slug, 'task-1');
  const second = json(box, ['next']).delegateTask.task;
  for (const task of [first, second]) {
    assert.match(task, /Call the 100x skill on the brief/);
    assert.match(task, /call the 100x-wrapup skill/);
    assert.match(task, /The judge of the review is the only other agent you start/);
    assert.doesNotMatch(task, /100x-mockup|100x clock set \+15m/);
  }
  box.cleanup();
});

test('a prototype that finished frees its place, and status shows its verdict', () => {
  const box = sandbox();
  cli(['config', 'set', 'subagents.atOnce', '2', '--global'], { cwd: box.project, env: box.env });
  start(box);
  night(box, 'record', 'idle-game-lighthouse-keeper', 'task-1');
  night(box, 'record', 'tiny-budget-tracker', 'task-2');
  const dir = json(box, ['status']).projects[0].dir;
  finish(dir, 'ship');
  const status = json(box, ['status']);
  assert.deepEqual(status.counts, { waiting: 1, running: 1, finished: 1, blocked: 0 });
  assert.equal(status.projects[0].verdict, 'ship');
  assert.equal(json(box, ['next']).slug, 'idle-game-lighthouse-keeper-2');
  assert.match(night(box, 'status').out, /finished idle-game-lighthouse-keeper +ready to ship\. Done thing/);
  box.cleanup();
});

test('a child that died is retried once with a resume task, then it can be blocked', () => {
  const box = sandbox();
  start(box);
  night(box, 'record', 'idle-game-lighthouse-keeper', 'task-1');
  const retry = json(box, ['next', '--retry', 'idle-game-lighthouse-keeper']);
  assert.equal(retry.attempt, 2);
  assert.match(retry.delegateTask.task, /Resume the unfinished 100x run/);
  assert.match(retry.delegateTask.task, /Call the 100x-continue skill/);
  night(box, 'record', 'idle-game-lighthouse-keeper', 'task-1b');
  assert.match(json(box, ['next', '--retry', 'idle-game-lighthouse-keeper']).none, /already tried 2 times/);
  assert.equal(night(box, 'block', 'idle-game-lighthouse-keeper', 'needs a paid key').code, 0);
  assert.match(json(box, ['next', '--retry', 'idle-game-lighthouse-keeper']).none, /^blocked: needs a paid key\. A blocked project is not started again, even with --retry/);
  const status = json(box, ['status']);
  assert.equal(status.counts.blocked, 1);
  assert.equal(status.projects[0].note, 'needs a paid key');
  assert.notEqual(night(box, 'record', 'nope', 'x').code, 0);
  box.cleanup();
});

test('start never writes into a folder that already has files, it takes the next free name and says so', () => {
  const box = sandbox();
  const base = path.join(box.project, 'folders');
  write(path.join(base, 'my-app', 'brief.md'), 'OWNER ORIGINAL BRIEF\n');
  write(path.join(base, 'my-app', 'src', 'index.js'), 'console.log(1)\n');
  fs.mkdirSync(path.join(base, 'tiny-budget-tracker'), { recursive: true });
  const result = night(box, 'start', '--until', '+3h', '--base', base, '--brief', 'my app', '--brief', 'A tiny budget tracker');
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /my-app already has files in it, so this brief builds in my-app-2\. Nothing there was touched\./);
  assert.equal(fs.readFileSync(path.join(base, 'my-app', 'brief.md'), 'utf8'), 'OWNER ORIGINAL BRIEF\n');
  assert.equal(fs.readFileSync(path.join(base, 'my-app-2', 'brief.md'), 'utf8'), 'my app\n');
  assert.equal(fs.readFileSync(path.join(base, 'tiny-budget-tracker', 'brief.md'), 'utf8'), 'A tiny budget tracker\n', 'an empty folder is free to use');
  assert.deepEqual(json(box, ['status']).projects.map((p) => p.slug), ['my-app-2', 'tiny-budget-tracker']);
  box.cleanup();
});

test('a file holds several briefs separated by a line with three dashes', () => {
  const box = sandbox();
  write(path.join(box.project, 'briefs.txt'), 'First idea\nwith two lines\n---\nSecond idea\n---\n\n');
  cli(['config', 'set', 'subagents.atOnce', '3', '--global'], { cwd: box.project, env: box.env });
  const result = night(box, 'start', '--until', '+3h', '--file', path.join(box.project, 'briefs.txt'), '--parallel', '3');
  assert.equal(result.code, 0, result.err);
  const status = json(box, ['status']);
  assert.equal(status.projects.length, 2);
  assert.equal(status.parallel, 3);
  assert.equal(fs.readFileSync(path.join(status.projects[0].dir, 'brief.md'), 'utf8'), 'First idea\nwith two lines\n');
  assert.match(night(box, 'end').out, /Ended\./);
  assert.match(json(box, ['next']).none, /has ended/);
  box.cleanup();
});

test('start refuses a missing wake time, no briefs, a night under an hour and unknown commands', () => {
  const box = sandbox();
  assert.match(night(box, 'start', '--brief', 'x').err, /--until/);
  assert.match(night(box, 'start', '--until', '+8h').err, /at least one brief/);
  assert.match(night(box, 'start', '--until', '+30m', '--brief', 'x').err, /at least 60 minutes/);
  assert.match(night(box, 'start', '--until', '+8h', '--brief', 'x', '--parallel', '0').err, /whole number/);
  assert.match(night(box, 'status').err, /No night is planned/);
  assert.match(night(box, 'sleep').err, /Unknown night command/);
  box.cleanup();
});

test('no child starts in the last hour', async () => {
  const box = sandbox();
  process.env.X100_HOME = path.join(box.home, '.100x');
  try {
    const { startNight, nextProject } = await import('../lib/night.mjs');
    const at = (h, m = 0) => new Date(2026, 10, 16, h, m, 0, 0);
    startNight({ briefs: ['one'], until: '07:00', base: path.join(box.dir, 'n'), now: at(22) });
    const config = { overnight: { provider: null, model: null, options: {} } };
    assert.ok(nextProject(config, { now: at(23) }).slug);
    assert.match(nextProject(config, { now: new Date(2026, 10, 17, 6, 30) }).none, /only 30 minutes left/);
  } finally {
    delete process.env.X100_HOME;
    box.cleanup();
  }
});

test('the subagent cap wins over a bigger parallel ask', () => {
  const box = sandbox();
  const result = night(box, 'start', '--until', '+3h', '--brief', 'One idea', '--parallel', '5');
  assert.equal(result.code, 0, result.err);
  assert.equal(json(box, ['status']).parallel, 1);
  box.cleanup();
});

test('a retry is a start like any other: an ended night, a spent clock and a full set of running children stop it, and the retried child does not count against itself', () => {
  const box = sandbox();
  start(box);
  night(box, 'record', 'idle-game-lighthouse-keeper', 'task-1');
  assert.equal(json(box, ['next', '--retry', 'idle-game-lighthouse-keeper']).slug, 'idle-game-lighthouse-keeper', 'the one that died is the only one running, so it may start again');
  assert.match(json(box, ['next', '--retry', 'idle-game-lighthouse-keeper']).none, /handed out less than 10 minutes ago and is not recorded yet/, 'a second retry before the record');
  night(box, 'record', 'idle-game-lighthouse-keeper', 'task-1b');
  night(box, 'record', 'tiny-budget-tracker', 'task-2');
  assert.match(json(box, ['next', '--retry', 'tiny-budget-tracker']).none, /1 running, the most at once is 1/, 'another child is running, so the cap holds');
  assert.equal(night(box, 'end').code, 0);
  assert.match(json(box, ['next', '--retry', 'tiny-budget-tracker']).none, /this night has ended/);
  box.cleanup();

});

test('a retry in the last hour of the night is refused too', async () => {
  const box = sandbox();
  process.env.X100_HOME = path.join(box.home, '.100x');
  try {
    const { startNight, nextProject, recordStart } = await import('../lib/night.mjs');
    const at = (h, m = 0) => new Date(2026, 10, 16, h, m, 0, 0);
    const plan = startNight({ briefs: ['one'], until: '07:00', base: path.join(box.dir, 'n'), now: at(22) });
    recordStart(plan.projects[0].slug, 'task-1', { now: at(23) });
    const config = { overnight: { provider: null, model: null, options: {} } };
    assert.ok(nextProject(config, { retry: plan.projects[0].slug, now: at(23, 30) }).slug);
    assert.match(nextProject(config, { retry: plan.projects[0].slug, now: new Date(2026, 10, 17, 6, 30) }).none, /only 30 minutes left, too late to start another/);
  } finally {
    delete process.env.X100_HOME;
    box.cleanup();
  }
});

test('a night child on a 1m window is refused when its task is built, and the text names the SDK line for Cursor', () => {
  const box = sandbox();
  assert.equal(cli(['config', 'role', 'overnight', '--model', 'muse-wonder-1.0', '--provider', 'cursor', '--option', 'reasoning_effort=max', '--option', 'contextWindow=300k', '--global'], { cwd: box.project, env: box.env }).code, 0);
  start(box);
  const text = night(box, 'next').out;
  assert.match(text, /In Cursor the Task tool is not that tool, so never use it: run `100x helper run --model muse-wonder-1\.0 --effort max --context 300k --task-file <file> --cwd <folder>` with block_until_ms 0 instead\./);
  assert.equal(cli(['config', 'role', 'overnight', '--model', 'muse-wonder-1.0', '--provider', 'cursor', '--option', 'contextWindow=1m', '--global'], { cwd: box.project, env: box.env }).code, 0);
  const refused = night(box, 'next');
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /The overnight model is set to a 1m context window, which is MAX mode on Cursor/);
  box.cleanup();
});

test('a child handed out by next is held until it is recorded, so a second next or retry cannot start another above the cap', async () => {
  const box = sandbox();
  start(box);
  const first = json(box, ['next']);
  assert.equal(first.slug, 'idle-game-lighthouse-keeper');
  assert.match(json(box, ['next']).none, /1 running, the most at once is 1|1 handed out and not recorded yet/, 'a second next before the record starts nothing');
  assert.equal(night(box, 'record', first.slug, 'task-1').code, 0);
  assert.match(json(box, ['next']).none, /1 running, the most at once is 1/);
  assert.match(night(box, 'status').out, /running +idle-game-lighthouse-keeper/);
  box.cleanup();

  const held = sandbox();
  cli(['config', 'set', 'subagents.atOnce', '2', '--global'], { cwd: held.project, env: held.env });
  start(held, ['--parallel', '2']);
  assert.equal(json(held, ['next']).slug, 'idle-game-lighthouse-keeper');
  assert.equal(json(held, ['next']).slug, 'tiny-budget-tracker', 'the first is held, so the second child is a different one');
  assert.match(json(held, ['next']).none, /2 handed out and not recorded yet|2 running, the most at once is 2/, 'two are held, which is the cap');
  held.cleanup();

  const old = sandbox();
  process.env.X100_HOME = path.join(old.home, '.100x');
  try {
    const { startNight, nextProject } = await import('../lib/night.mjs');
    const at = (h, m = 0) => new Date(2026, 10, 16, h, m, 0, 0);
    startNight({ briefs: ['one'], until: '07:00', base: path.join(old.dir, 'n'), now: at(22) });
    const config = { overnight: { provider: null, model: null, options: {} }, subagents: { atOnce: 1 } };
    assert.ok(nextProject(config, { now: at(22, 5) }).slug);
    assert.match(nextProject(config, { now: at(22, 9) }).none, /1 running, the most at once is 1/, 'the hand-out counts against the cap');
    assert.ok(nextProject(config, { now: at(22, 20) }).slug, 'a hand-out that was never recorded is let go after ten minutes');
  } finally {
    delete process.env.X100_HOME;
    old.cleanup();
  }
});

test('a night plan that is not a plan, or has an end time nobody can read, starts nothing and says which file', () => {
  for (const [name, change] of [['projects is a string', { projects: 'x' }], ['projects is null', { projects: null }], ['a project has no folder', { projects: [{ slug: 'a', state: 'waiting', attempts: 0 }] }], ['the end time is garbage', { until: 'garbage' }], ['parallel is not a number', { parallel: 'many' }], ['a project has no state', { projects: [{ slug: 'a', dir: '/tmp/a', attempts: 0 }] }], ['a project has no attempts', { projects: [{ slug: 'a', dir: '/tmp/a', state: 'waiting' }] }], ['a project has an unknown state', { projects: [{ slug: 'a', dir: '/tmp/a', state: 'sleeping', attempts: 0 }] }], ['a project has an empty slug', { projects: [{ slug: '', dir: '/tmp/a', state: 'waiting', attempts: 0 }] }], ['attempts is negative', { projects: [{ slug: 'a', dir: '/tmp/a', state: 'waiting', attempts: -1 }] }]]) {
    const box = sandbox();
    start(box);
    const file = path.join(box.home, '.100x', 'night', `${json(box, ['status']).id}.json`);
    const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...plan, ...change }));
    for (const args of [['next'], ['status'], ['next', '--retry', 'idle-game-lighthouse-keeper']]) {
      const result = night(box, ...args);
      assert.notEqual(result.code, 0, `${name} ${args.join(' ')}`);
      assert.match(result.err, /is not a night plan this version wrote/, `${name} ${args.join(' ')}`);
      assert.doesNotMatch(result.err, /TypeError|is not a function|Cannot read/);
    }
    box.cleanup();
  }
});
