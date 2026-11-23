import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { GRIND_LIMIT, converged, grindVerdict, grindWords, lensFor, nextSlot, parseReady, plannedFor } from '../lib/rounds.mjs';
import { cli, sandbox } from './helpers.mjs';
import { FINDINGS, makeProject, runJson, TRIAGE } from './projects.mjs';

const run = (box, ...args) => cli(args, { cwd: box.project, env: box.env });
const dot = (box, ...parts) => path.join(box.project, '.100x', ...parts);
const entry = (slot, lens, { blocker = 0, major = 0, ready = true } = {}) => ({ slot, lens, ready, severities: { blocker, major, minor: 1, nit: 0 } });

test('the lenses run code first, then UI and UX, and the last round is always the ship test', () => {
  const plan = (total) => Array.from({ length: total }, (_, i) => lensFor(i + 1, total)).join(' ');
  assert.equal(plan(1), 'ship');
  assert.equal(plan(2), 'code ship');
  assert.equal(plan(3), 'code product ship');
  assert.equal(plan(4), 'code code product ship');
  assert.equal(plan(5), 'code code product product ship');
});

test('a clean round skips the rest of its lens, a dirty one does not', () => {
  assert.equal(nextSlot([], 5), 1);
  assert.equal(nextSlot([entry(1, 'code', { major: 2 })], 5), 2);
  assert.equal(nextSlot([entry(1, 'code')], 5), 3, 'a clean code round moves on to the UI');
  assert.equal(nextSlot([entry(1, 'code'), entry(3, 'product')], 5), 5, 'a clean UI round moves on to the ship test');
  assert.equal(nextSlot([entry(1, 'code'), entry(3, 'product'), entry(5, 'ship')], 5), null);
  assert.equal(nextSlot([entry(1, 'code', { ready: false })], 5), 2, 'not ready is never clean');
  assert.equal(nextSlot([entry(1, 'code', { blocker: 1 }), entry(2, 'code', { major: 1 }), entry(3, 'product'), entry(4, 'product'), entry(5, 'ship')], 5), null);
  assert.equal(converged(entry(1, 'code')), true);
  assert.equal(converged(entry(1, 'code', { blocker: 1 })), false);
});

test('the ready line is read from the judge text, and its absence is not a no', () => {
  assert.equal(parseReady('## Verdict\nReady to ship: yes\nKeep going.'), true);
  assert.equal(parseReady('## Verdict\n**Ready to ship:** no\n'), false);
  assert.equal(parseReady('## Verdict\nReady to sell: yes\nKeep going.'), true, 'a round judged when the line said sell still reads');
  assert.equal(parseReady('## Verdict\n**Ready to sell:** no\n'), false);
  assert.equal(parseReady('## Verdict\nKeep going.'), null);
});

const QUOTED = `# Review

## F1 [major] The page says "Ready to ship: yes" beside a failed check
Where: the hero
Evidence: the sentence "Ready to ship: yes" sits next to a red line
Fix: take the claim out

## Verdict
Ready to ship: no
Single most valuable change: take the claim out
`;

test('a claim quoted in a finding does not answer for the judge, only the Verdict section does', () => {
  assert.equal(parseReady(QUOTED), false, 'the first match is the quote, and the answer is the line in the Verdict section');
  assert.equal(parseReady('Ready to ship: no\n\n## F1 [minor] The page says "ready to ship: yes"\n'), true, 'with no Verdict heading the last line wins');
  assert.equal(parseReady('## F1 [minor] Says ready to ship: yes\n\n## Verdict\nKeep going.\n'), null, 'a Verdict section with no answer is no answer, and the quote above it is not one');
});

