import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { planText, reach, reachLine, winsNeeded } from '../lib/eval/plan.mjs';
import { signTest } from '../lib/eval/stats.mjs';
import { bakeoff, judge, keyOf, OFF, ON, ORDERS, sees } from './bakeoff-helpers.mjs';
import { cli, ROOT, sandbox } from './helpers.mjs';

test('winsNeeded is the fewest wins the sign test calls under 0.05, and null when no count of that many pairs can', () => {
  assert.equal(winsNeeded(5), null, 'a clean sweep of 5 is p = 0.0625');
  assert.equal(winsNeeded(6), 6);
  assert.equal(winsNeeded(7), 7);
  assert.equal(winsNeeded(8), 8);
  assert.equal(winsNeeded(9), 8);
  assert.equal(winsNeeded(10), 9);
  for (const n of [6, 9, 12, 20]) {
    const wins = winsNeeded(n);
    assert.ok(signTest(wins, n - wins) < 0.05 && signTest(wins - 1, n - wins + 1) >= 0.05, `${n} pairs`);
  }
});

test('reach reads the best case for each arm from the pairs not yet judged', () => {
  const state = (wins, ties, realPairs, decisive = wins[ON] + wins[OFF]) => ({ arms: [OFF, ON], wins, realPairs, pairs: new Array(wins[ON] + wins[OFF] + ties).fill({}), decisive });
  assert.deepEqual(reach(state({ [OFF]: 0, [ON]: 4 }, 0, 6)).possible, [ON], '4 of 4 and 2 left can still be 6 of 6');
  assert.deepEqual(reach(state({ [OFF]: 3, [ON]: 3 }, 0, 20)).possible.sort(), [OFF, ON], 'a split with 14 left can still go either way');
  assert.deepEqual(reach(state({ [OFF]: 2, [ON]: 3 }, 0, 6)).possible, [], '3 against 2 and 1 left can reach 4 against 2 at best');
  assert.deepEqual(reach(state({ [OFF]: 0, [ON]: 0 }, 4, 6)).possible, [], '4 ties with 2 left is at most 2 decisive pairs');
  assert.equal(reachLine(state({ [OFF]: 0, [ON]: 6 }, 0, 6)), null, 'nothing left to judge, so the score says the rest');
  assert.match(reachLine(state({ [OFF]: 0, [ON]: 4 }, 0, 6)), /^Reach: 4 decisive pairs in 4 pairs judged so far, 2 pairs left\. "Ahead" is still possible for skill-on\.$/);
  assert.match(reachLine(state({ [OFF]: 0, [ON]: 0 }, 4, 6)), /^Reach: 0 decisive pairs in 4 pairs judged so far, 2 pairs left\. "Ahead" can no longer be reached.* stop judging and report "not shown"/);
});

test('planText states the counts, and quotes rates only for a run folder it is given', () => {
  assert.equal(planText(20), 'Plan. 20 briefs mean 40 arm runs and 44 judge runs, one helper at a time.', 'no run ships with the tool, so there are no rates to quote');
  assert.equal(planText(3), 'Plan. 3 briefs mean 6 arm runs and 10 judge runs, one helper at a time.');
  assert.equal(planText(4, '/nonexistent'), 'Plan. 4 briefs mean 8 arm runs and 12 judge runs, one helper at a time.', 'without a run there are no rates to quote');
});

test('init prints the plan, and status says when "ahead" can no longer be reached', () => {
  const box = sandbox();
  const { dir } = bakeoff(box, { n: 6 });
  const init = cli(['eval', 'bakeoff', 'init', path.join(box.dir, 'other'), '--first', '3'], { cwd: box.project, env: box.env });
  assert.equal(init.code, 0, init.err);
  assert.match(init.out, /\nPlan\. 3 briefs mean 6 arm runs and 10 judge runs/);

  judge(dir, sees(() => ON));
  const status = () => cli(['eval', 'bakeoff', 'status', dir], { cwd: box.project, env: box.env }).out.replace(/\s+/g, ' ');
  assert.doesNotMatch(status(), /Reach:/, 'every verdict is in, so there is nothing left to reach');

  const real = keyOf(dir).items.filter((item) => item.kind === 'real');
  const drop = (items) => { for (const item of items) for (const order of ORDERS) fs.rmSync(path.join(dir, 'judge', `${item.id}-${order}`), { recursive: true }); };
  drop(real.slice(0, 2));
  assert.match(status(), /Reach: 4 decisive pairs in 4 pairs judged so far, 2 pairs left\. "Ahead" is still possible for skill-on\./);

  judge(dir, sees(() => 'nobody'));
  drop(real.slice(0, 2));
  assert.match(status(), /Reach: 0 decisive pairs in 4 pairs judged so far, 2 pairs left\. "Ahead" can no longer be reached/);
  box.cleanup();
});
