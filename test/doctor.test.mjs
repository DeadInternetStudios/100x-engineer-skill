import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { helperCheck, judgeCheck, windowCheck, windowChecks } from '../lib/doctor.mjs';
import { cli, ROOT, sandbox, symlink, write } from './helpers.mjs';

test('doctor on an empty machine fails on the missing home and says how to fix it', () => {
  const box = sandbox();
  const result = cli(['doctor', '--json'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 1);
  const checks = JSON.parse(result.out);
  const home = checks.find((c) => c.name === 'home');
  assert.equal(home.status, 'fail');
  assert.match(home.fix, /install\.sh/);
  assert.equal(checks.find((c) => c.name === 'node').status, 'ok');
  box.cleanup();
});

test('help lists every command and version prints', () => {
  const help = cli(['help']);
  for (const name of ['init', 'config', 'log', 'doctor', 'validate']) assert.match(help.out, new RegExp(`\\b${name}\\b`));
  assert.match(cli(['version']).out, /^\d+\.\d+\.\d+/);
  assert.notEqual(cli(['nonsense']).code, 0);
});

test('the version a bug report can name is the package number and the commit the install is at, in version and in doctor', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const line = cli(['version']).out.trim();
  const number = version.replaceAll('.', '\\.');
  // A throwaway copy of the tree, as the planted-bug script makes, has no .git, and then the number stands alone.
  if (fs.existsSync(path.join(ROOT, '.git'))) assert.match(line, new RegExp(`^${number} \\(commit [0-9a-f]{7,}(, with uncommitted changes)?\\)$`), 'a git checkout names its commit');
  else assert.equal(line, version, 'a copy with no git history says the number only');
  const box = sandbox();
  const check = JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: box.env }).out).find((c) => c.name === '100x');
  assert.equal(check.status, 'ok');
  assert.equal(check.detail, line, 'doctor says the same thing');
  box.cleanup();
});

test('doctor tells the owner to call the 100x-setup skill, which exists, and not to run it as a command, when the judge command is missing', () => {
  const box = sandbox();
  cli(['config', 'set', 'review.command', 'no-such-judge-tool --print', '--global'], { cwd: box.project, env: box.env });
  const judge = JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: box.env }).out).find((c) => c.name === 'judge');
  assert.equal(judge.status, 'warn');
  assert.match(judge.fix, /call 100x-setup and change the judge/);
  assert.doesNotMatch(judge.fix, /run 100x-setup/, 'a skill is called, it is not a shell command');
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', '100x-setup', 'SKILL.md')), 'the skill the fix names is in this repo');
  box.cleanup();
});

test('doctor warns when the linked companion skill is a different build than the copy 100x runs, and not when it is the same build', () => {
  const box = sandbox();
  const skills = path.join(box.home, '.agents', 'skills');
  fs.mkdirSync(skills, { recursive: true });
  const checkout = path.join(box.dir, 'checkout', 'unslop-text');
  fs.cpSync(path.join(ROOT, 'vendor', 'unslop-text'), checkout, { recursive: true });
  symlink(checkout, path.join(skills, 'unslop-text'));
  const check = () => JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: box.env }).out).find((c) => c.name === 'skill unslop-text');
  const same = check();
  assert.equal(same.status, 'ok');
  assert.match(same.detail ?? same.message ?? '', /the same build as the pinned copy/);
  fs.appendFileSync(path.join(checkout, 'SKILL.md'), '\nA newer line.\n');
  const differs = check();
  assert.equal(differs.status, 'warn');
  assert.match(differs.detail ?? differs.message ?? '', /a checkout that differs from the pinned copy/);
  assert.match(differs.fix, /`100x text` runs the pinned copy and an agent that follows the skill runs this checkout/);
  box.cleanup();
});

