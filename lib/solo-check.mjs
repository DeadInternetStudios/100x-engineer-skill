import fs from 'node:fs';
import path from 'node:path';
import { clockSpan } from './clock.mjs';
import { passNames, runRows, startedAt, stateFile } from './project.mjs';
import { verifyOn } from './prompt.mjs';
import { loopFindingsFile, parseFindings } from './review.mjs';
import { findingsFile, readState, roundDir } from './rounds.mjs';
import { CHALLENGES, CHALLENGE_NAMES, LOOP_SUSPICIONS, ROUND_SUSPICIONS, challengeProblems, loopFindingCount, loopProblems, readChallenge, roundProblems, soloProof, suspicionProblems } from './solo.mjs';
import { helperRunsSince } from './spend.mjs';
import { plural } from './text.mjs';
import { readLedger } from './verify.mjs';

export const challengeFile = (root, name) => stateFile(root, 'solo', `${name}.md`);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

// A challenge is owed for a stage the run really went through. The plan and the build always happen. Core leaves a log row, depth leaves
// features in run.json, and the properties are attacked once the ledger has rows.
export function neededChallenges(root, run) {
  const rows = runRows(root);
  return CHALLENGE_NAMES.filter((name) => {
    // A skipped core (core.enabled false, or a big change with a clear spec) is logged as a skip, and a skip scored nothing to attack.
    // A dud variant ends early, with no depth, no must-not-break test and no review, so it owes no build challenge either.
    if (name === 'build') return run?.verdict !== 'dud';
    if (name === 'core') return rows.some((row) => row.phase === 'core' && !/\bskip(?:ped|s|ping)?\b/i.test(`${row.decision} ${row.result}`));
    if (name === 'depth') return Array.isArray(run?.features) && run.features.length > 0;
    if (name === 'properties') return verifyOn(root) && readLedger(root).length > 0;
    return true;
  });
}

// One entry for each challenge that is owed, with what is wrong with it. An empty list of problems is a challenge that passes.
export function challengeStatus(root, run) {
  return neededChallenges(root, run).map((name) => {
    const text = read(challengeFile(root, name));
    const problems = text === null
      ? [`is missing. ${CHALLENGES[name].stage}. \`100x solo new ${name}\` writes the file to fill in`]
      : challengeProblems(text, CHALLENGES[name], soloProof);
    return { name, file: `.100x/solo/${name}.md`, exists: text !== null, problems };
  });
}

// The files of the stage 6 rounds: each archived round, and the open one when it is not the same file as the last archived.
function roundFiles(root) {
  const entries = readState(root).entries;
  const files = entries.map((entry) => ({ label: `round ${entry.slot}`, file: path.join(roundDir(root, entry.slot), 'findings.md') })).filter(({ file }) => fs.existsSync(file));
  const open = read(findingsFile(root));
  if (open !== null && open !== read(files.at(-1)?.file ?? '')) files.push({ label: 'the open round', file: findingsFile(root) });
  return files;
}

// Everything `100x finish` asks of a solo run beyond a normal one. Nobody else started, each stage was attacked in writing, and every
// round and loop holds the suspicions that were written before the checks.
export function soloProblems(root, run) {
  const errors = [];
  const helpers = helperRunsSince(root, Date.parse(startedAt(root)) - 60000);
  if (helpers) errors.push(`solo. run.json says mode solo, but .100x/helpers.jsonl holds ${plural(helpers, 'helper run')}. A solo run starts no other model. A run that used one is not a solo run, and only the owner says whether to take the flag off, by editing .100x/run.json by hand`);
  if (fs.existsSync(stateFile(root, 'review', 'run.json'))) errors.push('solo. a judge command was started with `100x review-run` (.100x/review/run.json). A solo run starts no other model');
  for (const status of challengeStatus(root, run)) for (const problem of status.problems) errors.push(`solo. ${status.file} ${problem}`);
  let lastSeat = null;
  for (const { label, file } of roundFiles(root)) {
    const text = read(file);
    const { problems, broken } = suspicionProblems(text, { min: ROUND_SUSPICIONS }, soloProof);
    for (const problem of problems) errors.push(`solo. ${label}, findings.md ${problem}`);
    const found = parseFindings(text).findings.length;
    for (const problem of roundProblems(text, found)) errors.push(`solo. ${label}, findings.md ${problem}`);
    // Two rounds in a row sit in two chairs. A seat copied from the round before is the same look again.
    const seat = readChallenge(text).seat?.toLowerCase() ?? null;
    if (seat && seat === lastSeat) errors.push(`solo. ${label}, findings.md has the same seat as the round before. Sit somewhere else, the brief names the seat`);
    lastSeat = seat;
    if (broken > found) errors.push(`solo. ${label}, findings.md has ${plural(broken, 'broken suspicion')} and ${plural(found, 'finding')}. A suspicion that came out broken is a finding, with a severity`);
  }
  const loops = [...passNames(root), ...Array.from({ length: runRows(root).filter((row) => row.phase === 'round').length }, (_, i) => `round-${i + 1}`)];
  for (const name of loops) {
    const text = read(loopFindingsFile(root, name));
    if (text === null) continue;
    const { problems, broken } = suspicionProblems(text, { min: LOOP_SUSPICIONS }, soloProof);
    for (const problem of problems) errors.push(`solo. loop ${name}, judge.md ${problem}`);
    const found = loopFindingCount(text);
    for (const problem of loopProblems(text, found)) errors.push(`solo. loop ${name}, judge.md ${problem}`);
    if (broken > found) errors.push(`solo. loop ${name}, judge.md has ${plural(broken, 'broken suspicion')} and ${plural(found, 'finding')}. A suspicion that came out broken is a finding, a line that starts with its severity (blocker, major, minor or nit)`);
  }
  return errors;
}

const CLOCK_GRACE_MINUTES = 30;

// A solo run may finish UNREVIEWED only when the clock left no room for a round. The clock that says so is the owner's, set when
// the run began. One set at the end of the run, to a few minutes, would say it every time.
export function lateClock(root) {
  const span = clockSpan(root);
  const began = Date.parse(startedAt(root));
  if (!span || Number.isNaN(began) || Math.abs(span.setAt - began) <= CLOCK_GRACE_MINUTES * 60000) return null;
  const when = (ms) => new Date(ms).toISOString();
  return `the clock was set at ${when(span.setAt)} and the run began at ${when(began)}. A clock that is not the one the run began with cannot say there was no room for a round. Run stage 6 yourself: \`100x brief\`, \`100x review-call\`, and the round procedure in \`100x ref solo\``;
}
