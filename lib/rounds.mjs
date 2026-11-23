import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { headCommit } from './git.mjs';
import { stateFile } from './project.mjs';
import { writeJson } from './write-json.mjs';

export const reviewDir = (root) => stateFile(root, 'review');
export const briefFile = (root) => path.join(reviewDir(root), 'brief.md');
export const findingsFile = (root) => path.join(reviewDir(root), 'findings.md');
export const triageFile = (root) => path.join(reviewDir(root), 'triage.md');
export const roundsFile = (root) => path.join(reviewDir(root), 'rounds.json');
export const roundDir = (root, slot) => path.join(reviewDir(root), `round-${slot}`);

// The judge looks, the builder fixes, the judge looks again. The code and how it behaves come first, then the UI and UX, and the
// last round is always the "would you ship this" test over everything.
export const LENSES = {
  code: 'the code and how it behaves',
  product: 'the UI and UX',
  ship: 'whether it is ready to ship',
};

export function lensFor(slot, total) {
  if (slot >= total) return 'ship';
  return slot <= Math.ceil((total - 1) / 2) ? 'code' : 'product';
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex');

export function readState(root) {
  try {
    const state = JSON.parse(readText(roundsFile(root)));
    return { entries: Array.isArray(state.entries) ? state.entries : [], current: state.current ?? null };
  } catch {
    return { entries: [], current: null };
  }
}

function writeState(root, state) {
  fs.mkdirSync(reviewDir(root), { recursive: true });
  writeJson(roundsFile(root), state);
}

// The judge's own answer to "is it ready to ship". true, false, or null when the line is missing. The line was "Ready to sell" until
// 2026-11-21, so a round judged before then still reads. The answer is the line in the Verdict
// section at the end. A finding that quotes "Ready to ship: yes" from the page under judgement is not the judge's answer, so the first
// match in the file does not count. A file with no Verdict heading answers with its last match.
export function parseReady(findingsText) {
  const text = String(findingsText ?? '');
  const verdict = [...text.matchAll(/^#{1,6}[ \t]*verdict\b.*$/gim)].pop();
  const answers = [...(verdict ? text.slice(verdict.index) : text).matchAll(/ready to (?:ship|sell)\W{0,6}(yes|no)\b/gi)];
  const hit = verdict ? answers[0] : answers.at(-1);
  return hit ? hit[1].toLowerCase() === 'yes' : null;
}

// A round with no blocker and no major finding, and no "not ready", has nothing left for the next round of the same kind. The ship test
// is clean only when the judge said yes. A judge that wrote no answer has not said the product is ready.
export const converged = (entry) => ((entry.severities?.blocker ?? 0) + (entry.severities?.major ?? 0) === 0) && entry.ready !== false && (entry.lens !== 'ship' || entry.ready === true);

// The next round to hold. A round of the same kind as a clean one just before it is skipped, so a clean code round moves on to the UI.
export function nextSlot(entries, total) {
  const last = entries.at(-1);
  let slot = (last?.slot ?? 0) + 1;
  while (last && slot <= total && lensFor(slot, total) === last.lens && converged(last)) slot += 1;
  return slot > total ? null : slot;
}

// 100x-grind keeps judging past the usual rounds until a fresh judge says the product is ready to ship. Three things end it. The yes
// itself, which is a ship test with no blocker and no major finding (green). Three ship tests in a row that did not beat the best one
// so far, fewest blockers and majors first and fewest findings second (stalled). And the round limit.
export const GRIND_STALL = 3;
export const GRIND_LIMIT = 15;

const worry = (entry) => [(entry.severities?.blocker ?? 0) + (entry.severities?.major ?? 0), entry.counts?.flags ?? 0];
const lessWorry = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

export function grindVerdict(entries) {
  const last = entries.at(-1);
  if (!last) return { state: 'go-on' };
  if (last.lens === 'ship' && converged(last)) return { state: 'green', round: last.slot };
  const tests = entries.filter((entry) => entry.lens === 'ship');
  if (tests.length) {
    let best = 0;
    tests.forEach((entry, i) => {
      if (lessWorry(worry(entry), worry(tests[best]))) best = i;
    });
    const since = tests.length - 1 - best;
    if (since >= GRIND_STALL) return { state: 'stalled', best: tests[best].slot, serious: worry(tests[best])[0], flags: worry(tests[best])[1], since };
  }
  if (entries.length >= GRIND_LIMIT) return { state: 'limit', rounds: entries.length };
  return { state: 'go-on' };
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Said after a round closes and by 100x brief, so the agent never has to work out for itself that the grind is over.
export function grindWords(verdict) {
  if (verdict.state === 'green') return `Green light. The judge of round ${verdict.round} said ready to ship and found no blocker or major finding.`;
  if (verdict.state === 'stalled') return `Stalled. ${verdict.since} ship tests in a row found nothing better than round ${verdict.best}, which had ${count(verdict.serious, 'blocker or major finding', 'blocker or major findings')} among ${count(verdict.flags, 'finding', 'findings')}.`;
  if (verdict.state === 'limit') return `Round limit. The last judge did not say ready to ship.`;
  return null;
}

// How many rounds the judge is planned to hold right now. With grind on, once every usual round is held and the last judge did not
// green light it, one more ship test is planned. The setting review.rounds is never changed, the extra round is worked out from the files.
export function plannedFor(entries, review) {
  if (!review.grind) return review.rounds;
  if (nextSlot(entries, review.rounds) !== null) return review.rounds;
  return grindVerdict(entries).state === 'go-on' ? entries.at(-1).slot + 1 : review.rounds;
}

export const plannedRounds = (root, review) => plannedFor(readState(root).entries, review);

export function roundStatus(root, total) {
  const state = readState(root);
  const findings = readText(findingsFile(root));
  const last = state.entries.at(-1) ?? null;
  const closedHash = Boolean(findings) && last?.findingsHash === hashOf(findings);
  const inProgress = Boolean(findings) && !closedHash;
  const next = nextSlot(state.entries, total);
  const slot = inProgress ? state.current?.slot ?? next ?? total : next;
  return { total, entries: state.entries, last, inProgress, next, slot, lens: slot === null ? null : lensFor(slot, total), done: !inProgress && next === null, findings };
}

// What closing the round now would record, without writing anything. Needs a triage that passes.
export function pendingEntry(root, total, triage) {
  const status = roundStatus(root, total);
  if (!status.inProgress || triage.errors.length || !triage.summary) return null;
  const { flags, accepted, rejected, deferred } = triage.summary;
  // The fixes are committed between the brief and the close, so the next judge reads the commits since the brief.
  const briefed = fs.existsSync(briefFile(root)) ? fs.statSync(briefFile(root)).mtime.toISOString() : null;
  return {
    slot: status.slot,
    lens: lensFor(status.slot, total),
    briefedAt: briefed,
    briefHead: readState(root).current?.head ?? null,
    closedAt: new Date().toISOString(),
    findingsHash: hashOf(status.findings),
    ready: parseReady(status.findings),
    counts: { flags, accepted, rejected, deferred },
    severities: triage.summary.bySeverity,
  };
}

// Closes the round whose triage passes and keeps its files, so the next round starts clean and the judge can read this one.
export function closeRound(root, total, triage) {
  const entry = pendingEntry(root, total, triage);
  if (!entry) return null;
  const state = readState(root);
  const dir = roundDir(root, entry.slot);
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, name] of [[briefFile(root), 'brief.md'], [findingsFile(root), 'findings.md'], [triageFile(root), 'triage.md']]) {
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name));
  }
  state.entries.push(entry);
  state.current = null;
  writeState(root, state);
  return entry;
}

