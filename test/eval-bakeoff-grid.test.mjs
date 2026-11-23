import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { scoreBakeoff } from '../lib/eval/tally.mjs';
import { bakeoff, keyOf, ORDERS } from './bakeoff-helpers.mjs';
import { sandbox, write } from './helpers.mjs';

// The word "ahead" is the claim the whole bake-off exists to guard. This walks every way 12 real pairs can split between two arms and every way the
// judge can fail a control, writes the verdict files a judge would write, and checks the report against counts made from the scenario itself and a
// sign test written out again here, not against the tool's own helpers. The expected word is ahead only when every condition of the protocol holds.
const PAIRS = 12;
const REASON = 'the second layout reads more clearly';

const choose = (n, k) => {
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
};
const twoSided = (a, b) => {
  const n = a + b;
  if (n === 0) return 1;
  let tail = 0;
  for (let k = 0; k <= Math.min(a, b); k += 1) tail += choose(n, k);
  return Math.min(1, (2 * tail) / 2 ** n);
};

// A judge picks a page, and the letter it writes depends on where the page sat: the first page is A in order o1 and B in order o2.
const letter = (order, pick) => (pick === 'tie' ? 'tie' : (pick === 'first') === (order === 'o1') ? 'A' : 'B');
const other = (pick) => (pick === 'first' ? 'second' : 'first');
const side = (item, label) => (item.first === label ? 'first' : 'second');

function writeVerdicts(dir, picks, { why = () => REASON, skip = null } = {}) {
  for (const item of keyOf(dir).items) {
    ORDERS.forEach((order, index) => {
      const file = path.join(dir, 'judge', `${item.id}-${order}`, 'verdict.json');
      if (skip === `${item.id}-${order}`) return fs.rmSync(file, { force: true });
      write(file, JSON.stringify({ winner: letter(order, picks(item)[index]), why: why(item, order) }));
    });
  }
}

// What the judge does with the real pairs. Wins for each arm first, then ties and flips in a fixed rotation, so the counts are known from the spec.
function realPicks(dir, wins) {
  const arms = keyOf(dir).arms;
  const real = keyOf(dir).items.filter((item) => item.kind === 'real');
  const plan = new Map();
  let at = 0;
  let flips = 0;
  const give = (count, arm) => {
    for (let i = 0; i < count; i += 1) {
      const item = real[at++];
      const pick = side(item, arm);
      plan.set(item.id, [pick, pick]);
    }
  };
  give(wins[0], arms[0]);
  give(wins[1], arms[1]);
  const shapes = [['tie', 'tie'], ['first', 'tie'], ['tie', 'second']];
  for (let i = 0; at < real.length; i += 1) {
    const item = real[at++];
    if (i % 4 === 3) {
      plan.set(item.id, ['first', 'second']);
      flips += 1;
    } else plan.set(item.id, shapes[i % 3]);
  }
  return { plan, flips };
}

const CONTROLS = {
  sees: { trusted: true, planted: (item) => { const pick = side(item, 'intact'); return [pick, pick]; }, identical: () => ['tie', 'tie'] },
  'always says A': { trusted: false, planted: () => ['first', 'second'], identical: () => ['first', 'second'] },
  'prefers the blurred page': { trusted: false, planted: (item) => { const pick = side(item, 'blurred'); return [pick, pick]; }, identical: () => ['tie', 'tie'] },
  'names a winner between two identical pages': { trusted: false, planted: (item) => { const pick = side(item, 'intact'); return [pick, pick]; }, identical: () => ['first', 'first'] },
  'fails both': { trusted: false, planted: (item) => { const pick = side(item, 'blurred'); return [pick, pick]; }, identical: () => ['second', 'second'] },
};

const picksFor = (dir, wins, control) => {
  const { plan, flips } = realPicks(dir, wins);
  return { flips, picks: (item) => (item.kind === 'real' ? plan.get(item.id) : item.kind === 'planted' ? control.planted(item) : control.identical(item)) };
};

test('over every split of 12 pairs and every way a judge can fail a control, the word is ahead only when an independent count says so', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: PAIRS, seed: 11 });
  const key = keyOf(dir);
  const [armA, armB] = key.arms;
  const real = key.items.filter((item) => item.kind === 'real');
  assert.equal(real.length, PAIRS);
  assert.ok(real.filter((item) => item.first === armA).length >= 3 && real.filter((item) => item.first === armB).length >= 3, 'the seed puts each arm first in some pairs, or this walk would not test the order swap');

  let scenarios = 0;
  let ahead = 0;
  for (let a = 0; a <= PAIRS; a += 1) {
    for (let b = 0; a + b <= PAIRS; b += 1) {
      for (const [name, control] of Object.entries(CONTROLS)) {
        const { picks, flips } = picksFor(dir, [a, b], control);
        writeVerdicts(dir, picks);
        const result = scoreBakeoff(dir);
        const where = `${a} to ${b}, judge ${name}`;
        const p = twoSided(a, b);
        const expectAhead = control.trusted && a + b >= 6 && p < 0.05 && a !== b;
        assert.equal(result.wins[armA], a, where);
        assert.equal(result.wins[armB], b, where);
        assert.equal(result.decisive, a + b, where);
        assert.equal(result.ties, PAIRS - a - b, where);
        assert.equal(result.flips, flips, where);
        assert.ok(Math.abs(result.p - p) < 1e-12, `${where}: p is ${result.p}, worked out again it is ${p}`);
        assert.equal(result.judgeTrusted, control.trusted, where);
        assert.equal(result.verdict.word === 'ahead', expectAhead, `${where}: said ${result.verdict.word}, p ${p}`);
        assert.equal(/ is ahead:/.test(result.headline), expectAhead, `${where}: the headline says ${result.headline}`);
        if (expectAhead) {
          assert.equal(result.verdict.arm, a > b ? armA : armB, where);
          ahead += 1;
        }
        scenarios += 1;
      }
    }
  }
  assert.equal(scenarios, 91 * Object.keys(CONTROLS).length);
  assert.equal(ahead, 2 * 12, 'by the sign test, 12 splits of 12 pairs are ahead for each arm when the judge sees: 6 to 0 up to 12 to 0, 8 to 1 up to 11 to 1, and 10 to 2');
  box.cleanup();
});

test('a judge that sees and a clear lead still give no word when a verdict is missing or its reason names an arm, the key or the tasks', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: PAIRS, seed: 11 });
  const items = keyOf(dir).items;
  const firstReal = items.find((item) => item.kind === 'real');
  const lead = [10, 2];
  const { picks } = picksFor(dir, lead, CONTROLS.sees);

  writeVerdicts(dir, picks);
  assert.equal(scoreBakeoff(dir).verdict.word, 'ahead', 'the same lead is ahead when nothing is wrong');

  writeVerdicts(dir, picks, { skip: `${firstReal.id}-o2` });
  const missing = scoreBakeoff(dir);
  assert.equal(missing.verdict.word, 'not shown');
  assert.ok(missing.verdict.withheld && missing.missing.length === 1, 'one missing verdict withholds the word');

  const names = ['skill-on', 'skill-off', 'This is the work of arm-2', 'I read key.json first', 'I opened tasks/brief-1--skill-on.md', 'the 100x one is better', 'it follows SKILL.md'];
  for (const reason of names) {
    writeVerdicts(dir, picks, { why: (item, order) => (item.id === firstReal.id && order === 'o1' ? reason : REASON) });
    const result = scoreBakeoff(dir);
    assert.equal(result.verdict.word, 'not shown', `a reason that says "${reason}" is void`);
    assert.ok(result.verdict.withheld, reason);
  }
  box.cleanup();
});
