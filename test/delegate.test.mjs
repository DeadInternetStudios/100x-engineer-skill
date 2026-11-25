import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkCommand, checkTarget, cursorRoute } from '../lib/delegate.mjs';
import { hardCodesMax, lockedTarget, outsideLock, parseOnly } from '../lib/helper-lock.mjs';
import { cli, ROOT, sandbox, write } from './helpers.mjs';
import { makeProject } from './projects.mjs';

const LOCK = 'muse-wonder-1.0 reasoning_effort=max context=300k';
const muse = (options, providerInstanceId = 'cursor', model = 'muse-wonder-1.0') => ({ ...(providerInstanceId === undefined ? {} : { providerInstanceId }), model, options });

test('a 1m window is refused for Cursor in any spelling of the provider and for no provider, and left alone for another provider', () => {
  for (const provider of ['cursor', 'Cursor', ' cursor ', 'CURSOR-work', undefined, '']) {
    assert.throws(() => checkTarget(muse({ contextWindow: '1m' }, provider), 'judge'), /The judge is set to a 1m context window, which is MAX mode on Cursor/, JSON.stringify(provider));
  }
  assert.throws(() => checkTarget(muse({ context: ' 1M ' }), 'judge'), /1m context window/, 'the other option name, whitespace and case');
  const claude = muse({ contextWindow: '1m' }, 'claude', 'claude-opus');
  assert.equal(checkTarget(claude, 'judge'), claude, 'a provider that is not Cursor is not 100x to limit');
  assert.equal(checkTarget(null, 'judge'), null);
  assert.deepEqual(checkTarget(muse({ contextWindow: '300k' }), 'judge'), muse({ contextWindow: '300k' }));
});

