import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NO_BIG_FINDING, ON_CARD, reasonParts, reasonsFor, reasonText, sharedState, shownReasons, whyNotReady } from '../lib/why-not.mjs';
import { badgeWords, decision, heldBack, lookTone, trustLine, worstReason } from '../lib/look-first.mjs';
import { runDir } from '../lib/run-dir.mjs';
import { afterFirstSentence, clipWords, firstSentence } from '../lib/text.mjs';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), '100x-why-'));
const stateOf = (root) => path.join(root, '.100x');
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test('the first sentence of a pitch is the one that says what the thing is, and the dots in numbers and e.g. do not end it', () => {
  assert.equal(firstSentence('A tip splitter for the dinner table. It rounds each share.'), 'A tip splitter for the dinner table.');
  assert.equal(afterFirstSentence('A tip splitter for the dinner table. It rounds each share.'), 'It rounds each share.');
  assert.equal(firstSentence('Splits a bill 3.5 ways, e.g. by item. Fast.'), 'Splits a bill 3.5 ways, e.g. by item.');
  assert.equal(firstSentence('A game\nof tag   for two. More.'), 'A game of tag for two.');
  assert.equal(firstSentence('Mr. Smith builds a game. Fun.'), 'Mr. Smith builds a game.', 'a title like Mr. does not end it');
  assert.equal(firstSentence('Ask Dr. Who, St. Louis style. Fun.'), 'Ask Dr. Who, St. Louis style.');
  assert.equal(firstSentence('Built by A. Smith for bakers. Fresh daily.'), 'Built by A. Smith for bakers.', 'a lone initial does not end it');
  assert.equal(firstSentence('Dr. A. Smith builds games. Fun.'), 'Dr. A. Smith builds games.');
  assert.equal(firstSentence('Hey! It builds games fast. Play now.'), 'Hey! It builds games fast.', 'a lead-in of a few words is not what the run is');
  assert.equal(firstSentence('Say less. Every page says less.'), 'Say less. Every page says less.', 'two short sentences are what it is, together');
  assert.equal(firstSentence('Say less.'), 'Say less.', 'a short pitch with nothing after it stays whole');
  assert.equal(firstSentence('Hey! it builds games fast and nothing else follows'), 'Hey! it builds games fast and nothing else follows', 'with no sentence after the lead-in, the whole pitch is what it is');
  assert.equal(afterFirstSentence('Hey! It builds games fast. Play now.'), 'Play now.');
  assert.equal(firstSentence('No full stop at the end'), 'No full stop at the end');
  assert.equal(afterFirstSentence('One sentence only.'), '');
  assert.equal(firstSentence(undefined), '');
});

test('a line is clipped at a word and says so, and a short one is left alone', () => {
  assert.equal(clipWords('Short one.', 40), 'Short one.');
  const clipped = clipWords('A very long sentence about a game with many words in it, so it has to be cut somewhere.', 40);
  assert.equal(clipped, 'A very long sentence about a game with…');
  assert.equal(clipWords('Tidy   up\nspaces.', 40), 'Tidy up spaces.');
});

const FINDINGS = `# Findings

## F1 [blocker] A **second tab** silently erases newer progress.
Where: save

## F2 [major] No undo: one mis-tap reschedules a card
Where: review screen

## F3 [major] The sound is sold unheard
Where: settings

## F4 [minor] Hint text is dim

## F5 [blocker] Opening a link from another phone shows a blank page

## Verdict
Ready to ship: no
Single most valuable change: Make the first minute work without an account
`;
const TRIAGE = `F1 accept. fixed in a1b2c3d
F2 defer. needs a design call
F3 reject. the sound is on purpose
F4 reject. decorative
`;

