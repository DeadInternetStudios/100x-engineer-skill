import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseFindings, parseTriage } from '../lib/review.mjs';
import { cli, sandbox } from './helpers.mjs';
import { FINDINGS, makeProject, runJson } from './projects.mjs';

const triage = (box, ...args) => cli(['triage', ...args], { cwd: box.project, env: box.env });

test('findings parse from headings and bullets, with severity and title', () => {
  const { findings, warnings } = parseFindings(`## F1 [blocker] Nav overflows
text
### F2: major - Dim text
- F3 (minor) Odd spacing
## F4 No severity here
## F5 [minor] Blocker rules are unclear
## F6 Minor typo in the footer
## F1 [nit] repeated
`);
  assert.deepEqual(findings.map((f) => [f.id, f.severity, f.title]), [
    ['F1', 'blocker', 'Nav overflows'],
    ['F2', 'major', 'Dim text'],
    ['F3', 'minor', 'Odd spacing'],
    ['F4', 'blocker', 'No severity here'],
    ['F5', 'minor', 'Blocker rules are unclear'],
    ['F6', 'blocker', 'Minor typo in the footer'],
  ]);
  assert.equal(warnings.length, 3);
  assert.match(warnings.join(' '), /F4 has no severity word, so it counts as a blocker/);
  assert.match(warnings.join(' '), /F6 has no severity word/);
  assert.match(warnings.join(' '), /F1 appears more than once/);
});

test('the reviewer\'s own sections are not findings, however their lines start', () => {
  const { findings } = parseFindings(`## F1 [major] Real finding
Evidence: ran it

## Earlier findings check
- F1 fixed, saw it work
F2: not fixed, still overflows
### F3 regressed

## What is good
- F4 keep the pages as they are

## Verdict
Ready to ship: no
`);
  assert.deepEqual(findings.map((f) => f.id), ['F1']);
  const later = parseFindings('## Earlier findings check\nRound 1 F1 - fixed\n\n## F2 [minor] New one\n');
  assert.deepEqual(later.findings.map((f) => f.id), ['F2'], 'a finding after those sections still counts');
});

test('triage lines accept the ways a model writes them', () => {
  const { entries, errors } = parseTriage(`F1 accept. fixed in abc
- F2: rejected - the button is hidden on purpose
**F3** deferred. needs a backend
F4 DEFER later
Some prose that mentions F9 but is not a decision
`);
  assert.deepEqual([...entries.entries()].map(([id, e]) => [id, e.decision, e.reason]), [
    ['F1', 'accept', 'fixed in abc'],
    ['F2', 'reject', 'the button is hidden on purpose'],
    ['F3', 'defer', 'needs a backend'],
    ['F4', 'defer', 'later'],
  ]);
  assert.deepEqual(errors, []);
});

test('triage passes when every finding has a decision and a reason', () => {
  const box = sandbox();
  makeProject(box);
  const result = triage(box);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /2 findings\. 1 accepted, 1 rejected, 0 deferred, 0 untriaged\./);
  assert.match(result.out, /triage complete/);
  box.cleanup();
});

