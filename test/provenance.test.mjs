import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { baseModel, sameModel } from '../lib/models.mjs';
import { parseHelperStarts, recentHelpers, tally, verifyHelper } from '../lib/provenance.mjs';
import { cli, ROOT, sandbox, write } from './helpers.mjs';

// One block as Cursor writes it for a subagentStart hook, and one for a tool call the parser must skip.
const BANNER = '═'.repeat(87);
const startBlock = ({ at, id, toolCallId = id, model, task }) => `[${at}] ERROR: Hook 1 failed with exit code 1
${BANNER}
subagentStart
${BANNER}
Command: node "/x/hook.mjs"

INPUT:
${JSON.stringify({ conversation_id: 'c1', model, subagent_id: id, subagent_type: 'generalPurpose', task, tool_call_id: toolCallId, subagent_model: model, hook_event_name: 'subagentStart' }, null, 2)}

OUTPUT:
(empty)

`;
const noiseBlock = (at) => `[${at}] Hook step requested: postToolUse
INPUT:
${JSON.stringify({ hook_event_name: 'postToolUse', tool_name: 'Shell', tool_input: { command: 'ls' } }, null, 2)}

OUTPUT:
(empty)

`;

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

function logsFolder(box, blocks, name = 'cursor.hooks.workspaceId-abc.log') {
  const dir = path.join(box.dir, 'logs');
  write(path.join(dir, '20261120T180021', 'window1_wb6', 'output_1', name), blocks.join('\n'));
  return dir;
}

test('a model is the same model when only its effort or mode word differs, and not when its version does', () => {
  assert.equal(baseModel('claude-sonnet-5-5-max'), 'claude-sonnet-5-5');
  assert.equal(baseModel('Muse-Wonder-1.0-XHigh'), 'muse-wonder-1.0');
  assert.equal(baseModel('claude-opus-4-8-thinking-high[effort=high]'), 'claude-opus-4-8');
  assert.ok(sameModel('claude-sonnet-5-5', 'claude-sonnet-5-5-max'));
  assert.ok(sameModel('composer-2.5', 'composer-2.5-fast'));
  assert.ok(!sameModel('claude-sonnet-5', 'claude-sonnet-5-5'), 'a different version is a different model');
  assert.ok(!sameModel('muse-wonder-1.0', 'composer-2.5-fast'));
  assert.ok(!sameModel('', ''), 'two empty names are not the same model');
  assert.ok(!sameModel(null, 'claude-sonnet-5-5'));
});

test('a block copied from a real Cursor hooks log parses, and the two starts Cursor writes for one helper are one helper', () => {
  const starts = parseHelperStarts(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'cursor-hooks-sample.log'), 'utf8'));
  assert.equal(starts.length, 2);
  assert.deepEqual(starts.map((s) => s.model), ['composer-2.5-fast', 'composer-2.5-fast']);
  assert.equal(starts[0].toolCallId, starts[1].toolCallId);
  assert.match(starts[0].at, /^2026-11-20T18:26:39/);
  assert.match(starts[1].task, /Project folder\. \/Users\/owner\/projects\/demo/);
});

test('only subagentStart blocks count, a cut-off block is not an event, and the newest helper that names the project is the one checked', () => {
  const parsed = parseHelperStarts([
    noiseBlock('2026-11-20T10:00:00.000Z'),
    startBlock({ at: '2026-11-20T10:01:00.000Z', id: 'h1', model: 'composer-2.5-fast', task: 'Project folder. /work/a' }),
    startBlock({ at: '2026-11-20T10:02:00.000Z', id: 'h2', model: 'muse-wonder-1.0-xhigh', task: 'Project folder. /work/a' }),
    startBlock({ at: '2026-11-20T10:03:00.000Z', id: 'h3', model: 'composer-2.5-fast', task: 'Project folder. /work/b' }),
    `[2026-11-20T10:04:00.000Z] x\nINPUT:\n{ "hook_event_name": "subagentStart", "subagent_mod`,
  ].join('\n'));
  assert.deepEqual(parsed.map((s) => s.id), ['h1', 'h2', 'h3']);
  const asked = { requested: 'muse-wonder-1.0-xhigh', taskHas: '/work/a' };
  assert.equal(verifyHelper(parsed, asked).status, 'ok', 'h2 is the newest helper for /work/a');
  assert.equal(verifyHelper(parsed, { requested: 'muse-wonder-1.0-xhigh', taskHas: '/work/b' }).status, 'mismatch');
  assert.equal(verifyHelper(parsed, { requested: 'composer-2.5', taskHas: '/work/b' }).status, 'ok', 'the fast word does not make it another model');
  const none = verifyHelper(parsed, { requested: 'muse-wonder-1.0-xhigh', taskHas: '/work/c' });
  assert.equal(none.status, 'unknown');
  assert.match(none.why, /3 helpers are in the log and none was started with a task that names \/work\/c/);
  assert.equal(verifyHelper([], asked).status, 'unknown');
  assert.equal(verifyHelper([{ at: 'x', id: 'h', model: null, task: '' }], { requested: 'm' }).status, 'unknown', 'a helper with no model named is not a match');
});

