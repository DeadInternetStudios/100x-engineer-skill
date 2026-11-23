import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox, write } from './helpers.mjs';

test('init scaffolds, creates a repository, hides .100x from git and detects the stack', () => {
  const box = sandbox();
  write(path.join(box.project, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { three: '1' }, devDependencies: { vite: '5' } }));
  write(path.join(box.project, 'vercel.json'), '{}');
  const result = cli(['init', '--json'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  const info = JSON.parse(result.out);
  assert.equal(info.stack.kind, 'node');
  assert.equal(info.stack.devCommand, 'npm run dev');
  assert.equal(info.stack.urlGuess, 'http://localhost:5173');
  assert.deepEqual(info.stack.frameworks.sort(), ['three', 'vite']);
  assert.deepEqual(info.stack.deployHints, ['vercel']);
  assert.equal(info.git.present, true);
  for (const file of ['project.md', 'decisions.tsv', 'STATE.md']) assert.ok(fs.existsSync(path.join(box.project, '.100x', file)), file);
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: box.project }).toString();
  assert.doesNotMatch(status, /\.100x/);
  box.cleanup();
});

test('the project file has a place for the pre-flight the skill says to save', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'project.md'), 'utf8'), /\n## Pre-flight\n/);
  box.cleanup();
});

test('the global folder is never taken for a project, even when the home folder is reached through a symlink', () => {
  const box = sandbox();
  const link = path.join(box.dir, 'home-link');
  fs.symlinkSync(box.home, link);
  fs.mkdirSync(path.join(box.home, '.100x'), { recursive: true });
  const env = { ...box.env, HOME: link, X100_HOME: path.join(link, '.100x') };
  for (const [args, refusal] of [[['log', 'start', 'x', 'y'], /No \.100x folder found here/], [['status'], /No run in this folder/]]) {
    const result = cli(args, { cwd: box.home, env });
    assert.notEqual(result.code, 0, args.join(' '));
    assert.match(result.err, refusal, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(box.home, '.100x', 'decisions.tsv')), false, 'nothing was written into the global folder');
  box.cleanup();
});

test('init is safe to run twice and never overwrites', () => {
  const box = sandbox();
  cli(['init'], { cwd: box.project, env: box.env });
  write(path.join(box.project, '.100x', 'project.md'), 'my words');
  const again = JSON.parse(cli(['init', '--json'], { cwd: box.project, env: box.env }).out);
  assert.deepEqual(again.created, []);
  assert.equal(fs.readFileSync(path.join(box.project, '.100x', 'project.md'), 'utf8'), 'my words');
  const exclude = fs.readFileSync(path.join(box.project, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter((line) => line === '.100x/').length, 1);
  box.cleanup();
});

test('a plain index.html folder is detected as static', () => {
  const box = sandbox();
  write(path.join(box.project, 'index.html'), '<p>hi</p>');
  const info = JSON.parse(cli(['init', '--json', '--no-git'], { cwd: box.project, env: box.env }).out);
  assert.equal(info.stack.kind, 'static');
  assert.equal(info.git.present, false);
  assert.equal(fs.existsSync(path.join(box.project, '.git')), false);
  box.cleanup();
});

test('init refuses the home folder', () => {
  const box = sandbox();
  const result = cli(['init', '--no-git'], { cwd: box.home, env: box.env });
  assert.notEqual(result.code, 0);
  assert.match(result.err, /Refusing/);
  box.cleanup();
});

test('--track leaves .100x visible to git', () => {
  const box = sandbox();
  cli(['init', '--track'], { cwd: box.project, env: box.env });
  const status = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: box.project }).toString();
  assert.match(status, /\.100x\/decisions\.tsv/);
  box.cleanup();
});

test('the must-not-break folder is spelled the way every other part of 100x spells it', () => {
  const box = sandbox();
  cli(['init'], { cwd: box.project, env: box.env });
  assert.ok(fs.existsSync(path.join(box.project, '.100x', 'must-not-break')));
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'mustNotBreak')), false);
  box.cleanup();
});

const earlierRunIn = (box) => {
  cli(['init'], { cwd: box.project, env: box.env });
  write(path.join(box.project, '.100x', 'STATE.md'), 'Stage: 4 Polish\nNext: pass 2\n');
  cli(['log', '--start', 'first-1'], { cwd: box.project, env: box.env });
  cli(['run', 'set', 'hero', 'shots/x.png'], { cwd: box.project, env: box.env });
  cli(['clock', 'set', '+2h', '--fill'], { cwd: box.project, env: box.env });
  write(path.join(box.project, '.100x', 'shots', 'pass-1', 'matrix.json'), '{}');
  write(path.join(box.project, '.100x', 'loops', 'pass-1', 'ask.md'), 'ask');
};

test('init names an earlier run and leaves its files alone until --fresh', () => {
  const box = sandbox();
  earlierRunIn(box);
  const info = JSON.parse(cli(['init', '--json'], { cwd: box.project, env: box.env }).out);
  assert.deepEqual(info.earlier, { finished: false, stage: '4 Polish', watchdog: null });
  assert.ok(fs.existsSync(path.join(box.project, '.100x', 'run.json')));
  const text = cli(['init'], { cwd: box.project, env: box.env }).out;
  assert.match(text, /earlier\s+a run is already here \(not finished, 4 Polish\)\. A new brief starts clean with 100x init --fresh\. To pick it up, skip init and call 100x-continue\./);
  box.cleanup();
});