// A project folder whose judge's last round closed as round `slot`, with files of a later round still open beside it.
function reviewedRun({ ready = false, findings = FINDINGS, triage = TRIAGE, slot = 3 } = {}) {
  const root = folder();
  const review = path.join(stateOf(root), 'review');
  write(path.join(review, 'rounds.json'), JSON.stringify({ entries: [{ slot: 1, lens: 'code', ready: true }, { slot, lens: 'ship', ready }], current: null }));
  write(path.join(review, `round-${slot}`, 'findings.md'), findings);
  write(path.join(review, `round-${slot}`, 'triage.md'), triage);
  write(path.join(review, 'findings.md'), '## F1 [major] A finding from a round that has not closed\n');
  return root;
}

test('the judge\'s reasons are its blockers and majors, what still stands first, each with what became of it', () => {
  const state = stateOf(reviewedRun());
  const all = whyNotReady(state);
  assert.deepEqual(all, [
    { title: 'Opening a link from another phone shows a blank page', state: 'left' },
    { title: 'No undo: one mis-tap reschedules a card', state: 'left' },
    { title: 'A second tab silently erases newer progress', state: 'fixed' },
    { title: 'The sound is sold unheard', state: 'disagreed' },
  ], 'a finding nobody answered is still open, a blocker comes before a major, a fix comes after what still stands, and the builder\'s word against the judge\'s comes last. A minor is never a reason');
  assert.deepEqual(whyNotReady(state, { limit: 2 }), all.slice(0, 2));
});

test('a run keeps every reason the judge gave, the ranking and the message show the first three, a card the first two, and each counts the rest', () => {
  const many = Array.from({ length: 20 }, (_, i) => `## F${i + 1} [major] Reason number ${i + 1}\n`).join('\n');
  const root = reviewedRun({ findings: `${many}\n## Verdict\nReady to ship: no\n`, triage: '' });
  assert.equal(whyNotReady(stateOf(root)).length, 20, 'none is dropped, so a count of the rest is never short');
  const five = [1, 2, 3, 4, 5].map((n) => ({ title: `R${n}`, state: 'left' }));
  assert.deepEqual(shownReasons(five), { first: five.slice(0, 3), rest: five.slice(3), more: 2 });
  assert.deepEqual(shownReasons(five.slice(0, 3)), { first: five.slice(0, 3), rest: [], more: 0 });
  assert.deepEqual(shownReasons(five, ON_CARD), { first: five.slice(0, 2), rest: five.slice(2), more: 3 });
  assert.deepEqual(shownReasons([]), { first: [], rest: [], more: 0 });
});

test('the reasons come from the round the judge refused in, and not from the files of a later round', () => {
  const root = reviewedRun({ findings: '## F1 [blocker] The closed round says this\n\n## Verdict\nReady to ship: no\n', triage: 'F1 defer. later\n' });
  assert.deepEqual(whyNotReady(stateOf(root)), [{ title: 'The closed round says this', state: 'left' }]);
});

test('a judge that said yes, did not say, or left nothing behind gives no reasons, and reading writes nothing', () => {
  const yes = stateOf(reviewedRun({ ready: true }));
  assert.deepEqual(whyNotReady(yes), []);
  assert.deepEqual(whyNotReady(stateOf(reviewedRun({ ready: null }))), [], 'a judge that never said yes or no did not say no');
  assert.deepEqual(whyNotReady(stateOf(folder())), [], 'no review folder');
  const broken = folder();
  write(path.join(stateOf(broken), 'review', 'rounds.json'), '{not json');
  assert.deepEqual(whyNotReady(stateOf(broken)), []);
  const refused = stateOf(reviewedRun());
  const before = fs.readdirSync(refused, { recursive: true }).sort();
  whyNotReady(refused);
  assert.deepEqual(fs.readdirSync(refused, { recursive: true }).sort(), before);
});