// Called when the brief is written. A round that is still open keeps its findings. A closed one is archived, so it is cleared.
export function startRound(root, total) {
  const status = roundStatus(root, total);
  if (status.inProgress) {
    const state = readState(root);
    if (state.current?.slot !== status.slot) writeState(root, { ...state, current: { slot: status.slot, lens: status.lens, total, head: headCommit(root) } });
    return { slot: status.slot, lens: status.lens, fresh: false, held: status.entries.length };
  }
  if (status.next === null) return { done: true, held: status.entries.length };
  for (const file of [findingsFile(root), triageFile(root)]) fs.rmSync(file, { force: true });
  const state = readState(root);
  state.current = { slot: status.next, lens: lensFor(status.next, total), total, head: headCommit(root) };
  writeState(root, state);
  return { slot: status.next, lens: state.current.lens, fresh: true, held: status.entries.length };
}

export const describeEntry = (entry) => `round ${entry.slot} (${LENSES[entry.lens]})`;

export function roundsSummary(root, total) {
  const { entries } = readState(root);
  if (entries.length === 0) return null;
  const sum = (key) => entries.reduce((n, entry) => n + (entry.counts?.[key] ?? 0), 0);
  return {
    held: entries.length,
    planned: Math.max(total, entries.at(-1).slot),
    lenses: entries.map((entry) => LENSES[entry.lens]),
    lastReady: entries.at(-1).ready,
    counts: { flags: sum('flags'), accepted: sum('accepted'), rejected: sum('rejected'), deferred: sum('deferred') },
    severities: Object.fromEntries(['blocker', 'major', 'minor', 'nit'].map((s) => [s, entries.reduce((n, entry) => n + (entry.severities?.[s] ?? 0), 0)])),
  };
}
