import fs from 'node:fs';
import path from 'node:path';
import { parseFindings, parseTriage } from './review.mjs';
import { runDir } from './run-dir.mjs';
import { clipWords } from './text.mjs';

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

// What became of a finding: the builder fixed it, left it for later, or said the judge was wrong. A finding nobody triaged is still open.
const STATE = { accept: 'fixed', defer: 'left', reject: 'disagreed' };
// What is still standing comes first. A fix is a claim until a judge looks again, and a rejected finding is the builder's word against the judge's.
const STANDING = { left: 0, fixed: 1, disagreed: 2 };
const SEVERITY = { blocker: 0, major: 1 };

// A run keeps every reason the judge gave, and the report lists all of them. The ranking and the finish message show the first few and say
// how many more there are. A card has less room than a line of chat, so it shows fewer and opens the rest in place.
const SHOWN = 3;
export const ON_CARD = 2;
// A reason keeps up to this many characters, and the report prints all of them. A card, the ranking and the finish message cut it at a word past SHORT.
const TITLE = 240;
export const SHORT = 140;

// The judge's one line on what to change first. The brief asks for "Single most valuable change: ...", and a few plain wordings of it count too.
const TOP_CHANGE = /^\s*(?:[-*]\s*)?\**(?:what is the )?(?:single )?most valuable change\**\s*(?:[:?\u2013\u2014-]|is to\b|is\b)\s*\**(.+?)\s*$/im;
// What a run says when the judge said no and its findings name nothing big, so an empty list is never read as a page that lost its reasons.
export const NO_BIG_FINDING = 'The judge left no big finding on record';

const clip = (text, max = TITLE) => {
  const line = String(text).replace(/[`*]/g, '').replace(/\s+/g, ' ').replace(/[\s.:;,]+$/, '').trim();
  return line.length <= max ? line : `${line.slice(0, max).replace(/\s+\S*$/, '')}…`;
};

const lastRound = (review) => {
  try {
    const { entries } = JSON.parse(read(path.join(review, 'rounds.json')));
    return Array.isArray(entries) ? entries.at(-1) ?? null : null;
  } catch {
    return null;
  }
};

// Why the last judge said NOT ready to ship, in the judge's own words: its blockers and majors, and what became of each. The last round
// is the only one whose fixes nobody has checked again. A judge that said no and found nothing big gets its one top change, or a plain
// line that it left none. Empty when the judge said yes or did not say, or its files are gone. Takes the folder that holds the run's
// files, reads it and writes nothing.
export function whyNotReady(stateDir, { limit = Infinity } = {}) {
  const review = path.join(stateDir, 'review');
  const last = lastRound(review);
  if (!last || last.ready !== false) return [];
  const closed = path.join(review, `round-${last.slot}`);
  // The files of the round that closed are in its folder, empty or not, because the top-level files belong to the round after it. Only a run
  // with no round folder at all keeps its closed round's files at the top.
  const base = fs.existsSync(closed) ? closed : review;
  const findings = read(path.join(base, 'findings.md'));
  const triage = parseTriage(read(path.join(base, 'triage.md'))).entries;
  const reasons = parseFindings(findings)
    .findings.filter((finding) => finding.severity in SEVERITY)
    .map((finding, order) => ({ title: clip(finding.title), state: STATE[triage.get(finding.id)?.decision] ?? 'left', severity: finding.severity, order }))
    .sort((a, b) => STANDING[a.state] - STANDING[b.state] || SEVERITY[a.severity] - SEVERITY[b.severity] || a.order - b.order)
    .slice(0, limit)
    .map(({ title, state }) => ({ title, state }));
  if (reasons.length) return reasons;
  if (!findings.trim()) return [];
  const top = TOP_CHANGE.exec(findings);
  return [top ? { title: clip(top[1]), state: 'wanted' } : { title: NO_BIG_FINDING, state: 'none' }];
}

const AFTER = { left: 'left for later', fixed: 'fixed, not checked again', disagreed: 'the builder disagreed' };

// One reason as the words that name it and the words that say what became of it, so a page can set the second in a quieter voice.
export const reasonParts = ({ title, state }, max = Infinity) => (state === 'wanted' ? { title: `The judge's top change: ${clipWords(title, max)}`, after: '' } : { title: clipWords(title, max), after: AFTER[state] ?? '' });

// When every reason in a list ended the same way, the list says it once, with how many it covers, above the list and not on each line.
const every = (count) => (count === 2 ? 'Both reasons were' : `All ${count} reasons were`);
const ALL = {
  left: (count) => `${every(count)} left for later.`,
  fixed: (count) => `${every(count)} fixed since. ${count === 2 ? 'Neither was' : 'None was'} checked again.`,
  disagreed: (count) => `The builder disagreed with ${count === 2 ? 'both reasons' : `all ${count} reasons`}.`,
};
export const sharedState = (reasons) => (reasons.length > 1 && reasons.every((reason) => reason.state === reasons[0].state) ? ALL[reasons[0].state]?.(reasons.length) ?? '' : '');

// The reasons shown first, and the ones left over.
export const shownReasons = (reasons, shown = SHOWN) => ({ first: reasons.slice(0, shown), rest: reasons.slice(shown), more: Math.max(0, reasons.length - shown) });

// One reason as a line of text.
export function reasonText(reason, max) {
  const { title, after } = reasonParts(reason, max);
  return after ? `${title} (${after})` : title;
}

// The reasons a run carries, wherever they came from. A run finished by this build stores them. An older run has them in its folder,
// or in the archive of its folder when the project has started another run since. A stored empty list is a list that was read from empty
// files, so it is read again. A run the judge refused always has one line to show, so no page draws a red box with nothing under it.
export function reasonsFor(entry) {
  if (entry.review?.rounds?.lastReady !== false) return [];
  const stored = entry.review.rounds.why;
  if (Array.isArray(stored) && stored.length) return stored;
  const read = entry.path ? whyNotReady(runDir(entry)) : [];
  return read.length ? read : [{ title: NO_BIG_FINDING, state: 'none' }];
}
