import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { stateFile } from './project.mjs';
import { writeJson } from './write-json.mjs';

export const clockFile = (root) => stateFile(root, 'clock.json');

const pad = (n) => String(n).padStart(2, '0');
export const clockTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// A deadline from words an owner would type. 17:30, 5pm, 5:30pm, +90m, +2h, +1h30m, for 10 hours, until 6am, by 5pm, or an ISO date and time.
export function parseDeadline(text, now = new Date()) {
  const input = String(text ?? '').trim().toLowerCase().replace(/^(?:in|for|until|by)\s+/, '');
  // Spans in any words: +2h, +1h30m, 50 hours, 2 days, 1 week, 90 minutes.
  const UNITS = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440, w: 10080, week: 10080, weeks: 10080 };
  const spanText = input.replace(/^\+/, '').trim();
  if (/^(\d+(?:\.\d+)?\s*[a-z]+\s*)+$/.test(spanText)) {
    let minutes = 0;
    let known = true;
    for (const hit of spanText.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)) {
      if (!(hit[2] in UNITS)) { known = false; break; }
      minutes += Number(hit[1]) * UNITS[hit[2]];
    }
    if (known && minutes > 0) return new Date(now.getTime() + minutes * 60000);
  }
  const clock = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(input);
  if (clock && (clock[2] || clock[3])) {
    let hours = Number(clock[1]);
    const minutes = Number(clock[2] ?? 0);
    if (clock[3] === 'pm' && hours < 12) hours += 12;
    if (clock[3] === 'am' && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) throw new CliError(`"${text}" is not a time of day.`);
    const at = new Date(now);
    at.setHours(hours, minutes, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  }
  const iso = Date.parse(input.length > 10 ? text.trim() : '');
  if (!Number.isNaN(iso)) return new Date(iso);
  throw new CliError(`Could not read "${text}" as a deadline. Try 17:30, 5pm, +90m, for 10 hours, 2 days or +1h30m.`);
}

// A fill clock means "use the whole time". finish refuses until the work time is over. The last tenth of the time,
// at most an hour, is kept for the final review, the matrix and finish itself.
export const reserveMinutesFor = (totalMinutes) => Math.min(60, Math.max(1, Math.round(totalMinutes * 0.1)));

export function setClock(root, text, now = new Date(), { fill = false } = {}) {
  const deadline = parseDeadline(text, now);
  if (deadline.getTime() - now.getTime() < 60000) throw new CliError('The deadline is less than a minute away.');
  const record = { setAt: now.toISOString(), deadline: deadline.toISOString(), ...(fill ? { fill: true } : {}) };
  writeJson(clockFile(root), record);
  return clockStatus(root, now);
}

// The owner's way out of a fill clock when nothing more can be done. The report shows it.
export function stopClock(root, reason, now = new Date()) {
  const record = readRecord(root);
  if (record?.unreadable) throw new CliError(record.unreadable);
  if (!record?.fill) throw new CliError('No fill clock is running, so there is nothing to stop. Set one with `100x clock set <time> --fill`.');
  if (!String(reason ?? '').trim()) throw new CliError('Say why: `100x clock stop "<reason>"`. The report shows it.');
  record.stopped = { at: now.toISOString(), reason: String(reason).trim() };
  writeJson(clockFile(root), record);
  return clockStatus(root, now);
}

export function clearClock(root) {
  const had = fs.existsSync(clockFile(root));
  fs.rmSync(clockFile(root), { force: true });
  return had;
}

// No file is no clock. A file that cannot be read is something else: finish trusts this file for the time a fill clock still has to
// run, so a damaged one has to be said, never read as no clock.
function readRecord(root) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(clockFile(root), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { unreadable: damaged(root, error.code ?? 'it is not valid JSON') };
  }
  if (!record || Number.isNaN(Date.parse(record.setAt)) || Number.isNaN(Date.parse(record.deadline))) return { unreadable: damaged(root, 'it has no start or deadline') };
  return record;
}

const damaged = (root, why) => `The clock file ${path.relative(root, clockFile(root)) || 'clock.json'} cannot be read (${why}). It holds the deadline. Set the clock again with \`100x clock set <time>\`, add --fill for a fill clock, or delete it on purpose with \`100x clock clear\`.`;

// When the clock was set and how long it was set for, or null when there is none.
export function clockSpan(root) {
  const record = readRecord(root);
  if (!record?.setAt || !record.deadline) return null;
  return { setAt: Date.parse(record.setAt), minutes: Math.round((Date.parse(record.deadline) - Date.parse(record.setAt)) / 60000) };
}

export function clockStatus(root, now = new Date()) {
  const record = readRecord(root);
  if (!record) return { state: 'none' };
  if (record.unreadable) return { state: 'unreadable', problem: record.unreadable };
  const deadline = new Date(record.deadline);
  const total = Math.max(1, deadline - Date.parse(record.setAt));
  const left = deadline - now;
  const status = {
    state: left > 0 ? 'running' : 'passed',
    deadline: record.deadline,
    deadlineLocal: clockTime(deadline),
    leftMinutes: Math.round(left / 60000),
    totalMinutes: Math.round(total / 60000),
    usedPercent: Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100))),
  };
  if (!record.fill) return status;
  const reserve = reserveMinutesFor(status.totalMinutes);
  const workUntil = new Date(deadline.getTime() - reserve * 60000);
  return {
    ...status,
    fill: true,
    reserveMinutes: reserve,
    workUntil: workUntil.toISOString(),
    workUntilLocal: clockTime(workUntil),
    workLeftMinutes: Math.max(0, Math.ceil((workUntil - now) / 60000)),
    stopped: record.stopped ?? null,
    setAt: record.setAt,
  };
}

// Whether finish may close the run. A plain deadline never blocks it. A fill clock blocks it until the work time is over.
export function fillGate(root, now = new Date()) {
  const status = clockStatus(root, now);
  if (status.state === 'unreadable') return { ok: false, status, message: status.problem };
  if (!status.fill || status.stopped || status.workLeftMinutes === 0) return { ok: true, status };
  const span = status.workLeftMinutes >= 60 ? `${Math.floor(status.workLeftMinutes / 60)} h ${status.workLeftMinutes % 60} min` : `${status.workLeftMinutes} min`;
  return {
    ok: false,
    status,
    message: `The clock says use all the time. ${span} of work left, until ${status.workUntilLocal}. Run the next round from references/fill.md of the 100x skill, then ask again. Only \`100x clock stop "<reason>"\` ends it earlier.`,
  };
}

export function describe(status) {
  if (status.state === 'none') return 'No clock is set. Set one with `100x clock set <time>`.';
  if (status.state === 'unreadable') return status.problem;
  if (status.state === 'passed') return `The deadline passed ${-status.leftMinutes} minutes ago, at ${status.deadlineLocal}.${status.fill ? ' finish is allowed now.' : ''}`;
  const hours = Math.floor(status.leftMinutes / 60);
  const left = hours ? `${hours} h ${status.leftMinutes % 60} min` : `${status.leftMinutes} min`;
  const base = `${left} left of ${status.totalMinutes} min, ${status.usedPercent}% used. Deadline ${status.deadlineLocal}.`;
  if (!status.fill) return base;
  if (status.stopped) return `${base} Fill clock stopped early: ${status.stopped.reason}`;
  return status.workLeftMinutes > 0
    ? `${base} Use all of it. Work until ${status.workUntilLocal}, then ${status.reserveMinutes} min to finish. finish refuses before then.`
    : `${base} The work time is over. finish is allowed now.`;
}