test('a judge that said no and found nothing big gives its one top change, and a long title is cut at a word', () => {
  const minorsOnly = reviewedRun({ findings: '## F1 [minor] Dim hint\n\n## Verdict\nReady to ship: no\n- Single most valuable change: **Make the first minute work without an account.**\n', triage: 'F1 defer. later\n' });
  assert.deepEqual(whyNotReady(stateOf(minorsOnly)), [{ title: 'Make the first minute work without an account', state: 'wanted' }]);
  const nothing = reviewedRun({ findings: '## Verdict\nReady to ship: no\n', triage: '' });
  assert.deepEqual(whyNotReady(stateOf(nothing)), [{ title: NO_BIG_FINDING, state: 'none' }], 'a judge that said no and named nothing says so, and the empty list is never read as lost reasons');
  assert.deepEqual(reasonParts({ title: NO_BIG_FINDING, state: 'none' }), { title: 'The judge left no big finding on record', after: '' });
  for (const line of ['Single most valuable change: Fix the save button', '- **Single most valuable change:** Fix the save button', 'Most valuable change is to fix the save button', 'Single most valuable change - Fix the save button', 'Single most valuable change \u2014 Fix the save button', 'What is the single most valuable change? Fix the save button']) {
    const worded = reviewedRun({ findings: `## F1 [minor] Dim hint\n\n## Verdict\nReady to ship: no\n${line}\n`, triage: 'F1 defer. later\n' });
    assert.deepEqual(whyNotReady(stateOf(worded)).map((reason) => reason.state), ['wanted'], line);
    assert.match(whyNotReady(stateOf(worded))[0].title, /^(?:to )?[Ff]ix the save button$/, line);
  }
  const title = 'The save button does nothing when the list has more than a thousand rows and the phone is offline';
  const fits = reviewedRun({ findings: `## F1 [blocker] ${title}, so a night of edits is lost\n\n## Verdict\nReady to ship: no\n`, triage: 'F1 defer. later\n' });
  assert.equal(whyNotReady(stateOf(fits))[0].title, `${title}, so a night of edits is lost`, 'a title the run keeps is cut only past 240 characters, so the report can print it whole');
  const long = reviewedRun({ findings: `## F1 [blocker] ${`${title} `.repeat(4)}\n\n## Verdict\nReady to ship: no\n`, triage: 'F1 defer. later\n' });
  const [reason] = whyNotReady(stateOf(long));
  assert.ok(reason.title.length <= 241 && reason.title.endsWith('…') && !/\s…$/.test(reason.title), reason.title);
  const short = reasonParts(reason, 140).title;
  assert.ok(short.length <= 141 && short.endsWith('…') && !/\s…$/.test(short), `a card, the ranking and the message cut it again, at a word: ${short}`);
  assert.equal(reasonParts({ title: 'No undo', state: 'left' }, 140).title, 'No undo', 'a short title is left alone');
  assert.equal(reasonText({ title: `${title}, so a night of edits is lost`, state: 'left' }, 60).endsWith('… (left for later)'), true);
});

test('a reason is a title and, in a quieter voice, what became of it', () => {
  assert.deepEqual(reasonParts({ title: 'No undo', state: 'left' }), { title: 'No undo', after: 'left for later' });
  assert.equal(reasonText({ title: 'No undo', state: 'left' }), 'No undo (left for later)');
  assert.equal(reasonText({ title: 'No undo', state: 'fixed' }), 'No undo (fixed, not checked again)');
  assert.equal(reasonText({ title: 'No undo', state: 'disagreed' }), 'No undo (the builder disagreed)');
  assert.equal(reasonText({ title: 'Make it work offline', state: 'wanted' }), 'The judge\'s top change: Make it work offline');
});

