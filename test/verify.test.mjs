import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkLedger, hashCovers, readLedger } from '../lib/verify.mjs';
import { cli, ROOT, sandbox, write } from './helpers.mjs';

const CHECKER = path.join(ROOT, 'skills', '100x', 'assets', 'property-checker.mjs');
const sh = (cwd, command) => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8' });
const verify = (box, ...args) => cli(['verify', '--root', box.project, ...args], { cwd: box.project, env: box.env });
const RED = 'FAIL  guard:pay. the model forbids pay(3) but the implementation accepted it\n';

function project() {
  const box = sandbox();
  fs.mkdirSync(path.join(box.project, 'verify'), { recursive: true });
  fs.copyFileSync(CHECKER, path.join(box.project, 'verify', 'check.mjs'));
  const add = (extra = []) => verify(box, 'add', 'order-money', '--kind', 'invariant', '--property', 'Refunded never exceeds paid and paid never exceeds the total', '--covers', 'verify/check.mjs', '--command', 'node verify/check.mjs', '--level', 'exhaustive', ...extra);
  return { box, add };
}

test('a property is unchecked until it runs, unproven until it has failed once, and holds only then', () => {
  const { box, add } = project();
  assert.equal(add().code, 0, add().err);
  assert.match(verify(box, 'status').out, /^unchecked +order-money/);
  assert.equal(verify(box, 'status').code, 1);

  const run = verify(box, 'run');
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /^pass {2}order-money\. invariant, exhaustive, exit 0/);
  const unproven = verify(box, 'status');
  assert.match(unproven.out, /^unproven +order-money.*no failing run in verify\/red\/order-money\.txt/);
  assert.equal(unproven.code, 1);

  write(path.join(box.project, 'verify', 'red', 'order-money.txt'), 'no failing line here\n');
  assert.match(verify(box, 'status').out, /has no FAIL line/);
  write(path.join(box.project, 'verify', 'red', 'order-money.txt'), RED);
  const holds = verify(box, 'status');
  assert.match(holds.out, /^holds +order-money/);
  assert.equal(holds.code, 0);
  box.cleanup();
});

test('a change to covered code makes the property stale, and only a fresh green run plus a written note moves it forward', () => {
  const { box, add } = project();
  add();
  write(path.join(box.project, 'verify', 'red', 'order-money.txt'), RED);
  verify(box, 'run');
  assert.equal(verify(box, 'status').code, 0);

  const file = path.join(box.project, 'verify', 'check.mjs');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\n// a later edit\n');
  const stale = verify(box, 'status');
  assert.match(stale.out, /^stale +order-money.*covered code changed after the last sync/);
  assert.equal(stale.code, 1);

  const early = verify(box, 'sync', 'order-money', '--note', 'read the edit, it only adds a comment');
  assert.equal(early.code, 1);
  assert.match(early.err, /changed after the last green run of order-money\. Run it again/);

  assert.equal(verify(box, 'run', 'order-money').code, 0);
  assert.match(verify(box, 'status').out, /^stale/, 'a green run alone does not move the sync');
  assert.equal(verify(box, 'sync', 'order-money', '--note', 'short').code, 1, 'a sync needs a real note');
  assert.equal(verify(box, 'sync', 'order-money', '--note', 'read the edit, it only adds a comment').code, 0);
  assert.match(verify(box, 'status').out, /^holds/);
  const history = verify(box, 'history', 'order-money').out;
  assert.match(history, /add/);
  assert.match(history, /sync.*read the edit/);
  box.cleanup();
});

