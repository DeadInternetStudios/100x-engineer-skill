import { CliError } from './errors.mjs';
import { readRun } from './project.mjs';

// A solo run is the whole 100x pipeline done by one model in one chat. No helper, judge or child ever starts. Every second look that a
// normal run gets from another model is this model attacking its own work, in writing, with proof from running it. run.json says
// `mode: solo`, the commands that would start another model refuse, and `100x finish` checks the challenge files in .100x/solo.
export function isSolo(root) {
  if (!root) return false;
  try {
    return readRun(root)?.mode === 'solo';
  } catch {
    // A damaged run.json is reported by the command that needs it, in its own words. A guard is never the first thing to fail on it.
    return false;
  }
}

export function refuseWhenSolo(root, what) {
  if (!isSolo(root)) return;
  throw new CliError(`This is a solo run (run.json says mode solo), so no other model starts: ${what}. The model in this chat builds and judges, and \`100x ref solo\` says how it challenges its own work. Only the owner can decide that this run is not solo, by editing .100x/run.json by hand.`);
}

// The flag is one way for the life of a run. An agent that could take it off could start a helper and put it back.
export function refuseModeChange(root, key, value) {
  const unquoted = typeof value === 'string' ? value.trim().replace(/^(["'])(.*)\1$/, '$2') : value;
  if (!/^mode(\.|$)/.test(key) || !isSolo(root) || (key === 'mode' && unquoted === 'solo')) return;
  throw new CliError('This is a solo run, and the solo flag stays for the life of the run. Taking it off is the owner\'s call, made by editing .100x/run.json by hand. Nothing in a solo run may start another model.');
}

// The challenge files of a run, one per stage. `when` names what makes one required, and `min` is how many suspicions it holds at least.
export const CHALLENGES = {
  plan: {
    min: 5,
    stage: 'Stage 0, after the prompt check, before any code',
    seat: 'the owner reading project.md cold on day two, who wanted something else',
    read: 'project.md and the brief, word for word. Not your reasons for the plan',
    questions: [
      'Does every ask trace to words in the brief, and is there a word in the brief that no ask covers?',
      'Which ask would I close on weak evidence, and what would strong evidence be?',
      'Which line under Properties or Rules is a claim that can be false? Write the case that would break it.',
      'What is the riskiest assumption, really? Does the Core slice test it, or something easier?',
      'What did I assume instead of asking, and which assumption is expensive to undo?',
      'What would make the owner drop this on day two? What is the best alternative, and why would anyone pick this?',
    ],
  },
  core: {
    min: 5,
    stage: 'Stage 1, after the Core score, before the verdict stands',
    seat: 'the owner opening the slice cold, with one minute',
    read: 'the running slice and its screenshots. Not the core log row or your notes',
    questions: [
      'Did the slice test the riskiest assumption, or an easier one?',
      'Score it again with the tests in `100x ref core`, from the screenshots alone. What did you see for each, and would a stranger score higher or lower?',
      'Would I send this screenshot to a friend, or am I flattered by how hard it was to make?',
      'Pivot or go on: what evidence says go on, and what would a pivot look like?',
      'What is the weakest second of the moment, and what makes it feel cheap?',
      'Does it start from the project\'s own command on a fresh clone?',
    ],
  },
  build: {
    min: 5,
    stage: 'Stage 2, when the asks are closed, before polish',
    seat: 'a stranger on a fresh clone who owes the builder nothing',
    read: 'the running product, the README and the Asks list. Not STATE.md and not your commit messages',
    questions: [
      'From a fresh clone, do the install and run commands work exactly as written?',
      'Which ask did I close on evidence I did not run again just now? Run it again.',
      'What breaks with empty, huge, hostile, double submitted or offline input?',
      'What did I leave as a stub, a TODO or a hard coded value that a user will hit?',
      'What does the first screen show with no data, with one item and with a thousand?',
      'Where does an error reach the user, and what does it say? What is the first line in the console?',
    ],
  },
  depth: {
    min: 5,
    stage: 'Stage 3, after the predicted features are built, before polish',
    seat: 'the owner who asked for none of the extra features and will notice every one',
    read: 'run.json features, their cut hints and the predicted follow ups in project.md',
    questions: [
      'Does each feature cut cleanly? Run the cut for each one, then run the moment.',
      'Is each one a prediction of what the owner will ask for, or something I wanted to build?',
      'Does any feature make the moment worse, slower or busier?',
      'Did any feature leak into the core flow, the data or the first screen?',
      'Which feature would the owner delete first?',
    ],
  },
  properties: {
    min: 5,
    stage: 'Stage 5, once the ledger has rows, before the first review round',
    seat: 'an adversary who holds the specification and is paid for every counterexample',
    read: 'verify/ledger.tsv, the code each row covers and `100x ref properties`. Not the comments in the models',
    questions: [
      'For each row, write an input or a sequence of steps that breaks the sentence, and run it against the real code.',
      'What five things must always be true about this logic that no row states? Think of conservation, order, doing it twice, bounds and who may do it.',
      'What does each model leave out? Widen one bound or add the missing case, and run it again.',
      'Which rows hold only at the smallest size? Say so in the level, and say what is not covered.',
      'Did each red run fail for the seeded defect, and not for a typo?',
      'Which covered code changed since its row last ran?',
    ],
  },
};
export const CHALLENGE_NAMES = Object.keys(CHALLENGES);
export const RECHECK_MIN = 3;
export const ROUND_SUSPICIONS = 8;
export const LOOP_SUSPICIONS = 5;

export const QUESTION = 'Let\'s analyze this. Is it correct? Is it good? Be brutal. Assume it is not, and find out why.';

// The seat a round takes by its lens. A look from the builder's own chair finds what the builder already believes, so each look
// starts by sitting somewhere else.
export const SEATS = {
  code: ['a staff engineer who is paged when this breaks and did not write it', 'a tester paid for every bug, who starts with the inputs nobody expected'],
  product: ['a stranger on a phone with ten seconds to spare, who owes the maker nothing', 'a first time user on the slowest phone, who cannot ask anyone and will not read a manual'],
  ship: ['a person deciding whether to put their name on this, who knows the best alternative', 'a competitor reading it to find the reason not to pick it'],
};
// `nth` counts the earlier rounds of the same lens, so the second code round sits in the second code seat.
export const seatFor = (lens, nth = 0) => SEATS[lens][Math.max(0, nth) % SEATS[lens].length];

// The chairs of the loops, one for each pass or round in turn.
export const LOOP_SEATS = [
  'a stranger on a phone who did not build this and owes its maker nothing',
  'a user on the slowest phone who cannot ask anyone and will not read a manual',
  'a skeptic who has used the best alternative for years and wants a reason to stay',
];
const loopSeat = (name) => LOOP_SEATS[(Number(/(\d+)$/.exec(name)?.[1] ?? 1) - 1) % LOOP_SEATS.length];

export function challengeTemplate(name) {
  const c = CHALLENGES[name];
  return `# Challenge: ${name}
Seat: ${c.seat}

${QUESTION}

Read only: ${c.read}. Do not reread STATE.md, your decision notes or your own earlier answers until you reach Fixes. They are why you cannot see the flaws.

Questions to start from. Add your own.
${c.questions.map((question) => `- ${question}`).join('\n')}

Write the suspicions before you run anything, at least ${c.min}. One list item each, in this form, and no list item for the form itself:
S1 <a sentence that could be false>. Proof: <the command in backticks and its output, a screenshot path you opened, a file or a commit>. Result: holds | broken

## Suspicions

## Recheck
Seat: <a different person than above, for example a user on the slowest phone>
(Only when nothing broke above: at least ${RECHECK_MIN} more list items from that seat, with harder inputs, in the same form but numbered R1, R2 and so on.)

## Fixes
(One list item for each broken suspicion: what changed, the commit, and what you ran again to see it hold.)

Verdict: open
(holds: nothing broke, and the recheck is done. fixed: every broken one is fixed and run again.)
`;
}

// What a proof may point at. The normal run's test lets a bare digit through, and a self-review is the place where that matters:
// a number is what you write when nothing was run. A command in backticks, a file or a commit is what a reader can go and check.
const PROOF = /`(?=[^`]*[a-z])(?:[^`]*[\s\/.][^`]*|[^`]{3,})`|\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|(?:[\w@.-]+\/)+[\w@-]+\.[a-z][a-z0-9]{1,5}\b|\.100x\/[\w@./-]+|\b[\w-]{2,}\.[a-z][a-z0-9]{1,5}\b/i;
export const soloProof = (text) => PROOF.test(text);

// A list item is one line, plus the lines that continue it until a blank line, a heading or the next item.
const LIST_ITEM = /^\s*(?:[-*]|\d+[.)])\s+(\S.*)$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const SECTIONS = ['suspicions', 'recheck', 'fixes'];
// A finding line starts with a severity word, in the shapes the repository already uses: `major: x`, `F1 [major] x`, `[major] x`, `## F1 [major] x`.
const FINDING_LINE = /^\s*(?:#{1,4}\s+)?(?:(?:[-*]|\d+[.)])\s+)?\**(?:F\d+\s+)?\[?(blocker|major|minor|nit)\b/i;

export function readChallenge(text) {
  const out = { seat: null, recheckSeat: null, verdict: null, suspicions: [], recheck: [], fixes: [] };
  let section = null;
  let item = null;
  const flush = () => {
    if (item && section) out[section].push(item.join(' '));
    item = null;
  };
  for (const line of String(text).split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const word = heading[2].trim().toLowerCase().split(/\W+/)[0];
      section = SECTIONS.includes(word) ? word : null;
      continue;
    }
    const seat = /^\**Seat:\**\s*(.*)$/i.exec(line);
    if (seat) {
      flush();
      const said = seat[1].replace(/\*+$/, '').trim();
      if (section === 'recheck') out.recheckSeat ??= said;
      else if (section === null) out.seat ??= said;
      continue;
    }
    // A finding written under the suspicions ends the list. It is not a suspicion without an id.
    if (FINDING_LINE.test(line) && !(item && /^\s{2,}\S/.test(line)) && (section === 'suspicions' || section === 'recheck')) {
      flush();
      section = null;
      continue;
    }
    const verdict = /^\**Verdict:\**\s*\**([a-z]+)/i.exec(line);
    if (verdict) {
      flush();
      out.verdict = verdict[1].toLowerCase();
      continue;
    }
    if (!section) continue;
    const listed = LIST_ITEM.exec(line);
    if (listed) {
      flush();
      item = [listed[1].trim()];
    } else if (item && line.trim()) item.push(line.trim());
    else flush();
  }
  flush();
  return out;
}

const proofOf = (text) => /\bproof:\s*(.*?)(?=\s*\bresult:|$)/i.exec(text)?.[1]?.trim() ?? '';
const resultOf = (text) => /\bresult:\s*\**(holds|broken)\b/i.exec(text)?.[1]?.toLowerCase() ?? null;
const clip = (text) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);

// Every suspicion has to name what was run or seen and say how it came out. `checkable` is the test the triage uses for a reason.
const idOf = (text) => /^\**(S\d+|R\d+)\b/i.exec(text)?.[1]?.toUpperCase() ?? null;

export function itemProblems(items, checkable, label = 'suspicion', prefix = 'S') {
  const problems = [];
  const seen = new Set();
  items.forEach((text, index) => {
    const where = `${label} ${index + 1} ("${clip(text)}")`;
    const id = idOf(text);
    if (!id || !id.startsWith(prefix)) problems.push(`${where} has no id. Start it with ${prefix}1, ${prefix}2 and so on, so a fix can name it`);
    else if (seen.has(id)) problems.push(`${where} reuses the id ${id}`);
    seen.add(id);
    if (!checkable(proofOf(text))) problems.push(`${where} has no proof. After "Proof:" name a command in backticks, a file path or a commit. A bare number is not proof`);
    if (!resultOf(text)) problems.push(`${where} says no result. End it with "Result: holds" or "Result: broken"`);
  });
  return problems;
}

export const brokenCount = (items) => items.filter((text) => resultOf(text) === 'broken').length;
const brokenIds = (items) => items.filter((text) => resultOf(text) === 'broken').map(idOf).filter(Boolean);

// A finding in a loop's judge.md is a line that starts with a severity word. The loop has no findings list of its own.
export const loopFindingCount = (text) => String(text).split('\n').filter((line) => FINDING_LINE.test(line)).length;

// A challenge file passes when it holds enough suspicions with proof, a clean look was looked at again from another seat, and every
// break was fixed and run again. A break that nobody fixed, or a verdict left open, does not pass.
export function challengeProblems(text, { min }, checkable) {
  const c = readChallenge(text);
  const problems = [];
  const placeholder = (seat) => !seat || seat.startsWith('<');
  if (placeholder(c.seat)) problems.push('has no "Seat:" line before the first heading. Say who you were for this look');
  if (c.suspicions.length < min) problems.push(`holds ${c.suspicions.length} suspicions under "## Suspicions" and needs at least ${min}`);
  problems.push(...itemProblems(c.suspicions, checkable));
  const all = [...c.suspicions, ...c.recheck];
  const broken = brokenCount(all);
  if (!c.verdict || c.verdict === 'open') problems.push('has no verdict yet. Close it with "Verdict: holds" or "Verdict: fixed"');
  else if (!['holds', 'fixed'].includes(c.verdict)) problems.push(`has the verdict "${c.verdict}". It is holds or fixed`);
  else if (broken > 0 && c.verdict === 'holds') problems.push(`has ${broken} broken suspicion${broken === 1 ? '' : 's'} and the verdict holds. Fix them, run them again and say "Verdict: fixed"`);
  else if (broken === 0 && c.verdict === 'fixed') problems.push('says fixed, and no suspicion is broken');
  if (broken > 0) {
    if (c.fixes.length === 0) problems.push(`has ${broken} broken suspicion${broken === 1 ? '' : 's'} and no list item under "## Fixes"`);
    for (const [index, fix] of c.fixes.entries()) if (!checkable(fix)) problems.push(`fix ${index + 1} ("${clip(fix)}") names no commit, path or command. Say what changed and what you ran again`);
    for (const id of brokenIds(all)) if (!c.fixes.some((fix) => new RegExp(`^\\**${id}\\b`, 'i').test(fix))) problems.push(`${id} came out broken and no fix starts with it. Start its item under "## Fixes" with ${id}`);
  } else if (c.suspicions.length >= min) {
    // The list comes first. A recheck is owed once there is a list that found nothing.
    if (c.recheck.length < RECHECK_MIN) problems.push(`found nothing, so it was looked at again from another seat. "## Recheck" needs at least ${RECHECK_MIN} list items and has ${c.recheck.length}`);
    if (placeholder(c.recheckSeat)) problems.push('has no "Seat:" line under "## Recheck". A second look from the same chair finds the same things');
    else if (c.seat && c.recheckSeat.toLowerCase() === c.seat.toLowerCase()) problems.push('has the same seat in "## Recheck" as above. Look again from another one');
  }
  // The recheck holds its own items however the look came out, so a break found there is held to the same rules.
  if (c.recheck.length > 0) problems.push(...itemProblems(c.recheck, checkable, 'recheck item', 'R'));
  return problems;
}

// What a round or a loop file has to hold, which is the brief's own format plus a list of suspicions written first.
export function suspicionProblems(text, { min }, checkable) {
  const items = readChallenge(text).suspicions;
  const problems = [];
  if (items.length < min) problems.push(`holds ${items.length} suspicions under "## Suspicions" and needs at least ${min}, written before the checks`);
  problems.push(...itemProblems(items, checkable));
  return { problems, broken: brokenCount(items) };
}

// A round's findings.md also says who judged and, when it found nothing, that it looked again.
export function roundProblems(text, findings) {
  const c = readChallenge(text);
  const problems = [];
  if (!c.seat || c.seat.startsWith('<')) problems.push('has no "Seat:" line before the first heading. Say who you were for this round, as the brief asks');
  if (findings === 0 && !/^\s*\**Rechecked:\**\s*\S/im.test(text)) problems.push('has no findings and no "Rechecked:" line. A look that finds nothing is looked at again from another seat, and the line says what that second look found');
  return problems;
}

// A loop's judge.md names the chair it was judged from, and a loop that found nothing says what the second look found.
export function loopProblems(text, findings) {
  const problems = [];
  const seat = /^\s*\**Seat:\**\s*(\S.*)$/im.exec(text)?.[1];
  if (!seat || seat.startsWith('<')) problems.push('has no "Seat:" line. Write the chair from step 2 on the line after "Judged by:"');
  if (findings === 0 && !/^\s*\**Rechecked:\**\s*\S/im.test(text)) problems.push('has no findings and no "Rechecked:" line. A look that finds nothing is looked at again from another seat, and the line says what that second look found');
  return problems;
}

// What the brief and the loop task say in a solo run. The judge's own brief is written for another model, so a solo run swaps the
// parts that assume one.
export const BRIEF_INTRO = 'You built this, and now you judge it. This is a solo run: no other model looks and no helper starts, so nobody catches what you miss. Its owner is about to decide whether to publish it and put their name on it, for the people it is meant for. Your question: is it correct, is it good, is it ready to ship? Be brutal. Do not soften, balance or praise to be polite. Shipping may mean a paid product, a free tool, an open-source or MIT-licensed project or a skill other people install. Never count the lack of a price, payments, a business model or a sales route against it unless the asks name one. Every flaw you miss comes back as a bug report, a bad review or a lost user. If you would not use it or recommend it to the person it is for, say that first. You know why every choice was made, and that is the bias. Judge only what the files and the running product show, never what you remember intending.';

export const briefSeat = (lens, nth) => `Your seat this round: ${seatFor(lens, nth)}. Say it on the first line of findings.md, as "Seat: ...". Until the findings are written you are that person and did not build this.`;

export const briefRules = (findings, dir) => [
  `- Write ${findings} first, complete, before you change anything. Fixes come after triage, never during the look. Screenshots go under ${dir}. Do not commit, deploy or push while you judge.`,
  '- Do not read STATE.md, your earlier answers or commit messages to decide that something is fine. They are context, not proof. Run it and look.',
  `- Before you run anything, write at least ${ROUND_SUSPICIONS} suspicions under "## Suspicions" at the top of findings.md. One list item each, a sentence that could be false, in the form "S1 <suspicion>. Proof: <the command in backticks and its output, a screenshot path you opened, a file or a commit>. Result: holds | broken". Fill in Proof and Result as you test. Every suspicion that comes out broken is also a finding below, one finding for each, that names its id. Not a single one may stay without proof.`,
  '- Reject nothing in your head. A flaw you wave off without writing it down is the flaw you will ship.',
];

export const EARLIER_SOLO = 'You judged this in an earlier round, then answered your own findings. Do not trust those answers. Check them.';

export const CLEAN_LOOK = 'A look that finds nothing is suspect. Say what you tried and what each try would have shown if the work were broken. Then look again from the seat of a different person with harder inputs, and write one line that starts with "Rechecked:" and says what that second look found. Only then may the file stand with no findings.';

export function loopSteps({ name, ask, findings, answers, minutes }) {
  return [
    `Loop ${name}. Solo: you did this work and you judge it. Nobody else looks. ${QUESTION}`,
    '1. Commit what you have, so the work you judge cannot change while you judge it.',
    `2. Sit in this chair: ${loopSeat(name)}. Do not reread STATE.md, your decision notes or your earlier answers. They are why you cannot see the flaws.`,
    `3. Open ${ask} for the paths of the before and after screenshots and the run command, and read nothing more of it yet. When the product has a screen, open the before and after contact sheets, then the single full-size screenshots: the smallest phone, the landscape phone and the widest desktop. Write one line per screen into ${findings} under "## First look", of what a stranger sees in ten seconds. Counts are not looking. If you cannot see images, write that as the first finding with the severity blocker, and write "Better: no".`,
    `4. Now read the rest of the ask: what this loop tried to do. Choose how it must be judged and say it on the first line of ${findings}: "Judged by: looking" for work a user sees or feels, "running" for flows and behavior, "numbers" for math, speed and data, "words" for text. A loop can need two. Pick the way that is hardest on the work, not the way that is easiest for you. On the second line write "Seat: " and the chair from step 2.`,
    `5. Write at least ${LOOP_SUSPICIONS} suspicions under "## Suspicions", each a sentence that could be false, in the form "S1 <suspicion>. Proof: <the command in backticks and its output, a screenshot path you opened, a file or a commit>. Result: holds | broken". Then test them: run the product with the command in the ask, do the main flow, look at every state you reach, use your own inputs and recompute any number another way.`,
    '6. Under a "## Findings" heading below the suspicions, write the findings, short, one line each that starts with a severity word (blocker, major, minor, nit) and says what you saw, not what you remember. Every broken suspicion is a finding of its own, named by its id.',
    '7. End the file with exactly these two lines: "Drifting: yes" or "Drifting: no", then "Better: yes" or "Better: no". Drifting means the work is moving away from the moment or into a bad idea, even when each change looks fine.',
    `8. ${CLEAN_LOOK}`,
    `9. Only now write ${answers}: for each finding, fixed (say where) or rejected with evidence. To reject one, first write the best case that it is right, then the command or screenshot that beats it.`,
    `10. You have ${minutes} minutes. Never play sound. Start no other agent. When done, say the Judged by line, the finding counts, the Drifting and Better lines.`,
  ];
}
