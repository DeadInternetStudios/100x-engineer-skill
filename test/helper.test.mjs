import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readReceipt, receiptBacks, receiptParams, receiptState } from '../lib/receipt.mjs';
import { sealFile, sealState } from '../lib/seal.mjs';
import { BIN, cli, ROOT, sandbox, write } from './helpers.mjs';

// A stand-in for @cursor/sdk. It keeps a catalog like the account's own, can be logged out, can report another model than the one
// asked for, can fail, and can hang until it is cancelled. Every call it gets is written to a file the test reads back.
const FAKE_SDK = `
const fs = require('node:fs');
const behavior = JSON.parse(process.env.FAKE_SDK_BEHAVIOR || '{}');
const note = (entry) => fs.appendFileSync(process.env.FAKE_SDK_LOG, JSON.stringify(entry) + '\\n');
const values = (...all) => all.map((value) => ({ value }));
const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const museVariants = ['300k', '1m'].flatMap((window) => efforts.map((effort) => ({ params: [{ id: 'context', value: window }, { id: 'reasoning_effort', value: effort }], displayName: 'Muse ' + window + ' ' + effort, isDefault: window === '1m' && effort === 'xhigh', isMaxMode: window === '1m' })));
const catalog = [
  { id: 'muse-wonder-1.0', parameters: [{ id: 'context', values: values('300k', '1m') }, { id: 'reasoning_effort', values: values(...efforts) }], variants: museVariants },
  { id: 'composer-2.5', parameters: [{ id: 'fast', values: values('false', 'true') }] },
  { id: 'turbo-1', parameters: [{ id: 'speed', values: values('std', 'turbo') }], variants: [{ params: [{ id: 'speed', value: 'std' }], displayName: 'Turbo std', isMaxMode: false }, { params: [{ id: 'speed', value: 'turbo' }], displayName: 'Turbo turbo', isMaxMode: true }] },
  { id: 'blind-ctx', parameters: [{ id: 'context', values: values('300k', '1m') }] },
  { id: 'gappy-1', parameters: [{ id: 'context', values: values('300k', '1m') }, { id: 'fast', values: values('false', 'true') }], variants: [{ params: [{ id: 'context', value: '300k' }, { id: 'fast', value: 'false' }], displayName: 'Gappy 300k', isMaxMode: false }, { params: [{ id: 'context', value: '1m' }, { id: 'fast', value: 'true' }], displayName: 'Gappy 1m fast', isMaxMode: true }] },
  { id: 'noflag-1', parameters: [{ id: 'context', values: values('300k', '1m') }], variants: [{ params: [{ id: 'context', value: '300k' }], displayName: 'Noflag 300k' }, { params: [{ id: 'context', value: '1m' }], displayName: 'Noflag 1m' }] },
  { id: 'noparams-1', parameters: [{ id: 'context', values: values('300k', '1m') }], variants: [{ displayName: 'Noparams' }] },
];
const expires = Date.UTC(2027, 1, 18);
exports.Cursor = {
  models: { list: async () => { if (behavior.loggedOut) { const error = new Error('Invalid API key'); error.name = 'AuthenticationError'; throw error; } return catalog; } },
  auth: {
    status: async () => (behavior.loggedOut ? { status: 'logged-out' } : { status: 'logged-in', email: 'owner@example.test', apiKeyExpiresAtMs: expires }),
    login: async ({ onLoginUrl }) => { note({ login: true }); onLoginUrl('https://example.test/login?code=abc'); return { apiKey: 'SECRET-KEY-DO-NOT-PRINT', email: 'owner@example.test', apiKeyExpiresAtMs: expires }; },
  },
};
exports.Agent = {
  create: async ({ model, local, disallowedTools }) => {
    note({ create: { model, cwd: local.cwd, disallowedTools } });
    return {
      agentId: 'agent-fake',
      send: async (task) => {
        note({ task });
        let cancelled = false;
        let release;
        const released = new Promise((resolve) => { release = resolve; });
        return {
          id: 'run-fake',
          supports: () => true,
          cancel: async () => { cancelled = true; release(); },
          async *stream() {
            yield { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } };
            if (behavior.hang) await released;
          },
          wait: async () => ({ status: cancelled ? 'cancelled' : behavior.status || 'finished', result: 'the answer', model: behavior.ran === undefined ? model : behavior.ran, durationMs: 1500, usage: { totalTokens: 42, reasoningTokens: 7 }, error: behavior.error ? { message: behavior.error } : undefined }),
        };
      },
      [Symbol.asyncDispose]: async () => note({ disposed: true }),
    };
  },
};
`;