test('doctor warns about a link an older install made to a skill this repo dropped, and install clears it', () => {
  const box = sandbox();
  assert.equal(cli(['install', '--no-bin'], { env: box.env }).code, 0);
  const skills = path.join(box.home, '.agents', 'skills');
  const manifestFile = path.join(box.home, '.100x', 'install.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const gone = path.join(ROOT, 'vendor', 'dropped-companion');
  const link = path.join(skills, 'dropped-companion');
  symlink(gone, link);
  // Not stale: the owner's own link, to a folder outside this repo that is missing. It is not 100x's to judge.
  const theirs = path.join(skills, 'my-own-skill');
  symlink(path.join(box.dir, 'nowhere'), theirs);
  manifest.links.push({ path: link, target: gone }, { path: theirs, target: path.join(box.dir, 'nowhere') });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const check = () => JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: box.env }).out).find((c) => c.name === 'old links');
  const found = check();
  assert.equal(found.status, 'warn');
  assert.ok((found.detail ?? found.message ?? '').includes(link), 'it names the link');
  assert.ok(!(found.detail ?? found.message ?? '').includes('my-own-skill'), 'it leaves the owner link alone');
  assert.match(found.fix, /Run `100x install`\. It removes the link and puts back the one you had made/);
  assert.equal(cli(['install', '--no-bin'], { env: box.env }).code, 0);
  assert.equal(check(), undefined, 'after the install there is nothing to warn about');
  box.cleanup();
});

test('a damaged install record is a warning with the fix, not a crash, in doctor and in install', () => {
  const box = sandbox();
  assert.equal(cli(['install', '--no-bin'], { env: box.env }).code, 0);
  const manifestFile = path.join(box.home, '.100x', 'install.json');
  for (const damaged of ['{"links":"oops"}', '{"links":["a string"]}', '{"links":[{"path":"a","target":"b","replaced":123}]}', '{"files":[{"path":"a","sha256":7}]}', '{not json']) {
    fs.writeFileSync(manifestFile, damaged);
    const result = cli(['doctor', '--json'], { cwd: box.project, env: box.env });
    const found = JSON.parse(result.out).find((c) => c.name === 'install record');
    assert.equal(found?.status, 'warn', `${damaged}. ${result.out.slice(0, 200)}${result.err}`);
    assert.match(found.fix, /Run `100x install`\. It writes a new one/);
    const undone = cli(['install', '--uninstall', '--no-bin'], { env: box.env });
    assert.equal(undone.code, 0, `uninstall with ${damaged}. ${undone.out}${undone.err}`);
    const again = cli(['install', '--no-bin'], { env: box.env });
    assert.equal(again.code, 0, `${damaged}. ${again.out}${again.err}`);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).links.length > 0, true, 'install wrote a new record');
  box.cleanup();
});

