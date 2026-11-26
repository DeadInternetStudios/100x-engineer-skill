#!/usr/bin/env node
// Property checker for the final message that `100x finish` prints, `chatSummary` in lib/report.mjs.
// It explores every mix of optional data a run can have, builds the message with the real function, and checks what the message promises.
// Copied from skills/100x/assets/property-checker.mjs. The engine is below the line that says ENGINE.
//
//   node verify/final-message.check.mjs [--json]
//
// The six properties, in this file.
//   state          the shape of a run as the message sees it: a verdict, a judge, a review, rounds, reasons, checks, screen sizes, asks, work, next asks, steps, a url.
//   transitions    one piece of data changes at a time, and the message that is built from the new run shows the change.
//   preconditions  a run with no review has no rounds, and only a judge that said no has reasons. The message is never asked for such a run.
//   postconditions after a change, every part of the message that is not about the changed piece reads exactly as before.
//   invariants     what the message always holds, in every mix: the verdict alone on line 1, the reason on line 2, every label once when its
//                  data exists and not at all when it does not, the blocks in order, no stray blank lines, nothing missing, the same text twice.
//   liveness       none that needs an assumption. The message is built by a function that returns for every state in the model, and every state has a next step or is a stop.
import { chatSummary } from '../lib/report.mjs';

const env = (name, fallback) => (process.env[name] === undefined ? fallback : Number(process.env[name]));
const MAX_STATES = env('MAX_STATES', 200000);
const MAX_DEPTH = env('MAX_DEPTH', Infinity);

// ---- The implementation under test. ----
const TITLE = 'Glow';
const WHY = 'The first tap lights the screen. Nothing else is claimed.';
const MOMENT = 'The first tap lights the whole screen.';
const SAY = { ship: 'ready to ship', fine: 'fine', dud: 'needs work' };
const STEPS = ['Tap once and watch the glow', 'Tap five times fast', 'Turn the phone sideways'];
const CHECKS = [
  { kind: 'numbers', status: 'pass', summary: '40 cases match a hand count, 0 failing' },
  { kind: 'screen-sizes', status: 'fail', summary: '3 broken of 212 elements' },
];
const REASONS = [
  { title: 'Upgrade button clipped at 320px', state: 'fixed' },
  { title: 'A second tab erases newer notes', state: 'left' },
  { title: 'The total ignores a refund', state: 'disagreed' },
  { title: 'Dark mode hides the border', state: 'left' },
  { title: 'The empty list has no hint', state: 'left' },
];
const NEXT = ['Save a list of friends', 'Round up to the dollar', 'Share the split as a picture', 'Add a tip jar', 'Dark mode'];
const LAST_READY = { ready: true, notready: false, silent: null };

function entryOf(s) {
  const reviewed = s.review === 'reviewed';
  return {
    title: TITLE,
    pitch: 'PITCH-SENTENCE-THAT-THE-CHAT-MESSAGE-NO-LONGER-CARRIES.',
    verdict: s.verdict,
    verdictWhy: WHY,
    moment: MOMENT,
    runCmd: 'npm start',
    url: s.url ? 'http://localhost:5173' : undefined,
    tryFirst: STEPS.slice(0, s.steps),
    mustNotBreak: CHECKS.slice(0, s.checks),
    review: reviewed
      ? {
          status: 'reviewed',
          model: 'model-x',
          sameAsBuilder: s.judge !== 'other',
          solo: s.judge === 'solo',
          flags: 3,
          fixed: 2,
          rounds: s.rounds === 'none' ? undefined : { held: 2, planned: 3, lenses: ['the code and how it behaves'], lastReady: LAST_READY[s.rounds], why: s.rounds === 'notready' && s.reasons ? REASONS.slice(0, s.reasons) : undefined },
        }
      : { status: 'unreviewed', note: 'no judge was available' },
    matrix: s.matrix === 'ok' ? { totals: { broken: 0, weak: 1 }, viewports: 15, examined: 148 } : s.matrix === 'broken' ? { totals: { broken: 4, weak: 1 }, viewports: 15, examined: 148 } : undefined,
    matrixSkipped: s.matrix === 'skipped' ? 'a command line tool has no screen' : undefined,
    asks: s.asks ? { closed: 2, total: 3 } : { closed: 0, total: 0 },
    work: s.work ? { minutes: 120, totalMinutes: 180, rounds: 4 } : undefined,
    nextAsks: NEXT.slice(0, s.nextAsks),
    path: '/tmp/glow-verify',
  };
}

