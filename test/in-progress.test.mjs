import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox } from './helpers.mjs';
import { makeProject, runJson } from './projects.mjs';

const HOUR = 3600 * 1000;

// A project that has begun: init, then the first decision. Nothing else is written, which is how a night that stops early leaves it.
function begun(box, name, { logs = 1 } = {}) {
  const root = path.join(box.dir, name);
  fs.mkdirSync(root, { recursive: true });
  assert.equal(cli(['init', '--no-git'], { cwd: root, env: box.env }).code, 0);
  for (let i = 0; i < logs; i += 1) assert.equal(cli(['log', 'build', `step ${i + 1}`, 'the test', 'none', 'ok'], { cwd: root, env: box.env }).code, 0);
  return root;
}

const morning = (box, ...args) => cli(['morning', ...args], { cwd: box.dir, env: box.env });
const registryLines = (box) => fs.readFileSync(path.join(box.env.X100_HOME, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

// Every file the run's state is read from, so the run looks as if nobody had touched it since then.
function touchedAgo(root, ms) {
  const when = new Date(Date.now() - ms);
  const dir = path.join(root, '.100x');
  for (const name of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, name), when, when);
}

test('a run that has begun and not finished is on the report, with where it stands and the line that picks it up', () => {
  const box = sandbox();
  const root = begun(box, 'kana');
  const result = morning(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /^Report\. No finished runs yet\. The run in progress below shows here when it finishes\.\n/);
  assert.match(result.out, /\nIn progress\. 1 run not finished\.\n01 kana\.\n {3}state {2}Working\. Last touched just now\.\n/);
  assert.match(result.out, /\n {3}asks {3}No asks written yet\.\n {3}go on {2}Call `100x-continue` in .*kana\.\n/);
  assert.ok(result.out.includes(fs.realpathSync(root)) || result.out.includes(root), 'the folder is named');
  assert.doesNotMatch(result.err, /left out/, 'a run that has not finished is not a damaged row');
  assert.equal(cli(['registry', 'list'], { cwd: box.dir, env: box.env }).out.trim(), 'no finished runs', 'the ranking and the list hold finished runs only');
  assert.equal(JSON.parse(morning(box, '--json').out).length, 0, '--json lists finished runs, as it always did');
  const page = fs.readFileSync(path.join(box.env.X100_HOME, 'morning', 'index.html'), 'utf8');
  assert.match(page, /<section class="progress"[^>]*><h2[^>]*>In progress\. 1 run not finished<\/h2><ul><li><p><b>kana<\/b><\/p><p class="quiet">Working\./);
  box.cleanup();
});

test('a run is tracked once, however many decisions it logs, and a log kept elsewhere does not track anything', () => {
  const box = sandbox();
  const root = begun(box, 'kana', { logs: 3 });
  assert.equal(registryLines(box).length, 1, 'three decisions, one row');
  assert.equal(registryLines(box)[0].started, true);
  const elsewhere = path.join(box.dir, 'elsewhere.tsv');
  assert.equal(cli(['log', 'build', 'a decision', 'the test', '--file', elsewhere], { cwd: root, env: box.env }).code, 0);
  assert.equal(registryLines(box).length, 1);
  const other = path.join(box.dir, 'other');
  fs.mkdirSync(other);
  cli(['init', '--no-git'], { cwd: other, env: box.env });
  assert.equal(cli(['log', 'build', 'a decision', 'the test', '--file', elsewhere], { cwd: other, env: box.env }).code, 0);
  assert.equal(registryLines(box).length, 1, 'a project that only logs to another file is not on the report');
  box.cleanup();
});

test('when the run finishes it leaves the in-progress list and takes its place in the ranking', () => {
  const box = sandbox();
  const root = path.join(box.dir, 'glow');
  fs.mkdirSync(root);
  makeProject(box, { root, run: runJson({ title: 'glow' }) });
  assert.equal(cli(['log', 'build', 'first step', 'the test', 'none', 'ok'], { cwd: root, env: box.env }).code, 0);
  const before = morning(box);
  assert.match(before.out, /In progress\. 1 run not finished\.\n01 glow\./);
  const done = cli(['finish'], { cwd: root, env: box.env });
  assert.equal(done.code, 0, done.err);
  const after = morning(box);
  assert.doesNotMatch(after.out, /In progress/, 'a finished run is not also listed as unfinished');
  assert.match(after.out, /^Report\. 1 prototype in the last 18 hours/);
  const last = registryLines(box).at(-1);
  assert.equal(last.id, registryLines(box)[0].id, 'finish writes its row under the id the run was tracked with');
  assert.equal(last.verdict, 'ship');
  assert.equal(last.started, undefined);
  box.cleanup();
});

test('a run nobody has touched for hours says it is idle, and how to drop it', () => {
  const box = sandbox();
  const root = begun(box, 'kana');
  touchedAgo(root, 3 * HOUR);
  const result = morning(box);
  assert.match(result.out, /state {2}Idle, last touched 3 hours ago\. It may have stopped\./);
  const id = registryLines(box)[0].id;
  assert.match(result.out, new RegExp(`To drop it from this report, \`100x registry remove ${id}\`\\.`));
  assert.match(fs.readFileSync(path.join(box.env.X100_HOME, 'morning', 'index.html'), 'utf8'), /<li class="idle">/);
  const dropped = cli(['registry', 'remove', id], { cwd: box.dir, env: box.env });
  assert.match(dropped.out, /removed 1 run/);
  assert.doesNotMatch(morning(box).out, /In progress/);
  box.cleanup();
});

test('a run left alone for longer than the window is counted, and --all lists it', () => {
  const box = sandbox();
  const root = begun(box, 'kana');
  touchedAgo(root, 3 * 24 * HOUR);
  const result = morning(box);
  assert.doesNotMatch(result.out, /01 kana/);
  assert.match(result.out, /\n1 older run never finished\. `100x morning --all` lists it\./);
  const all = morning(box, '--all');
  assert.match(all.out, /In progress\. 1 run not finished\.\n01 kana\./);
  assert.match(all.out, /Idle, last touched 72 hours ago/);
  assert.doesNotMatch(all.out, /older run never finished/);
  box.cleanup();
});

test('a folder that began a second run is listed once, for the run in progress', () => {
  const box = sandbox();
  const root = begun(box, 'kana');
  // The first run began yesterday and was never finished. The folder has started another since, which is the one in progress.
  const file = path.join(box.env.X100_HOME, 'runs.jsonl');
  const [first] = registryLines(box);
  fs.writeFileSync(file, `${JSON.stringify({ ...first, id: 'earlier', startedAt: '2026-11-20T08:00:00.000Z' })}\n`);
  assert.equal(cli(['log', '--start', 'second-run'], { cwd: root, env: box.env }).code, 0);
  assert.equal(cli(['log', 'build', 'the second run begins', 'the test', 'none', 'ok'], { cwd: root, env: box.env }).code, 0);
  assert.equal(registryLines(box).length, 2, 'both starts are on file');
  const result = morning(box);
  assert.match(result.out, /In progress\. 1 run not finished\./, 'the earlier start in the same folder was left behind by the second');
  assert.doesNotMatch(result.out, /older run never finished/, 'and it is not counted as an older run either');
  box.cleanup();
});

test('a project whose folder is gone is left off the list without a word', () => {
  const box = sandbox();
  const root = begun(box, 'kana');
  fs.rmSync(root, { recursive: true, force: true });
  const result = morning(box);
  assert.equal(result.code, 0, result.err);
  assert.doesNotMatch(result.out, /In progress/);
  assert.equal(result.err, '');
  box.cleanup();
});
