import fs from 'node:fs';
import path from 'node:path';
import { readRun, startedAt } from './project.mjs';
import { readRegistry, runId, upsert } from './registry.mjs';
import { ago, projectStatus } from './status.mjs';
import { plural, sayWhat } from './text.mjs';

// A run is on the report from its first logged decision, not from `100x finish`. The row is the same id the finished row will use, so finish
// replaces it, and a run that never finishes stays here as one that did not.
export function track(root) {
  const at = startedAt(root);
  const id = runId(root, at);
  if (readRegistry().some((row) => row.id === id)) return false;
  upsert({ id, started: true, path: root, startedAt: at });
  return true;
}

// No decision, no file touched, for this long: the run most likely stopped, and the report says so instead of calling it working.
export const IDLE_MINUTES = 90;
const CLIP = 160;
const clip = (text) => (!text ? null : text.length > CLIP ? `${text.slice(0, CLIP - 1).trimEnd()}…` : text);

// Each folder has one run in progress: its latest start. An older start in the same folder is a run that was abandoned for the next one.
function latestStarts() {
  const latest = new Map();
  for (const row of readRegistry()) {
    if (typeof row.path !== 'string' || typeof row.startedAt !== 'string' || Number.isNaN(Date.parse(row.startedAt))) continue;
    const seen = latest.get(row.path);
    if (!seen || Date.parse(row.startedAt) > Date.parse(seen.startedAt)) latest.set(row.path, row);
  }
  return [...latest.values()].filter((row) => row.started === true);
}

function look(row, now) {
  let status;
  let run;
  try {
    status = projectStatus(row.path);
    run = readRun(row.path);
  } catch {
    return null;
  }
  if (status.finished) return null;
  const updatedAt = Date.parse(status.updatedAt);
  return {
    id: row.id,
    root: row.path,
    title: run?.title ?? path.basename(row.path),
    what: run?.pitch ? sayWhat(run.pitch) : null,
    stage: clip(status.stage),
    next: clip(status.next),
    asks: status.asks,
    rounds: status.rounds,
    startedAt: row.startedAt,
    updatedAt: status.updatedAt,
    idle: now - updatedAt > IDLE_MINUTES * 60000,
  };
}

// The runs that have started and not finished, the most recently touched first. A run nobody has touched for longer than the window is
// counted, not listed, the way older finished runs are, and --all lists it.
export function inProgress({ sinceHours, all = false, now = Date.now() } = {}) {
  const cutoff = all || !sinceHours ? 0 : now - sinceHours * 3600 * 1000;
  const runs = latestStarts()
    .filter((row) => fs.existsSync(path.join(row.path, '.100x')))
    .map((row) => look(row, now))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const shown = runs.filter((run) => Date.parse(run.updatedAt) >= cutoff).map((run) => ({ ...run, words: progressWords(run, now) }));
  const older = runs.length - shown.length;
  return { runs: shown, older, olderWords: older ? olderWords(older) : null };
}

// How far the run has got, in the words the owner reads: working or idle, the stage, the asks closed, the judge. The id is for an idle run,
// which the owner may have given up on and can drop from the report with it.
const progressWords = (run, now) => ({
  state: run.idle ? `Idle, last touched ${ago(run.updatedAt, now)}. It may have stopped.` : `Working. Last touched ${ago(run.updatedAt, now)}.`,
  go: `Call \`100x-continue\` in ${run.root}.${run.idle ? ` To drop it from this report, \`100x registry remove ${run.id}\`.` : ''}`,
  asks: run.asks.total ? `${run.asks.total - run.asks.open} of ${run.asks.total} closed, ${run.asks.open} open.` : 'No asks written yet.',
  judge: run.rounds ? `${run.rounds.held} of ${run.rounds.planned} rounds held. The last judge ${run.rounds.lastReady === null ? 'gave no answer' : run.rounds.lastReady ? 'said ready to ship' : 'said NOT ready to ship'}.` : null,
});

const olderWords = (count) => `${plural(count, 'older run')} never finished. \`100x morning --all\` lists ${count === 1 ? 'it' : 'them'}.`;

// The lines under the ranking in the terminal. Nothing at all when nothing is unfinished, so a report with no loose ends is unchanged.
export function inProgressLines({ runs, older, olderWords: more }) {
  if (!runs.length && !older) return [];
  const lines = [''];
  if (runs.length) lines.push(`In progress. ${plural(runs.length, 'run')} not finished.`);
  runs.forEach((run, index) => {
    const { words } = run;
    lines.push(`${String(index + 1).padStart(2, '0')} ${run.title}.${run.what ? ` ${run.what}` : ''}`, `   state  ${words.state}`);
    if (run.stage) lines.push(`   stage  ${run.stage}`);
    lines.push(`   asks   ${words.asks}`);
    if (words.judge) lines.push(`   judge  ${words.judge}`);
    lines.push(`   go on  ${words.go}`);
  });
  if (older) lines.push(more);
  return lines;
}