test('a quoted claim does not turn a no into a ready round when the round is closed', () => {
  const box = sandbox();
  makeProject(box, { rounds: 3, run: runJson(), findings: QUOTED, triage: 'F1 accept. fixed in a1b2c3d, the claim is gone from the page\n', matrix: { startedAt: new Date(Date.now() + 60000).toISOString() } });
  run(box, 'brief');
  assert.equal(run(box, 'triage').code, 0);
  const [closed] = JSON.parse(fs.readFileSync(dot(box, 'review', 'rounds.json'), 'utf8')).entries;
  assert.equal(closed.ready, false, 'the stored round says the judge said no');
  assert.equal(converged(closed), false, 'so the round is not clean and the next round of the same kind still runs');
  box.cleanup();
});

test('triage closes the round once, archives it, and the next brief carries the answers to the judge', () => {
  const box = sandbox();
  makeProject(box, { rounds: 3, run: runJson(), matrix: { startedAt: new Date(Date.now() + 60000).toISOString() } });
  const first = run(box, 'brief');
  assert.match(first.out, /Round 1 of 3, the code and how it behaves, still open\./);
  assert.match(fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8'), /Round 1 of 3\. Lens: the code and how it behaves/);
  assert.match(fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8'), /Data and state/);
  // makeProject wrote findings for the open round, and rebuilding the brief keeps them
  assert.match(run(box, 'brief').out, /still open/);
  assert.ok(fs.existsSync(dot(box, 'review', 'findings.md')));
  const closed = run(box, 'triage');
  assert.equal(closed.code, 0, closed.err + closed.out);
  assert.match(closed.out, /Round 1 of 3 closed, the code and how it behaves\. Ready to ship: yes\./);
  run(box, 'triage');
  assert.equal(JSON.parse(fs.readFileSync(dot(box, 'review', 'rounds.json'), 'utf8')).entries.length, 1, 'closing twice holds one round');
  assert.ok(fs.existsSync(dot(box, 'review', 'round-1', 'triage.md')));
  // FINDINGS has a major finding, so the code round is not clean and the next round is the UI and UX
  assert.match(run(box, 'brief').out, /Round 2 of 3, the UI and UX\./);
  const text = fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.match(text, /Round 2 of 3\. Lens: the UI and UX/);
  assert.match(text, /The first minute/);
  assert.match(text, /Earlier findings check/);
  assert.match(text, /Reopened:/);
  assert.match(text, /F2 \[minor\] Hint text is dim\. reject\./);
  assert.equal(fs.existsSync(dot(box, 'review', 'findings.md')), false);
  box.cleanup();
});

test('a brief when every round is held says so, and review-call knows where the rounds stand', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1 });
  assert.equal(run(box, 'triage').code, 0);
  assert.match(run(box, 'brief').out, /All rounds are done, 1 of 1 held\. Run `100x finish`\./);
  const call = JSON.parse(run(box, 'review-call', '--json').out);
  assert.deepEqual([call.round.held, call.round.total, call.round.done], [1, 1, true]);
  assert.match(run(box, 'review-call').out, /All rounds are done, 1 of 1 held/);
  box.cleanup();
});

test('finish waits for the planned rounds, and a clock with no room for another one only warns', () => {
  const box = sandbox();
  makeProject(box, { rounds: 3 });
  const refused = run(box, 'finish');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /the judge held 1 of 3 rounds\. Round 2 \(the UI and UX\) is next/);
  assert.equal(cli(['registry', 'list', '--json'], { env: box.env }).out.trim(), '[]');
  run(box, 'clock', 'set', '+12m');
  const warned = run(box, 'finish');
  assert.equal(warned.code, 0, warned.err + warned.out);
  assert.match(warned.out, /warn\s+the judge held 1 of 3 rounds\. The clock had no room for round 2/);
  assert.match(warned.out, /Judge rounds: 1 of 3 done, on the code and how it behaves,/);
  box.cleanup();
});