test('the doctor counts every helper in the hooks log before it caps what it tallies, and says so', () => {
  const review = { enabled: true, model: 'muse-wonder-1.0' };
  const helpers = Array.from({ length: 25 }, () => ({ model: 'composer-2.5-fast' }));
  const [name, status, detail] = helperCheck(review, helpers);
  assert.equal(name, 'judge ran');
  assert.equal(status, 'warn');
  assert.match(detail, /the app's hooks log lists 25 helpers from the last 24 hours, and the last 20 are counted here: composer-2\.5-fast x20\. None ran muse-wonder-1\.0/);
  const few = helperCheck(review, helpers.slice(0, 3))[2];
  assert.match(few, /lists 3 helpers from the last 24 hours: composer-2\.5-fast x3\./, 'under the cap there is nothing to explain');
  assert.equal(helperCheck(review, [{ model: 'muse-wonder-1.0' }])[1], 'ok');
  assert.equal(helperCheck({ ...review, command: 'x' }, helpers), null, 'a judge started by a command is not read from the app log');
});

test('a judge command that is also the builder reads as one sentence', () => {
  const [, status, detail] = judgeCheck({ enabled: true, command: 'node', model: 'claude-sonnet-5-5' }, 'claude-sonnet-5-5');
  assert.equal(status, 'warn');
  assert.match(detail, /^a command, node, model claude-sonnet-5-5\. It is also the model that builds, so its review is a self-review$/);
});

test('the window check fails a 1m window in any spelling, fails a command that passes 1m, warns on no window where Cursor picks one, and is quiet otherwise', () => {
  const sdk = '100x helper run --model "$X100_MODEL" ${X100_OPT_CONTEXTWINDOW:+--context "$X100_OPT_CONTEXTWINDOW"} --task "$X100_TASK"';
  const on = { provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '300k' }, command: sdk };
  assert.equal(windowCheck('judge', on), null);
  assert.equal(windowCheck('judge', { ...on, model: null }), null);
  assert.equal(windowCheck('judge', { provider: null, model: 'composer-2.5', options: { effort: 'max' }, command: null }), null, 'an app that does not pick a Cursor window has none to check');
  for (const window of ['1m', '1M', ' 1m ']) {
    const row = windowCheck('judge', { ...on, options: { contextWindow: window } });
    assert.deepEqual(row.slice(0, 2), ['judge window', 'fail'], window);
    assert.match(row[2], /asks for a 1m context window, which is MAX mode on Cursor/);
    assert.match(row[3], /contextWindow=300k/);
  }
  assert.equal(windowCheck('judge', { ...on, options: { context: '1m' } })[1], 'fail', 'the other spelling of the option');
  assert.match(windowCheck('judge', { ...on, command: '100x helper run --model x --context 1m --task y' })[2], /command passes --context 1m/);
  assert.match(windowCheck('judge', { ...on, command: '100x helper run --context=1m' })[2], /command passes --context 1m/);
  assert.match(windowCheck('judge', { ...on, options: { effort: 'max', contextWindow: null } })[2], /takes its window from the setting, and the setting has none, so `100x helper run` refuses it as MAX mode/);
  assert.match(windowCheck('judge', { ...on, command: '100x helper run --model "$X100_MODEL" --effort "$X100_EFFORT" --task "$X100_TASK"' })[2], /command never passes a context window, so `100x helper run` refuses it as MAX mode/, 'a 300k setting does not help a command that drops it');
  assert.equal(windowCheck('judge', { ...on, options: {}, command: '100x helper run --model x --context 300k --task y' }), null, 'a literal window needs no setting');
  assert.match(windowCheck('overnight', { provider: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max' }, command: null })[2], /names no context window on provider cursor/);
});

test('every helper role is checked, the fallback judge and the overnight and quick children as well as the judge', () => {
  const effective = {
    review: { provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '300k' }, fallbackModel: 'muse-wonder-1.0', fallbackOptions: { contextWindow: '1m' }, command: null },
    overnight: { provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '1m' } },
    quick: { provider: null, model: null, options: {} },
  };
  assert.deepEqual(windowChecks(effective).map((row) => row.slice(0, 2)), [['fallback judge window', 'fail'], ['overnight window', 'fail']]);
});

test('the window check reads a command with no model set, wants the variable review-run really sets, and leaves a switched-off judge and another provider alone', () => {
  const sdk = '100x helper run --task "$X100_TASK"';
  assert.match(windowCheck('judge', { provider: null, model: null, options: {}, command: `${sdk} --context 1m` })[2], /command passes --context 1m/, 'a hard-coded 1m with no model set');
  assert.match(windowCheck('judge', { provider: null, model: null, options: {}, command: sdk })[2], /never passes a context window/, 'an SDK command with no model and no window');
  assert.equal(windowCheck('judge', { provider: null, model: null, options: {}, command: 'claude -p "$X100_TASK"' }), null, 'a command that is not the SDK helper is not this check');
  const wrongVariable = windowCheck('judge', { provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '300k' }, command: '100x helper run ${X100_OPT_CONTEXT:+--context "$X100_OPT_CONTEXT"} --task "$X100_TASK"' });
  assert.match(wrongVariable[2], /reads \$X100_OPT_CONTEXT, and review-run sets \$X100_OPT_CONTEXTWINDOW for this role, so it expands to nothing/);
  assert.equal(windowCheck('judge', { provider: 'cursor', model: 'muse-wonder-1.0', options: { context: '300k' }, command: '100x helper run ${X100_OPT_CONTEXT:+--context "$X100_OPT_CONTEXT"} --task "$X100_TASK"' }), null, 'the variable that matches the option key the role carries');
  assert.equal(windowCheck('judge', { provider: 'claude', model: 'claude-opus', options: { contextWindow: '1m' }, command: null }), null, 'a 1m window on a provider that is not Cursor is not MAX mode on Cursor');
  assert.equal(windowCheck('judge', { provider: null, model: 'composer-2.5', options: { contextWindow: '1m' }, command: null })[1], 'fail', 'a role with no provider might be Cursor');
  const off = { review: { enabled: false, provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '1m' }, fallbackModel: null, fallbackOptions: {}, command: null }, overnight: { provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '1m' } }, quick: {} };
  assert.deepEqual(windowChecks(off).map((row) => row[0]), ['overnight window'], 'a judge that never starts has no window problem, the children still do');
  const shared = { review: { enabled: true, provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '300k' }, fallbackModel: null, fallbackOptions: {}, command: `${sdk} --context 1m` }, overnight: {}, quick: {} };
  assert.equal(windowChecks(shared).length, 1, 'a shared command is reported once, not once for a fallback that is not set');
});