const BAD = [
  ['an untriaged finding', { triage: 'F1 accept. done\n' }, /no triage for F2/],
  ['a decision with no reason', { triage: 'F1 accept.\nF2 reject. fine\n' }, /F1 accept needs a reason of at least 15 characters/],
  ['a deferred blocker', { findings: '## F1 [blocker] Broken\n', triage: 'F1 defer. needs a backend that is not built\n' }, /F1 is a blocker and cannot be deferred/],
  ['a blocker whose heading lost its severity word, so rewording cannot demote it', { findings: '## F1 critical thing that blocks the owner\n', triage: 'F1 defer. needs a backend that is not built\n' }, /F1 is a blocker and cannot be deferred/],
  ['an accept that says nothing checkable', { triage: 'F1 accept. blah blah blah blah blah\nF2 reject. fine\n' }, /F1 accept needs a reason that points at something checkable/],
  ['an accept too short to mean anything', { triage: 'F1 accept. blah\nF2 reject. fine\n' }, /F1 accept needs a reason of at least 15 characters/],
  ['a reject with no evidence of its own', { triage: 'F1 accept. fixed in a1b2c3d\nF2 reject. it is fine and not a real issue at all\n' }, /F2 reject needs a reason that points at something checkable/],
  ['a defer that is too short', { triage: 'F1 accept. fixed in a1b2c3d\nF2 defer. later\n' }, /F2 defer needs a reason of at least 15 characters/],
  ['a decision for a finding that does not exist', { triage: 'F1 accept. a\nF2 reject. b\nF7 accept. c\n' }, /mentions F7, which is not in findings\.md/],
  ['a finding triaged twice', { triage: 'F1 accept. a\nF1 reject. b\nF2 reject. c\n' }, /F1 is triaged twice/],
  ['no findings file', { findings: null }, /no findings file/],
  ['an empty findings file', { findings: '# Findings\n\nI looked around.\n', triage: '' }, /no findings .* and no "No findings" line/],
];

for (const [name, setup, pattern] of BAD) {
  test(`triage refuses ${name}`, () => {
    const box = sandbox();
    makeProject(box, setup);
    const result = triage(box);
    assert.equal(result.code, 1);
    assert.match(result.out, pattern);
    box.cleanup();
  });
}

test('a review that found nothing passes when it says so', () => {
  const box = sandbox();
  makeProject(box, { findings: '# Findings\n\nNo findings. I ran the matrix and used it for ten minutes.\n', triage: null });
  const result = triage(box);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /0 findings/);
  box.cleanup();
});

test('finish takes review counts from the files, not from the run notes', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ review: { status: 'reviewed', model: 'muse-wonder-1.0', flags: 99, fixed: 99 } }) });
  const result = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Review \(muse-wonder-1\.0\): 2 flagged, 1 fixed, 1 rejected\n/);
  const run = JSON.parse(fs.readFileSync(path.join(box.project, '.100x', 'run.json'), 'utf8'));
  assert.deepEqual([run.review.flags, run.review.fixed, run.review.rejected], [2, 1, 1]);
  box.cleanup();
});

test('finish refuses a reviewed run whose findings are not all triaged', () => {
  const box = sandbox();
  makeProject(box, { triage: 'F1 accept. done\n' });
  const result = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 1);
  assert.match(result.err, /review\. no triage for F2/);
  box.cleanup();
});