test('a run under lite says it took fewer passes and rounds than the usual, even when lite is set for every project', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ polishPasses: 1 }), rounds: 2 });
  assert.equal(run(box, 'config', 'preset', 'lite', '--global').code, 0);
  // The fixture holds one judge round, and the clock has no room for the second, as in the test above.
  run(box, 'clock', 'set', '+12m');
  const done = run(box, 'finish');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Judge rounds: 1 of 2 done, .* \(this project's setting is lower than the usual 5\)/);
  assert.match(fs.readFileSync(dot(box, 'REPORT.md'), 'utf8'), /1 of 3/, 'the report says one polish pass of the usual three');
  box.cleanup();
});

test('a project setting that asks for fewer judge rounds than the owner usually does says so in the report and the final message', () => {
  const box = sandbox();
  makeProject(box, { rounds: 3 });
  assert.equal(run(box, 'config', 'set', 'review.rounds', '1', '--local').code, 0);
  const done = run(box, 'finish');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Judge rounds: 1 of 1 done, on whether it is ready to ship \(this project's setting is lower than the usual 3\)/);
  assert.match(fs.readFileSync(dot(box, 'REPORT.md'), 'utf8'), /this project's setting is lower than the usual 3\)/);
  assert.match(fs.readFileSync(dot(box, 'REPORT.html'), 'utf8'), /this project&#39;s setting is lower than the usual 3\)|this project's setting is lower than the usual 3\)/);
  box.cleanup();
  const same = sandbox();
  makeProject(same, { rounds: 1 });
  assert.doesNotMatch(run(same, 'finish').out, /lower than the usual/);
  same.cleanup();
});

test('a judge that says not ready is shown in the warning, the report and the final message', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, findings: FINDINGS.replace('## Verdict\n', '## Verdict\nReady to ship: no\n'), triage: TRIAGE });
  const done = run(box, 'finish');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /\nLook first: The judge said NOT ready to ship\n/);
  assert.doesNotMatch(done.out, /warn\s+the judge's last word/, 'the Look first line already says it');
  assert.match(done.out, /Judge rounds: 1 of 1 done, on whether it is ready to ship, and the last word was NOT ready to ship\n/);
  assert.match(fs.readFileSync(dot(box, 'REPORT.md'), 'utf8'), /the last word was NOT ready to ship/);
  box.cleanup();
});

test('the next judge is shown the commits the builder made while fixing the last round', () => {
  const box = sandbox();
  makeProject(box, { rounds: 3 });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: box.project, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(box.project, 'app.txt'), 'one');
  git('add', 'app.txt');
  git('commit', '-q', '-m', 'first version before the judge');
  run(box, 'brief');
  fs.writeFileSync(path.join(box.project, 'app.txt'), 'two');
  git('commit', '-q', '-am', 'wrap the clipped row at 320px');
  assert.equal(run(box, 'triage').code, 0);
  run(box, 'brief');
  const text = fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.match(text, /Commits since the last round was briefed\. These are the builder's fixes\./);
  const earlier = text.slice(text.indexOf('## Earlier rounds'), text.indexOf('## What to judge'));
  assert.match(earlier, /wrap the clipped row at 320px/);
  assert.doesNotMatch(earlier, /first version before the judge/);
  box.cleanup();
});

