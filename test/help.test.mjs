import assert from 'node:assert/strict';
import test from 'node:test';
import { commands, helpGroups } from '../lib/commands/index.mjs';
import { cli, sandbox } from './helpers.mjs';

const own = commands.filter((command) => !command.passThrough);

test('every command answers --help and -h with its own usage, and exits 0', () => {
  const box = sandbox();
  for (const command of own) {
    for (const flag of ['--help', '-h']) {
      const result = cli([command.name, flag], { cwd: box.project, env: box.env });
      assert.equal(result.code, 0, `100x ${command.name} ${flag}. ${result.err}`);
      assert.ok(result.out.startsWith(`100x ${command.name}\n`), `100x ${command.name} ${flag} did not print the usage of ${command.name}`);
    }
  }
  box.cleanup();
});

test('the command list is grouped, and every command is in exactly one group', () => {
  const listed = helpGroups.flatMap(([, names]) => names);
  assert.deepEqual([...listed].sort(), commands.map((command) => command.name).sort(), 'a command is missing from helpGroups or listed twice');
  const box = sandbox();
  const out = cli(['help'], { cwd: box.project, env: box.env }).out;
  let at = -1;
  for (const [heading, names] of helpGroups) {
    const found = out.indexOf(`\n${heading}\n`);
    assert.ok(found > at, `${heading} is missing or out of order`);
    at = found;
    for (const name of names) assert.match(out, new RegExp(`\n  ${name} +\\S`), `${name} is not listed under ${heading}`);
  }
  box.cleanup();
});

test('help is found after a subcommand too, and the old form still works', () => {
  const box = sandbox();
  const sub = cli(['night', 'start', '--help'], { cwd: box.project, env: box.env });
  assert.equal(sub.code, 0);
  assert.match(sub.out, /^100x night\n/);
  assert.equal(cli(['help', 'night'], { cwd: box.project, env: box.env }).out, sub.out);
  box.cleanup();
});

test('the text command hands --help to its own tool', () => {
  const box = sandbox();
  const text = cli(['text', '--help'], { cwd: box.project, env: box.env });
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /^100x text measures a text/);
  assert.doesNotMatch(text.out, /unslop/);
  box.cleanup();
});

test('the two report commands say which report each one makes, so the word report is not read as one command', () => {
  const box = sandbox();
  const list = cli(['help'], { cwd: box.project, env: box.env }).out;
  assert.match(list, /\n  report +Rebuild this run's own REPORT\.md and REPORT\.html\. The page with every run is made by morning\./);
  assert.match(list, /\n  morning +The report page with every finished run, the one the owner opens by saying report\./);
  assert.match(cli(['help', 'report'], { cwd: box.project, env: box.env }).out, /The page with every finished run is made by 100x morning\./);
  box.cleanup();
});