test('with a lock a Cursor target must be the locked selection, and an empty target becomes it', () => {
  const only = { only: LOCK };
  const good = muse({ reasoning_effort: 'max', contextWindow: '300k' });
  assert.equal(checkTarget(good, 'judge', only), good);
  assert.equal(checkTarget(muse({ effort: 'MAX', context: '300k' }, 'cursor', 'Muse-Wonder-1.0'), 'judge', only).model, 'Muse-Wonder-1.0', 'the other spellings, and case');
  for (const wrong of [muse({ reasoning_effort: 'max', contextWindow: '300k' }, 'cursor', 'composer-2.5'), muse({ reasoning_effort: 'high', contextWindow: '300k' }), muse({ reasoning_effort: 'max' }), muse({})]) {
    assert.throws(() => checkTarget(wrong, 'overnight model', only), /The overnight model is .*, and helpers on this machine are locked to muse-wonder-1\.0 \(effort max, window 300k\) by helper\.only in the global config/, JSON.stringify(wrong));
  }
  assert.deepEqual(checkTarget({}, 'overnight model', only), { providerInstanceId: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' } }, 'a child that would follow the thread runs the locked selection');
  assert.deepEqual(checkTarget({}, 'overnight model'), {}, 'with no lock an empty target stays the thread');
  const other = muse({ reasoning_effort: 'high' }, 'claude', 'claude-opus');
  assert.equal(checkTarget(other, 'judge'), other, 'with no lock a provider that is not Cursor is not 100x to limit');
  assert.throws(() => checkTarget(other, 'judge', only), /The judge is claude-opus \(effort high\) on the provider "claude", and helpers on this machine are locked to muse-wonder-1\.0/, 'with a lock the lock is for every helper, whatever its provider');
  assert.deepEqual(checkTarget({ providerInstanceId: 'claude', options: {} }, 'overnight model', only).providerInstanceId, 'cursor', 'a child that would follow a thread on another provider runs the locked selection on Cursor');
});

test('the lock parses to a selection, refuses what cannot work, and compares in both spellings', () => {
  assert.deepEqual(parseOnly(LOCK), { id: 'muse-wonder-1.0', params: [{ id: 'reasoning_effort', value: 'max' }, { id: 'context', value: '300k' }] });
  for (const bad of ['', '   ', 'muse-wonder-1.0 max', 'muse-wonder-1.0=x']) assert.throws(() => parseOnly(bad), /helper\.only (must look like|is empty)/, JSON.stringify(bad));
  for (const bad of [null, 123, ['muse-wonder-1.0'], {}]) assert.throws(() => parseOnly(bad), /helper\.only must be a string/, JSON.stringify(bad));
  assert.throws(() => parseOnly('muse-wonder-1.0 reasoning_effort= context=300k'), /helper\.only gives reasoning_effort no value/);
  assert.throws(() => parseOnly('muse-wonder-1.0 reasoning_effort=max context=1m'), /helper\.only names a 1m context window, which is MAX mode on Cursor/);
  assert.throws(() => parseOnly('muse-wonder-1.0 context=300k contextWindow=1M'), /names the context window twice|names a 1m context window/);
  assert.throws(() => parseOnly('muse-wonder-1.0 reasoning_effort=max effort=low context=300k'), /names the effort twice/);
  assert.throws(() => parseOnly('muse-wonder-1.0 context=300k context=200k'), /names the context window twice/);
  assert.deepEqual(parseOnly('composer-2.5'), { id: 'composer-2.5', params: [] });
  assert.deepEqual(lockedTarget(LOCK).options, { reasoning_effort: 'max', contextWindow: '300k' });
  assert.equal(outsideLock(muse({ reasoning_effort: 'max', contextWindow: '300k' }), LOCK), null);
  assert.equal(outsideLock(muse({}), null), null);
});

test('a target that asks twice, in different spellings, is refused whichever spelling carries the 1m or the other effort', () => {
  const only = { only: LOCK };
  const dual = [{ context: '300k', contextWindow: '1m' }, { contextWindow: '300k', context: '1M' }, { context: '300k', ContextWindow: '1m' }, { contextWindow: '300k', context_window: '1m' }, { reasoning_effort: 'max', context: '300k', CONTEXT_WINDOW: ' 1m ' }];
  for (const options of dual) {
    assert.throws(() => checkTarget(muse(options), 'judge'), /1m context window, which is MAX mode on Cursor/, JSON.stringify(options));
    assert.throws(() => checkTarget(muse(options), 'judge', only), /1m context window/, JSON.stringify(options));
  }
  for (const options of [{ reasoning_effort: 'max', effort: 'low', context: '300k' }, { context: '300k', contextWindow: '200k' }]) {
    assert.throws(() => checkTarget(muse(options), 'judge'), /The judge sets its (effort|context window) twice, to /, JSON.stringify(options));
  }
  assert.equal(outsideLock(muse({ reasoning_effort: 'max', effort: 'low', context: '300k' }), LOCK) !== null, true, 'two efforts are not the locked one');
  const same = muse({ reasoning_effort: 'max', effort: 'MAX', contextWindow: '300k', context: '300k' });
  assert.equal(checkTarget(same, 'judge', only), same, 'the same value said twice is one value');
  const claude = muse({ context: '300k', contextWindow: '1m' }, 'claude', 'claude-opus');
  assert.equal(checkTarget(claude, 'judge'), claude, 'another provider is not 100x to limit without a lock');
  assert.throws(() => checkTarget(claude, 'judge', only), /locked to muse-wonder-1\.0/, 'and under a lock it is not the locked selection');
});

test('a target with no model becomes the locked selection whatever options it carries, and keeps its own provider spelling', () => {
  const locked = { model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' } };
  for (const target of [{ providerInstanceId: 'cursor', options: { reasoning_effort: 'high' } }, { providerInstanceId: 'cursor', options: { reasoning_effort: 'max', contextWindow: '300k' } }, { providerInstanceId: 'cursor', options: { effort: 'low' } }, { options: { contextWindow: '200k' } }]) {
    const got = checkTarget(target, 'overnight model', { only: LOCK });
    assert.deepEqual({ model: got.model, options: got.options }, locked, JSON.stringify(target));
  }
  assert.equal(checkTarget({ providerInstanceId: 'Cursor-work', options: { effort: 'low' } }, 'overnight model', { only: LOCK }).providerInstanceId, 'Cursor-work');
  assert.equal(checkTarget({ options: {} }, 'overnight model', { only: LOCK }).providerInstanceId, 'cursor');
  assert.throws(() => checkTarget({ providerInstanceId: 'cursor', options: { contextWindow: '1m' } }, 'overnight model', { only: LOCK }), /1m context window/);
  assert.deepEqual(checkTarget({ providerInstanceId: 'cursor', options: { effort: 'low' } }, 'overnight model'), { providerInstanceId: 'cursor', options: { effort: 'low' } }, 'with no lock it stays as asked');
});

test('a judge command that hard-codes 1m is refused on Cursor and left alone elsewhere', () => {
  for (const command of ['x helper run --context 1m', 'x --context=1M', 'x --context "1m"', "x --context  '1m' --y", 'x --context 1000k', 'x --context 10m', 'x --context 1000000', 'x "--context" 1m', "x '--context'='1m'", 'x --context${IFS}1m', 'x --context$IFS"1m"', 'x \\--context 1m', 'x --context 1m; true', '(x --context 1m)', 'x --context=1m;', "x --context $'1m'", 'x --context 1m && y', 'x --context 1m|y']) {
    for (const provider of ['cursor', 'Cursor', '', undefined]) assert.throws(() => checkCommand(command, provider, 'judge'), /The judge command passes --context 1m, which is MAX mode on Cursor, and a helper never starts in MAX mode\. Run `100x config unset review\.command --global` and set the SDK line from `100x ref apps`\./, `${command} ${provider}`);
    assert.doesNotThrow(() => checkCommand(command, 'claude', 'judge'), command);
  }
  for (const command of ['x --context 300k', 'x --context 200k', 'x --context "$W"', 'x ${X100_OPT_CONTEXTWINDOW:+--context "$X100_OPT_CONTEXTWINDOW"}', null, '']) assert.doesNotThrow(() => checkCommand(command, 'cursor', 'judge'), String(command));
});

test('the SDK line never prints a 1m window, and the JSON carries it next to the delegateTask', () => {
  assert.match(cursorRoute(muse({ reasoning_effort: 'max', contextWindow: '1m' })), /--effort max --context 300k --task-file/);
  assert.match(cursorRoute({}), /--model <model> --context 300k/);
  const box = sandbox();
  makeProject(box);
  assert.equal(cli(['config', 'role', 'review', '--provider', 'cursor', '--model', 'muse-wonder-1.0', '--option', 'reasoning_effort=max', '--option', 'contextWindow=300k', '--global'], { cwd: box.project, env: box.env }).code, 0);
  const call = JSON.parse(cli(['review-call', '--json'], { cwd: box.project, env: box.env }).out);
  assert.match(call.startInCursor, /^In Cursor the Task tool is not that tool, so never use it: run `100x helper run --model muse-wonder-1\.0 --effort max --context 300k --task-file <file> --cwd <folder>` with block_until_ms 0 instead\.$/);
  assert.equal('startInCursor' in call.delegateTask, false, 'the object an app takes unchanged is not altered');
  box.cleanup();
});

test('review-call, review-run and night next refuse a target outside the lock or on 1m, and review-run spawns nothing', async () => {
  const box = sandbox();
  makeProject(box);
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  assert.equal(run('config', 'set', 'helper.only', LOCK, '--global').code, 0);
  const stub = path.join(box.project, 'stub-judge.mjs');
  const spawned = path.join(box.project, 'spawned.txt');
  write(stub, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(spawned)}, process.env.X100_MODEL + '|' + process.env.X100_OPT_CONTEXTWINDOW);\n`);
  assert.equal(run('config', 'set', 'review.command', JSON.stringify(`"${process.execPath}" "${stub}"`), '--global').code, 0);
  const role = (name, model, window, effort = 'max') => run('config', 'role', name, '--provider', 'cursor', '--model', model, '--option', `reasoning_effort=${effort}`, '--option', `contextWindow=${window}`, '--global');
  // a command judge on 1m
  assert.equal(role('review', 'muse-wonder-1.0', '1m').code, 0);
  for (const args of [['review-call'], ['review-call', '--json'], ['review-run']]) {
    const refused = run(...args);
    assert.notEqual(refused.code, 0, args.join(' '));
    assert.match(refused.err, /The judge is set to a 1m context window, which is MAX mode on Cursor/, args.join(' '));
  }
  // a command judge on another model than the lock
  assert.equal(role('review', 'composer-2.5', '300k').code, 0);
  for (const args of [['review-call'], ['review-run']]) {
    const refused = run(...args);
    assert.notEqual(refused.code, 0, args.join(' '));
    assert.match(refused.err, /The judge is composer-2\.5 \(effort max, window 300k\), and helpers on this machine are locked to muse-wonder-1\.0/, args.join(' '));
  }
  assert.equal(fs.existsSync(spawned), false, 'no judge command was spawned');
  // the fallback judge
  assert.equal(role('review', 'muse-wonder-1.0', '300k').code, 0);
  assert.equal(run('config', 'role', 'fallback', '--provider', 'cursor', '--model', 'composer-2.5', '--option', 'reasoning_effort=max', '--option', 'contextWindow=300k', '--global').code, 0);
  assert.match(run('review-call').err, /The fallback judge is composer-2\.5/);
  assert.match(run('review-run', '--fallback').err, /The fallback judge is composer-2\.5/);
  assert.equal(run('config', 'role', 'fallback', '--clear', '--global').code, 0);
  // a child that would follow the thread runs the locked selection
  assert.equal(run('night', 'start', '--until', '+8h', '--brief', 'A tiny budget tracker').code, 0);
  const next = JSON.parse(run('night', 'next', '--json').out);
  assert.deepEqual(next.delegateTask.target, { providerInstanceId: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' } });
  assert.match(next.startInCursor, /--model muse-wonder-1\.0 --effort max --context 300k/);
  assert.equal(role('overnight', 'composer-2.5', '300k').code, 0);
  assert.match(run('night', 'next').err, /The overnight model is composer-2\.5/);
  // a command that hard-codes 1m is refused on Cursor whatever the role says, and nothing is spawned
  assert.equal(role('overnight', 'muse-wonder-1.0', '300k').code, 0);
  const plain = `"${process.execPath}" "${stub}"`;
  assert.equal(run('config', 'set', 'review.command', JSON.stringify(`${plain} --context 1m`), '--global').code, 0);
  for (const args of [['review-call'], ['review-call', '--json'], ['review-run']]) {
    const refused = run(...args);
    assert.notEqual(refused.code, 0, args.join(' '));
    assert.match(refused.err, /The judge command passes --context 1m, which is MAX mode on Cursor/, args.join(' '));
  }
  assert.equal(fs.existsSync(spawned), false, 'the command was not spawned');
  assert.equal(run('config', 'set', 'review.command', JSON.stringify(plain), '--global').code, 0);
  // and the locked selection starts the judge
  assert.equal(run('review-run').code, 0);
  // the judge runs on its own after the call returns: let it finish before its folder is deleted from under it
  const end = Date.now() + 15000;
  while (JSON.parse(run('review-run', '--status', '--json').out).state === 'running' && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(spawned), true, 'the locked selection started the judge');
  box.cleanup();
});

test('a provider is Cursor unless it is plainly another one, so a number, an object or a look-alike name gets the checks', () => {
  const lock = { only: LOCK };
  const bad = { reasoning_effort: 'max', contextWindow: '1m' };
  for (const provider of [123, { name: 'cursor' }, ['claude'], 'curs\u00ador', '\u0441ursor', 'my provider', '1cursorish', true]) {
    assert.throws(() => checkTarget({ providerInstanceId: provider, model: 'composer-2.5', options: bad }, 'overnight model'), /1m context window/, JSON.stringify(provider));
    assert.throws(() => checkTarget({ providerInstanceId: provider, model: 'composer-2.5', options: { reasoning_effort: 'max', contextWindow: '300k' } }, 'overnight model', lock), /locked to muse-wonder-1\.0/, JSON.stringify(provider));
  }
  for (const provider of ['claude', 'claudeAgent', 'codex', 'openai-compat', 'my.provider_2']) {
    const target = { providerInstanceId: provider, model: 'x', options: bad };
    assert.equal(checkTarget(target, 'judge'), target, provider);
    assert.throws(() => checkTarget(target, 'judge', lock), /locked to muse-wonder-1\.0/, provider);
  }
});

test('a window of a million tokens in any form, or one that is not a size, is refused, and so is a value that is not text', () => {
  const asked = (contextWindow) => ({ providerInstanceId: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow } });
  for (const window of ['1m', '1M', '1000k', '1000K', '1.0m', '1 m', '1m\u200b', '1\uFF4D', '\uFF11m', '1000000', '2m', '1,000k'.replace(',', ''), '1.5m']) {
    assert.throws(() => checkTarget(asked(window), 'judge'), /context window, which is MAX mode on Cursor|which is not a size/, JSON.stringify(window));
  }
  for (const window of ['1\u043c', 'huge', '300k!', '3 0 0 k x']) assert.throws(() => checkTarget(asked(window), 'judge'), /which is not a size 100x can read/, JSON.stringify(window));
  for (const window of ['300k', '300K', '200k', '300000', '999k', '0.5m']) assert.doesNotThrow(() => checkTarget(asked(window), 'judge'), window);
  for (const window of [1000000, 300000, ['300k'], { size: '300k' }, true]) assert.throws(() => checkTarget(asked(window), 'judge'), /as something other than text/, JSON.stringify(window));
  assert.throws(() => checkTarget({ providerInstanceId: 'cursor', model: ['muse-wonder-1.0'], options: {} }, 'judge'), /names its model as \["muse-wonder-1\.0"\], and a model is a text id/);
  assert.throws(() => checkTarget({ providerInstanceId: 'cursor', model: 5, options: {} }, 'judge', { only: LOCK }), /names its model as 5/);
  assert.throws(() => parseOnly('muse-wonder-1.0 reasoning_effort=max context=1000k'), /names a 1000k context window, which is MAX mode on Cursor/);
  assert.throws(() => parseOnly('muse-wonder-1.0 reasoning_effort=max context=big'), /names a big context window, which is not a size 100x can read/);
  assert.match(cursorRoute({ model: 'muse-wonder-1.0', options: { contextWindow: '1000k' } }), /--context 300k/, 'the printed line never carries a million-token window');
});

test('a lock that names a model alone holds a target to that model with no effort and no window, as helper run does', () => {
  const only = { only: 'muse-wonder-1.0' };
  const bare = { providerInstanceId: 'cursor', model: 'muse-wonder-1.0', options: {} };
  assert.equal(checkTarget(bare, 'judge', only), bare);
  for (const options of [{ reasoning_effort: 'low' }, { contextWindow: '200k' }, { effort: 'max', context: '300k' }]) {
    assert.throws(() => checkTarget({ ...bare, options }, 'judge', only), /locked to muse-wonder-1\.0 by helper\.only/, JSON.stringify(options));
  }
  const half = { only: 'muse-wonder-1.0 context=300k' };
  assert.equal(checkTarget({ ...bare, options: { contextWindow: '300k' } }, 'judge', half).model, 'muse-wonder-1.0');
  assert.throws(() => checkTarget({ ...bare, options: { contextWindow: '300k', reasoning_effort: 'low' } }, 'judge', half), /locked to muse-wonder-1\.0 \(window 300k\)/);
});

test('with a lock a judge that names no model is the locked selection, in review-call, review-run and config target, and the backup stays unset', () => {
  const box = sandbox();
  makeProject(box);
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  assert.equal(run('config', 'set', 'review.model', 'null', '--global').code, 0, 'no judge is chosen');
  assert.equal(JSON.parse(run('review-call', '--json').out).via, 'none');
  assert.equal(run('config', 'set', 'helper.only', LOCK, '--global').code, 0);
  const locked = { providerInstanceId: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' } };
  assert.deepEqual(JSON.parse(run('config', 'target', 'review').out), locked);
  assert.equal(run('config', 'target', 'fallback').out.trim(), 'null', 'no backup judge is set, and none is made up');
  const call = JSON.parse(run('review-call', '--json').out);
  assert.equal(call.via, 'harness');
  assert.deepEqual(call.delegateTask.target, locked);
  assert.match(call.startInCursor, /--model muse-wonder-1\.0 --effort max --context 300k/);
  assert.equal(call.selfReview, undefined, 'no builder is set, so it is not a review of itself');
  assert.equal(run('config', 'unset', 'helper.only', '--global').code, 0);
  assert.equal(JSON.parse(run('review-call', '--json').out).via, 'none', 'without a lock a judge that is not chosen stays not chosen');
  box.cleanup();
});

test('a refusal names the command that fixes it, with the role and the option the caller knows', () => {
  const only = { only: LOCK };
  assert.throws(() => checkTarget(muse({ contextWindow: '1m' }), 'judge', { role: 'review' }), /Run `100x config role review --model muse-wonder-1\.0 --option contextWindow=300k --global`\./);
  assert.throws(() => checkTarget(muse({ reasoning_effort: 'low' }), 'judge', { ...only, role: 'review' }), /`100x config role review --provider cursor --model muse-wonder-1\.0 --option reasoning_effort=max --option contextWindow=300k --global` sets it, or the owner lifts the lock with `100x config unset helper\.only --global`/);
  assert.throws(() => checkTarget(muse({ context: '300k', contextWindow: '200k' }), 'fallback judge', { role: 'fallback' }), /Keep one of context, contextWindow and remove the others with `100x config unset review\.fallbackOptions\.context` or `100x config unset review\.fallbackOptions\.contextWindow`, adding --global or --local/);
  assert.throws(() => checkTarget(muse({ effort: 'low', reasoning_effort: 'max' }), 'overnight model', { role: 'overnight' }), /`100x config unset overnight\.options\.effort` or `100x config unset overnight\.options\.reasoning_effort`/);
  assert.throws(() => checkTarget({ model: 'claude-opus-4', options: { context: '1m' } }, 'review role', { role: 'review' }), /If this model is not on Cursor, name its provider with `--provider <app>` and this check leaves it alone\./);
  assert.doesNotThrow(() => checkTarget({ providerInstanceId: 'claude', model: 'claude-opus-4', options: { context: '1m' } }, 'review role', { role: 'review' }), 'which is what naming the provider does');
});

test('no usage text, README or skill teaches a window of a million tokens as something to pass, except the one page that explains why it is refused', () => {
  const teach = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  const files = [path.join(ROOT, 'README.md'), ...walk(path.join(ROOT, 'skills')), ...walk(path.join(ROOT, 'lib', 'commands'))].filter((file) => /\.(md|mjs)$/.test(file) && !file.endsWith(path.join('references', 'apps.md')));
  for (const file of files) {
    for (const [at, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
      if (hardCodesMax(line) || /\b(context|contextWindow)=1m\b/i.test(line)) teach.push(`${path.relative(ROOT, file)}:${at + 1}`);
    }
  }
  assert.deepEqual(teach, []);
});

test('under a lock a judge command that names another model itself is refused, and one that reads the variable is not', () => {
  const only = { only: LOCK };
  for (const command of ['x --model other-model', 'x --model=other', 'x --model "composer-2.5" --y', "x '--model' composer-2.5", 'x --model other; y']) {
    assert.throws(() => checkCommand(command, 'cursor', 'judge', only), /The judge command names the model .* itself, and helpers on this machine are locked to muse-wonder-1\.0 by helper\.only in the global config\. Let it read \$X100_MODEL/, command);
    assert.throws(() => checkCommand(command, 'claude', 'judge', only), /locked to muse-wonder-1\.0/, `${command}: the lock is for every provider`);
    assert.doesNotThrow(() => checkCommand(command, 'claude', 'judge'), `${command}: with no lock another model is the owner's choice`);
  }
  for (const command of ['x --model "$X100_MODEL" --y', 'x --model muse-wonder-1.0', 'x --model Muse-Wonder-1.0', 'x --model ${X100_MODEL}', 'x', null]) assert.doesNotThrow(() => checkCommand(command, 'cursor', 'judge', only), String(command));
});

test('the provider is part of the locked selection: the locked model on another vendor, or on a provider that is not a name, is outside, and a child on one runs on Cursor', () => {
  const only = { only: LOCK };
  const locked = (providerInstanceId) => ({ providerInstanceId, model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' } });
  for (const provider of ['claude', 'codex', 'CURS0R', 123, { name: 'cursor' }, ['cursor']]) {
    assert.throws(() => checkTarget(locked(provider), 'judge', only), /is muse-wonder-1\.0 \(effort max, window 300k\) on the provider /, JSON.stringify(provider));
  }
  for (const provider of ['cursor', 'Cursor', 'cursor-work', undefined, null, '']) assert.doesNotThrow(() => checkTarget(locked(provider), 'judge', only), JSON.stringify(provider));
  for (const provider of [123, { name: 'cursor' }, ['claude'], 'claude']) {
    assert.equal(checkTarget({ providerInstanceId: provider, options: {} }, 'overnight model', only).providerInstanceId, 'cursor', `a child on ${JSON.stringify(provider)} follows nothing but the lock`);
  }
  assert.equal(checkTarget({ providerInstanceId: 'Cursor-work', options: {} }, 'overnight model', only).providerInstanceId, 'Cursor-work');
});