function withSdk(behavior = {}) {
  const box = sandbox();
  const from = path.join(box.dir, 'fake-sdk');
  const log = path.join(box.dir, 'sdk-calls.jsonl');
  write(path.join(from, 'node_modules', '@cursor', 'sdk', 'package.json'), JSON.stringify({ name: '@cursor/sdk', version: '9.9.9', main: 'index.js' }));
  write(path.join(from, 'node_modules', '@cursor', 'sdk', 'index.js'), FAKE_SDK);
  const env = { ...box.env, X100_CURSOR_SDK_FROM: from, FAKE_SDK_BEHAVIOR: JSON.stringify(behavior), FAKE_SDK_LOG: log };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  const run = (args) => cli(['helper', ...args], { cwd: box.project, env });
  return { box, env, calls, run };
}

const readSha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const MUSE = ['run', '--model', 'muse-wonder-1.0', '--effort', 'max', '--context', '300k'];

test('a helper starts through the SDK on the model and parameters asked for, in the folder given, and the SDK result is printed', () => {
  const { box, calls, run } = withSdk();
  const taskFile = path.join(box.dir, 'task.md');
  write(taskFile, 'Judge the prototype.\nWrite findings.md.\n');
  const out = path.join(box.dir, 'answers', 'answer.txt');
  const result = run([...MUSE, '--task-file', taskFile, '--cwd', box.project, '--out', out]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /^helper finished\. 1\.5 s, 42 tokens\./);
  assert.match(result.out, /asked muse-wonder-1\.0 \(reasoning_effort max, context 300k\)/);
  assert.match(result.out, /ran {3}muse-wonder-1\.0 \(reasoning_effort max, context 300k\), as the SDK reports it/);
  assert.match(result.out, /agent agent-fake {2}run run-fake {2}answer /);
  assert.equal(fs.readFileSync(out, 'utf8'), 'the answer\n');
  const seen = calls();
  assert.deepEqual(seen[0], { create: { model: { id: 'muse-wonder-1.0', params: [{ id: 'reasoning_effort', value: 'max' }, { id: 'context', value: '300k' }] }, cwd: box.project, disallowedTools: ['task'] } });
  assert.deepEqual(seen[1], { task: 'Judge the prototype.\nWrite findings.md.\n' });
  assert.deepEqual(seen[2], { disposed: true });
  box.cleanup();
});

test('a model, parameter or value the account catalog does not list is refused before any helper starts', () => {
  const { box, calls, run } = withSdk();
  const refused = (args, pattern) => {
    const result = run([...args, '--task', 'x']);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, pattern, args.join(' '));
  };
  refused(['run', '--model', 'muse-wonder-1.0-max'], /muse-wonder-1\.0-max is not a model this account can use through the SDK\. The catalog has: muse-wonder-1\.0, composer-2\.5/);
  refused(['run', '--model', 'muse-wonder-1.0', '--effort', 'maximum'], /maximum is not a value of muse-wonder-1\.0 reasoning_effort\. Its values are minimal\|low\|medium\|high\|xhigh\|max/);
  refused(['run', '--model', 'muse-wonder-1.0', '--context', '2m'], /2m is not a value of muse-wonder-1\.0 context/);
  refused(['run', '--model', 'composer-2.5', '--effort', 'max'], /composer-2\.5 has no parameter for --effort/);
  refused(['run', '--model', 'muse-wonder-1.0', '--option', 'speed=fast'], /muse-wonder-1\.0 has no parameter speed/);
  refused(['run', '--model', 'muse-wonder-1.0', '--option', 'nonsense'], /--option takes <id>=<value>/);
  refused(['run', '--model', 'muse-wonder-1.0', '--effort', 'max', '--option', 'reasoning_effort=low'], /reasoning_effort was given twice/);
  assert.deepEqual(calls(), [], 'no helper was started');
  const fast = run(['run', '--model', 'composer-2.5', '--option', 'fast=true', '--task', 'x']);
  assert.equal(fast.code, 0, fast.err);
  assert.deepEqual(calls()[0].create.model, { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }] });
  box.cleanup();
});

test('a lock written in the delegate spellings, or in other case, is the same selection for helper run as for every other route', () => {
  const { box, env, calls, run } = withSdk();
  const config = (...args) => cli(['config', ...args], { cwd: box.project, env });
  cli(['init', '--no-git'], { cwd: box.project, env });
  for (const lock of ['muse-wonder-1.0 effort=max contextWindow=300k', 'muse-wonder-1.0 reasoning_effort=max contextWindow=300k', 'Muse-Wonder-1.0 Effort=MAX context_window=300K']) {
    assert.equal(config('set', 'helper.only', lock, '--global').code, 0, lock);
    assert.equal(run([...MUSE, '--task', 'x']).code, 0, `the locked selection runs under ${lock}`);
    const refused = run(['run', '--model', 'muse-wonder-1.0', '--effort', 'high', '--context', '300k', '--task', 'x']);
    assert.equal(refused.code, 1, lock);
    assert.match(refused.err, /Refused: helpers on this machine are locked to .* by helper\.only in the global config, and this asked for muse-wonder-1\.0 \(reasoning_effort high, context 300k\)/, lock);
  }
  assert.equal(calls().filter((call) => call.create).length, 3);
  box.cleanup();
});