test('every round tells the judge to decide what matters for this kind of product, and carries the builder focus', () => {
  const box = sandbox();
  const projectMd = '# Pixel pack\n\n## Brief\nA pack of 32 tiles.\n\n## Judge focus\nThe tiles must read as one hand and tile without seams.\n\n## Moment\nA full scene from 12 tiles.\n';
  makeProject(box, { rounds: 3, projectMd });
  run(box, 'brief');
  const text = fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.match(text, /## What matters most for this product/);
  assert.match(text, /The builder's focus\. The tiles must read as one hand and tile without seams\./);
  assert.match(text, /Decide what makes this kind of product good or bad/);
  assert.match(text, /skip what does not apply to this product and name each skipped item in one line/);
  box.cleanup();
});

// A closed round as the rounds file keeps it. `flags` is the number of findings the judge wrote.
const closedRound = (slot, lens, { blocker = 0, major = 0, flags = 3, ready = true } = {}) => ({ slot, lens, ready, severities: { blocker, major, minor: 1, nit: 0 }, counts: { flags } });
const sellTests = (...shapes) => shapes.map((shape, i) => closedRound(5 + i, 'ship', shape));

test('a ship test is clean only when the judge said yes, and a judge that gave no answer has not said it', () => {
  assert.equal(converged(closedRound(5, 'ship')), true);
  assert.equal(converged(closedRound(5, 'ship', { ready: null })), false, 'no answer on the ship test is not a yes');
  assert.equal(converged(closedRound(5, 'ship', { ready: false })), false);
  assert.equal(converged(closedRound(5, 'ship', { major: 1 })), false, 'a yes that lists a major is not clean');
  assert.equal(converged(closedRound(1, 'code', { ready: null })), true, 'the earlier lenses keep their meaning');
});

test('the grind is green on a ship test that says yes with no blocker and no major, and on nothing else', () => {
  assert.deepEqual(grindVerdict(sellTests({})), { state: 'green', round: 5 });
  assert.equal(grindVerdict(sellTests({ ready: false })).state, 'go-on');
  assert.equal(grindVerdict(sellTests({ ready: null })).state, 'go-on', 'a missing answer asks another judge');
  assert.equal(grindVerdict(sellTests({ major: 1 })).state, 'go-on', 'yes with a major on the list is not green');
  assert.equal(grindVerdict(sellTests({ blocker: 1 })).state, 'go-on');
  assert.equal(grindVerdict([closedRound(1, 'code'), closedRound(3, 'product')]).state, 'go-on', 'a clean round of an earlier lens is not the ship test');
  assert.equal(grindVerdict([]).state, 'go-on');
  assert.equal(grindVerdict([...sellTests({ ready: false, major: 2 }), closedRound(6, 'ship')]).state, 'green', 'a later yes counts');
});

test('three ship tests in a row that do not beat the best one so far end the grind', () => {
  const stuck = sellTests({ ready: false, major: 2, flags: 7 }, { ready: false, major: 2, flags: 8 }, { ready: false, major: 3, flags: 9 });
  assert.equal(grindVerdict(stuck).state, 'go-on', 'two rounds without progress are not three');
  const stalled = grindVerdict([...stuck, ...sellTests({ ready: false, major: 2, flags: 7 }).map((e) => ({ ...e, slot: 8 }))]);
  assert.deepEqual(stalled, { state: 'stalled', best: 5, serious: 2, flags: 7, since: 3 }, 'a tie with the best is not better');
  const better = sellTests({ ready: false, major: 3, flags: 9 }, { ready: false, major: 2, flags: 9 }, { ready: false, major: 2, flags: 9 }, { ready: false, major: 2, flags: 9 });
  assert.equal(grindVerdict(better).state, 'go-on', 'fewer majors at round 6 restarted the count');
  assert.equal(grindVerdict([...better, ...sellTests({ ready: false, major: 2, flags: 9 }).map((e) => ({ ...e, slot: 9 }))]).state, 'stalled');
  const fewerFindings = sellTests({ ready: false, flags: 5 }, { ready: false, flags: 4 }, { ready: false, flags: 3 }, { ready: false, flags: 2 }, { ready: false, flags: 1 });
  assert.equal(grindVerdict(fewerFindings).state, 'go-on', 'with no blockers or majors left, fewer findings is progress');
  const flipping = sellTests({ ready: false, major: 2 }, { ready: false, major: 1 }, { ready: false, major: 2 }, { ready: false, major: 1 }, { ready: false, major: 2 });
  assert.equal(grindVerdict(flipping).state, 'stalled', 'going back and forth is not progress');
  assert.equal(grindVerdict([closedRound(1, 'code', { major: 1 }), closedRound(2, 'code', { major: 1 }), closedRound(3, 'product', { major: 1 }), closedRound(4, 'product', { major: 1 })]).state, 'go-on', 'only ship tests count, the earlier lenses find different things');
});

test('the round limit ends a grind that keeps making progress, and a green light beats it', () => {
  const climbing = Array.from({ length: GRIND_LIMIT }, (_, i) => closedRound(5 + i, 'ship', { ready: false, flags: 25 - i }));
  assert.deepEqual(grindVerdict(climbing), { state: 'limit', rounds: GRIND_LIMIT });
  assert.equal(grindVerdict(climbing.slice(0, -1)).state, 'go-on');
  assert.equal(grindVerdict([...climbing.slice(0, -1), closedRound(5 + GRIND_LIMIT - 1, 'ship')]).state, 'green');
});

test('a grind that keeps getting better still stops at the round limit, and a stuck one stops at the stall long before it', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, findings: null, triage: null });
  run(box, 'config', 'set', 'review.grind', 'true', '--local');
  let last;
  for (let round = 1; round <= GRIND_LIMIT; round += 1) {
    run(box, 'brief');
    last = writeRound(box, { majors: GRIND_LIMIT - round, minors: 1, ready: false });
    if (round < GRIND_LIMIT) assert.match(last.out, /Next, `100x brief` for round/, `round ${round} is not the end`);
  }
  assert.match(last.out, new RegExp(`\\nRound limit\\. The last judge did not say ready to ship\\. ${GRIND_LIMIT} rounds held\\. Stop here`));
  assert.match(run(box, 'brief').out, /^Round limit\./m);
  assert.equal(grindVerdict(sellTests(...Array.from({ length: GRIND_LIMIT }, () => ({ major: 2, ready: false })))).state, 'stalled', 'when both are true the stall says more');
  box.cleanup();
});

