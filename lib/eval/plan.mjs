import fs from 'node:fs';
import path from 'node:path';
import { signTest } from './stats.mjs';
import { ALPHA, MIN_DECISIVE, scoreBakeoff } from './tally.mjs';
import { plural } from './words.mjs';

// What a bake-off costs and what it can say, worked before the first helper starts and while the judging runs.
// The rates come from earlier runs, so they are measured numbers and not a guess, and they say which run they are from. No run ships with the tool,
// so a plan quotes rates only when it is given a run folder. The largest run sets the plan, and a smaller one that read differently is said beside it.
export const SHIPPED_RUNS = [];

// The fewest wins, out of this many decisive pairs, that the sign test calls under ALPHA. Null when no result of that many pairs can.
export function winsNeeded(decisive) {
  for (let wins = Math.floor(decisive / 2) + 1; wins <= decisive; wins += 1) if (signTest(wins, decisive - wins) < ALPHA) return wins;
  return null;
}

// Whether "ahead" can still be reached while some pairs are not judged. The best case for an arm is every pair left going its way.
export function reach(result) {
  const pending = result.realPairs - result.pairs.length;
  const possible = result.arms.filter((arm) => {
    const other = result.arms.find((name) => name !== arm);
    const wins = result.wins[arm] + pending;
    const losses = result.wins[other];
    return wins + losses >= MIN_DECISIVE && wins > losses && signTest(wins, losses) < ALPHA;
  });
  return { pending, possible };
}

// One line for `status` while judges are still to run, and nothing once every pair is in, because the score says the rest then.
export function reachLine(result) {
  const { pending, possible } = reach(result);
  if (!pending) return null;
  const soFar = `${plural(result.decisive, 'decisive pair')} in ${plural(result.pairs.length, 'pair')} judged so far, ${plural(pending, 'pair')} left`;
  if (possible.length) return `Reach: ${soFar}. "Ahead" is still possible for ${possible.join(' or ')}.`;
  return `Reach: ${soFar}. "Ahead" can no longer be reached, even if every pair left went one way. This is the time to stop judging and report "not shown", and to say it was stopped for that reason.`;
}

// Status is asked in every state a folder can be in. When the score cannot be worked out (a key that changed, say), score says why, and status says nothing here.
export function reachOf(dir) {
  try {
    return reachLine(scoreBakeoff(dir));
  } catch {
    return null;
  }
}

// The rates of one run: tokens and minutes for the arms of one brief, tokens and minutes for one judge run, and the share of pairs that were decisive.
function ratesOf(dir) {
  try {
    const runs = JSON.parse(fs.readFileSync(path.join(dir, 'runs.json'), 'utf8'));
    const result = scoreBakeoff(dir);
    const arms = Object.entries(runs).filter(([key]) => !key.startsWith('judge'));
    const judges = Object.entries(runs).filter(([key]) => key.startsWith('judge/')).sort(([, a], [, b]) => a.finishedAt.localeCompare(b.finishedAt));
    const briefs = result.realPairs;
    const sum = (list, field) => list.reduce((total, [, run]) => total + run[field], 0);
    // The judges ran one after another straight after the arms, so each one took the time since the one before it ended.
    const armsEnd = Math.max(...arms.map(([, run]) => Date.parse(run.finishedAt)));
    const judgeMinutes = (Date.parse(judges.at(-1)[1].finishedAt) - armsEnd) / 60000;
    const date = /bakeoff-(\d{4}-\d{2}-\d{2})/.exec(dir)?.[1];
    return {
      label: date ? `the run of ${date}` : 'an earlier run',
      briefs,
      armTokens: sum(arms, 'tokens') / briefs,
      armMinutes: sum(arms, 'minutes') / briefs,
      judgeTokens: sum(judges, 'tokens') / judges.length,
      judgeMinutes: judgeMinutes / judges.length,
      judges: judges.length,
      decisive: result.decisive,
      flips: result.flips,
      decisiveShare: result.decisive / result.realPairs,
      armTotal: sum(arms, 'tokens'),
      judgeTotal: sum(judges, 'tokens'),
    };
  } catch {
    return null;
  }
}

const millions = (tokens) => `${(tokens / 1e6).toFixed(1)}M`;
const hours = (minutes) => (minutes < 90 ? `${Math.round(minutes)} minutes` : `${(minutes / 60).toFixed(1)} hours`);

// The paragraph `init` prints: runs, tokens, time, and how many decisive pairs to expect at the rate of the largest run on record and what the word needs of them.
// Given a folder, it plans from that run alone.
export function planText(briefs, dir) {
  const arms = briefs * 2;
  const judges = (briefs + 2) * 2;
  const known = (dir ? [dir] : SHIPPED_RUNS).map(ratesOf).filter(Boolean).sort((a, b) => b.briefs - a.briefs);
  const head = `Plan. ${plural(briefs, 'brief')} mean ${plural(arms, 'arm run')} and ${plural(judges, 'judge run')}, one helper at a time.`;
  if (!known.length) return head;
  const [rates, ...others] = known;
  const tokens = briefs * rates.armTokens + judges * rates.judgeTokens;
  const minutes = briefs * rates.armMinutes + judges * rates.judgeMinutes;
  const cost = `${cap(rates.label)}${dir ? '' : ', the largest on record,'} used ${millions(rates.armTotal)} tokens for the arms of ${plural(rates.briefs, 'brief')} and ${millions(rates.judgeTotal)} for its ${plural(rates.judges, 'judge run')}. At those rates this run is about ${millions(tokens)} tokens and ${hours(minutes)} of helper time.`;
  const expected = Math.round(briefs * rates.decisiveShare);
  const share = `Decisive pairs in ${rates.label}: ${rates.decisive} of ${rates.briefs}${rates.flips ? `, and ${rates.flips} flipped with the order` : ''}.`;
  const need = expected >= MIN_DECISIVE ? winsNeeded(expected) : null;
  const power = expected < MIN_DECISIVE
    ? `At that rate ${plural(briefs, 'brief')} give about ${plural(expected, 'decisive pair')}, under the ${MIN_DECISIVE} the word needs, so the run would end "not shown".`
    : need === null
      ? `At that rate ${plural(briefs, 'brief')} give about ${plural(expected, 'decisive pair')}, and no result of that many passes the sign test.`
      : `At that rate ${plural(briefs, 'brief')} give about ${plural(expected, 'decisive pair')}. "Ahead" then needs ${need} of ${expected} (p = ${signTest(need, expected - need).toFixed(3)}), and ${need - 1} of ${expected} is p = ${signTest(need - 1, expected - need + 1).toFixed(3)}.`;
  const beside = others.filter((other) => Math.round(briefs * other.decisiveShare) !== expected).map((other) => `${cap(other.label)} had ${other.decisive} of ${other.briefs}, which would give about ${plural(Math.round(briefs * other.decisiveShare), 'decisive pair')}, so the count of decisive pairs varies a lot and this plan is a forecast and not a promise.`);
  return [head, cost, share, power, ...beside, `\`100x eval bakeoff status\` says when "ahead" can no longer be reached, and that is the time to stop judging.`].join(' ');
}

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
