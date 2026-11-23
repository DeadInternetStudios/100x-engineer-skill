import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, ROOT, sandbox, write } from './helpers.mjs';
import { makeProject } from './projects.mjs';

const DOC = fs.readFileSync(path.join(ROOT, 'skills', '100x', 'references', 'apps.md'), 'utf8');
const TEMPLATES = Object.fromEntries([...DOC.matchAll(/^### (\S+)\n[\s\S]*?```sh\n([\s\S]*?)\n```/gm)].map((m) => [m[1], m[2].trim()]));
const TASK = 'You are the independent reviewer.\nSecond line with "quotes" and $dollars.';
// The program a template runs, when it is not named like the template. The Cursor template runs 100x itself, which starts the helper through the SDK.
const PROGRAM = { cursor: '100x' };

// A program with the app's name that records its arguments, one per line, and writes the findings file when asked to.
function stubApps(box) {
  const bin = path.join(box.dir, 'bin');
  const record = path.join(box.dir, 'args.txt');
  for (const name of Object.keys(TEMPLATES)) {
    write(path.join(bin, PROGRAM[name] ?? name), `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done > "${record}"\nprintf '%s' "$X100_MODEL" > "$X100_FINDINGS" 2>/dev/null\nexit 0\n`);
    fs.chmodSync(path.join(bin, PROGRAM[name] ?? name), 0o755);
  }
  return { bin, args: () => fs.readFileSync(record, 'utf8').split('\0').slice(0, -1) };
}

const run = (command, env, bin) => spawnSync('sh', ['-c', command], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env }, encoding: 'utf8' });

test('the documented apps are the ones the test knows about', () => {
  assert.deepEqual(Object.keys(TEMPLATES).sort(), ['claude', 'codex', 'cursor', 'gemini', 'opencode']);
});

for (const [name, template] of Object.entries(TEMPLATES)) {
  test(`${name} template passes the model and effort when set, drops them when empty, and sends the task as one argument`, () => {
    const box = sandbox();
    const { bin, args } = stubApps(box);
    const full = run(template, { X100_MODEL: 'some-model', X100_EFFORT: 'max', X100_TASK: TASK, X100_FINDINGS: path.join(box.dir, 'f.md') }, bin);
    assert.equal(full.status, 0, full.stderr);
    assert.ok(args().includes('some-model'), 'the model reaches the app');
    assert.equal(args().filter((a) => a === TASK).length, 1, 'the task is exactly one argument, quotes and newline intact');
    if (name !== 'gemini' && name !== 'opencode') assert.ok(args().some((arg) => arg === 'max' || arg.endsWith('=max')), 'the effort reaches the app');
    const bare = run(template, { X100_MODEL: '', X100_EFFORT: '', X100_TASK: TASK, X100_FINDINGS: path.join(box.dir, 'f.md') }, bin);
    assert.equal(bare.status, 0, bare.stderr);
    assert.ok(!args().some((a) => /^(-m|--model|--effort)$/.test(a) || a.includes('model_reasoning_effort')), 'nothing is passed for an empty model or effort');
    assert.equal(args().filter((a) => a === TASK).length, 1);
    box.cleanup();
  });
}

test('a documented template works end to end through review-run', async () => {
  const box = sandbox();
  const { bin } = stubApps(box);
  makeProject(box);
  cli(['config', 'role', 'review', '--model', 'opus', '--option', 'effort=max', '--global'], { cwd: box.project, env: box.env });
  assert.equal(cli(['config', 'set', 'review.command', JSON.stringify(TEMPLATES.claude), '--global'], { cwd: box.project, env: box.env }).code, 0);
  const env = { ...box.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const started = cli(['review-run'], { cwd: box.project, env });
  assert.equal(started.code, 0, started.err);
  const findings = path.join(box.project, '.100x', 'review', 'findings.md');
  for (let waited = 0; !fs.existsSync(path.join(box.project, '.100x', 'review', 'run.exit')); waited += 100) {
    assert.ok(waited < 15000, 'the app stub never finished');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(fs.readFileSync(findings, 'utf8'), 'opus');
  const status = JSON.parse(cli(['review-run', '--status', '--json'], { cwd: box.project, env }).out);
  assert.deepEqual([status.state, status.code], ['exited', 0]);
  box.cleanup();
});
