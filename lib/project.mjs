import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRunStart, readRows } from './decisions.mjs';
import { badJson, CliError } from './errors.mjs';
import { findProjectRoot } from './paths.mjs';
import { modern } from './runfile.mjs';
import { sealState } from './seal.mjs';
import { writeJson } from './write-json.mjs';

export const stateFile = (root, ...parts) => path.join(root, '.100x', ...parts);

export function requireRoot(from = process.cwd()) {
  const root = findProjectRoot(from);
  if (!root) throw new CliError('No .100x folder found here. Run `100x init` in the project first.');
  return root;
}

export function readRun(root) {
  const file = stateFile(root, 'run.json');
  if (!fs.existsSync(file)) return null;
  try {
    return modern(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    throw badJson(file, error, 'set the facts again with `100x run set`');
  }
}

export function writeRun(root, run) {
  writeJson(stateFile(root, 'run.json'), run);
}

// finished.json is written by 100x finish and nothing else, so a run only counts as finished once finish ran.
export function writeFinished(root, marker) {
  writeJson(stateFile(root, 'finished.json'), marker);
}

export function readFinished(root) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(root, 'finished.json'), 'utf8'));
  } catch {
    return null;
  }
}

const LINE_BREAK = /\r?\n/;
// A list item quotes code by opening its fence right after the bullet, "- ```sh", so a marker after a list marker opens a fence too.
const FENCE_OPEN = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

// One pass over a project.md that says what each line is: the file's own text, a line of fenced code, or part of a comment. A heading or a
// checkbox inside a fence or a comment is a quotation, not the file's own. A comment is one that starts a line, which is how the template's
// hints are written, so a `<!--` in the middle of a sentence is text. What is left of a line after a comment closes on it is read again
// as the start of a line, so a second comment there counts. A fence closes on its own kind of marker, at least as long as the one that
// opened it, so a longer fence can quote a shorter one.
//   shape     the line when it is the file's own text, else ''
//   body      the line as a section holds it: own text and fenced code, with comments taken out
//   fenced    true for a line of fenced code
//   unclosed  the fence or comment still open at the end of the file, with the line it opened on
export function scan(markdown) {
  const shape = [];
  const body = [];
  const fenced = [];
  let fence = null;
  let comment = null;
  markdown.split(LINE_BREAK).forEach((line, index) => {
    let own = '';
    let text = '';
    let code = false;
    let rest = line;
    let whole = true;
    do {
      const piece = rest;
      rest = '';
      if (fence) {
        code = true;
        text = piece;
        const close = FENCE_CLOSE.exec(piece);
        if (close && close[1][0] === fence.char && close[1].length >= fence.size) fence = null;
      } else if (comment) {
        const end = piece.indexOf('-->');
        if (end >= 0) {
          comment = null;
          rest = piece.slice(end + 3).trim();
        }
      } else {
        const open = FENCE_OPEN.exec(piece);
        if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
          fence = { char: open[1][0], size: open[1].length, line: index + 1 };
          code = true;
          text = piece;
        } else if (/^[ \t]*<!--/.test(piece)) {
          const end = piece.indexOf('-->', piece.indexOf('<!--') + 2);
          if (end >= 0) rest = piece.slice(end + 3).trim();
          else comment = index + 1;
        } else {
          if (whole) own = piece;
          text = piece;
        }
      }
      whole = false;
    } while (rest);
    shape.push(own);
    body.push(text);
    fenced.push(code);
  });
  return { shape, body, fenced, unclosed: fence ? { kind: 'fence', line: fence.line } : comment ? { kind: 'comment', line: comment } : null };
}

// The Moment section is read under its legacy heading too, so an older project.md needs no migration.
const headingAt = (heading) => new RegExp(heading === 'Moment' ? '^##\\s+(?:Moment|Wow)\\b' : `^##\\s+${heading}\\b`, 'i');

export function readAsks(root) {
  const file = stateFile(root, 'project.md');
  if (!fs.existsSync(file)) return { found: false, asks: [] };
  const text = fs.readFileSync(file, 'utf8');
  // A fence or comment that never closes would hide every ask after it. The check says so, and this reads the file as it always did.
  const { shape, unclosed } = scan(text);
  const lines = unclosed ? text.split(LINE_BREAK) : shape;
  const start = lines.findIndex((line) => headingAt('Asks').test(line));
  if (start < 0) return { found: false, asks: [] };
  const asks = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const hit = /^\s*[-*]\s+\[( |x|X|~)\]\s+(.+)$/.exec(line);
    if (hit) asks.push({ status: hit[1] === ' ' ? 'open' : hit[1] === '~' ? 'dropped' : 'done', text: hit[2].trim() });
  }
  return { found: true, asks };
}