test('a failing check is broken, and an exhaustive claim is refused when the checker says it was bounded', () => {
  const { box, add } = project();
  add();
  write(path.join(box.project, 'verify', 'red', 'order-money.txt'), RED);
  const ledger = path.join(box.project, 'verify', 'ledger.tsv');
  fs.writeFileSync(ledger, fs.readFileSync(ledger, 'utf8').replace('node verify/check.mjs', 'echo BOUNDED. stopped at 6 states; echo pass x. ok'));
  const bounded = verify(box, 'run');
  assert.equal(bounded.code, 1);
  assert.match(bounded.out, /FAIL {2}order-money\. invariant, exhaustive, the ledger says exhaustive but the checker reported BOUNDED/);
  assert.match(verify(box, 'status').out, /^broken +order-money/);

  verify(box, 'amend', 'order-money', '--evidence', 'the model is too big for a full search, commit abc1234', '--level', 'bounded');
  const honest = verify(box, 'run');
  assert.equal(honest.code, 0, honest.out);
  assert.match(honest.out, /^pass {2}order-money\. invariant, bounded, exit 0/);
  assert.match(verify(box, 'status').out, /^holds +order-money +invariant, bounded/);
  box.cleanup();
});

test('amend needs evidence, keeps the old wording in the log and leaves the property unchecked', () => {
  const { box, add } = project();
  add();
  write(path.join(box.project, 'verify', 'red', 'order-money.txt'), RED);
  verify(box, 'run');
  assert.equal(verify(box, 'amend', 'order-money', '--property', 'Refunds may now exceed what was paid, up to a fee').code, 1);
  const done = verify(box, 'amend', 'order-money', '--property', 'Refunded never exceeds paid plus the fee', '--evidence', 'fee policy change, commit 9f2c1d0');
  assert.equal(done.code, 0, done.err);
  assert.match(verify(box, 'status').out, /^unchecked +order-money/);
  const history = fs.readFileSync(path.join(box.project, 'verify', 'history.tsv'), 'utf8');
  assert.match(history, /amend.*Refunded never exceeds paid and paid never exceeds the total.*fee policy change/);
  assert.equal(verify(box, 'retire', 'order-money', '--why', 'orders moved to another service').code, 0);
  assert.equal(readLedger(box.project).length, 0);
  assert.match(fs.readFileSync(path.join(box.project, 'verify', 'history.tsv'), 'utf8'), /retire.*orders moved/);
  box.cleanup();
});

test('code with no rule starts the procedure, and a waiver or a property ends the question', () => {
  const { box, add } = project();
  sh(box.project, 'git init -q -b main && git config user.email t@t && git config user.name t && git add -A && git commit -qm base');
  sh(box.project, 'git checkout -q -b feature');
  write(path.join(box.project, 'src', 'rules.mjs'), 'export const fee = (cents) => Math.floor(cents * 0.03);\n');
  write(path.join(box.project, 'src', 'rules.test.mjs'), 'import "./rules.mjs";\n');
  write(path.join(box.project, 'src', 'view.mjs'), 'export const label = () => "hi";\n');

  const cover = verify(box, 'cover', 'src/rules.mjs');
  assert.equal(cover.code, 2);
  assert.match(cover.out, /^NO RULE {2}src\/rules\.mjs/m);
  assert.match(cover.out, /No rule covers this code, so start the verification procedure: read skills\/100x\/references\/properties\.md/);

  const gaps = verify(box, 'gaps');
  assert.equal(gaps.code, 1);
  assert.match(gaps.out, /NO RULE {2}src\/rules\.mjs/);
  assert.match(gaps.out, /NO RULE {2}src\/view\.mjs/);
  assert.doesNotMatch(gaps.out, /rules\.test\.mjs/, 'a test is not code that needs a rule');

  assert.equal(verify(box, 'waive', 'src/view.mjs', '--why', 'copy and layout, nothing to state').code, 0);
  assert.equal(verify(box, 'waive', 'src/rules.mjs').code, 1, 'a waiver needs its reason');
  add(['--covers', 'src/rules.mjs']);
  const after = verify(box, 'gaps');
  assert.equal(after.code, 0, after.out);
  assert.match(verify(box, 'cover', 'src/view.mjs').out, /covered {2}src\/view\.mjs {2}by waived-src-view-mjs \(waived\)/);
  box.cleanup();
});

