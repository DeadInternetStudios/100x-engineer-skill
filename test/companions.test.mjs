import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkVendored, COMPANIONS, readPins, treeHash, vendorCompanion, vendorDir } from '../lib/companions.mjs';
import { cli, ROOT, sandbox, write } from './helpers.mjs';


function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}

function checkout(box, name, body = 'one') {
  const dir = path.join(box.dir, 'src', name);
  write(path.join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when testing.\n---\n${body}\n`);
  write(path.join(dir, 'skills', name, 'scripts', 'tool.mjs'), 'console.log("tool");\n');
  write(path.join(dir, 'package.json'), '{"version":"2.3.4"}');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

test('the copy in vendor/ is exactly what companions.json pins', () => {
  const results = checkVendored(ROOT);
  assert.deepEqual(results.map((r) => r.name), Object.keys(COMPANIONS));
  assert.deepEqual(results.filter((r) => !r.ok).map((r) => r.problem), []);
});

test('a hand edit of a pinned copy is found, and so is a missing one', () => {
  const box = sandbox();
  const repo = path.join(box.dir, 'repo');
  fs.cpSync(path.join(ROOT, 'vendor'), path.join(repo, 'vendor'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'companions.json'), path.join(repo, 'companions.json'));
  assert.equal(checkVendored(repo).every((r) => r.ok), true);
  fs.appendFileSync(path.join(vendorDir('unslop-text', repo), 'SKILL.md'), '\nA hand edit.\n');
  const [text] = checkVendored(repo);
  assert.equal(text.ok, false);
  assert.match(text.problem, /vendor\/unslop-text differs from its pin \([0-9a-f]{7}\)\. Someone edited it by hand\. Change the tool in its own repository/);
  fs.rmSync(vendorDir('unslop-text', repo), { recursive: true });
  assert.match(checkVendored(repo)[0].problem, /vendor\/unslop-text is missing/);
  box.cleanup();
});

test('the same files hash the same wherever they sit, and one changed byte changes the hash', () => {
  const box = sandbox();
  write(path.join(box.dir, 'a', 'x.md'), 'one');
  write(path.join(box.dir, 'a', 'sub', 'y.md'), 'two');
  fs.cpSync(path.join(box.dir, 'a'), path.join(box.dir, 'b'), { recursive: true });
  write(path.join(box.dir, 'b', '.DS_Store'), 'noise');
  write(path.join(box.dir, 'b', 'node_modules', 'z.js'), 'noise');
  assert.equal(treeHash(path.join(box.dir, 'a')), treeHash(path.join(box.dir, 'b')));
  write(path.join(box.dir, 'b', 'x.md'), 'ONE');
  assert.notEqual(treeHash(path.join(box.dir, 'a')), treeHash(path.join(box.dir, 'b')));
  box.cleanup();
});

test('vendoring copies the skill folder, records the commit and a hash, and refuses a dirty checkout', () => {
  const box = sandbox();
  const repo = path.join(box.dir, 'repo');
  fs.mkdirSync(repo);
  const src = checkout(box, 'unslop-text');
  const pin = vendorCompanion('unslop-text', src, { repo });
  assert.equal(pin.version, '2.3.4');
  assert.equal(pin.commit, git(src, 'rev-parse', 'HEAD'));
  assert.equal(pin.path, 'skills/unslop-text');
  assert.ok(fs.existsSync(path.join(vendorDir('unslop-text', repo), 'scripts', 'tool.mjs')));
  assert.equal(readPins(repo)['unslop-text'].hash, treeHash(vendorDir('unslop-text', repo)));
  write(path.join(src, 'skills', 'unslop-text', 'SKILL.md'), 'edited and not committed');
  assert.throws(() => vendorCompanion('unslop-text', src, { repo }), /uncommitted changes in skills\/unslop-text/);
  assert.equal(vendorCompanion('unslop-text', src, { repo, allowDirty: true }).version, '2.3.4');
  assert.throws(() => vendorCompanion('unslop-text', path.join(box.dir, 'nowhere'), { repo }), /has no SKILL\.md/);
  box.cleanup();
});

test('100x text runs the pinned unslop-text from any folder and passes its exit code through', () => {
  const box = sandbox();
  write(path.join(box.project, 'plain.md'), 'The timer starts when you press the big button.\n');
  const slop = "In today's fast-paced world, it's important to note that this robust, seamless solution will delve into a rich tapestry of cutting-edge synergies. ".repeat(10);
  write(path.join(box.project, 'padded.md'), slop);
  const ok = cli(['text', 'lint', 'plain.md', '--profile', 'docs', '--fail-above', '8'], { cwd: box.project, env: box.env });
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /plain\.md/);
  const bad = cli(['text', 'lint', 'padded.md', '--profile', 'docs', '--fail-above', '8'], { cwd: box.project, env: box.env });
  assert.equal(bad.code, 1, bad.out + bad.err);
  assert.match(cli(['text', '--help'], { cwd: box.project, env: box.env }).out, /100x text lint/);
  box.cleanup();
});

test('help and suggested commands are spelled the way 100x runs them, so a copy and paste works', () => {
  const box = sandbox();
  const text = cli(['text', '--help'], { cwd: box.project, env: box.env }).out;
  assert.match(text, /^100x text measures a text and checks that a rewrite kept its facts\./, 'the first line a stranger reads has no old name');
  assert.match(text, /Usage: 100x text <command> \[options\] {5}"100x text <command> --help" lists/);
  assert.match(text, /100x text begin docs\/ && 100x text finish/);
  assert.doesNotMatch(text, /(^|\s)unslop (lint|check|begin|finish|<command>)/);
  // a message from deep inside the tool names the command to run next
  const finish = cli(['text', 'finish'], { cwd: box.project, env: box.env });
  assert.match(finish.err + finish.out, /100x text begin/);
  assert.doesNotMatch(finish.err + finish.out, /"unslop begin/);
  assert.match(finish.err + finish.out, /^100x text: no snapshot named/m);
  box.cleanup();
});

test('every command of 100x text answers --help without the old program name, which does not run', () => {
  const box = sandbox();
  const commands = ['lint', 'voice', 'plan', 'audit', 'check', 'claims', 'diff', 'begin', 'finish', 'restore', 'strings', 'apply', 'words', 'rules', 'profiles', 'demo'];
  for (const command of commands) {
    const help = cli(['text', command, '--help'], { cwd: box.project, env: box.env });
    assert.equal(help.code, 0, `${command}: ${help.out}${help.err}`);
    assert.doesNotMatch(help.out + help.err, /(?<![\w./-])unslop(?![\w-])/, `100x text ${command} --help names the old program`);
  }
  box.cleanup();
});

test('the command that 100x text check suggests next is spelled the way 100x runs it, not as a path into vendor/', () => {
  const box = sandbox();
  write(path.join(box.project, 'before.txt'), 'The timer starts when you press the big button. Then it counts down from ten.\n');
  write(path.join(box.project, 'after.txt'), 'The timer starts when you press the button. Then it counts down from nine.\n');
  const result = cli(['text', 'check', 'before.txt', 'after.txt'], { cwd: box.project, env: box.env });
  const said = result.out + result.err;
  assert.match(said, /100x text diff before\.txt after\.txt/, said);
  assert.doesNotMatch(said, /node \S*unslop\.mjs/);
  box.cleanup();
});

test('the vendor script answers an option it no longer has in one line and a usage, not a stack trace', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'vendor-companions.mjs'), '--design', 'x'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^vendor-companions: Unknown option '--design'\nnode scripts\/vendor-companions\.mjs \[--text <checkout>\]/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('a checkout named in the environment replaces the pinned copy for a tool you are changing', () => {
  const box = sandbox();
  write(path.join(box.dir, 'mine.mjs'), 'console.log("my build of the tool", process.argv.slice(2).join(" "));\n');
  const result = cli(['text', 'lint', 'x'], { cwd: box.project, env: { ...box.env, X100_UNSLOP_TEXT_CLI: path.join(box.dir, 'mine.mjs') } });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /my build of the tool lint x/);
  box.cleanup();
});

test('the router and the companion say the same thing about the command: where the companion names its script, the 100x command replaces it', () => {
  const router = fs.readFileSync(path.join(ROOT, 'skills', '100x', 'SKILL.md'), 'utf8');
  assert.match(router, /where it says `node <skill folder>\/scripts\/unslop\.mjs` or `unslop`, run `100x text` with the same arguments/);
  for (const [name, companion] of Object.entries(COMPANIONS)) {
    const skill = fs.readFileSync(path.join(vendorDir(name, ROOT), 'SKILL.md'), 'utf8');
    assert.match(skill, /scripts\/(?:cli|unslop)\.mjs/, `${name} names its script, so the line below has something to replace`);
    assert.match(skill, new RegExp(`A tool that runs this skill may give its own command[^\\n]*\`100x ${companion.command}\``), `${name} says that a tool's command replaces the script`);
  }
});
