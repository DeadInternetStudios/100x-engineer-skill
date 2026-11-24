import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { killTree } from '../lib/proc.mjs';
import { cli, sandbox, write } from './helpers.mjs';
import { makeProject } from './projects.mjs';

const json = (box, args) => JSON.parse(cli(args, { cwd: box.project, env: box.env }).out);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await wait(100);
  }
}

// A judge that is only a command: it writes what it was handed into the findings file.
const STUB = `import fs from 'node:fs';
const e = process.env;
fs.writeFileSync(e.X100_FINDINGS, [e.X100_MODEL, e.X100_PROVIDER, e.X100_EFFORT, e.X100_OPT_CONTEXTWINDOW, e.X100_ROOT === process.cwd(), e.X100_TASK.includes(e.X100_BRIEF), e.X100_EXIT_FILE.endsWith('run.exit')].join('|'));
`;

function withCommand(box, command = `"${process.execPath}" "$X100_ROOT/stub-judge.mjs"`) {
  write(path.join(box.project, 'stub-judge.mjs'), STUB);
  const set = cli(['config', 'set', 'review.command', JSON.stringify(command), '--global'], { cwd: box.project, env: box.env });
  assert.equal(set.code, 0, set.err);
}

test('with no judge chosen the call says so and offers no delegate task', () => {
  const box = sandbox();
  makeProject(box, { judge: false });
  const call = json(box, ['review-call', '--json']);
  assert.equal(call.via, 'none');
  assert.equal(call.configured, false);
  assert.equal('delegateTask' in call, false, 'a delegate task with no model would run on the builder itself');
  assert.match(cli(['review-call'], { cwd: box.project, env: box.env }).out, /No judge is chosen yet\. Call 100x-setup, or pick a model/);
  box.cleanup();
});

test('a judge command runs in the background with the model, effort and task in its environment', async () => {
  const box = sandbox();
  makeProject(box);
  cli(['config', 'role', 'review', '--model', 'judge-x', '--option', 'effort=max', '--option', 'contextWindow=300k', '--global'], { cwd: box.project, env: box.env });
  withCommand(box);
  const call = json(box, ['review-call', '--json']);
  assert.equal(call.via, 'command');
  assert.equal('delegateTask' in call, false);
  const findings = path.join(box.project, '.100x', 'review', 'findings.md');
  fs.rmSync(findings, { force: true });
  const started = cli(['review-run'], { cwd: box.project, env: box.env });
  assert.equal(started.code, 0, started.err);
  assert.match(started.out, /Judge started in the background/);
  const status = await until(() => {
    const now = json(box, ['review-run', '--status', '--json']);
    return now.state === 'exited' ? now : null;
  }, 'the judge to exit');
  assert.equal(status.code, 0);
  assert.equal(fs.readFileSync(findings, 'utf8'), 'judge-x|cursor|max|300k|true|true|true');
  box.cleanup();
});

test('the backup judge runs the same command with its own model', async () => {
  const box = sandbox();
  makeProject(box);
  cli(['config', 'role', 'fallback', '--model', 'backup-y', '--option', 'reasoning_effort=high', '--global'], { cwd: box.project, env: box.env });
  withCommand(box);
  const started = cli(['review-run', '--fallback'], { cwd: box.project, env: box.env });
  assert.equal(started.code, 0, started.err);
  await until(() => json(box, ['review-run', '--status', '--json']).state === 'exited', 'the backup judge to exit');
  assert.equal(fs.readFileSync(path.join(box.project, '.100x', 'review', 'findings.md'), 'utf8'), 'backup-y|cursor|high||true|true|true');
  box.cleanup();
});

test('a second start is refused while one runs, and stop ends the whole process group', async () => {
  const box = sandbox();
  makeProject(box);
  withCommand(box, 'sleep 60');
  assert.equal(cli(['review-run'], { cwd: box.project, env: box.env }).code, 0);
  const { pid } = json(box, ['review-run', '--status', '--json']);
  assert.equal(json(box, ['review-run', '--status', '--json']).state, 'running');
  const again = cli(['review-run'], { cwd: box.project, env: box.env });
  assert.notEqual(again.code, 0);
  assert.match(again.err, /already running/);
  assert.equal(json(box, ['review-run', '--stop', '--json']).state, 'stopped');
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, 'the process to be gone');
  box.cleanup();
});

test('a pid that another process reused is not the judge, is not reported as running and is never signalled', async () => {
  const box = sandbox();
  makeProject(box);
  withCommand(box, 'sleep 60');
  // An unrelated process in a group of its own stands for whatever took the pid after a reboot.
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' });
  other.unref();
  try {
    const dir = path.join(box.project, '.100x', 'review');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ pid: other.pid, procStart: 'Thu Jan  1 00:00:00 1970', startedAt: new Date().toISOString(), model: 'm', role: 'review' }));
    assert.equal(json(box, ['review-run', '--status', '--json']).state, 'died');
    assert.equal(cli(['review-run'], { cwd: box.project, env: box.env }).code, 0, 'a new judge may start');
    json(box, ['review-run', '--stop', '--json']);
    process.kill(other.pid, 0);
  } finally {
    killTree(other.pid);
    box.cleanup();
  }
});

test('review-run without a command explains where to set one', () => {
  const box = sandbox();
  makeProject(box);
  const result = cli(['review-run'], { cwd: box.project, env: box.env });
  assert.notEqual(result.code, 0);
  assert.match(result.err, /No judge command is set/);
  assert.match(cli(['review-run', '--status'], { cwd: box.project, env: box.env }).out, /No judge has been started/);
  box.cleanup();
});

test('a shell command is only read from the global config, never from a project file', () => {
  const box = sandbox();
  makeProject(box);
  const local = cli(['config', 'set', 'review.command', 'echo hi', '--local'], { cwd: box.project, env: box.env });
  assert.notEqual(local.code, 0);
  assert.match(local.err, /only be set with --global/);
  write(path.join(box.project, '.100x', 'config.json'), JSON.stringify({ review: { command: 'touch pwned' } }));
  assert.notEqual(cli(['config', 'validate'], { cwd: box.project, env: box.env }).code, 0);
  assert.equal(json(box, ['review-call', '--json']).via, 'harness', 'the project command is ignored');
  assert.notEqual(cli(['review-run'], { cwd: box.project, env: box.env }).code, 0);
  assert.equal(fs.existsSync(path.join(box.project, 'pwned')), false);
  box.cleanup();
});

test('a loop judge by command writes into the loop folder, not the stage 6 findings', async () => {
  const box = sandbox();
  makeProject(box, { loops: false });
  cli(['config', 'role', 'review', '--model', 'judge-x', '--global'], { cwd: box.project, env: box.env });
  withCommand(box);
  const dir = path.join(box.project, '.100x', 'loops', 'pass-2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ask.md'), 'Pass 2. Craft.\n');
  const started = json(box, ['review-run', '--loop', 'pass-2', '--json']);
  assert.match(started.findings, /loops[\\/]pass-2[\\/]judge\.md$/);
  const text = await until(() => (fs.existsSync(started.findings) ? fs.readFileSync(started.findings, 'utf8') : null), 'the loop judge findings', 99000);
  assert.match(text, /judge-x/);
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'review', 'findings.md')), true, 'makeProject stage 6 fixture is untouched in content');
  box.cleanup();
});