const CRASH = 'THE MESSAGE COULD NOT BE BUILT: ';
const cache = new Map();
const keyOf = (s) => JSON.stringify(s);
const summaryOf = (s) => {
  const key = keyOf(s);
  if (!cache.has(key)) {
    // A message that cannot be built is a finding about that state, so it is named and not a stack trace.
    try { cache.set(key, chatSummary(entryOf(s))); } catch (error) { cache.set(key, `${CRASH}${error.message}`); }
  }
  return cache.get(key);
};

// Lines of a message, with each line tied to the label that owns it. A numbered line, and "and N more", belong to the label above them.
function parse(text) {
  const lines = text.split('\n');
  const owner = [];
  let label = null;
  lines.forEach((line, index) => {
    if (line === '') { owner.push(null); return; }
    if (index === 0) label = 'headline';
    else if (index === 1) label = 'why';
    else if (/^\d+\) /.test(line) || /^and \d+ more in the report$/.test(line)) { /* stays with the label above */ } else {
      const found = line.match(/^(Look first|Why not ready to ship|The moment|Run|Try first|Must not break|Review|Judged by|Judge rounds|Looked at|Screen sizes|Asks|Work|Report|Next likely asks)\b/);
      label = found ? found[1] : `unknown:${line}`;
    }
    owner.push(label);
  });
  return { lines, owner };
}
const linesOf = (text, wanted) => { const { lines, owner } = parse(text); return lines.filter((_, i) => owner[i] === wanted); };
const countOf = (text, wanted) => { const { lines, owner } = parse(text); return lines.filter((line, i) => owner[i] === wanted && !/^\d+\) /.test(line) && !/^and \d+ more/.test(line) && line !== '').length; };
const ORDER = ['headline', 'why', 'Look first', 'Why not ready to ship', 'The moment', 'Run', 'Try first', 'Must not break', 'Review', 'Judged by', 'Judge rounds', 'Looked at', 'Screen sizes', 'Asks', 'Work', 'Report', 'Next likely asks'];

// What the data says should be there, written from the data and not from the code.
const wanted = (s) => {
  const reviewed = s.review === 'reviewed';
  return {
    headline: 1,
    why: 1,
    'Look first': s.checks === 0 || s.checks === 2 || s.matrix === 'broken' || !reviewed || s.rounds === 'notready' || s.rounds === 'silent' ? 1 : 0,
    'Why not ready to ship': reviewed && s.rounds === 'notready' ? 1 : 0,
    'The moment': 1,
    Run: 1,
    'Try first': 1,
    'Must not break': s.checks,
    Review: 1,
    'Judged by': reviewed && s.judge !== 'other' ? 1 : 0,
    'Judge rounds': reviewed && s.rounds !== 'none' ? 1 : 0,
    'Looked at': reviewed && s.rounds !== 'none' ? 1 : 0,
    'Screen sizes': 1,
    Asks: s.asks ? 1 : 0,
    Work: s.work ? 1 : 0,
    Report: 1,
    'Next likely asks': s.nextAsks ? 1 : 0,
  };
};