test('status says how many rounds are held, what the last judge said, and where the grind stands', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, findings: null, triage: null });
  assert.doesNotMatch(run(box, 'status').out, /^Rounds /m, 'no round held, no line');
  run(box, 'brief');
  writeRound(box, { majors: 1, ready: false });
  assert.match(run(box, 'status').out, /^Rounds {5}1 held of 1 planned\. The last judge said NOT ready to ship\.$/m);
  run(box, 'config', 'set', 'review.grind', 'true', '--local');
  assert.match(run(box, 'status').out, /^Rounds {5}1 held of 2 planned\. The last judge said NOT ready to ship\. Grind on\. Not green yet\.$/m);
  run(box, 'brief');
  writeRound(box, { minors: 1, ready: true });
  assert.match(run(box, 'status').out, /^Rounds {5}2 held of 2 planned\. The last judge said ready to ship\. Grind on\. Green light\. The judge of round 2 said ready to ship and found no blocker or major finding\.$/m);
  assert.deepEqual(JSON.parse(run(box, 'status', '--json').out).rounds, { held: 2, planned: 2, lastReady: true, grind: true, words: 'Green light. The judge of round 2 said ready to ship and found no blocker or major finding.' });
  box.cleanup();
});

test('the words for each way a grind ends say which one it was', () => {
  assert.equal(grindWords({ state: 'go-on' }), null);
  assert.equal(grindWords({ state: 'green', round: 7 }), 'Green light. The judge of round 7 said ready to ship and found no blocker or major finding.');
  assert.equal(grindWords({ state: 'stalled', best: 5, serious: 1, flags: 1, since: 3 }), 'Stalled. 3 ship tests in a row found nothing better than round 5, which had 1 blocker or major finding among 1 finding.');
  assert.equal(grindWords({ state: 'limit', rounds: 15 }), 'Round limit. The last judge did not say ready to ship.');
});

