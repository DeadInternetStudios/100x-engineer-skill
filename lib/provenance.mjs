import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sameModel } from './models.mjs';

// The model on a review is a name the agent writes into a note, and an app can run another model than the one it was asked for.
// Cursor writes the input of every hook it runs into its own log. For a subagentStart hook that input names the model the helper was
// started on, which is the one record of it that the agent did not write. Cursor only logs an event when some hook is set for it.
export const HOOK_SNIPPET = '{ "version": 1, "hooks": { "subagentStart": [{ "command": "true" }] } }';

const STAMP = /^\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\]/;
const HOOK_LOG = /^cursor\.hooks\..*\.log$/;

// X100_CURSOR_LOGS moves the folder, and an empty one turns the check off. The tests use both.
export function cursorLogsDir() {
  if (process.env.X100_CURSOR_LOGS !== undefined) return process.env.X100_CURSOR_LOGS;
  const home = os.homedir();
  return process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Cursor', 'logs') : path.join(home, '.config', 'Cursor', 'logs');
}

function hookLogs(dir, sinceMs, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < 4) found.push(...hookLogs(file, sinceMs, depth + 1));
    else if (entry.isFile() && HOOK_LOG.test(entry.name)) {
      const stat = fs.statSync(file);
      if (stat.mtimeMs >= sinceMs) found.push({ file, mtimeMs: stat.mtimeMs });
    }
  }
  return found;
}

// One block per hook run: a [timestamp] line, then "INPUT:", the JSON the hook was given, and "OUTPUT:". A block that is not a
// subagentStart is skipped before it is parsed, because most of a log is tool calls and thoughts.
export function parseHelperStarts(text) {
  const lines = text.split('\n');
  const starts = [];
  let stamp = null;
  for (let i = 0; i < lines.length; i += 1) {
    const stampLine = STAMP.exec(lines[i]);
    if (stampLine) stamp = stampLine[1];
    if (lines[i] !== 'INPUT:') continue;
    let end = i + 1;
    while (end < lines.length && lines[end] !== 'OUTPUT:') end += 1;
    const body = lines.slice(i + 1, end).join('\n');
    i = end;
    if (!body.includes('"hook_event_name": "subagentStart"')) continue;
    try {
      const payload = JSON.parse(body);
      starts.push({ at: stamp, id: payload.subagent_id, toolCallId: payload.tool_call_id ?? payload.subagent_id, model: payload.subagent_model ?? payload.model ?? null, type: payload.subagent_type ?? null, task: String(payload.task ?? '') });
    } catch {
      // A block cut off at the end of a log is not an event.
    }
  }
  return starts;
}

// Cursor logs two starts for one helper, one under the id of the tool call and one under the helper's own id. They are one helper.
function onePerHelper(starts) {
  const byCall = new Map();
  for (const start of starts) {
    const held = byCall.get(start.toolCallId);
    if (!held || (held.id === held.toolCallId && start.id !== start.toolCallId)) byCall.set(start.toolCallId, start);
  }
  return [...byCall.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// Helpers started in the last `hours`, oldest first, from the newest hook logs.
export function recentHelpers({ hours = 24, now = Date.now(), logsDir = cursorLogsDir(), maxLogs = 12 } = {}) {
  if (!logsDir) return [];
  const logs = hookLogs(logsDir, now - hours * 3_600_000).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxLogs);
  const cutoff = new Date(now - hours * 3_600_000).toISOString();
  const starts = logs.flatMap(({ file }) => parseHelperStarts(fs.readFileSync(file, 'utf8')));
  return onePerHelper(starts).filter((start) => !start.at || start.at >= cutoff);
}

// ok means the app ran the model that was asked for. mismatch means it ran another one. unknown means the log cannot say.
export function verifyHelper(helpers, { requested, taskHas = null }) {
  const matching = helpers.filter((helper) => !taskHas || helper.task.includes(taskHas));
  const helper = matching.at(-1);
  if (!helper) {
    const why = helpers.length ? `${helpers.length} helpers are in the log and none was started with ${taskHas ? `a task that names ${taskHas}` : 'a task'}` : 'the log holds no helper start';
    return { status: 'unknown', requested, why };
  }
  const status = helper.model && sameModel(helper.model, requested) ? 'ok' : helper.model ? 'mismatch' : 'unknown';
  return { status, requested, ran: helper.model, id: helper.id, startedAt: helper.at, ...(status === 'unknown' ? { why: 'the log names no model for that helper' } : {}) };
}

// "composer-2.5-fast x6, muse-wonder-1.0-xhigh x2", the most used first.
export function tally(helpers) {
  const counts = new Map();
  for (const helper of helpers) counts.set(helper.model ?? 'no model named', (counts.get(helper.model ?? 'no model named') ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([model, count]) => `${model} x${count}`).join(', ');
}