// ---- The model. ----
// A run is these fields. A review that is not there has no rounds, and only a judge that said no has reasons.
const VALUES = {
  verdict: ['ship', 'fine', 'dud'],
  judge: ['other', 'same', 'solo'],
  review: ['reviewed', 'unreviewed'],
  rounds: ['none', 'ready', 'notready', 'silent'],
  reasons: [0, 1, 4],
  checks: [0, 1, 2],
  matrix: ['none', 'ok', 'broken', 'skipped'],
  asks: [0, 1],
  work: [0, 1],
  nextAsks: [0, 2, 5],
  steps: [1, 3],
  url: [0, 1],
};
const valid = (s) => (s.review === 'reviewed' || s.rounds === 'none') && (s.rounds === 'notready' || s.reasons === 0);
// The verdict fills the first line and the judge adds one line, and nothing else reads either. Each is tried with every other piece at its start value, which keeps the model at a few thousand states.
const ISOLATED = ['verdict', 'judge'];
const START = { review: 'reviewed', rounds: 'ready', reasons: 0, checks: 1, matrix: 'ok', asks: 1, work: 0, nextAsks: 2, steps: 3, url: 1 };
const atStart = (s) => Object.entries(START).every(([field, value]) => s[field] === value);
const allowed = (s, field) => (ISOLATED.includes(field) ? atStart(s) && ISOLATED.filter((other) => other !== field).every((other) => s[other] === VALUES[other][0]) : ISOLATED.every((other) => s[other] === VALUES[other][0]));
const setField = (state, [field, value]) => {
  const next = { ...state, [field]: value };
  if (!valid(next)) throw new Error(`${field} = ${value} is not a run the message can be asked about`);
  if (!allowed(state, field)) throw new Error('the verdict and the judge are tried on their own, and the other pieces on a run that is ready to ship and judged by another model');
  return next;
};
// The parts of the message each field may change. Everything else has to read as it did.
const FAMILY = {
  verdict: ['headline'],
  judge: ['Judged by'],
  review: ['Review', 'Judged by', 'Look first', 'Judge rounds', 'Looked at', 'Why not ready to ship'],
  rounds: ['Look first', 'Judge rounds', 'Looked at', 'Why not ready to ship'],
  reasons: ['Why not ready to ship'],
  checks: ['Must not break', 'Look first'],
  matrix: ['Screen sizes', 'Look first'],
  asks: ['Asks'],
  work: ['Work'],
  nextAsks: ['Next likely asks'],
  steps: ['Try first'],
  url: ['Run'],
};