test('recent helpers come from the newest hook logs inside the window, oldest first, and an empty folder setting turns the record off', () => {
  const box = sandbox();
  const logs = logsFolder(box, [
    startBlock({ at: minutesAgo(90), id: 'old', model: 'composer-2.5-fast', task: 't' }),
    startBlock({ at: minutesAgo(5), id: 'call-1', model: 'composer-2.5-fast', task: 't' }),
    startBlock({ at: minutesAgo(5), id: 'new-b', toolCallId: 'call-1', model: 'composer-2.5-fast', task: 't' }),
    startBlock({ at: minutesAgo(2), id: 'muse', model: 'muse-wonder-1.0-xhigh', task: 't' }),
  ]);
  const inHour = recentHelpers({ hours: 1, logsDir: logs });
  assert.deepEqual(inHour.map((h) => h.id), ['new-b', 'muse'], 'the two starts of one helper count once, and the old one is out of the window');
  assert.equal(tally(inHour), 'composer-2.5-fast x1, muse-wonder-1.0-xhigh x1');
  assert.equal(recentHelpers({ hours: 24, logsDir: logs }).length, 3);
  assert.deepEqual(recentHelpers({ hours: 24, logsDir: '' }), []);
  assert.deepEqual(recentHelpers({ hours: 24, logsDir: path.join(box.dir, 'no-such-folder') }), []);
  box.cleanup();
});

test('review-verify says mismatch and exits 1 when the app ran another model, and tells the agent not to write the model it asked for', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const logs = logsFolder(box, [startBlock({ at: minutesAgo(1), id: 'helper-1', model: 'composer-2.5-fast', task: `You are the judge. Project folder. ${box.project}` })]);
  const env = { ...box.env, X100_CURSOR_LOGS: logs };
  const result = cli(['review-verify', '--requested', 'muse-wonder-1.0-xhigh'], { cwd: box.project, env });
  assert.equal(result.code, 1);
  assert.match(result.out, /^mismatch\. You asked for muse-wonder-1\.0-xhigh\. The app ran composer-2\.5-fast\. Helper helper-1,/);
  assert.match(result.out, /Do not write muse-wonder-1\.0-xhigh as the model/);
  const json = JSON.parse(cli(['review-verify', '--requested', 'muse-wonder-1.0-xhigh', '--json'], { cwd: box.project, env }).out);
  assert.deepEqual([json.status, json.ran, json.id], ['mismatch', 'composer-2.5-fast', 'helper-1']);
  box.cleanup();
});

test('review-verify says ok for the model asked for, defaults to the judge in config, and exits 0', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  cli(['config', 'role', 'review', '--provider', 'cursor', '--model', 'muse-wonder-1.0', '--global'], { cwd: box.project, env: box.env });
  const logs = logsFolder(box, [startBlock({ at: minutesAgo(1), id: 'helper-9', model: 'muse-wonder-1.0-xhigh', task: `Project folder. ${box.project}` })]);
  const result = cli(['review-verify'], { cwd: box.project, env: { ...box.env, X100_CURSOR_LOGS: logs } });
  assert.equal(result.code, 0);
  assert.match(result.out, /^ok\. The app ran muse-wonder-1\.0-xhigh, the model you asked for \(muse-wonder-1\.0\)\. Helper helper-9,/);
  box.cleanup();
});

test('review-verify says unknown and exits 0 when no helper in the record is this project\'s, and when there is no record', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const logs = logsFolder(box, [startBlock({ at: minutesAgo(1), id: 'elsewhere', model: 'composer-2.5-fast', task: 'Project folder. /somewhere/else' })]);
  const other = cli(['review-verify', '--requested', 'muse-wonder-1.0-xhigh'], { cwd: box.project, env: { ...box.env, X100_CURSOR_LOGS: logs } });
  assert.equal(other.code, 0);
  assert.match(other.out, /^unknown\. 1 helpers are in the log and none was started with a task that names /);
  assert.match(other.out, /write in the review note that the model was not verified by the app/);
  const none = cli(['review-verify', '--requested', 'muse-wonder-1.0-xhigh'], { cwd: box.project, env: { ...box.env, X100_CURSOR_LOGS: '' } });
  assert.equal(none.code, 0);
  assert.match(none.out, /^unknown\. the log holds no helper start/);
  assert.match(none.out, /100x review-verify --setup/);
  const noModel = cli(['review-verify'], { cwd: box.project, env: { ...box.env, X100_CURSOR_LOGS: '' } });
  assert.equal(noModel.code, 1);
  assert.match(noModel.err, /Say which model you asked for with --requested/);
  box.cleanup();
});

test('review-verify --setup prints one hook that is valid JSON, and --list shows each helper with its model', () => {
  const box = sandbox();
  const setup = cli(['review-verify', '--setup'], { cwd: box.project, env: box.env });
  const hook = JSON.parse(setup.out.slice(setup.out.indexOf('{')));
  assert.deepEqual(hook.hooks.subagentStart, [{ command: 'true' }]);
  const logs = logsFolder(box, [startBlock({ at: minutesAgo(3), id: 'helper-a', model: 'composer-2.5-fast', task: 'one' }), startBlock({ at: minutesAgo(1), id: 'helper-b', model: 'muse-wonder-1.0-xhigh', task: 'two' })]);
  const list = cli(['review-verify', '--list'], { cwd: box.project, env: { ...box.env, X100_CURSOR_LOGS: logs } });
  assert.match(list.out, /composer-2\.5-fast\s+helper-a\s+one\n.*muse-wonder-1\.0-xhigh\s+helper-b\s+two/);
  assert.notEqual(cli(['review-verify', '--hours', 'soon'], { cwd: box.project, env: box.env }).code, 0);
  box.cleanup();
});