test('doctor checks the judge and the overnight child against the lock, and a hard-coded 1m only where it could be Cursor', () => {
  const only = 'muse-wonder-1.0 reasoning_effort=max context=300k';
  const role = (model, options = { reasoning_effort: 'max', contextWindow: '300k' }, provider = 'cursor') => ({ provider, model, options });
  const effective = (extra = {}) => ({ review: { enabled: true, ...role('muse-wonder-1.0'), fallbackModel: null, fallbackOptions: {}, command: null }, overnight: role('muse-wonder-1.0'), quick: {}, helper: { only }, ...extra });
  assert.deepEqual(windowChecks(effective()), []);
  assert.deepEqual(windowChecks(effective({ helper: {} })), []);
  const wrong = effective({ overnight: role('composer-2.5'), quick: role('composer-2.5'), review: { enabled: true, ...role('composer-2.5'), fallbackModel: 'muse-wonder-1.0', fallbackOptions: { reasoning_effort: 'high', contextWindow: '300k' }, command: null } });
  const rows = windowChecks(wrong);
  assert.deepEqual(rows.map((row) => row.slice(0, 2)), [['judge lock', 'fail'], ['fallback judge lock', 'fail'], ['overnight lock', 'fail']], 'the quick jobs are the thread, not a helper');
  assert.match(rows[0][2], /the judge is composer-2\.5 \(effort max, window 300k\), and helpers on this machine are locked to muse-wonder-1\.0/);
  assert.deepEqual(windowChecks(effective({ overnight: role(null) })), [], 'a child with no model becomes the locked selection');
  assert.deepEqual(windowChecks(effective({ overnight: role('composer-2.5', {}, 'claude') })).map((row) => row.slice(0, 2)), [['overnight lock', 'fail']], 'the lock is for every helper, whatever its provider');
  assert.deepEqual(windowChecks(effective({ helper: {}, overnight: role('composer-2.5', {}, 'claude') })), [], 'with no lock a provider that is not Cursor is left alone');
  assert.match(windowChecks(wrong)[0][3], /Run `100x config role review --provider cursor --model muse-wonder-1\.0 --option reasoning_effort=max --option contextWindow=300k --global`, or lift the lock with `100x config unset helper\.only --global`\./);
  assert.deepEqual(windowChecks(effective({ helper: { only: 'not a lock' } })), [], 'a lock that does not parse has its own row');
  assert.equal(windowCheck('overnight', { provider: 'Cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max' }, command: null })[1], 'warn', 'a capitalised Cursor has no window to pick either');
  assert.equal(windowCheck('judge', { provider: 'cursor', model: 'muse-wonder-1.0', options: { context: '300k', ContextWindow: '1m' }, command: null })[1], 'fail', 'a 1m under another spelling');
  for (const window of ['1000k', 1000000, 'huge', ['300k']]) assert.equal(windowCheck('judge', { provider: 123, model: 'muse-wonder-1.0', options: { contextWindow: window }, command: null })?.[1], 'fail', `${JSON.stringify(window)} on a provider that might be Cursor`);
  const command = '100x helper run --model x --context 1m --task y';
  assert.equal(windowCheck('judge', { provider: 'claude', model: 'claude-opus', options: {}, command: 'claude --context 1m' }), null, 'a hard-coded 1m on another provider is not MAX mode on Cursor');
  assert.match(windowCheck('judge', { provider: 'cursor', model: 'muse-wonder-1.0', options: { context: '300k' }, command })[2], /command passes --context 1m/);
  const wanted = windowCheck('judge', { provider: 'cursor', model: 'muse-wonder-1.0', options: { context_window: '300k' }, command: '100x helper run ${X100_OPT_CONTEXT_WINDOW:+--context "$X100_OPT_CONTEXT_WINDOW"} --task "$X100_TASK"' });
  assert.equal(wanted, null, 'the variable review-run sets for an option with an underscore');
});