const model = {
  name: 'the final message, every mix of optional data',
  assumptions: [
    'one run at a time, the values listed for each field and the data below stand for every run (3 verdicts, review or none, 4 round outcomes, 0, 1 or 4 reasons, 0 to 2 checks, 4 screen size outcomes, asks, work, 0, 2 or 5 next asks, 1 or 3 steps, a url or none)',
    'the verdict and the judge are each tried with every other piece at its start value, because only line 1 reads the verdict and only one line reads the judge',
    'the text of each value is fixed: a longer title, reason or step is not tried here, because finish refuses them above a length before the message is built',
    'only the layout of the message is checked here. The words of each line are the words the report and the tests already pin',
  ],
  init: () => ({ verdict: 'ship', judge: 'other', review: 'reviewed', rounds: 'ready', reasons: 0, checks: 1, matrix: 'ok', asks: 1, work: 0, nextAsks: 2, steps: 3, url: 1 }),
  terminal: () => true,
  actions: [
    {
      name: 'set',
      params: () => Object.entries(VALUES).flatMap(([field, values]) => values.map((value) => [field, value])),
      pre: (s, [field, value]) => valid({ ...s, [field]: value }) && s[field] !== value && allowed(s, field),
      apply: setField,
      post: (before, after, [field, value]) => {
        if (summaryOf(before) === summaryOf(after)) return `changing ${field} to ${value} changed nothing in the message`;
        const a = parse(summaryOf(before));
        const b = parse(summaryOf(after));
        for (const label of ORDER) {
          if (FAMILY[field].includes(label)) continue;
          const was = a.lines.filter((_, i) => a.owner[i] === label).join('\n');
          const now = b.lines.filter((_, i) => b.owner[i] === label).join('\n');
          if (was !== now) return `changing ${field} also changed what ${label} says: ${JSON.stringify(was)} became ${JSON.stringify(now)}`;
        }
        return true;
      },
    },
  ],
  invariants: [
    {
      name: 'every-mix-builds-a-message',
      holds: (s) => !summaryOf(s).startsWith(CRASH) || summaryOf(s),
    },
    {
      name: 'verdict-alone-on-line-one',
      holds: (s) => {
        const [first, second] = summaryOf(s).split('\n');
        if (first !== `${TITLE}: ${SAY[s.verdict]}.`) return `line 1 is ${JSON.stringify(first)}, not the title and the verdict alone`;
        return second === WHY || `line 2 is ${JSON.stringify(second)}, not the reason`;
      },
    },
    {
      name: 'the-pitch-is-left-to-the-report',
      holds: (s) => !summaryOf(s).includes('PITCH-SENTENCE') || 'the pitch is in the chat message',
    },
    {
      name: 'every-label-once-when-its-data-exists',
      holds: (s) => {
        const text = summaryOf(s);
        for (const [label, count] of Object.entries(wanted(s))) {
          const found = countOf(text, label);
          if (found !== count) return `${label} appears ${found} times, and the data says ${count}`;
        }
        return true;
      },
    },
    {
      name: 'steps-one-per-line',
      holds: (s) => {
        const lines = linesOf(summaryOf(s), 'Try first');
        const expect = ['Try first:', ...STEPS.slice(0, s.steps).map((step, i) => `${i + 1}) ${step}`)];
        return JSON.stringify(lines) === JSON.stringify(expect) || `Try first reads ${JSON.stringify(lines)}`;
      },
    },
    {
      name: 'reasons-one-per-line',
      holds: (s) => {
        if (!(s.review === 'reviewed' && s.rounds === 'notready')) return true;
        const lines = linesOf(summaryOf(s), 'Why not ready to ship');
        const shown = Math.min(3, Math.max(1, s.reasons));
        const numbered = lines.filter((line) => /^\d+\) /.test(line));
        const more = lines.filter((line) => /^and \d+ more in the report$/.test(line));
        if (lines[0] !== 'Why not ready to ship:') return `the reasons start with ${JSON.stringify(lines[0])}`;
        if (numbered.length !== shown) return `${numbered.length} reasons are shown, and ${shown} should be`;
        if (s.reasons > 3 ? more.length !== 1 || !more[0].startsWith(`and ${s.reasons - 3} more`) : more.length !== 0) return `the line that says how many more are in the report is ${JSON.stringify(more)}`;
        return true;
      },
    },
    {
      name: 'blocks-in-order-with-one-blank-line-between',
      holds: (s) => {
        const text = summaryOf(s);
        if (text.startsWith('\n') || text.endsWith('\n') || text.includes('\n\n\n')) return 'a blank line leads, trails or doubles';
        const { lines, owner } = parse(text);
        const labels = owner.filter((x, i) => x !== null && owner.indexOf(x) === i);
        const rank = labels.map((label) => ORDER.indexOf(label));
        if (rank.some((r) => r < 0) || rank.some((r, i) => i > 0 && r < rank[i - 1])) return `the parts come in the order ${labels.join(', ')}`;
        const startsBlock = (label) => { const i = owner.indexOf(label); return i > 0 && lines[i - 1] === ''; };
        if (!startsBlock('The moment')) return 'the moment does not start its own block';
        if (!startsBlock('Report')) return 'the report line does not start its own block';
        const firstCheck = ['Must not break', 'Review'].find((label) => owner.includes(label));
        if (!startsBlock(firstCheck)) return `${firstCheck} does not start the block of checks`;
        const blank = lines.filter((line) => line === '').length;
        return blank === 3 || `there are ${blank} blank lines, and 3 are expected between 4 blocks`;
      },
    },
    {
      name: 'every-fact-is-kept',
      holds: (s) => {
        const text = summaryOf(s);
        const must = [`Run: npm start${s.url ? ', then open http://localhost:5173' : ''}`, `The moment: ${MOMENT.replace(/\.$/, '')}`, 'Report: file:///tmp/glow-verify/.100x/REPORT.html', 'Review'];
        for (const check of CHECKS.slice(0, s.checks)) must.push(check.summary);
        if (s.review === 'reviewed' && s.rounds !== 'none') {
          must.push('Judge rounds: 2 of 3 done', 'Looked at: the code and how it behaves');
          must.push({ ready: 'the last word was ready to ship', notready: 'the last word was NOT ready to ship', silent: 'with no last word from the judge' }[s.rounds]);
        }
        if (s.review === 'reviewed' && s.judge !== 'other') must.push(s.judge === 'solo' ? 'Judged by: the same model that built it. A solo run, so no other model looked' : 'Judged by: the same model that built it');
        if (s.asks) must.push('Asks: 2 of 3 closed');
        if (s.work) must.push('Work: 2 h of 3 h asked for, 4 rounds');
        if (s.matrix === 'skipped') must.push('Screen sizes: skipped, a command line tool has no screen');
        if (s.matrix === 'ok') must.push('Screen sizes: 0 broken, 1 weak, 15 sizes and 148 elements checked');
        if (s.matrix === 'none') must.push('Screen sizes: not run');
        if (s.nextAsks) must.push(`Next likely asks: ${NEXT.slice(0, Math.min(3, s.nextAsks)).join('; ')}${s.nextAsks > 3 ? `; and ${s.nextAsks - 3} more in the report` : ''}`);
        for (const reason of REASONS.slice(0, s.review === 'reviewed' && s.rounds === 'notready' ? Math.min(3, s.reasons) : 0)) must.push(reason.title);
        const missing = must.filter((piece) => !text.includes(piece));
        return missing.length === 0 || `the message lost ${JSON.stringify(missing)}`;
      },
    },
    {
      name: 'clean-lines',
      holds: (s) => {
        const text = summaryOf(s);
        if (/[ \t]$/m.test(text)) return 'a line ends with a space';
        if (/undefined|NaN|\[object/.test(text)) return 'the message holds undefined, NaN or [object';
        return true;
      },
    },
    {
      name: 'same-run-same-message',
      holds: (s) => chatSummary(entryOf(s)) === chatSummary(entryOf(s)) || 'two calls gave two messages',
    },
  ],
  liveness: [],
};

