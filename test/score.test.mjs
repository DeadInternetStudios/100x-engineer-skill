import assert from 'node:assert/strict';
import test from 'node:test';
import { decision } from '../lib/look-first.mjs';
import { compareEntries, factsOf } from '../lib/score.mjs';
import { sameGround } from '../lib/text.mjs';

const entry = (id, over = {}) => ({
  id,
  verdict: 'ship',
  mustNotBreak: [{ kind: 'screen-sizes', status: 'pass', summary: '0 broken of 212' }],
  matrix: { totals: { broken: 0, weak: 5 } },
  review: { status: 'reviewed' },
  polishPasses: 3,
  finishedAt: '2026-11-15T03:00:00Z',
  ...over,
});

const order = (entries) => [...entries].sort(compareEntries).map((e) => e.id);

test('the verdict decides first, then the measured facts, never the clock alone', () => {
  const entries = [
    entry('newest-but-failing', { mustNotBreak: [{ kind: 'numbers', status: 'fail', summary: '3 of 40 fail' }], finishedAt: '2026-11-15T07:00:00Z' }),
    entry('proved', { finishedAt: '2026-11-15T01:00:00Z' }),
    entry('fine-clean', { verdict: 'fine' }),
    entry('dud', { verdict: 'dud' }),
    entry('check-skipped', { mustNotBreak: [{ kind: 'screen-sizes', status: 'skipped', summary: 'no phone available here' }] }),
  ];
  assert.deepEqual(order(entries), ['proved', 'check-skipped', 'newest-but-failing', 'fine-clean', 'dud']);
});

test('among equal verdicts and must-not-break results, fewer broken then fewer weak findings come first', () => {
  const entries = [
    entry('weak-9', { matrix: { totals: { broken: 0, weak: 9 } } }),
    entry('broken-2', { matrix: { totals: { broken: 2, weak: 0 } } }),
    entry('weak-1', { matrix: { totals: { broken: 0, weak: 1 } } }),
    entry('no-screen', { matrix: null }),
  ];
  assert.deepEqual(order(entries), ['weak-1', 'weak-9', 'broken-2', 'no-screen']);
});

test('reviewed beats unreviewed, then more polish passes, then the newer run', () => {
  const entries = [
    entry('old', { finishedAt: '2026-11-14T03:00:00Z' }),
    entry('unreviewed', { review: { status: 'unreviewed', note: 'off' } }),
    entry('polished', { polishPasses: 5 }),
    entry('new'),
  ];
  assert.deepEqual(order(entries), ['polished', 'new', 'old', 'unreviewed']);
});

test('an old single must-not-break object and a list of checks rank the same way', () => {
  assert.equal(factsOf(entry('a', { mustNotBreak: { kind: 'numbers', status: 'pass', summary: '12 of 12' } })).mustNotBreak, 'pass');
  assert.equal(factsOf(entry('b', { mustNotBreak: [{ kind: 'a', status: 'pass', summary: '1' }, { kind: 'b', status: 'fail', summary: '2' }] })).mustNotBreak, 'fail');
  assert.equal(factsOf(entry('c', { mustNotBreak: undefined })).mustNotBreak, 'none');
});

test('a run the judge refused ranks below one of the same verdict that it did not, and a ready to ship the judge refused is look first, not ready to ship', () => {
  const refused = entry('refused', { review: { status: 'reviewed', rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false } } });
  const fine = entry('fine', { verdict: 'fine' });
  assert.deepEqual(order([refused, entry('backed'), fine]), ['backed', 'refused', 'fine']);
  assert.equal(decision(entry('backed')), 'ship');
  assert.equal(decision(refused), 'look');
  assert.equal(decision(entry('fine-refused', { verdict: 'fine', review: refused.review })), 'look');
  assert.equal(decision(entry('dud-refused', { verdict: 'dud', review: refused.review })), 'dud', 'a dud is already the worst word, so it keeps it');
  assert.equal(decision(entry('no-judge', { review: { status: 'unreviewed', note: 'off' } })), 'look');
  assert.equal(decision(entry('mockup', { mode: 'mockup', review: { status: 'unreviewed', note: 'by design' } })), 'ship', 'a mockup has no judge by design, so its verdict stands');
});

test('inside a verdict a run nobody backed goes last, so the top of the page is never a run that only has the builder\'s word', () => {
  const noJudge = { review: { status: 'unreviewed', note: 'off' } };
  const noCheck = { mustNotBreak: [] };
  const refused = { review: { status: 'reviewed', rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false } } };
  const entries = [
    entry('unbacked', { ...noJudge, ...noCheck, finishedAt: '2026-11-15T09:00:00Z' }),
    entry('refused', refused),
    entry('judged-only', noCheck),
    entry('checked-only', noJudge),
    entry('fine-backed', { verdict: 'fine' }),
    entry('fine-unbacked', { verdict: 'fine', ...noJudge, ...noCheck }),
  ];
  assert.deepEqual(order(entries), ['checked-only', 'judged-only', 'refused', 'unbacked', 'fine-backed', 'fine-unbacked']);
  assert.equal(factsOf(entries[0]).unbacked, true);
  assert.equal(factsOf(entries[1]).unbacked, false, 'a judge that said no still looked');
  assert.equal(factsOf(entry('skipped', { ...noJudge, mustNotBreak: [{ kind: 'screen-sizes', status: 'skipped', summary: 'no phone available here' }] })).unbacked, true, 'a check that was skipped holds nothing');
});

test('a mockup ranks after every run that was built and judged, whatever its verdict, and keeps its own verdict', () => {
  const mockup = entry('mockup', { mode: 'mockup', review: { status: 'unreviewed', note: 'by design' } });
  const refused = entry('refused', { verdict: 'fine', review: { status: 'reviewed', rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false } } });
  const dud = entry('dud', { verdict: 'dud' });
  assert.deepEqual(order([mockup, dud, refused, entry('backed')]), ['backed', 'refused', 'dud', 'mockup']);
  assert.equal(factsOf(mockup).mockup, true);
  assert.equal(factsOf(entry('backed')).mockup, false);
});

test('two sentences say the same thing when a third of the shorter one is in the other, and nothing is the same as nothing', () => {
  const tells = ['Run it in any git repo and one screen shows where the weight is, what changed lately and who touched it, which files change together, and the files to fear.', 'Run it in a repo you have never seen and one screen says where to start, which file to respect, which files move together and whom to ask.'];
  assert.equal(sameGround(...tells), true, 'the pair a judge flagged as one sentence twice');
  const lamp = ['An idle game about keeping a lighthouse lit over a living coast. Ships pay for safe passage, and the lamp keeps earning while the tab is closed.', 'At dusk the lamp comes on, its beam sweeps across a living bay, and each ship it catches pays out in a shower of light that you can also trigger by tapping the lamp.'];
  assert.equal(sameGround(...lamp), false, 'a pitch and a moment that share three words are two sentences');
  assert.equal(sameGround('', ''), false);
  assert.equal(sameGround(undefined, 'Tap once'), false);
});