test('brief collects the asks, moment, how to run, history, tools and the findings format', () => {
  const box = sandbox();
  makeProject(box);
  fs.mkdirSync(path.join(box.home, '.100x'), { recursive: true });
  fs.writeFileSync(path.join(box.home, '.100x', 'profile.md'), '# Profile\nBoring visuals are the repeat complaint.\n');
  const result = cli(['brief'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  const text = fs.readFileSync(path.join(box.project, '.100x', 'review', 'brief.md'), 'utf8');
  assert.match(text, /^# Review brief\. Glow/);
  assert.match(text, /Make a thing that glows\./);
  assert.match(text, /- \[x\] a thing that glows/);
  assert.match(text, /- \[~\] print view \(dropped: out of scope\)/);
  assert.match(text, /Moment\. The first tap lights the whole screen\./);
  assert.match(text, /Must not break\. screen-sizes, pass\./);
  assert.match(text, /Run: `npm run dev`/);
  assert.match(text, /100x shots <url> --matrix all/);
  assert.match(text, /## F1 \[blocker\] Short title/);
  assert.match(text, /Do not start subagents\./);
  assert.match(text, /Never play sound on this machine\./);
  assert.match(text, /You have 90 minutes\./);
  assert.match(text, /Boring visuals are the repeat complaint\./);
  assert.doesNotMatch(text, /<!--/);
  assert.doesNotMatch(text, /^# Profile/m, 'the owner profile must not add a second top level heading to the brief');
  assert.match(text, /^### Profile/m, 'its headings sit under the brief section that holds them');
  box.cleanup();
});

test('a project with no detectable run command says so instead of pointing at itself', () => {
  const box = sandbox();
  makeProject(box, { run: { ...runJson(), runCmd: undefined, url: undefined } });
  cli(['brief'], { cwd: box.project, env: box.env });
  const text = fs.readFileSync(path.join(box.project, '.100x', 'review', 'brief.md'), 'utf8');
  assert.match(text, /Run: no command was detected/);
  assert.match(text, /Open: no address was detected/);
  assert.doesNotMatch(text, /see project\.md/);
  box.cleanup();
});

test('review-call prints the subagent tool arguments for the configured reviewer', () => {
  const box = sandbox();
  makeProject(box);
  const call = JSON.parse(cli(['review-call', '--json'], { cwd: box.project, env: box.env }).out);
  assert.equal(call.enabled, true);
  const task = call.delegateTask;
  assert.deepEqual(task.target, { providerInstanceId: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' } });
  assert.equal(task.role, 'review');
  assert.equal(task.isolation, 'shared', 'the reviewer must see the working tree, including uncommitted work');
  assert.equal(task.mode, 'async', 'a wait mode call gives up after about a minute while the child keeps running');
  assert.equal('timeoutMs' in task, false, 'timeoutMs only applies to wait mode');
  assert.equal(call.deadlineMinutes, 90);
  assert.match(task.task, /brief\.md in full/);
  assert.match(task.task, /findings\.md/);
  assert.doesNotMatch(task.task, /sk-|token|password/i);
  const human = cli(['review-call'], { cwd: box.project, env: box.env }).out;
  assert.match(human, /Review is on\. muse-wonder-1\.0 via cursor, reasoning_effort max, contextWindow 300k\. Deadline 90 minutes\./);
  box.cleanup();
});

test('the judge gets what the clock allows, and nothing is started when there is no room', () => {
  const box = sandbox();
  makeProject(box);
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  cli(['clock', 'set', '+3h'], { cwd: box.project, env: box.env });
  assert.equal(JSON.parse(run('review-call', '--json').out).deadlineMinutes, 90, 'plenty of time keeps the configured wait');
  cli(['clock', 'set', '+40m'], { cwd: box.project, env: box.env });
  const short = JSON.parse(run('review-call', '--json').out);
  assert.equal(short.deadlineMinutes, 32, 'the wait shrinks to the clock minus the last fifth, which belongs to wrap up');
  assert.equal(short.noRoom, undefined);
  assert.match(run('review-call').out, /Deadline 32 minutes\./);
  run('brief');
  const brief = fs.readFileSync(path.join(box.project, '.100x', 'review', 'brief.md'), 'utf8');
  assert.match(brief, /You have 32 minutes\. Write a first findings\.md within 11 minutes/);
  cli(['clock', 'set', '+12m'], { cwd: box.project, env: box.env });
  const none = JSON.parse(run('review-call', '--json').out);
  assert.equal(none.noRoom, true);
  assert.equal(none.deadlineMinutes, 7);
  cli(['clock', 'set', '+40m', '--fill'], { cwd: box.project, env: box.env });
  assert.equal(JSON.parse(run('review-call', '--json').out).deadlineMinutes, 35, 'a fill clock keeps only five minutes, its final judge sits in the reserve');
  cli(['clock', 'set', '+12m'], { cwd: box.project, env: box.env });
  const said = run('review-call').out;
  assert.match(said, /No room for a judge\. 1[12] min are left on the clock and a judge needs at least 15\./);
  assert.match(said, /100x run set review '\{"status":"unreviewed","note":"no time left for a judge: 1[12] min on the clock"\}'/);
  assert.doesNotMatch(said, /Review is on/);
  box.cleanup();
});

test('review settings come from config, and review off is reported plainly', () => {
  const box = sandbox();
  makeProject(box);
  cli(['config', 'set', 'review.model', 'some-other-model', '--local'], { cwd: box.project, env: box.env });
  cli(['config', 'set', 'review.fallbackModel', 'backup-model', '--local'], { cwd: box.project, env: box.env });
  const call = JSON.parse(cli(['review-call', '--json'], { cwd: box.project, env: box.env }).out);
  assert.equal(call.delegateTask.target.model, 'some-other-model');
  assert.deepEqual(call.fallbackTarget, { providerInstanceId: 'cursor', model: 'backup-model' });
  cli(['config', 'set', 'review.enabled', 'false', '--local'], { cwd: box.project, env: box.env });
  assert.deepEqual(JSON.parse(cli(['review-call', '--json'], { cwd: box.project, env: box.env }).out), { enabled: false });
  assert.match(cli(['review-call'], { cwd: box.project, env: box.env }).out, /Review is off in config/);
  box.cleanup();
});

test('a backup judge that is the model that builds is called a self-review, and the target the app receives stays clean', () => {
  const box = sandbox();
  makeProject(box);
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  run('config', 'set', 'review.fallbackModel', 'builder-model', '--local');
  assert.equal(JSON.parse(run('review-call', '--json').out).fallbackSameAsBuilder, undefined);
  run('config', 'set', 'builder.model', 'builder-model', '--local');
  const same = JSON.parse(run('review-call', '--json').out);
  assert.equal(same.fallbackSameAsBuilder, true);
  assert.deepEqual(same.fallbackTarget, { providerInstanceId: 'cursor', model: 'builder-model' });
  assert.match(run('review-call').out, /fallback builder-model if the first call cannot start\. It is the model that builds, so its look is a self-review\. Say so in the review note/);
  box.cleanup();
});

test('the shared findings fixture is itself valid', () => {
  assert.equal(parseFindings(FINDINGS).findings.length, 2);
});

test('a loop judge gets its own brutal task and findings file, and refuses without an ask file', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, loops: false });
  const missing = cli(['review-call', '--loop', 'pass-1', '--json'], { cwd: box.project, env: box.env });
  assert.notEqual(missing.code, 0);
  assert.match(missing.err + missing.out, /No ask file for loop pass-1/);
  fs.mkdirSync(path.join(box.project, '.100x', 'loops', 'pass-1'), { recursive: true });
  fs.writeFileSync(path.join(box.project, '.100x', 'loops', 'pass-1', 'ask.md'), '# Pass 1\nThe moment. A first tap that lights the screen.\n');
  const call = cli(['review-call', '--loop', 'pass-1', '--json'], { cwd: box.project, env: box.env });
  assert.equal(call.code, 0, call.err);
  const parsed = JSON.parse(call.out);
  assert.equal(parsed.via, 'harness');
  assert.equal(parsed.deadlineMinutes, 20);
  assert.match(parsed.findings, /loops\/pass-1\/judge\.md$/);
  assert.match(parsed.delegateTask.task, /Be brutal/);
  assert.match(parsed.delegateTask.task, /Drifting: yes/);
  assert.match(parsed.delegateTask.task, /Judged by: looking/);
  assert.match(parsed.delegateTask.task, /Never judge a screen from its code/);
  assert.match(parsed.delegateTask.task, /single full-size screenshots/);
  assert.match(parsed.delegateTask.task, /loops\/pass-1\/ask\.md/);
  box.cleanup();
});

test('the stage 6 brief tells the judge to judge screens with its eyes, never from code', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1 });
  cli(['brief'], { cwd: box.project, env: box.env });
  const text = fs.readFileSync(path.join(box.project, '.100x', 'review', 'brief.md'), 'utf8');
  assert.match(text, /judge with your eyes/);
  assert.match(text, /single full-size screenshots/);
  assert.match(text, /Never judge a screen from its code/);
  box.cleanup();
});