test('the files of a finished run are in its folder until the project starts another run, and then in the archive that names it', () => {
  const root = folder();
  const state = stateOf(root);
  const entry = { id: 'aaaaaaaaaa', path: root };
  assert.equal(runDir(entry), state, 'a folder with no files is the live folder');
  write(path.join(state, 'finished.json'), JSON.stringify({ runId: 'aaaaaaaaaa' }));
  assert.equal(runDir(entry), state, 'the live folder holds this run');
  write(path.join(state, 'finished.json'), JSON.stringify({ runId: 'bbbbbbbbbb' }));
  write(path.join(state, 'archive', '20261101T010000Z', 'finished.json'), JSON.stringify({ runId: 'cccccccccc' }));
  write(path.join(state, 'archive', '20261102T010000Z', 'finished.json'), JSON.stringify({ runId: 'aaaaaaaaaa' }));
  assert.equal(runDir(entry), path.join(state, 'archive', '20261102T010000Z'), 'the live folder holds another run now, so the archive that names this one is its folder');
  const gone = runDir({ id: 'dddddddddd', path: root });
  assert.equal(fs.existsSync(gone), false, 'a run nobody archived while the live folder holds another run has no folder, so nothing shows the other run as this one');
  assert.deepEqual(reasonsFor({ id: 'dddddddddd', path: root, review: { status: 'reviewed', rounds: { lastReady: false } } }), [{ title: NO_BIG_FINDING, state: 'none' }], 'and it shows none of the other run\'s reasons, only that none is on record');
  fs.rmSync(path.join(state, 'finished.json'));
  assert.equal(fs.existsSync(runDir({ id: 'dddddddddd', path: root })), false, 'the next run has not finished and has no marker, and an archive that does not name this run does not make the live folder its');
  fs.rmSync(path.join(state, 'archive'), { recursive: true });
  assert.equal(runDir({ id: 'dddddddddd', path: root }), state, 'a project that never archived anything has the one run, and the live folder is its');
});

test('a closed round with an empty findings file gives no reasons, and does not borrow the files of the round after it', () => {
  const root = reviewedRun({ findings: '', triage: '' });
  assert.deepEqual(whyNotReady(stateOf(root)), [], 'the top-level file holds a later round\'s blocker, and it is not this round\'s');
  const noFolder = folder();
  const review = path.join(stateOf(noFolder), 'review');
  write(path.join(review, 'rounds.json'), JSON.stringify({ entries: [{ slot: 1, lens: 'ship', ready: false }], current: null }));
  write(path.join(review, 'findings.md'), '## F1 [blocker] Kept at the top by an older layout\n\n## Verdict\nReady to ship: no\n');
  assert.deepEqual(whyNotReady(stateOf(noFolder)), [{ title: 'Kept at the top by an older layout', state: 'left' }], 'a run with no round folder at all keeps its closed round at the top');
});

test('the reasons of a run are the ones it stored, else the ones in its folder, else the ones in its archive, and a run the judge passed has none', () => {
  const root = reviewedRun();
  const state = stateOf(root);
  write(path.join(state, 'finished.json'), JSON.stringify({ runId: 'aaaaaaaaaa' }));
  const refused = { id: 'aaaaaaaaaa', path: root, review: { status: 'reviewed', rounds: { lastReady: false } } };
  const states = (entry) => reasonsFor(entry).map((reason) => reason.state);
  assert.deepEqual(states(refused), ['left', 'left', 'fixed', 'disagreed'], 'read from its folder');
  const stored = [{ title: 'Stored at finish', state: 'fixed' }];
  assert.deepEqual(reasonsFor({ ...refused, review: { status: 'reviewed', rounds: { lastReady: false, why: stored } } }), stored, 'a run finished by this build keeps its own, whatever happens to the folder');
  assert.deepEqual(states({ ...refused, review: { status: 'reviewed', rounds: { lastReady: false, why: [] } } }), ['left', 'left', 'fixed', 'disagreed'], 'a stored empty list is read again from the folder, and does not stand for ever');
  for (const lastReady of [true, null]) assert.deepEqual(reasonsFor({ ...refused, review: { status: 'reviewed', rounds: { lastReady } } }), []);
  assert.deepEqual(reasonsFor({ ...refused, review: { status: 'unreviewed', note: 'no judge' } }), []);
  assert.deepEqual(reasonsFor({ id: 'ffffffffff', review: { status: 'reviewed', rounds: { lastReady: false, why: [] } } }), [{ title: NO_BIG_FINDING, state: 'none' }], 'a refused run with nothing to read still has one line, so no page draws a red box with nothing in it');
  const archive = path.join(state, 'archive', '20261102T010000Z');
  fs.mkdirSync(archive, { recursive: true });
  for (const name of ['review', 'finished.json']) fs.renameSync(path.join(state, name), path.join(archive, name));
  write(path.join(state, 'finished.json'), JSON.stringify({ runId: 'bbbbbbbbbb' }));
  assert.deepEqual(states(refused), ['left', 'left', 'fixed', 'disagreed'], 'the project started another run, and the reasons are read from the archive');
});