test('init --fresh moves one run aside, keeps the decision trail and the settings, and starts clean', () => {
  const box = sandbox();
  earlierRunIn(box);
  write(path.join(box.project, '.100x', 'config.json'), '{"polish":{"passes":2}}');
  write(path.join(box.project, '.100x', 'backlog.md'), 'my own notes');
  const info = JSON.parse(cli(['init', '--fresh', '--json'], { cwd: box.project, env: box.env }).out);
  assert.match(info.earlier.archivedTo, /^\.100x\/archive\/\d{8}T\d{6}Z$/);
  const moved = path.join(box.project, info.earlier.archivedTo);
  for (const name of ['run.json', 'clock.json', 'STATE.md', 'shots/pass-1/matrix.json', 'loops/pass-1/ask.md']) assert.ok(fs.existsSync(path.join(moved, name)), name);
  const here = path.join(box.project, '.100x');
  assert.equal(fs.existsSync(path.join(here, 'run.json')), false);
  assert.equal(fs.existsSync(path.join(here, 'clock.json')), false);
  assert.equal(fs.existsSync(path.join(here, 'loops')), false);
  assert.match(fs.readFileSync(path.join(here, 'STATE.md'), 'utf8'), /^Stage: 0 Open/m);
  assert.deepEqual(fs.readdirSync(path.join(here, 'shots')), []);
  assert.match(fs.readFileSync(path.join(here, 'decisions.tsv'), 'utf8'), /first-1/);
  assert.equal(fs.readFileSync(path.join(here, 'config.json'), 'utf8'), '{"polish":{"passes":2}}');
  assert.equal(fs.readFileSync(path.join(here, 'backlog.md'), 'utf8'), 'my own notes');
  box.cleanup();
});

test('init --fresh in a folder with no earlier run changes nothing', () => {
  const box = sandbox();
  cli(['init'], { cwd: box.project, env: box.env });
  const info = JSON.parse(cli(['init', '--fresh', '--json'], { cwd: box.project, env: box.env }).out);
  assert.equal(info.earlier, null);
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'archive')), false);
  box.cleanup();
});

test('a second run in the same folder is not finished because the first one was', () => {
  const box = sandbox();
  cli(['init'], { cwd: box.project, env: box.env });
  cli(['log', '--start', 'first-1'], { cwd: box.project, env: box.env });
  const trail = path.join(box.project, '.100x', 'decisions.tsv');
  fs.writeFileSync(trail, fs.readFileSync(trail, 'utf8').replace(/^\S+\tstart/m, '2026-11-01T10:00:00Z\tstart'));
  const first = JSON.parse(cli(['status', '--json'], { cwd: box.project, env: box.env }).out);
  assert.equal(first.startedAt, '2026-11-01T10:00:00Z');
  write(path.join(box.project, '.100x', 'finished.json'), JSON.stringify({ runId: createHash('sha1').update(`${fs.realpathSync(box.project)}\n${first.startedAt}`).digest('hex').slice(0, 10), finishedAt: new Date().toISOString(), verdict: 'fine' }));
  assert.equal(JSON.parse(cli(['status', '--json'], { cwd: box.project, env: box.env }).out).finished, true, 'the first run is finished');
  cli(['log', '--start', 'second-2'], { cwd: box.project, env: box.env });
  const second = JSON.parse(cli(['status', '--json'], { cwd: box.project, env: box.env }).out);
  assert.equal(second.finished, false);
  assert.equal(second.decisions.count, 1, 'only the rows of the run in progress count');
  assert.notEqual(second.startedAt, null);
  box.cleanup();
});

test('init --fresh moves the earlier run\'s stage tags aside, so the new run can use the names, and its report lists only its own', () => {
  const box = sandbox();
  earlierRunIn(box);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: box.project }).toString().trim();
  git('commit', '--allow-empty', '-m', 'first run');
  git('tag', '100x/core');
  git('tag', '-a', '-m', 'polish', '100x/polish-1');
  const info = JSON.parse(cli(['init', '--fresh', '--json'], { cwd: box.project, env: box.env }).out);
  assert.deepEqual(info.earlier.archivedTags.sort(), ['100x/core', '100x/polish-1']);
  const stamp = path.basename(info.earlier.archivedTo);
  assert.deepEqual(git('tag', '-l', '100x/*').split('\n').sort(), [`100x/archive/${stamp}/core`, `100x/archive/${stamp}/polish-1`]);
  assert.equal(git('rev-parse', `100x/archive/${stamp}/core^{commit}`), git('rev-parse', 'HEAD'), 'the tag still names the commit it did');
  assert.equal(git('cat-file', '-t', `100x/archive/${stamp}/polish-1`), 'tag', 'an annotated tag keeps its message');
  git('tag', '100x/core');
  const status = JSON.parse(cli(['status', '--json'], { cwd: box.project, env: box.env }).out);
  assert.deepEqual(status.git.tags, ['100x/core'], 'the new run sees its own tag and not the earlier run\'s');
  box.cleanup();
});

test('init --fresh says where the stage tags went, and says nothing about tags when there were none', () => {
  const box = sandbox();
  earlierRunIn(box);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: box.project }).toString().trim();
  git('commit', '--allow-empty', '-m', 'first run');
  git('tag', '100x/core');
  const said = cli(['init', '--fresh'], { cwd: box.project, env: box.env }).out;
  assert.match(said, /earlier\s+moved the earlier run \(not finished, 4 Polish\) to \.100x\/archive\/\d{8}T\d{6}Z\. This run starts clean\. Its tag is now under 100x\/archive\/, so this run can use the names again\./);
  const none = sandbox();
  earlierRunIn(none);
  assert.doesNotMatch(cli(['init', '--fresh'], { cwd: none.project, env: none.env }).out, /tag/);
  box.cleanup();
  none.cleanup();
});
