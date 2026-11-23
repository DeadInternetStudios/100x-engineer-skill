import fs from 'node:fs';
import path from 'node:path';

export const COLUMNS = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'];

export function cell(value) {
  const flat = String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
}

export function timestamp(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function appendRow(file, row, { now = new Date() } = {}) {
  for (const key of ['phase', 'decision', 'why']) {
    if (!String(row[key] ?? '').trim()) throw new Error(`a decision row needs ${key}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = !fs.existsSync(file) || fs.statSync(file).size === 0;
  const line = [
    timestamp(now),
    row.phase,
    row.decision,
    row.why,
    String(row.evidence ?? '').trim() || 'guess, no evidence yet',
    String(row.result ?? '').trim() || 'open',
  ]
    .map(cell)
    .join('\t');
  fs.appendFileSync(file, `${fresh ? `${COLUMNS.join('\t')}\n` : ''}${line}\n`);
  return line;
}

export function readRows(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1);
  // A row an agent appended by hand may be short. Every row has every column, so a reader never meets a missing one.
  return lines.map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(COLUMNS.map((name, index) => [name, cells[index] ?? '']));
  });
}

// startRow writes this row. A goal row also has the phase start, so the phase alone does not say where a run began.
export const isRunStart = (row) => row.phase === 'start' && /^Run \S+ began\./.test(row.decision ?? '');

export function startRow(file, runId, options) {
  const rows = readRows(file);
  const before = rows.length ? `${rows[0].ts} to ${rows.at(-1).ts}` : 'none';
  return appendRow(
    file,
    {
      phase: 'start',
      decision: `Run ${runId} began. Rows before this one, ${before}.`,
      why: 'First row of this run, so the trail shows where it picked up.',
      evidence: runId,
      result: 'ok',
    },
    options,
  );
}

// The file keeps UTC, which every machine reads the same way. A person reads the clock on the wall.
const pad2 = (n) => String(n).padStart(2, '0');
export function localTime(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts ?? '');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatRows(rows, { width = 110 } = {}) {
  const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
  return rows
    .map((r) => `${localTime(r.ts).padEnd(20)}  ${(r.phase ?? '').padEnd(10)} ${clip(r.decision ?? '', width)}\n${' '.repeat(22)}why ${clip(r.why ?? '', width)}\n${' '.repeat(22)}evidence ${clip(r.evidence ?? '', width)} | ${r.result ?? ''}`)
    .join('\n');
}