// ---- ENGINE. No need to edit below this line. ----
const canon = (value) => JSON.stringify(value, (key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]]))
  : item));
const say = (value) => { const text = JSON.stringify(value); return text.length > 150 ? `${text.slice(0, 147)}...` : text; };
const labelOf = (action, param) => (param === undefined ? action.name : `${action.name}(${JSON.stringify(param)})`);
const verdict = (value) => (value === true || value === undefined ? null : typeof value === 'string' ? value : 'it is false');

const keys = [];
const states = [];
const depths = [];
const out = [];
const parent = [];
const open = [];
const seen = new Map();
let truncated = false;
let transitions = 0;

const results = new Map(); // check name -> { ok, detail, trace, count }
const register = (name) => { if (!results.has(name)) results.set(name, { ok: true, more: 0, count: 0 }); return results.get(name); };
// The steps to a failure are built only for the first one, because a long run of failures must not cost a path each.
function fail(name, message, at, extra) {
  const entry = register(name);
  if (!entry.ok) { entry.more += 1; return; }
  entry.ok = false;
  entry.message = message;
  entry.labels = at === null ? [] : [...pathTo(at), ...(extra ? [extra] : [])];
  entry.at = at;
}
const pathTo = (index) => { const labels = []; for (let at = index; parent[at]; at = parent[at][0]) labels.unshift(parent[at][1]); return labels; };

function discover(state, from, label) {
  const key = canon(state);
  const known = seen.get(key);
  if (known !== undefined) return known;
  if (states.length >= MAX_STATES) { truncated = true; return -1; }
  const index = states.length;
  seen.set(key, index);
  keys.push(key);
  states.push(state);
  depths.push(from === null ? 0 : depths[from] + 1);
  out.push([]);
  open.push(false);
  parent.push(from === null ? null : [from, label]);
  return index;
}

const initial = model.init();
for (const state of Array.isArray(initial) ? initial : [initial]) discover(state, null, null);
for (const invariant of model.invariants ?? []) register('inv:' + invariant.name);
for (const action of model.actions) { register('guard:' + action.name); register('post:' + action.name); }
register('pure');
register('deadlock');
register('coverage');
const fired = new Set();
const terminal = model.terminal ?? (() => false);