test('with the grind on, one more ship test is planned until a judge says yes, and the setting is never changed', () => {
  const usual = { rounds: 5, grind: true };
  const held = [closedRound(1, 'code'), closedRound(3, 'product'), closedRound(5, 'ship', { ready: false, major: 1 })];
  assert.equal(plannedFor(held, { rounds: 5, grind: false }), 5, 'with the grind off the plan is the setting');
  assert.equal(plannedFor(held.slice(0, 2), usual), 5, 'the usual rounds come first');
  assert.equal(plannedFor([], usual), 5);
  assert.equal(plannedFor(held, usual), 6, 'every usual round is held and the judge said no');
  assert.equal(nextSlot(held, 6), 6);
  assert.equal(nextSlot([...held, closedRound(6, 'ship', { ready: null })], plannedFor([...held, closedRound(6, 'ship', { ready: null })], usual)), 7, 'a ship test with no answer is asked again, and is not skipped as clean');
  assert.equal(plannedFor([...held, closedRound(6, 'ship', { ready: false, major: 1 })], usual), 7, 'and again after the next no');
  assert.equal(plannedFor([...held, closedRound(6, 'ship')], usual), 5, 'a yes ends it');
  assert.equal(nextSlot([...held, closedRound(6, 'ship')], 5), null);
  const stalled = [...held.slice(0, 2), ...sellTests({ ready: false, major: 2 }, { ready: false, major: 2 }, { ready: false, major: 2 }, { ready: false, major: 2 })];
  assert.equal(plannedFor(stalled, usual), 5, 'a stall ends it');
  assert.equal(nextSlot(stalled, 5), null);
  assert.equal(plannedFor([closedRound(1, 'ship', { ready: false, major: 1 })], { rounds: 1, grind: true }), 2, 'it works from a plan of one round too');
});

// One judge's findings and the builder's answers, written the way the agent writes them, so the real triage closes the round.
// Two judges never write the same bytes, and a findings file that matches the last closed round byte for byte counts as that round, so each one signs its own.
let judges = 0;
const writeRound = (box, { majors = 0, minors = 0, ready }) => {
  const blocks = [
    ...Array.from({ length: majors }, (_, i) => `## F${i + 1} [major] Problem ${i + 1}\nWhere: shop\nEvidence: shots/review/phone-320 screenshot\nFix: change it\n`),
    ...Array.from({ length: minors }, (_, i) => `## F${majors + i + 1} [minor] Rough edge ${i + 1}\nWhere: shop\nEvidence: audit contrast 3.1:1\nFix: darken it\n`),
  ];
  const verdict = ready === undefined ? 'Keep going.' : `Ready to ship: ${ready ? 'yes' : 'no'}`;
  fs.writeFileSync(dot(box, 'review', 'findings.md'), `# Findings\n\n${blocks.join('\n') || 'No findings.\n'}\n## What is good\n- The glow loop, judge ${(judges += 1)}\n\n## Verdict\n${verdict}\n`);
  fs.writeFileSync(dot(box, 'review', 'triage.md'), Array.from({ length: majors + minors }, (_, i) => `F${i + 1} accept. fixed in a1b2c3d, the problem is gone`).join('\n') + '\n');
  return run(box, 'triage');
};