// One "## heading" of project.md as lines: everything up to the next "## ", with the hints (comments) taken out. own is false for a line
// of fenced code, which is somebody else's text. A heading inside a comment or a code fence is not a heading.
export function sectionLines(markdown, heading) {
  const { shape, body, fenced } = scan(markdown);
  const start = shape.findIndex((line) => headingAt(heading).test(line));
  if (start < 0) return [];
  const next = shape.findIndex((line, at) => at > start && /^##\s/.test(line));
  return body.slice(start + 1, next < 0 ? undefined : next).map((text, at) => ({ text, own: !fenced[start + 1 + at] }));
}

export const section = (markdown, heading) => sectionLines(markdown, heading).map((line) => line.text).join('\n').trim();
export const headingCount = (markdown, heading) => scan(markdown).shape.filter((line) => headingAt(heading).test(line)).length;
export const hasSection = (markdown, heading) => headingCount(markdown, heading) > 0;

const passesIn = (root, area) => {
  const dir = stateFile(root, area);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^pass-\d+$/.test(name)) : [];
};
const byNumber = (a, b) => Number(a.slice(5)) - Number(b.slice(5));

// Every pass that left anything behind. A project with a screen leaves shots, and one without leaves its judge's loop folder.
// run.json may not claim more passes than this.
export const passNames = (root) => [...new Set(['shots', 'loops'].flatMap((area) => passesIn(root, area)))].sort(byNumber);

const PREFERRED = ['final', 'pass-3', 'pass-2', 'pass-1', 'must-not-break', 'build', 'core'];

export function matrices(root) {
  const dir = stateFile(root, 'shots');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name, 'matrix.json');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      out.push({ label: entry.name, dir: path.join(dir, entry.name), mtime: fs.statSync(file).mtimeMs, totals: json.summary.totals, states: json.summary.states, examined: json.summary.examined, viewports: json.viewports.length, matrix: json.matrix, startedAt: json.startedAt ?? null, target: typeof json.target === 'string' ? json.target : null, sealed: sealState(file) === 'ok' });
    } catch {
      // a half written matrix is ignored
    }
  }
  return out;
}

// Evidence has to come from the prototype itself: a file inside the project, a page served on this machine,
// or the address run.json names (the run address or a deploy preview). A screen run of someone else's site proves nothing about this one.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
// A phone on the same wifi opens the dev server at the machine's network address, and the screens of that page are the prototype's own.
const onThisNetwork = (host) => /^(?:10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(host) || host.endsWith('.local');
const real = (file) => (fs.existsSync(file) ? fs.realpathSync(file) : file);
const insideRoot = (root, file) => {
  const base = real(root);
  const inside = real(file);
  return inside === base || inside.startsWith(base + path.sep);
};
export function targetIsOurs(root, target, run = {}) {
  if (typeof target !== 'string' || !target) return false;
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') {
    try {
      return insideRoot(root, fileURLToPath(url));
    } catch {
      // A path that names no place on this system, such as one with no drive on Windows, is not in the project.
      return false;
    }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || onThisNetwork(host)) return true;
  const named = [run.url, run.ship?.preview].flatMap((value) => {
    try {
      return [new URL(value).hostname];
    } catch {
      return [];
    }
  });
  return named.includes(url.hostname);
}

// The screens have to be of what the owner opens: a file for a file, a served page for a page. Screens of a one page file next
// to a run that says it serves an app at an address measure something else. An address that is not a URL cannot be compared.
const kindOf = (address) => {
  try {
    return new URL(address).protocol === 'file:' ? 'file' : 'page';
  } catch {
    return null;
  }
};
export function targetMatchesRun(target, run = {}) {
  const claimed = kindOf(run.url);
  const seen = kindOf(target);
  return !claimed || !seen || claimed === seen;
}

export function finalMatrix(root) {
  const all = matrices(root);
  for (const label of PREFERRED) {
    const hit = all.find((m) => m.label === label);
    if (hit) return hit;
  }
  return [...all].sort((a, b) => b.mtime - a.mtime)[0] ?? null;
}

// One folder can hold several runs, one after the other. The run in progress began at the last run start row.
export function runRows(root) {
  const rows = readRows(stateFile(root, 'decisions.tsv'));
  const from = rows.findLastIndex(isRunStart);
  return from < 0 ? rows : rows.slice(from);
}

export function startedAt(root) {
  const first = runRows(root)[0];
  return first?.ts ?? new Date(fs.statSync(stateFile(root, 'project.md')).birthtimeMs).toISOString();
}