for (let i = 0; i < states.length; i += 1) {
  const state = states[i];
  for (const invariant of model.invariants ?? []) {
    const entry = register('inv:' + invariant.name);
    entry.count += 1;
    const bad = verdict(invariant.holds(state));
    if (bad) fail('inv:' + invariant.name, bad, i);
  }
  if (depths[i] >= MAX_DEPTH) { open[i] = true; truncated = true; continue; }
  let enabledCount = 0;
  for (const action of model.actions) {
    const guard = register('guard:' + action.name);
    for (const param of action.params ? action.params(state) : [undefined]) {
      const label = labelOf(action, param);
      if (action.pre(state, param)) {
        enabledCount += 1;
        let next;
        try {
          next = action.apply(state, param);
        } catch (error) {
          fail('guard:' + action.name, 'the model allows ' + label + ' but the implementation refused it: ' + error.message, i, label);
          continue;
        }
        guard.count += 1;
        if (canon(state) !== keys[i]) {
          fail('pure', label + ' changed the state it was given. Return a new state and leave the old one alone', i, label);
          states[i] = JSON.parse(keys[i]);
        }
        fired.add(action.name);
        const post = register('post:' + action.name);
        post.count += 1;
        const bad = action.post ? verdict(action.post(state, next, param)) : null;
        if (bad) fail('post:' + action.name, bad, i, label);
        const target = discover(next, i, label);
        transitions += 1;
        if (target === -1) open[i] = true;
        else out[i].push([label, target]);
      } else if (action.refuses !== false) {
        let applied = null;
        try {
          applied = action.apply(state, param);
        } catch {
          guard.count += 1;
          continue;
        }
        if (canon(applied) === keys[i]) guard.count += 1;
        else {
          fail('guard:' + action.name, 'the model forbids ' + label + ' but the implementation accepted it and changed the state to ' + say(applied), i, label);
          // What the code really does is reachable too, so the invariants judge it. A step the code accepts and the spec forbids is marked with a !.
          const target = discover(applied, i, '!' + label);
          transitions += 1;
          if (target === -1) open[i] = true;
          else out[i].push(['!' + label, target]);
        }
      }
    }
  }
  if (enabledCount === 0 && !terminal(state)) fail('deadlock', 'no step is possible and the model does not call this a stopping point', i);
}

const exhaustive = !truncated;
const never = model.actions.filter((action) => !fired.has(action.name) && action.optional !== true).map((action) => action.name);
if (never.length && exhaustive) fail('coverage', 'these steps were never possible in any reachable state: ' + never.join(', ') + '. Check the model, or mark one optional', null);

// Liveness. Strong fairness: a run that avoids to forever must end in a closed set of states that all avoid to.
function components(allowed) {
  const index = new Array(states.length).fill(-1);
  const low = new Array(states.length).fill(0);
  const onStack = new Array(states.length).fill(false);
  const comp = new Array(states.length).fill(-1);
  const stack = [];
  const comps = [];
  let counter = 0;
  for (let root = 0; root < states.length; root += 1) {
    if (!allowed(root) || index[root] !== -1) continue;
    index[root] = low[root] = counter; counter += 1;
    stack.push(root);
    onStack[root] = true;
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      if (frame[1] < out[v].length) {
        const w = out[v][frame[1]][1];
        frame[1] += 1;
        if (!allowed(w)) continue;
        if (index[w] === -1) {
          index[w] = low[w] = counter; counter += 1;
          stack.push(w);
          onStack[w] = true;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
        if (low[v] === index[v]) {
          const members = [];
          let w;
          do { w = stack.pop(); onStack[w] = false; comp[w] = comps.length; members.push(w); } while (w !== v);
          comps.push(members);
        }
      }
    }
  }
  return { comp, comps };
}

const reverse = states.map(() => []);
states.forEach((_, i) => { for (const [, j] of out[i]) if (j >= 0) reverse[j].push(i); });
let fullGraph = null;