test('with the grind on, the rounds go on after the usual ones until a ship test is green', () => {
  const box = sandbox();
  makeProject(box, { rounds: 2, findings: null, triage: null });
  assert.equal(run(box, 'config', 'set', 'review.grind', 'true', '--local').code, 0);
  assert.match(run(box, 'brief').out, /Round 1 of 2, the code and how it behaves\./);
  const first = writeRound(box, { ready: true });
  assert.match(first.out, /Round 1 of 2 closed, the code and how it behaves\. Ready to ship: yes\./);
  assert.match(first.out, /\nNext, `100x brief` for round 2 of 2, whether it is ready to ship\.\n/, 'the usual rounds come first, so nothing says it is not green yet');
  assert.match(run(box, 'brief').out, /Round 2 of 2, whether it is ready to ship\./);
  const no = writeRound(box, { majors: 2, ready: false });
  assert.match(no.out, /\nNot green yet\. Next, `100x brief` for round 3 of 3, whether it is ready to ship\.\n/, 'the judge said no, so a third round is planned');
  const call = JSON.parse(run(box, 'review-call', '--json').out);
  assert.deepEqual([call.round.slot, call.round.total, call.round.lens, call.round.held, call.round.done], [3, 3, 'ship', 2, false]);
  assert.match(call.delegateTask.task, /Round 3 of 3, whether it is ready to ship\./, 'the judge is told which round it is');
  assert.match(run(box, 'brief').out, /Round 3 of 3, whether it is ready to ship\./);
  assert.match(fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8'), /Round 3 of 3\. Lens: whether it is ready to ship/);
  assert.match(fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8'), /Round 2, whether it is ready to ship\. The judge said ready to ship: no\./, 'the new judge is shown what the last one said');
  const yes = writeRound(box, { minors: 1, ready: true });
  assert.match(yes.out, /Round 3 of 3 closed, whether it is ready to ship\. Ready to ship: yes\./);
  assert.match(yes.out, /\nGreen light\. The judge of round 3 said ready to ship and found no blocker or major finding\. 3 rounds held\. Fix what is accepted, then `100x finish`\.\n/);
  assert.match(run(box, 'brief').out, /^Green light\. The judge of round 3 said ready to ship and found no blocker or major finding\. 3 rounds held\. Run `100x finish`\.$/m);
  const done = JSON.parse(run(box, 'review-call', '--json').out);
  assert.deepEqual([done.round.held, done.round.done], [3, true]);
  assert.equal(fs.existsSync(dot(box, 'review', 'round-3', 'findings.md')), true, 'every round is kept for the report and the next judge');
  box.cleanup();
});

test('a yes that still lists a major is not green, and a ship test with no answer is asked again', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, findings: null, triage: null });
  run(box, 'config', 'set', 'review.grind', 'true', '--local');
  run(box, 'brief');
  assert.match(writeRound(box, { majors: 1, ready: true }).out, /\nNot green yet\. Next, `100x brief` for round 2 of 2,/);
  run(box, 'brief');
  const silent = writeRound(box, { minors: 1 });
  assert.match(silent.out, /Ready to ship: the judge did not say\./);
  assert.match(silent.out, /\nNot green yet\. Next, `100x brief` for round 3 of 3,/, 'no answer is not a yes, and the round is not skipped as clean');
  box.cleanup();
});

test('the grind stops on a stall and says so, and no further round is planned', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, findings: null, triage: null });
  run(box, 'config', 'set', 'review.grind', 'true', '--local');
  for (let round = 1; round <= 3; round += 1) {
    run(box, 'brief');
    assert.match(writeRound(box, { majors: 2, ready: false }).out, new RegExp(`\\nNot green yet\\. Next, \`100x brief\` for round ${round + 1} of ${round + 1},`));
  }
  run(box, 'brief');
  const last = writeRound(box, { majors: 2, ready: false });
  assert.match(last.out, /\nStalled\. 3 ship tests in a row found nothing better than round 1, which had 2 blocker or major findings among 2 findings\. 4 rounds held\. Stop here and say what the judges keep saying, then `100x finish`\.\n/);
  assert.doesNotMatch(last.out, /Next, `100x brief`/);
  assert.match(run(box, 'brief').out, /^Stalled\. 3 ship tests in a row found nothing better than round 1/m);
  assert.match(run(box, 'status').out, /^Rounds {5}4 held of 4 planned\. The last judge said NOT ready to ship\. Grind on\. Stalled\. 3 ship tests in a row/m);
  assert.equal(JSON.parse(run(box, 'review-call', '--json').out).round.done, true);
  box.cleanup();
});