test('finish asks for a ledger only when the run says properties, and refuses a property that is stale or never failed', () => {
  const { box, add } = project();
  assert.deepEqual(checkLedger(box.project).errors, [], 'no ledger and no claim is no error');
  assert.match(checkLedger(box.project, { required: 'properties' }).errors[0], /holds no property/);
  assert.match(checkLedger(box.project, { required: 'any' }).errors[0], /ledger\.tsv is empty\. Property checks are on/);
  assert.deepEqual(checkLedger(box.project, { required: false }).errors, [], 'switched off means no ledger is asked for');

  add();
  const before = checkLedger(box.project).errors;
  assert.match(before[0], /property order-money is unchecked\. never run\. Fix it with 100x verify run order-money/);
  write(path.join(box.project, 'verify', 'red', 'order-money.txt'), RED);
  verify(box, 'run');
  assert.deepEqual(checkLedger(box.project).errors, []);

  fs.appendFileSync(path.join(box.project, 'verify', 'check.mjs'), '\n// edit\n');
  const stale = checkLedger(box.project).errors;
  assert.match(stale[0], /property order-money is stale\..*and then 100x verify sync order-money --note/);
  assert.notEqual(hashCovers(box.project, ['verify/check.mjs']).hash, readLedger(box.project)[0].covers_hash);
  box.cleanup();
});

test('the planner asks for Properties by default, and the owner can turn that off for a project or for every project', async () => {
  const { PROMPT_MD, makeProject } = await import('./projects.mjs');
  const { checkPrompt, verifyOn } = await import('../lib/prompt.mjs');
  const without = PROMPT_MD.replace(/## Properties[\s\S]*?(?=## Moment)/, '');
  assert.notEqual(without, PROMPT_MD);
  const box = sandbox();
  makeProject(box, { projectMd: without, prompted: true, ledger: false });
  const env = { ...process.env, ...box.env };
  const keep = Object.fromEntries(Object.keys(box.env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, box.env);
  try {
    assert.equal(verifyOn(box.project), true, 'on unless the owner says otherwise');
    assert.deepEqual(checkPrompt(box.project).problems.map((problem) => problem.section), ['Properties']);

    assert.equal(cli(['config', 'set', 'verify.enabled', 'false', '--local'], { cwd: box.project, env: box.env }).code, 0);
    assert.equal(verifyOn(box.project), false);
    assert.deepEqual(checkPrompt(box.project).problems, [], 'switched off for this project, so the section is not asked for');
    assert.equal(cli(['config', 'set', 'verify.enabled', 'true', '--local'], { cwd: box.project, env: box.env }).code, 0);
    assert.equal(verifyOn(box.project), true);

    assert.equal(cli(['config', 'set', 'verify.enabled', 'false', '--global'], { cwd: box.project, env: box.env }).code, 0);
    assert.equal(cli(['config', 'unset', 'verify.enabled', '--local'], { cwd: box.project, env: box.env }).code, 0);
    assert.equal(verifyOn(box.project), false, 'switched off for every project');
    assert.deepEqual(checkPrompt(box.project).problems, []);
  } finally {
    for (const [key, value] of Object.entries(keep)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    void env;
    box.cleanup();
  }
});

test('finish asks for a ledger row by default, accepts a waiver with its reason, and asks for nothing when checks are off', async () => {
  const { makeProject } = await import('./projects.mjs');
  const box = sandbox();
  makeProject(box, { ledger: false });
  fs.writeFileSync(path.join(box.project, 'index.html'), '<p>copy</p>\n');
  const asks = cli(['finish', '--check'], { cwd: box.project, env: box.env });
  assert.match(asks.out + asks.err, /verify\. verify\/ledger\.tsv is empty\. Property checks are on/);
  verify(box, 'waive', 'index.html', '--why', 'a page of copy, nothing to state');
  const waived = cli(['finish', '--check'], { cwd: box.project, env: box.env });
  assert.doesNotMatch(waived.out + waived.err, /verify\./);
  fs.rmSync(path.join(box.project, 'verify'), { recursive: true });
  cli(['config', 'set', 'verify.enabled', 'false', '--local'], { cwd: box.project, env: box.env });
  const off = cli(['finish', '--check'], { cwd: box.project, env: box.env });
  assert.doesNotMatch(off.out + off.err, /ledger\.tsv is empty/);
  assert.match(off.out + off.err, /property checks are switched off \(verify\.enabled false\), so nothing was verified/);
  box.cleanup();
});