const run = (over = {}) => ({ verdict: 'ship', mode: 'prototype', mustNotBreak: [{ kind: 'numbers', status: 'pass' }], review: { status: 'reviewed', rounds: { lastReady: true } }, ...over });
const refused = (over = {}) => run({ review: { status: 'reviewed', rounds: { lastReady: false } }, ...over });
const unjudged = (over = {}) => run({ review: { status: 'unreviewed' }, ...over });

test('one line says why the runs to look at first are there, each run counted once under its most serious reason and the biggest group first', () => {
  const failing = refused({ mustNotBreak: [{ kind: 'numbers', status: 'fail' }] });
  const entries = [refused(), refused(), refused(), unjudged(), unjudged(), failing, run(), unjudged({ verdict: 'dud' }), unjudged({ mode: 'mockup' })];
  assert.equal(heldBack(entries), 'Why, the worst reason of each run: the judge said no to 3, no judge looked at 2, a check failed on 1.', 'the failing run is counted once, under its check, and the dud and the mockup are not on the list');
  assert.equal(heldBack([failing, refused()]), 'Why, the worst reason of each run: a check failed on 1, the judge said no to 1.', 'a tie goes to the more serious reason');
  assert.equal(heldBack([refused(), refused(), refused({ mode: 'mockup', mustNotBreak: [{ kind: 'numbers', status: 'fail' }] })]), 'Why, the worst reason of each run: the judge said no to 2.', 'a mockup is in a group of its own above the line, so it is in no count on it, even with a failed check');
  assert.equal(heldBack([run({ mustNotBreak: [] }), run({ mustNotBreak: [] })]), 'Why, the worst reason of each run: no check was recorded for 2.');
  assert.equal(heldBack([refused(), run(), run()]), '', 'a single run to look at already says why on its own card');
  assert.equal(heldBack([run(), run()]), '', 'nothing to look at, nothing to explain');
  assert.equal(heldBack([]), '');
});