test('without the grind, a judge that says no does not plan another round, whatever the setting was before', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, findings: null, triage: null });
  run(box, 'brief');
  const closed = writeRound(box, { majors: 2, ready: false });
  assert.match(closed.out, /\nAll rounds are done, 1 of 1 held\. Fix what is accepted, then `100x finish`\.\n/);
  assert.doesNotMatch(closed.out, /Green light|Stalled|Not green/);
  assert.match(run(box, 'brief').out, /All rounds are done, 1 of 1 held\. Run `100x finish`\./);
  box.cleanup();
});

test('finish waits while the grind has another round planned, and takes a green light', () => {
  const box = sandbox();
  const notReady = FINDINGS.replace('## Verdict\n', '## Verdict\nReady to ship: no\n');
  makeProject(box, { rounds: 1, findings: notReady, triage: TRIAGE });
  run(box, 'config', 'set', 'review.grind', 'true', '--local');
  const refused = run(box, 'finish');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /the judge held 1 of 2 rounds\. Round 2 \(whether it is ready to ship\) is next\./);
  const yesWithMajor = FINDINGS.replace('## Verdict\n', '## Verdict\nReady to ship: yes\n');
  fs.writeFileSync(dot(box, 'review', 'findings.md'), yesWithMajor);
  assert.match(run(box, 'finish').err, /the judge held 1 of 2 rounds\./, 'a yes that lists a major is not a green light');
  const green = '# Findings\n\n## F1 [minor] Hint text is dim\nWhere: shop\nEvidence: audit contrast 3.1:1\nFix: darken the token\n\n## Verdict\nReady to ship: yes\n';
  fs.writeFileSync(dot(box, 'review', 'findings.md'), green);
  fs.writeFileSync(dot(box, 'review', 'triage.md'), 'F1 accept. fixed in a1b2c3d, the hint is darker\n');
  const done = run(box, 'finish');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Judge rounds: 1 of 1 done, on whether it is ready to ship,/);
  box.cleanup();
});

test('the report counts the grind rounds against what was held, not against the setting', () => {
  const box = sandbox();
  makeProject(box, { rounds: 1, findings: null, triage: null });
  run(box, 'config', 'set', 'review.grind', 'true', '--local');
  run(box, 'brief');
  writeRound(box, { majors: 1, ready: false });
  run(box, 'brief');
  writeRound(box, { minors: 1, ready: true });
  const done = run(box, 'finish');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Judge rounds: 2 of 2 done, on whether it is ready to ship,/);
  assert.doesNotMatch(done.out, /2 of 1 done/);
  assert.match(fs.readFileSync(dot(box, 'REPORT.md'), 'utf8'), /2 of 2 done/);
  box.cleanup();
});

test('a run that finished with a judge saying no can be ground afterwards, and finishing again replaces its row', () => {
  const box = sandbox();
  const notReady = FINDINGS.replace('## Verdict\n', '## Verdict\nReady to ship: no\n');
  makeProject(box, { rounds: 1, findings: notReady, triage: TRIAGE });
  const first = run(box, 'finish');
  assert.equal(first.code, 0, first.err + first.out);
  assert.match(first.out, /the last word was NOT ready to ship/);
  run(box, 'config', 'set', 'review.grind', 'true', '--local');
  assert.match(run(box, 'brief').out, /Round 2 of 2, whether it is ready to ship\./, 'a finished run is judged again from where its rounds stopped');
  assert.match(writeRound(box, { minors: 1, ready: true }).out, /\nGreen light\. The judge of round 2 said ready to ship/);
  const again = run(box, 'finish');
  assert.equal(again.code, 0, again.err + again.out);
  assert.match(again.out, /Judge rounds: 2 of 2 done, on whether it is ready to ship, and the last word was ready to ship\n/);
  assert.doesNotMatch(again.out, /Look first: The judge said NOT ready/);
  assert.equal(JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out).length, 1, 'the second finish replaced the row');
  box.cleanup();
});