test('a helper never starts in MAX mode: a selection that leaves the window open or names a MAX window is refused before anything starts', () => {
  const { box, calls, run } = withSdk();
  const refused = (args, pattern) => {
    const result = run([...args, '--task', 'x']);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, pattern, args.join(' '));
    assert.match(result.err, /A helper never starts in MAX mode\./, args.join(' '));
  };
  const open = /Refused: It names no context window, and the account's default for muse-wonder-1\.0 is a MAX mode variant\. A helper never starts in MAX mode\. Name a window that runs outside MAX mode, 300k, for example --context 300k\./;
  refused(['run', '--model', 'muse-wonder-1.0'], open);
  refused(['run', '--model', 'muse-wonder-1.0', '--effort', 'max'], open);
  refused(['run', '--model', 'muse-wonder-1.0', '--context', '1m', '--effort', 'max'], /The window asked for is a MAX mode variant of muse-wonder-1\.0\. A helper never starts in MAX mode\. Name a window that runs outside MAX mode, 300k, for example --context 300k\./);
  refused(['run', '--model', 'muse-wonder-1.0', '--option', 'context=1m', '--option', 'reasoning_effort=max'], /The window asked for is a MAX mode variant/);
  refused(['run', '--model', 'turbo-1', '--option', 'speed=turbo'], /Refused: This selection can run in MAX mode\. A helper never starts in MAX mode\. Variants that run outside MAX mode include speed=std\./);
  refused(['run', '--model', 'turbo-1'], /This selection can run in MAX mode\./);
  // A selection that matches no listed variant is refused too: the server would pick one, and nothing says it is not a MAX one.
  refused(['run', '--model', 'blind-ctx'], /Refused: The account's catalog lists no variants of blind-ctx, so nothing says its context window is not a MAX mode one\./);
  refused(['run', '--model', 'blind-ctx', '--context', '300k'], /Refused: The account's catalog lists no variants of blind-ctx/);
  refused(['run', '--model', 'gappy-1', '--context', '300k', '--option', 'fast=true'], /Refused: No listed variant of gappy-1 has those parameters, so which one would run is not known\. A helper never starts in MAX mode\. Variants that run outside MAX mode include context=300k fast=false\./);
  // Every 1m window is a MAX mode variant on this account, flagged or not, and a catalog entry of an unexpected shape is a refusal, not a crash.
  refused(['run', '--model', 'noflag-1', '--context', '1m'], /The window asked for is a MAX mode variant of noflag-1/);
  refused(['run', '--model', 'noparams-1', '--context', '300k'], /Refused: No listed variant of noparams-1 has those parameters/);
  refused(['run', '--model', 'gappy-1', '--option', 'fast=true'], /No listed variant of gappy-1 has those parameters|window asked for|names no context window/);
  assert.deepEqual(calls(), [], 'no helper was started');
  for (const args of [['run', '--model', 'turbo-1', '--option', 'speed=std'], ['run', '--model', 'gappy-1', '--context', '300k'], ['run', '--model', 'noflag-1', '--context', '300k'], ['run', '--model', 'muse-wonder-1.0', '--context', '300k']]) {
    const result = run([...args, '--task', 'x']);
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}`);
  }
  assert.deepEqual(calls().filter((call) => call.create).map((call) => call.create.model), [
    { id: 'turbo-1', params: [{ id: 'speed', value: 'std' }] },
    { id: 'gappy-1', params: [{ id: 'context', value: '300k' }] },
    { id: 'noflag-1', params: [{ id: 'context', value: '300k' }] },
    { id: 'muse-wonder-1.0', params: [{ id: 'context', value: '300k' }] },
  ]);
  assert.deepEqual([...new Set(calls().filter((call) => call.create).map((call) => JSON.stringify(call.create.disallowedTools)))], ['["task"]'], 'a helper cannot start a subagent of its own, which would run on a model nobody checked');
  box.cleanup();
});

test('helper.only locks every helper to one selection, a project file cannot set it, and nothing else starts', () => {
  const { box, env, calls, run } = withSdk();
  const config = (...args) => cli(['config', ...args], { cwd: box.project, env });
  const lock = 'muse-wonder-1.0 reasoning_effort=max context=300k';
  cli(['init', '--no-git'], { cwd: box.project, env });
  assert.equal(config('set', 'helper.only', lock, '--global').code, 0);
  assert.match(config('set', 'helper.only', 'composer-2.5', '--local').err, /helper\.only is the owner's limit on helpers, so it can only be set with --global/);
  write(path.join(box.project, '.100x', 'config.json'), JSON.stringify({ helper: { only: null, ceiling: 32 } }));
  assert.equal(config('get', 'helper.only').out.trim(), lock, 'a project file that clears the lock does not');
  assert.equal(run([...MUSE, '--task', 'x']).code, 0, 'the locked selection runs, in any order of its parameters');
  assert.equal(run(['run', '--model', 'muse-wonder-1.0', '--context', '300k', '--effort', 'max', '--task', 'x']).code, 0);
  for (const args of [['run', '--model', 'composer-2.5'], ['run', '--model', 'muse-wonder-1.0', '--effort', 'high', '--context', '300k'], ['run', '--model', 'muse-wonder-1.0', '--context', '300k']]) {
    const result = run([...args, '--task', 'x']);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, /Refused: helpers on this machine are locked to muse-wonder-1\.0 \(reasoning_effort max, context 300k\) by helper\.only in the global config/, args.join(' '));
  }
  assert.equal(calls().filter((call) => call.create).length, 2, 'only the two locked runs started a helper');
  // A project file that replaces the whole section with something that is not an object does not delete the lock either.
  for (const shape of ['"x"', 'null', '[]', '5', '{"only":"composer-2.5"}']) {
    fs.writeFileSync(path.join(box.project, '.100x', 'config.json'), `{"helper":${shape},"subagents":{"atOnce":32}}`);
    assert.equal(config('get', 'helper.only').out.trim(), lock, shape);
    assert.match(run(['run', '--model', 'composer-2.5', '--task', 'x']).err, /Refused: helpers on this machine are locked to/, shape);
  }
  fs.writeFileSync(path.join(box.project, '.100x', 'config.json'), '{"subagents":5}');
  assert.match(run(['run', '--model', 'composer-2.5', '--task', 'x']).err, /Refused: helpers on this machine are locked to/, 'a section set to a number');
  assert.equal(calls().filter((call) => call.create).length, 2, 'none of them started a helper');
  // A lock that cannot work is refused where it is set, not when the first helper is needed.
  for (const bad of ['muse-wonder-1.0 nonsense', '', '   ']) {
    const refused = config('set', 'helper.only', bad, '--global');
    assert.notEqual(refused.code, 0, JSON.stringify(bad));
    assert.match(refused.err, /helper\.only (must look like|is empty)/, JSON.stringify(bad));
  }
  assert.notEqual(config('set', 'helper.ceiling', '2.5', '--global').code, 0);
  assert.notEqual(config('set', 'subagents.atOnce', '6.5', '--global').code, 0);
  fs.rmSync(path.join(box.project, '.100x', 'config.json'));
  assert.equal(config('unset', 'helper.only', '--global').code, 0);
  assert.equal(run(['run', '--model', 'composer-2.5', '--task', 'x']).code, 0, 'the owner lifts it');
  box.cleanup();
});

test('a result that says MAX mode was on exits 3 even when the model and the parameters match', () => {
  const { box, run } = withSdk({ ran: { id: 'muse-wonder-1.0', params: [{ id: 'context', value: '300k' }, { id: 'reasoning_effort', value: 'max' }], maxMode: true } });
  const result = run([...MUSE, '--task', 'x']);
  assert.equal(result.code, 3, result.out);
  assert.match(result.out, /Not the model that was asked for: MAX mode was on\. This is not a run of the model that was chosen\./);
  assert.match(result.out, /ran {3}muse-wonder-1\.0 \(context 300k, reasoning_effort max\), MAX mode, as the SDK reports it/);
  box.cleanup();
});

test('the SDK reporting another model than the one asked for exits 3 and says it was not a run of that model', () => {
  for (const [ran, pattern] of [
    [{ id: 'composer-2.5' }, /Not the model that was asked for: model muse-wonder-1\.0 became composer-2\.5;/],
    [{ id: 'muse-wonder-1.0', params: [{ id: 'context', value: '300k' }, { id: 'reasoning_effort', value: 'low' }] }, /reasoning_effort max became low/],
    [{ id: 'muse-wonder-1.0', params: [{ id: 'context', value: '300k' }] }, /reasoning_effort max became not reported/],
  ]) {
    const { box, run } = withSdk({ ran });
    const result = run([...MUSE, '--task', 'x']);
    assert.equal(result.code, 3, result.out);
    assert.match(result.out, pattern);
    assert.match(result.out, /This is not a run of the model that was chosen\./);
    box.cleanup();
  }
  const { box, run } = withSdk({ ran: { id: 'muse-wonder-1.0', params: [{ id: 'context', value: '300k' }, { id: 'reasoning_effort', value: 'max' }, { id: 'fast', value: 'false' }] } });
  assert.equal(run([...MUSE, '--task', 'x']).code, 0, 'a parameter that was not asked for may be filled in by the server');
  box.cleanup();
});

test('a result with no model in it exits 0 and tells the agent to write that the model was not verified', () => {
  const { box, run } = withSdk({ ran: null });
  const result = run([...MUSE, '--task', 'x']);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /ran {3}not reported\n/);
  assert.match(result.out, /write "model not verified" wherever the model is recorded/);
  box.cleanup();
});

test('a helper that fails exits 2 with the reason, and one that outlives --minutes is cancelled at the deadline', () => {
  const failed = withSdk({ status: 'error', error: 'the model refused' });
  const result = failed.run([...MUSE, '--task', 'x']);
  assert.equal(result.code, 2);
  assert.match(result.out, /^helper error: the model refused\./);
  failed.box.cleanup();

  const slow = withSdk({ hang: true });
  const cut = slow.run([...MUSE, '--task', 'x', '--minutes', '0.001']);
  assert.equal(cut.code, 2, cut.out + cut.err);
  assert.match(cut.out, /^helper cancelled at the 0\.001 minute deadline\./);
  slow.box.cleanup();
});

test('--stream prints the helper text as it comes, and --json prints the whole result', () => {
  const { box, run } = withSdk();
  const streamed = run([...MUSE, '--task', 'x', '--stream']);
  assert.match(streamed.out, /^working\nhelper finished/);
  const json = JSON.parse(run([...MUSE, '--task', 'x', '--json']).out);
  assert.equal(json.status, 'finished');
  assert.equal(json.modelCheck, 'same');
  assert.equal(json.exitCode, 0);
  assert.equal(json.tokens, 42);
  assert.equal(json.reasoningTokens, 7);
  assert.deepEqual(json.ran.params, [{ id: 'reasoning_effort', value: 'max' }, { id: 'context', value: '300k' }]);
  box.cleanup();
});

test('a logged-out account is told the one command that fixes it, and login prints the link and never the key', () => {
  const out = withSdk({ loggedOut: true });
  const refused = out.run([...MUSE, '--task', 'x']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /The Cursor SDK has no valid login\. Run `100x helper login` once/);
  assert.deepEqual(out.calls(), [], 'no helper was started');
  const login = out.run(['login']);
  assert.equal(login.code, 0, login.err);
  assert.match(login.out, /https:\/\/example\.test\/login\?code=abc/);
  assert.match(login.out, /logged in as owner@example\.test\. The key expires 2027-02-18\./);
  assert.doesNotMatch(login.out + login.err, /SECRET-KEY-DO-NOT-PRINT/);
  out.box.cleanup();

  const inn = withSdk();
  const again = inn.run(['login']);
  assert.match(again.out, /already logged in as owner@example\.test\. The key expires 2027-02-18\./);
  assert.deepEqual(inn.calls(), [], 'no second login was started');
  assert.match(inn.run(['login', '--force']).out, /logged in as owner@example\.test/);
  assert.deepEqual(inn.calls(), [{ login: true }]);
  inn.box.cleanup();
});

test('models lists the ids with their parameters and values, as text or as JSON', () => {
  const { box, run } = withSdk();
  const text = run(['models']).out.split('\n');
  assert.equal(text[0], 'muse-wonder-1.0  context: 300k|1m  reasoning_effort: minimal|low|medium|high|xhigh|max');
  assert.equal(text[1], 'composer-2.5  fast: false|true');
  assert.deepEqual(JSON.parse(run(['models', '--json']).out).map((m) => m.id), ['muse-wonder-1.0', 'composer-2.5', 'turbo-1', 'blind-ctx', 'gappy-1', 'noflag-1', 'noparams-1']);
  box.cleanup();
});

test('with no SDK installed every command but setup says so and names the one that installs it, and setup knows when it is there', () => {
  const box = sandbox();
  const env = { ...box.env, X100_CURSOR_SDK_FROM: '' };
  for (const args of [['models'], ['login'], [...MUSE, '--task', 'x']]) {
    const result = cli(['helper', ...args], { cwd: box.project, env });
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, /The Cursor SDK is not installed\. Run `100x helper setup` once/);
  }
  box.cleanup();
  const { box: ready, run } = withSdk();
  assert.match(run(['setup']).out, /already available, @cursor\/sdk 9\.9\.9, not the 1\.4\.2 this was tested with\./);
  ready.cleanup();
});

test('the SDK is never loaded from the folder a helper works in, and a run says which SDK version it used', () => {
  const box = sandbox();
  const marker = path.join(box.dir, 'planted-ran.txt');
  write(path.join(box.project, 'node_modules', '@cursor', 'sdk', 'package.json'), JSON.stringify({ name: '@cursor/sdk', version: '0.0.1', main: 'index.js' }));
  write(path.join(box.project, 'node_modules', '@cursor', 'sdk', 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nexports.Agent = {};\nexports.Cursor = {};\n`);
  const env = { ...box.env, X100_CURSOR_SDK_FROM: '' };
  for (const args of [['models'], [...MUSE, '--task', 'x', '--cwd', box.project]]) {
    const result = cli(['helper', ...args], { cwd: box.project, env });
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, /The Cursor SDK is not installed\./, 'a package in the project is not the SDK');
  }
  assert.equal(fs.existsSync(marker), false, 'the planted package was never run');
  box.cleanup();

  const { box: ready, run } = withSdk();
  const text = run([...MUSE, '--task', 'say hi']).out;
  assert.match(text, /^sdk {3}@cursor\/sdk 9\.9\.9, not the 1\.4\.2 this was tested with$/m);
  assert.equal(JSON.parse(run([...MUSE, '--task', 'say hi', '--json']).out).sdkVersion, '9.9.9');
  ready.cleanup();
});