test('doctor says a lock it cannot parse once, as a fail, and an ok lock as an ok, with the ceiling', () => {
  const rows = (only, ceiling = null) => {
    const box = sandbox();
    write(path.join(box.home, '.100x', 'config.json'), JSON.stringify({ helper: { only, ceiling } }));
    try {
      return JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: box.env }).out).filter((row) => row.name === 'helper limits');
    } finally {
      box.cleanup();
    }
  };
  for (const bad of ['muse-wonder-1.0 nonsense', 123, 'muse-wonder-1.0 reasoning_effort= context=300k', 'muse-wonder-1.0 context=1m']) {
    const found = rows(bad, 6);
    assert.deepEqual(found.map((row) => row.status), ['fail'], JSON.stringify(bad));
  }
  const good = rows('muse-wonder-1.0 reasoning_effort=max context=300k', 6);
  assert.deepEqual(good.map((row) => row.status), ['ok']);
  assert.match(good[0].detail, /locked to muse-wonder-1\.0 reasoning_effort=max context=300k, a ceiling of 6 on the helpers a night or a run asks for at once/);
});

test('doctor names the locked judge when none is set, fails a command that names another model, and gives fixes with the role and the model filled in', () => {
  const only = 'muse-wonder-1.0 reasoning_effort=max context=300k';
  const bare = { enabled: true, provider: null, model: null, options: {}, command: null, fallbackModel: null, fallbackOptions: {} };
  assert.deepEqual(judgeCheck(bare, null).slice(0, 2), ['judge', 'warn'], 'with no lock a judge that is not chosen is a warning');
  const named = judgeCheck(bare, null, only);
  assert.deepEqual(named.slice(0, 2), ['judge', 'ok']);
  assert.match(named[2], /none named, so the locked selection, muse-wonder-1\.0/);
  assert.deepEqual(judgeCheck(bare, null, 'not a lock').slice(0, 2), ['judge', 'warn'], 'a lock that does not parse has its own row');
  const effective = (command) => ({ review: { ...bare, provider: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' }, command }, overnight: {}, quick: {}, helper: { only } });
  assert.deepEqual(windowChecks(effective('x helper run --model "$X100_MODEL" --context 300k')), []);
  const rows = windowChecks(effective('x --model other-model --context 300k'));
  assert.deepEqual(rows.map((row) => row.slice(0, 2)), [['judge lock', 'fail']]);
  assert.match(rows[0][2], /the judge command names the model other-model itself, and helpers on this machine are locked to muse-wonder-1\.0/);
  assert.deepEqual(windowChecks({ ...effective(null), helper: {} }), [], 'with no lock a command may name its own model');
  assert.match(windowCheck('judge', { provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '1m' }, command: null })[3], /^Run `100x config role review --model muse-wonder-1\.0 --option contextWindow=300k --global`\.$/);
  assert.match(windowCheck('overnight', { provider: 'cursor', model: 'muse-wonder-1.0', options: { contextWindow: '1m' }, command: null })[3], /^Run `100x config role overnight --model muse-wonder-1\.0 /);
  assert.match(windowCheck('fallback judge', { provider: 'cursor', model: 'composer-2.5', options: { contextWindow: '1m' }, command: null })[3], /^Run `100x config role fallback --model composer-2\.5 /);
});