test('trouble that was found is red and proof that is only missing is amber, and both are a run to look at first with their own badge words', () => {
  const matrix = { label: 'final', totals: { broken: 2, weak: 0, info: 0 }, viewports: 15, states: 106, examined: 100 };
  const cases = [
    ['judge said no', refused(), 'bad', 'judge-no', 'Judge said no'],
    ['a failed check', run({ mustNotBreak: [{ kind: 'numbers', status: 'fail' }] }), 'bad', 'check-failed', 'Check failed'],
    ['a broken screen', run({ matrix }), 'bad', 'broken', 'Broken screens'],
    ['no judge', unjudged(), 'warn', 'no-judge', 'No judge'],
    ['no check', run({ mustNotBreak: [] }), 'warn', 'no-check', 'No check'],
    ['a judge that never answered the ship question', run({ review: { status: 'reviewed', rounds: { lastReady: null } } }), 'warn', 'no-answer', 'No ship answer'],
    ['a judge that said no and a failed check', refused({ mustNotBreak: [{ kind: 'numbers', status: 'fail' }] }), 'bad', 'check-failed', 'Check failed'],
    ['no judge and a broken screen', unjudged({ matrix }), 'bad', 'broken', 'Broken screens'],
  ];
  for (const [name, entry, tone, kind, words] of cases) {
    assert.equal(trustLine(entry).tone, tone, `${name}: the tone`);
    assert.equal(trustLine(entry).held, true, `${name}: it is held back`);
    assert.equal(decision(entry), 'look', `${name}: it is a run to look at first`);
    assert.equal(worstReason(entry), kind, `${name}: the most serious reason`);
    assert.equal(badgeWords(kind), words, `${name}: the badge words`);
    assert.equal(lookTone(entry, entry.matrix, entry.mustNotBreak), tone, `${name}: the report page has the same tone`);
  }
  assert.deepEqual([trustLine(run()).tone, trustLine(run()).held, worstReason(run()), decision(run())], ['ok', false, null, 'ship'], 'a run with its proof has none of it');
  const silent = run({ review: { status: 'reviewed', rounds: { lastReady: null } } });
  assert.equal(trustLine(silent).text, 'The judge never said whether it is ready to ship.', 'the card does not say the checks pass for a judge that never answered');
  assert.equal(decision(silent), 'look', 'and the run is not filed or counted as ready to ship');
  const mockup = trustLine(unjudged({ mode: 'mockup' }));
  assert.deepEqual([mockup.tone, mockup.held], ['warn', false], 'a mockup says what it is, in amber, and is not held back');
  const borrowed = trustLine(run({ review: { status: 'reviewed', sameAsBuilder: true, rounds: { lastReady: true } } }));
  assert.deepEqual([borrowed.tone, borrowed.held], ['warn', false], 'a note is amber, and is not a reason to look first');
});

test('a count of broken things says it is added up over every screen size, so a big number is not read as a wreck', () => {
  const matrix = (over = {}) => ({ label: 'final', totals: { broken: 239, weak: 17, info: 0 }, viewports: 15, states: 106, examined: 26612, ...over });
  assert.equal(trustLine(run({ matrix: matrix() })).text, '239 things broken, counted across 15 screen sizes.');
  assert.equal(trustLine(run({ matrix: matrix({ totals: { broken: 1, weak: 0, info: 0 }, viewports: 1 }) })).text, '1 thing broken, counted across 1 screen size.');
  assert.equal(trustLine(run({ matrix: matrix({ viewports: 0 }) })).text, '239 things broken at some screen sizes.', 'a run that never said how many sizes it looked at keeps the plain count');
  assert.equal(trustLine(run({ matrix: matrix({ totals: { broken: 0, weak: 3, info: 0 } }) })).tone, 'ok', 'weak things alone are not a reason to look first');
});

test('reasons that all ended the same way are said once, and reasons that did not are left to say it each', () => {
  const two = (state) => [{ title: 'A', state }, { title: 'B', state }];
  assert.equal(sharedState(two('fixed')), 'Both reasons were fixed since. Neither was checked again.');
  const three = (state) => [...two(state), { title: 'C', state }];
  assert.equal(sharedState(three('fixed')), 'All 3 reasons were fixed since. None was checked again.');
  assert.equal(sharedState(two('left')), 'Both reasons were left for later.');
  assert.equal(sharedState(three('left')), 'All 3 reasons were left for later.');
  assert.equal(sharedState(two('disagreed')), 'The builder disagreed with both reasons.');
  assert.equal(sharedState(three('disagreed')), 'The builder disagreed with all 3 reasons.');
  assert.equal(sharedState([{ title: 'A', state: 'fixed' }, { title: 'B', state: 'left' }]), '');
  assert.equal(sharedState([{ title: 'A', state: 'fixed' }]), '', 'one reason keeps its own line');
  assert.equal(sharedState(two('wanted')), '');
  assert.equal(sharedState([]), '');
});
