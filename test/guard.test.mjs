import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox, write } from './helpers.mjs';

// The judge guard. A judge that is the model that builds shares its blind spots, so review-call and doctor both say so before any work is judged.
const BANNER = '═'.repeat(87);
const startBlock = (at, id, model) => `[${at}] ERROR: Hook 1 failed
${BANNER}
subagentStart
${BANNER}
INPUT:
${JSON.stringify({ subagent_id: id, tool_call_id: id, task: 't', subagent_model: model, hook_event_name: 'subagentStart' }, null, 2)}

OUTPUT:
(empty)

`;

function project({ builder, judge, command = null, judgeOptions = [] }) {
  const box = sandbox();
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  run('init', '--no-git');
  if (builder) run('config', 'role', 'builder', '--provider', 'cursor', '--model', builder, '--global');
  if (judge) run('config', 'role', 'review', '--provider', 'cursor', '--model', judge, ...judgeOptions, '--global');
  if (command) run('config', 'set', 'review.command', command, '--global');
  return { box, run };
}

const call = (run) => JSON.parse(run('review-call', '--json').out);
const judgeCheck = (box) => JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: box.env }).out).find((c) => c.name === 'judge');

test('a judge that is the builder\'s own model is a self-review: review-call carries selfReview, says so in words, and doctor warns with the fix', () => {
  const { box, run } = project({ builder: 'claude-sonnet-5-5', judge: 'claude-sonnet-5-5' });
  assert.equal(call(run).selfReview, true);
  assert.match(run('review-call').out, /The judge is the model that builds \(claude-sonnet-5-5\), so its look is a self-review and shares the builder's blind spots\. Call 100x-setup/);
  const check = judgeCheck(box);
  assert.equal(check.status, 'warn');
  assert.match(check.detail, /claude-sonnet-5-5 via cursor.* It is also the model that builds, so its review is a self-review/);
  assert.match(check.fix, /Call 100x-setup and give the judge a model from another vendor than the builder/);
  assert.match(check.fix, /100x config set review\.model <model> --global/);
  box.cleanup();
});

test('the same model with another effort word is still the builder\'s model', () => {
  const { box, run } = project({ builder: 'claude-sonnet-5-5', judge: 'claude-sonnet-5-5-max' });
  assert.equal(call(run).selfReview, true);
  assert.equal(judgeCheck(box).status, 'warn');
  box.cleanup();
});

test('two different models give neither the flag nor the warning, and a different version of a family is a different model', () => {
  for (const [builder, judge] of [['claude-sonnet-5-5', 'muse-wonder-1.0'], ['claude-sonnet-5', 'claude-sonnet-5-5']]) {
    const { box, run } = project({ builder, judge });
    const result = call(run);
    assert.ok(!('selfReview' in result), `${builder} against ${judge}`);
    assert.doesNotMatch(run('review-call').out, /self-review/);
    const check = judgeCheck(box);
    assert.equal(check.status, 'ok');
    assert.doesNotMatch(`${check.detail} ${check.fix}`, /self-review/);
    box.cleanup();
  }
});

test('with no builder model chosen there is nothing to compare, so a judge is never called a self-review', () => {
  const { box, run } = project({ judge: 'claude-sonnet-5-5' });
  assert.ok(!('selfReview' in call(run)));
  assert.equal(judgeCheck(box).status, 'ok');
  box.cleanup();
});

test('a judge command that names the builder\'s model is a self-review too, and a command with no model is not compared', () => {
  const same = project({ builder: 'claude-sonnet-5-5', judge: 'claude-sonnet-5-5', command: 'node --version' });
  assert.equal(call(same.run).selfReview, true);
  assert.equal(judgeCheck(same.box).status, 'warn');
  same.box.cleanup();
  const unnamed = project({ builder: 'claude-sonnet-5-5', command: 'node --version' });
  assert.ok(!('selfReview' in call(unnamed.run)));
  assert.equal(judgeCheck(unnamed.box).status, 'ok');
  unnamed.box.cleanup();
});

test('a loop judge is checked the same way', () => {
  const { box, run } = project({ builder: 'claude-sonnet-5-5', judge: 'claude-sonnet-5-5' });
  write(path.join(box.project, '.100x', 'loops', 'pass-1', 'ask.md'), '# ask\n');
  const loop = JSON.parse(run('review-call', '--json', '--loop', 'pass-1').out);
  assert.equal(loop.selfReview, true);
  assert.match(run('review-call', '--loop', 'pass-1').out, /self-review/);
  box.cleanup();
});

test('doctor reads the app\'s helper record: it warns when no recent helper ran the judge model, says ok when one did, and stays quiet with no record or a command judge', () => {
  const { box } = project({ builder: 'claude-sonnet-5-5', judge: 'muse-wonder-1.0' });
  const ranCheck = (logs) => JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: { ...box.env, X100_CURSOR_LOGS: logs } }).out).find((c) => c.name === 'judge ran');
  const now = Date.now();
  const stamp = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const folder = (name, blocks) => {
    const dir = path.join(box.dir, name);
    write(path.join(dir, 'a', 'b', 'c', 'cursor.hooks.workspaceId-1.log'), blocks.join('\n'));
    return dir;
  };
  const composerOnly = folder('composer', Array.from({ length: 6 }, (_, i) => startBlock(stamp(30 - i), `h${i}`, 'composer-2.5-fast')));
  const warned = ranCheck(composerOnly);
  assert.equal(warned.status, 'warn');
  assert.match(warned.detail, /lists 6 helpers from the last 24 hours: composer-2\.5-fast x6\. None ran muse-wonder-1\.0, the judge setting, so the app may be ignoring the model/);
  assert.match(warned.fix, /review\.command/);
  assert.match(warned.fix, /100x review-verify/);
  const mixed = folder('mixed', [startBlock(stamp(20), 'a', 'composer-2.5-fast'), startBlock(stamp(10), 'b', 'muse-wonder-1.0-xhigh')]);
  assert.equal(ranCheck(mixed).status, 'ok');
  assert.equal(ranCheck(''), undefined, 'no record, no check');
  assert.equal(ranCheck(path.join(box.dir, 'nothing-here')), undefined);
  cli(['config', 'set', 'review.command', 'node --version', '--global'], { cwd: box.project, env: box.env });
  assert.equal(ranCheck(composerOnly), undefined, 'a judge that runs as a command does not go through the app\'s helpers');
  box.cleanup();
});