test('the instruction, the folder and the deadline are checked before anything starts', () => {
  const { box, calls, run } = withSdk();
  const refused = (args, pattern) => {
    const result = run([...MUSE, ...args]);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, pattern, args.join(' '));
  };
  refused([], /exactly one of --task <text> or --task-file <file>/);
  refused(['--task', 'x', '--task-file', 'y'], /exactly one of --task <text> or --task-file <file>/);
  refused(['--task', '  '], /The task is empty\./);
  refused(['--task-file', path.join(box.dir, 'nope.md')], /Cannot read the task file/);
  refused(['--task', 'x', '--cwd', path.join(box.dir, 'nope')], /is not a folder\./);
  refused(['--task', 'x', '--minutes', '0'], /--minutes takes a number above 0\./);
  const noModel = run(['run', '--task', 'x']);
  assert.equal(noModel.code, 1);
  assert.match(noModel.err, /--model <id> is required\./);
  assert.equal(run(['fly']).code, 1);
  assert.deepEqual(calls(), []);
  box.cleanup();
});

test('the command line in apps.md runs as written with the variables 100x review-run sets, and starts the helper on the model, effort and context window of the review setting', () => {
  const apps = fs.readFileSync(path.join(ROOT, 'skills', '100x', 'references', 'apps.md'), 'utf8');
  const section = apps.slice(apps.indexOf('### cursor\n'), apps.indexOf('### codex'));
  const line = section.match(/```sh\n(100x helper run [^\n]+)\n```/)?.[1];
  assert.ok(line, 'the cursor section holds a 100x helper run line');
  const { box, env, calls } = withSdk();
  const bin = path.join(box.dir, 'bin');
  write(path.join(bin, '100x'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} "$@"\n`);
  fs.chmodSync(path.join(bin, '100x'), 0o755);
  const run = (extra) => spawnSync('sh', ['-c', line], { cwd: box.project, encoding: 'utf8', env: { ...process.env, ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, X100_TASK: 'Judge it. Write findings.md.', ...extra } });
  const result = run({ X100_MODEL: 'muse-wonder-1.0', X100_EFFORT: 'max', X100_OPT_CONTEXTWINDOW: '300k' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /^working\nhelper finished\./);
  assert.deepEqual(calls()[0].create.model, { id: 'muse-wonder-1.0', params: [{ id: 'reasoning_effort', value: 'max' }, { id: 'context', value: '300k' }] });
  assert.equal(calls()[1].task, 'Judge it. Write findings.md.');
  assert.equal(fs.realpathSync(calls()[0].create.cwd), fs.realpathSync(box.project));
  const bare = run({ X100_MODEL: 'composer-2.5', X100_EFFORT: '', X100_OPT_CONTEXTWINDOW: '' });
  assert.equal(bare.status, 0, bare.stderr);
  assert.deepEqual(calls().filter((c) => c.create).at(-1).create.model, { id: 'composer-2.5' }, 'empty settings leave their flags out');
  box.cleanup();
});

test('--receipt keeps what the SDK reported in a file signed with this machine\'s key, and an edit to it, or a result with no model, is refused', () => {
  const { box, run } = withSdk();
  process.env.X100_HOME = box.env.X100_HOME;
  const file = path.join(box.dir, 'receipts', 'one.json');
  const result = run([...MUSE, '--task', 'x', '--receipt', file]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, new RegExp(`receipt ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(sealState(file), 'ok', 'signed where it was written');
  const { receipt, sha } = readReceipt(file);
  assert.equal(receipt.ran.id, 'muse-wonder-1.0');
  assert.equal(receipt.modelCheck, 'same');
  assert.equal(receipt.runId, 'run-fake');
  assert.equal(receipt.tokens, 42);
  assert.equal(receipt.sdkVersion, '9.9.9');
  assert.equal('text' in receipt, false, 'the helper\'s answer is not part of what the SDK vouched for');
  assert.deepEqual(receiptParams(receipt), { context: '300k', reasoning_effort: 'max' });
  assert.ok(receiptBacks(file, sha));
  // A receipt that is signed and is not the one the record names backs nothing, so a record cannot be pointed at another run's receipt.
  const signedOther = path.join(box.dir, 'receipts', 'two.json');
  fs.writeFileSync(signedOther, fs.readFileSync(file, 'utf8').replace('"max"', '"high"'));
  sealFile(signedOther);
  assert.equal(sealState(signedOther), 'ok');
  assert.equal(receiptBacks(signedOther, sha), false, 'a signed receipt that is not the one the record names backs nothing');

  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"max"', '"low"'));
  assert.throws(() => readReceipt(file), /not a receipt this machine's 100x wrote, or it was edited since/);
  assert.equal(receiptBacks(file, sha), false, 'an edited receipt backs nothing');
  const bare = path.join(box.dir, 'bare.json');
  write(bare, '{"version":1}\n');
  assert.throws(() => readReceipt(bare), /not a receipt this machine's 100x wrote/, 'a file made by hand has no signature');
  // An empty or garbled seal file is not a signature, so it does not lift a typed receipt to "signed on another machine".
  const typed = path.join(box.dir, 'receipts', 'typed.json');
  fs.copyFileSync(file, typed);
  const typedSha = crypto.createHash('sha256').update(fs.readFileSync(typed)).digest('hex');
  fs.writeFileSync(`${typed}.seal`, '');
  assert.equal(receiptState(typed, typedSha), 'typed');
  fs.writeFileSync(`${typed}.seal`, 'not a signature\n');
  assert.equal(receiptState(typed, typedSha), 'typed');
  fs.writeFileSync(`${typed}.seal`, `${'a'.repeat(64)}\n`);
  assert.equal(receiptState(typed, typedSha), 'other-machine', 'a well-formed seal this key does not verify reads as another machine\'s');
  assert.throws(() => readReceipt(path.join(box.dir, 'nothing.json')), /There is no receipt at/);
  box.cleanup();

  const silent = withSdk({ ran: null });
  process.env.X100_HOME = silent.box.env.X100_HOME;
  const none = path.join(silent.box.dir, 'none.json');
  const unreported = silent.run([...MUSE, '--task', 'x', '--receipt', none]);
  assert.equal(unreported.code, 0);
  assert.match(unreported.out, /A bake-off will not take this run's receipt\./);
  assert.throws(() => readReceipt(none), /the SDK reported no model that ran/);
  silent.box.cleanup();

  const wrong = withSdk({ ran: { id: 'composer-2.5' } });
  process.env.X100_HOME = wrong.box.env.X100_HOME;
  const other = path.join(wrong.box.dir, 'other.json');
  assert.equal(wrong.run([...MUSE, '--task', 'x', '--receipt', other]).code, 3);
  assert.equal(readReceipt(other).receipt.modelCheck, 'mismatch', 'a run on another model still leaves its receipt, and it says so');
  wrong.box.cleanup();

  const maxed = withSdk({ ran: { id: 'muse-wonder-1.0', params: [{ id: 'context', value: '300k' }, { id: 'reasoning_effort', value: 'max' }], maxMode: true } });
  process.env.X100_HOME = maxed.box.env.X100_HOME;
  const inMax = path.join(maxed.box.dir, 'max.json');
  assert.equal(maxed.run([...MUSE, '--task', 'x', '--receipt', inMax]).code, 3);
  assert.throws(() => readReceipt(inMax), /the SDK reported MAX mode or a 1m window for this run, and a helper never runs in MAX mode, so it cannot back a record/);
  assert.equal(receiptBacks(inMax, readSha(inMax)), false, 'the score path will not count it either, even though the seal is good');
  assert.equal(sealState(inMax), 'ok');
  maxed.box.cleanup();

  // A 1m window with no MAX flag in the result is MAX mode on this account, in either spelling of the option.
  for (const id of ['context', 'contextWindow']) {
    const oneM = withSdk({ ran: { id: 'muse-wonder-1.0', params: [{ id, value: '1m' }, { id: 'reasoning_effort', value: 'max' }] } });
    process.env.X100_HOME = oneM.box.env.X100_HOME;
    const file = path.join(oneM.box.dir, `1m-${id}.json`);
    oneM.run([...MUSE, '--task', 'x', '--receipt', file]);
    assert.throws(() => readReceipt(file), /a 1m window for this run/, id);
    assert.equal(receiptBacks(file, readSha(file)), false, id);
    oneM.box.cleanup();
  }

  // The window parameter's spelling does not matter, and settings that are not a list are refused instead of crashing the reader.
  const spelled = withSdk();
  process.env.X100_HOME = spelled.box.env.X100_HOME;
  const base = path.join(spelled.box.dir, 'base.json');
  assert.equal(spelled.run([...MUSE, '--task', 'x', '--receipt', base]).code, 0);
  const shaped = (name, params) => {
    const file = path.join(spelled.box.dir, `${name}.json`);
    const body = JSON.parse(fs.readFileSync(base, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...body, ran: { ...body.ran, params } }));
    sealFile(file);
    return file;
  };
  for (const id of ['ContextWindow', 'context_window', 'CONTEXTWINDOW', 'Context', ' context ']) {
    const file = shaped(`spelled-${id.trim()}`, [{ id, value: '1M' }, { id: 'reasoning_effort', value: 'max' }]);
    assert.throws(() => readReceipt(file), /a 1m window for this run/, id);
    assert.equal(receiptBacks(file, readSha(file)), false, id);
  }
  for (const [name, params] of [['million', [{ id: 'context', value: '1000k' }]], ['number', [{ id: 'context', value: 1000000 }]], ['unreadable', [{ id: 'context', value: 'huge' }]], ['object', { context: '300k' }], ['string', 'context=300k'], ['nameless', [{ value: '300k' }]], ['null-item', [null]]]) {
    const file = shaped(name, params);
    assert.throws(() => readReceipt(file), /not a list of id and value|a 1m window for this run/, name);
    assert.equal(receiptBacks(file, readSha(file)), false, name);
  }
  const fine = shaped('fine', [{ id: 'context', value: '300k' }, { id: 'reasoning_effort', value: 'max' }]);
  assert.equal(readReceipt(fine).receipt.ran.id, 'muse-wonder-1.0');
  assert.equal(receiptBacks(fine, readSha(fine)), true);
  spelled.box.cleanup();
});

test('a helper that ends inside a project is counted in .100x/helpers.jsonl and status adds the runs up, and a helper outside a project leaves no file', () => {
  const outside = withSdk();
  assert.equal(outside.run([...MUSE, '--task', 'x']).code, 0);
  assert.equal(fs.existsSync(path.join(outside.box.project, '.100x')), false, 'with no project there is no run to add a helper to');
  outside.box.cleanup();

  const { box, env, run } = withSdk();
  fs.mkdirSync(path.join(box.project, '.100x'));
  const first = run([...MUSE, '--task', 'x']);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /\nspent 1 helper run, 42 tokens, 0 minutes of helper time\.\n/);
  const second = run([...MUSE, '--task', 'y']);
  assert.match(second.out, /\nspent 2 helper runs, 84 tokens, 0 minutes of helper time\.\n/);
  const rows = fs.readFileSync(path.join(box.project, '.100x', 'helpers.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.model, row.status, row.tokens, row.agentId]), [['muse-wonder-1.0', 'finished', 42, 'agent-fake'], ['muse-wonder-1.0', 'finished', 42, 'agent-fake']]);
  const status = cli(['status'], { cwd: box.project, env });
  assert.match(status.out, /\nSpend {6}2 helper runs, 84 tokens, 0 minutes of helper time\./);
  box.cleanup();
});

test('budget.tokens stops the next helper once the total reaches it, says how to lift the cap, and a helper with no token count marks the total as a floor', () => {
  const { box, env, calls, run } = withSdk();
  fs.mkdirSync(path.join(box.project, '.100x'));
  assert.equal(cli(['config', 'set', 'budget.tokens', '50', '--local'], { cwd: box.project, env }).code, 0);
  assert.equal(cli(['config', 'set', 'budget.tokens', '0', '--local'], { cwd: box.project, env }).code, 1, 'a cap of 0 is not a number the setting takes');
  const one = run([...MUSE, '--task', 'x']);
  assert.equal(one.code, 0, one.err);
  assert.match(one.out, /spent 1 helper run, 42 tokens, 0 minutes of helper time\. Cap 50 tokens \(budget\.tokens\), 8 left\./);
  const two = run([...MUSE, '--task', 'y']);
  assert.equal(two.code, 0, 'a cap stops the next helper, not the one that is running');
  assert.match(two.out, /Cap 50 tokens \(budget\.tokens\), spent\./);
  const refused = run([...MUSE, '--task', 'z']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /The budget is spent: this run's helpers have used 84 tokens and budget\.tokens is 50\. No helper starts\. Raise it with `100x config set budget\.tokens <number> --local`, or take the cap off with `100x config unset budget\.tokens --local`\./);
  assert.equal(calls().filter((call) => call.create).length, 2, 'the refused helper never reached the SDK');
  assert.match(cli(['config'], { cwd: box.project, env }).out, /Helpers\. At most 1 at once\. A run stops starting helpers at 50 tokens\./);

  assert.equal(cli(['config', 'unset', 'budget.tokens', '--local'], { cwd: box.project, env }).code, 0);
  assert.equal(run([...MUSE, '--task', 'z']).code, 0, 'with the cap off a helper starts again');

  fs.appendFileSync(path.join(box.project, '.100x', 'helpers.jsonl'), `${JSON.stringify({ at: '2026-11-21T10:00:00Z', model: 'x', status: 'finished', seconds: 60, tokens: null, agentId: null })}\nnot json\n`);
  const status = cli(['status'], { cwd: box.project, env });
  assert.match(status.out, /Spend {6}4 helper runs, 126 tokens, 1 minute of helper time, and 1 helper reported no token count, so the total is a floor\./);
  box.cleanup();
});