function checkLiveness(property) {
  const name = 'live:' + property.name;
  const entry = register(name);
  if (!exhaustive) { entry.ok = false; entry.message = 'not decided. The exploration stopped at a bound, so a state that looks stuck may only be unexplored. Raise MAX_STATES and MAX_DEPTH, or shrink the model'; entry.labels = []; entry.at = null; return; }
  const goal = states.map((state) => Boolean(property.to(state)));
  const starts = states.map((state, i) => !goal[i] && Boolean(property.from(state)));
  const count = states.filter((state) => property.from(state)).length;
  entry.count = count;
  if (count === 0) { entry.ok = false; entry.message = 'vacuous. No reachable state satisfies from, so nothing was checked'; entry.labels = []; entry.at = null; return; }
  const seeds = new Set();
  if ((property.fairness ?? 'strong') === 'strong') {
    fullGraph ??= components(() => true);
    fullGraph.comps.forEach((members, id) => {
      const closed = members.every((v) => out[v].every(([, w]) => fullGraph.comp[w] === id));
      if (closed && members.every((v) => !goal[v])) for (const v of members) seeds.add(v);
    });
  } else {
    const { comps } = components((v) => !goal[v]);
    comps.forEach((members) => {
      const loops = members.length > 1 || out[members[0]].some(([, w]) => w === members[0]);
      if (loops) for (const v of members) seeds.add(v);
    });
    states.forEach((_, v) => { if (!goal[v] && out[v].length === 0) seeds.add(v); });
  }
  // Every state that can reach a seed without passing through to.
  const doomed = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const v = queue.shift();
    for (const u of reverse[v]) if (!goal[u] && !doomed.has(u)) { doomed.add(u); queue.push(u); }
  }
  const bad = starts.findIndex((isStart, i) => isStart && doomed.has(i));
  if (bad === -1) return;
  // The way from the bad state into the trap, staying away from to.
  const via = new Map([[bad, null]]);
  const walk = [bad];
  let trapped = seeds.has(bad) ? bad : -1;
  for (let at = 0; at < walk.length && trapped === -1; at += 1) {
    for (const [label, w] of out[walk[at]]) {
      if (goal[w] || via.has(w)) continue;
      via.set(w, [walk[at], label]);
      walk.push(w);
      if (seeds.has(w)) { trapped = w; break; }
    }
  }
  const tail = [];
  for (let at = trapped; via.get(at); at = via.get(at)[0]) tail.unshift(via.get(at)[1]);
  entry.ok = false;
  entry.message = 'from ' + say(states[bad]) + ' the run can stay away from to forever. It gets stuck at ' + say(states[trapped]);
  entry.labels = [...pathTo(bad), ...tail];
  entry.at = trapped;
}
for (const property of model.liveness ?? []) checkLiveness(property);

const level = exhaustive ? 'exhaustive' : 'bounded';
const deepest = depths.reduce((most, depth) => Math.max(most, depth), 0);
const describe = (name, entry) => {
  if (!entry.ok) {
    const trace = entry.labels?.length ? ' Steps: ' + entry.labels.join(', ') + '.' : '';
    const more = entry.more ? ' (and ' + entry.more + ' more)' : '';
    return entry.message + more + '.' + trace;
  }
  if (name.startsWith('inv:')) return entry.count + ' states checked, ' + level;
  if (name.startsWith('guard:')) return entry.count + ' enabled and refused cases agree with the implementation, ' + level;
  if (name.startsWith('post:')) return entry.count + ' transitions checked, ' + level;
  if (name === 'pure') return 'no apply changed its input';
  if (name === 'deadlock') return 'every state has a step or is a stopping point, ' + level;
  if (name === 'coverage') return exhaustive ? 'every step was possible somewhere, ' + fired.size + ' of ' + model.actions.length : fired.size + ' of ' + model.actions.length + ' steps reached so far. Not decided on a bounded search';
  if (name.startsWith('live:')) return 'holds from ' + entry.count + ' states under ' + ((model.liveness.find((p) => 'live:' + p.name === name).fairness ?? 'strong')) + ' fairness, exhaustive';
  return 'ok';
};
const checks = [...results].map(([name, entry]) => ({ name, ok: entry.ok, level: name.startsWith('live:') || exhaustive ? level : 'bounded', detail: describe(name, entry) }));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ model: model.name, exhaustive, states: states.length, transitions, depth: deepest, assumptions: model.assumptions ?? [], checks }, null, 2));
} else {
  console.log('Model ' + model.name + '. ' + states.length + ' states, ' + transitions + ' transitions, deepest path ' + deepest + '.');
  console.log(exhaustive
    ? 'Exhaustive. Every reachable state was visited, so a pass is a proof for this model and these bounds.'
    : 'BOUNDED. The exploration stopped at ' + MAX_STATES + ' states or depth ' + MAX_DEPTH + '. A pass means nothing was found in what was visited, not a proof.');
  for (const line of model.assumptions ?? []) console.log('  assumes ' + line);
  for (const check of checks) console.log((check.ok ? 'pass' : 'FAIL') + '  ' + check.name + '. ' + check.detail);
}
process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
