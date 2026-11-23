import fs from 'node:fs';
import path from 'node:path';
import { clockStatus, describe } from './clock.mjs';
import { load } from './config.mjs';
import { git, stageTags } from './git.mjs';
import { readAsks, readFinished, readRun, runRows, startedAt, stateFile } from './project.mjs';
import { runId } from './registry.mjs';
import { checkTriage, findingsFile } from './review.mjs';
import { modern } from './runfile.mjs';
import { verdictSay } from './text.mjs';
import { grindVerdict, grindWords, plannedFor, readState as readRounds } from './rounds.mjs';
import { spendLine } from './spend.mjs';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

function started(root) {
  try {
    return startedAt(root);
  } catch {
    return null;
  }
}

// Where the judge rounds stand: how many are held, how many the plan wants, what the last judge said, and for a grind, whether it is green.
function judging(root) {
  const { entries } = readRounds(root);
  if (!entries.length) return null;
  const { review } = load({ cwd: root }).effective;
  return {
    held: entries.length,
    planned: Math.max(plannedFor(entries, review), entries.at(-1).slot),
    lastReady: entries.at(-1).ready,
    grind: Boolean(review.grind),
    words: review.grind ? grindWords(grindVerdict(entries)) : null,
  };
}

export function projectStatus(root) {
  const state = readText(stateFile(root, 'STATE.md'));
  const line = (label) => new RegExp(`^${label}:\\s*(.+)$`, 'mi').exec(state)?.[1]?.trim() ?? null;
  const run = readRun(root);
  const marker = readFinished(root);
  const finished = Boolean(marker) && marker.runId === runId(root, started(root) ?? '');
  const { asks } = readAsks(root);
  const rows = runRows(root);
  const dirty = git(root, ['status', '--porcelain']);
  const touched = ['STATE.md', 'decisions.tsv', 'project.md', 'run.json'].map((name) => {
    try {
      return fs.statSync(stateFile(root, name)).mtimeMs;
    } catch {
      return 0;
    }
  });
  const stateAt = touched[0];
  const lastAt = rows.length ? Date.parse(rows.at(-1).ts) : 0;
  return {
    name: path.basename(root),
    root,
    // How far STATE.md is behind the last decision. It is written by hand at stage ends, so a run that forgot an update shows here.
    stateBehindMinutes: stateAt && lastAt > stateAt ? Math.round((lastAt - stateAt) / 60000) : 0,
    stage: line('Stage'),
    next: line('Next'),
    risks: line('Open risks'),
    asks: { total: asks.length, open: asks.filter((a) => a.status === 'open').length, dropped: asks.filter((a) => a.status === 'dropped').length },
    decisions: { count: rows.length, last: rows.at(-1) ?? null },
    git: { branch: git(root, ['symbolic-ref', '--short', '-q', 'HEAD']), dirty: dirty ? dirty.split('\n').length : 0, last: git(root, ['log', '-1', '--pretty=format:%h %s']), tags: stageTags(root) },
    review: fs.existsSync(findingsFile(root)) ? checkTriage(root).summary : null,
    rounds: judging(root),
    spend: spendLine(root),
    finished,
    verdict: finished ? modern({ verdict: marker.verdict }).verdict ?? run?.verdict ?? null : run?.verdict ?? null,
    finishedAt: finished ? marker.finishedAt : null,
    watchdog: readJson(stateFile(root, 'watchdog.json')),
    clock: clockStatus(root),
    startedAt: started(root),
    updatedAt: new Date(Math.max(...touched)).toISOString(),
  };
}

export function ago(iso, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutes)) return 'unknown';
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} minutes ago`;
  return `${Math.round(minutes / 60)} hours ago`;
}

// The STATE.md lines run to paragraphs. Status is read in a glance, so each is cut and points at the file.
export const STATE_LINE_MAX = 200;
export const STALE_STATE_MINUTES = 30;
const clip = (text) => (text.length > STATE_LINE_MAX ? `${text.slice(0, STATE_LINE_MAX - 1).trimEnd()}… (all of it is in .100x/STATE.md)` : text);

export function formatStatus(s, now = Date.now()) {
  const label = (name, value) => `${name.padEnd(10)} ${value}`;
  const lines = [`${s.name}  ${s.root}`];
  lines.push(label('Stage', clip(s.stage ?? 'not recorded in STATE.md')));
  if (!s.finished) lines.push(label('Next', clip(s.next ?? 'not recorded in STATE.md')));
  if (!s.finished && s.stateBehindMinutes > STALE_STATE_MINUTES) lines.push(label('State', `STATE.md is ${s.stateBehindMinutes} minutes older than the last decision, so Stage and Next may be behind. Read \`100x log --tail 8\` before you trust them.`));
  if (s.risks && !/^none/i.test(s.risks)) lines.push(label('Risks', clip(s.risks)));
  lines.push(label('Asks', s.asks.total ? `${s.asks.total - s.asks.open} of ${s.asks.total} closed, ${s.asks.open} open` : 'no ledger yet'));
  lines.push(label('Decisions', s.decisions.count ? `${s.decisions.count}. Last, ${s.decisions.last.phase}. ${s.decisions.last.decision.slice(0, 90)}` : 'none yet'));
  lines.push(label('Git', s.git.branch ? `${s.git.branch}, ${s.git.dirty} uncommitted. Last ${s.git.last ?? 'no commits'}` : 'not a git repository'));
  if (s.clock && s.clock.state !== 'none' && !s.finished) lines.push(label('Clock', describe(s.clock)));
  if (s.rounds) {
    const said = s.rounds.lastReady === null ? 'gave no answer on whether it is ready to ship' : `said ${s.rounds.lastReady ? 'ready to ship' : 'NOT ready to ship'}`;
    const grind = s.rounds.grind ? ` Grind on. ${s.rounds.words ?? 'Not green yet.'}` : '';
    lines.push(label('Rounds', `${s.rounds.held} held of ${s.rounds.planned} planned. The last judge ${said}.${grind}`));
  }
  if (s.spend) lines.push(label('Spend', s.spend));
  if (s.review) lines.push(label('Review', `${s.review.flags} findings, ${s.review.untriaged} untriaged`));
  lines.push(label('Run', s.finished ? `FINISHED ${ago(s.finishedAt, now)}. Verdict ${verdictSay(s.verdict)}. Call \`100x-report\` to see it with the rest.` : 'NOT FINISHED'));
  if (s.watchdog?.scheduledTaskId) lines.push(label('Watchdog', `${s.watchdog.scheduledTaskId}${s.finished ? '. Delete it now.' : '. Delete it at finish.'}`));
  if (s.startedAt) lines.push(label('Started', ago(s.startedAt, now)));
  lines.push(label('Updated', ago(s.updatedAt, now)));
  return lines.join('\n');
}
