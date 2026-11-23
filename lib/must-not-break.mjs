import fs from 'node:fs';
import { matrices, stateFile, targetIsOurs, targetMatchesRun } from './project.mjs';

export const CHECK_STATUS = ['pass', 'fail', 'skipped'];
export const MAX_CHECKS = 2;

const KIND = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const present = (value) => typeof value === 'string' && value.trim().length > 0;
const RED_COUNT = /^\s*(?:ℹ|#)\s*fail\s+(\d+)\b/gim;
// The templates print one line per check, `pass  name. detail` or `FAIL  name. detail`. A saved green run has none.
const RED_LINE = /^FAIL\s+\S/m;

// run.json holds one check as an object, or two as a list. Everything reads it through here.
export const mustNotBreakList = (run) => {
  if (Array.isArray(run?.mustNotBreak)) return run.mustNotBreak.filter((item) => item && typeof item === 'object');
  return run?.mustNotBreak && typeof run.mustNotBreak === 'object' ? [run.mustNotBreak] : [];
};

export const mustNotBreakFile = (root, kind) => stateFile(root, 'must-not-break', `${kind}.txt`);

function outputText(root, kind) {
  try {
    return fs.readFileSync(mustNotBreakFile(root, kind), 'utf8');
  } catch {
    return null;
  }
}

function checkOne(root, check, { after, run }) {
  const errors = [];
  const label = present(check.kind) ? `the must-not-break check "${check.kind}"` : 'the must-not-break check';
  if (!present(check.kind) || !KIND.test(check.kind)) errors.push(`${label}. The kind must be one lowercase word, hyphens allowed, for example screen-sizes or numbers`);
  if (!CHECK_STATUS.includes(check.status)) errors.push(`${label}. The status must be one of ${CHECK_STATUS.join(', ')}`);
  if (!present(check.summary)) errors.push(`${label}. The summary is missing. Write the result in numbers, or the reason when you skipped it`);
  if (errors.length) return errors;

  if (check.status === 'skipped') {
    if (check.summary.trim().length < 12) errors.push(`${label}. You skipped it, so the summary must say why, at least a short sentence`);
    return errors;
  }
  if (!/\d/.test(check.summary)) errors.push(`${label}. The summary has no numbers. Give counts with totals, for example "0 broken of 212 elements across 15 viewports"`);

  const text = outputText(root, check.kind);
  // Screen sizes are measured, never typed. That check rests on an all-rotate run that `100x shots` wrote, and signed, after this run began.
  const screenRuns = check.kind === 'screen-sizes' ? matrices(root).filter((m) => m.matrix === 'all-rotate' && (!m.startedAt || !after || Date.parse(m.startedAt) >= after)) : [];
  const bigRun = screenRuns.filter((m) => m.sealed && targetIsOurs(root, m.target, run) && targetMatchesRun(m.target, run));
  if (check.kind === 'screen-sizes' && bigRun.length === 0) {
    const elsewhere = screenRuns.find((m) => m.sealed);
    const reason = elsewhere && targetIsOurs(root, elsewhere.target, run) ? `but run.json says the app opens at ${run.url}` : 'which is not this project';
    const typed = elsewhere ? ` The all-rotate run in .100x/shots looked at ${elsewhere.target ?? 'no page'}, ${reason}.` : screenRuns.length > 0 ? ' The all-rotate run in .100x/shots was not written by `100x shots`, or was changed after it was.' : '';
    errors.push(`${label}. It says ${check.status} but no all-rotate screen run backs it up.${typed} Run \`100x shots <url> --label must-not-break --matrix all-rotate --resize-test\`. It measures every screen size and records the result itself, so no output file is needed.`);
    return errors;
  }
  if (check.kind !== 'screen-sizes' && (text === null || text.trim().length < 20)) {
    errors.push(`${label}. It says ${check.status} but there is no output to back it up. Save the check output to .100x/must-not-break/${check.kind}.txt, for example by ending the command with | tee .100x/must-not-break/${check.kind}.txt`);
    return errors;
  }
  if (check.status === 'pass') {
    const reds = [...(text ?? '').matchAll(RED_COUNT)].map((hit) => Number(hit[1])).filter((count) => count > 0);
    if (reds.length) errors.push(`${label}. It says pass but .100x/must-not-break/${check.kind}.txt reports ${reds[0]} failing`);
    if (RED_LINE.test(text ?? '')) errors.push(`${label}. It says pass but .100x/must-not-break/${check.kind}.txt has a FAIL line. Save the green run there and keep the red run in ${check.kind}-red.txt`);
    // The newest signed run counts. An earlier red run was the one the builder fixed, so it does not block a later green one.
    const newest = bigRun.reduce((best, m) => (!best || (Date.parse(m.startedAt) || 0) >= (Date.parse(best.startedAt) || 0) ? m : best), null);
    const broken = newest?.totals?.broken ?? 0;
    if (broken > 0) errors.push(`${label}. It says pass but the newest all-rotate screen run "${newest.label}" has ${broken} broken findings`);
  }
  return errors;
}

export function checkMustNotBreak(root, run, { after = 0 } = {}) {
  const list = mustNotBreakList(run);
  const errors = [];
  if (list.length === 0) return { errors: ['No must-not-break check is recorded. Record it with 100x run push mustNotBreak. See the must-not-break mode of the 100x skill'], list };
  if (list.length > MAX_CHECKS) errors.push(`There are ${list.length} must-not-break checks. An app has one or two, never more`);
  const seen = new Set();
  for (const check of list) {
    if (seen.has(check.kind)) errors.push(`The must-not-break check "${check.kind}" is listed twice`);
    seen.add(check.kind);
    errors.push(...checkOne(root, check, { after, run }));
  }
  return { errors, list };
}

// Pass only when every check passed. Fail when any failed. Skipped otherwise. The ranking and the report use this.
export function mustNotBreakOutcome(run) {
  const list = mustNotBreakList(run);
  if (list.length === 0) return 'none';
  if (list.some((check) => check.status === 'fail')) return 'fail';
  return list.every((check) => check.status === 'pass') ? 'pass' : 'skipped';
}

// The morning page and the ranking read this, so the kind is words ("screen sizes passed") and not the id an agent typed.
const PAST = { pass: 'passed', fail: 'FAILED', skipped: 'skipped' };
export const checkWords = (check) => {
  const outcome = PAST[check.status] ?? (present(check.status) ? check.status : 'unknown');
  return { kind: (present(check.kind) ? check.kind : 'check').replace(/-/g, ' '), outcome, sentence: `${outcome.charAt(0).toUpperCase()}${outcome.slice(1)}` };
};
export const mustNotBreakLine = (run) => {
  const list = mustNotBreakList(run);
  return list.length ? list.map((check) => { const words = checkWords(check); return `${words.kind} ${words.outcome}`; }).join(', ') : 'none';
};
