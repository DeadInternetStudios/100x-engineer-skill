import { parseJsonStrings, entryKey } from './json-source.mjs';
import { SourceError } from './errors.mjs';
import { csvEntries } from './csv.mjs';
import { lineStarts, lineAt } from './text.mjs';
import { androidEntries } from './xml.mjs';

function uniqueKeys(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const count = (seen.get(entry.key) ?? 0) + 1;
    seen.set(entry.key, count);
    if (count > 1) entry.key = `${entry.key}#${count}`;
  }
  return entries;
}

function jsonEntries(source) {
  return uniqueKeys(
    parseJsonStrings(source)
      .filter((s) => !s.meta)
      .map((s) => ({ key: entryKey(s), value: s.value, line: s.line, start: s.start, end: s.end, encode: (value) => JSON.stringify(value) })),
  );
}

const PROPERTY_ESCAPES = { n: '\n', t: '\t', r: '\r', f: '\f' };

function decodeProperty(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, hex, ch) => (hex ? String.fromCharCode(parseInt(hex, 16)) : (PROPERTY_ESCAPES[ch] ?? ch)));
}

function endsWithOddBackslashes(text) {
  let count = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

function encodePropertyFactory(source) {
  const useUnicodeEscapes = /\\u[0-9a-fA-F]{4}/.test(source);
  return (value) => {
    let out = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/^\s/, (ch) => `\\${ch}`);
    if (useUnicodeEscapes) out = out.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return out;
  };
}

function propertyEntries(source) {
  const entries = [];
  const encode = encodePropertyFactory(source);
  const starts = lineStarts(source);
  const rawLines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const lineStart = offset;
    const firstLine = i + 1;
    offset += rawLines[i].length + 1;
    const line = rawLines[i].replace(/\r$/, '');
    if (/^\s*$/.test(line) || /^\s*[#!]/.test(line)) continue;
    const match = /^\s*((?:\\.|[^=:\s\\])+)(?:\s*[=:]\s*|\s+)(.*)$/.exec(line);
    if (!match) continue;
    const parts = [match[2]];
    const start = lineStart + line.length - match[2].length;
    let end = lineStart + line.length;
    while (endsWithOddBackslashes(parts.at(-1)) && i + 1 < rawLines.length) {
      parts[parts.length - 1] = parts.at(-1).slice(0, -1);
      i++;
      const next = rawLines[i].replace(/\r$/, '');
      parts.push(next.replace(/^\s+/, ''));
      end = offset + next.length;
      offset += rawLines[i].length + 1;
    }
    entries.push({ key: decodeProperty(match[1]), value: decodeProperty(parts.join('')), line: lineAt(starts, start) || firstLine, start, end, encode });
  }
  return uniqueKeys(entries);
}

const STRINGS_ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };

function decodeStrings(text) {
  return text.replace(/\\[uU]([0-9a-fA-F]{4})|\\(.)/g, (_, hex, ch) => (hex ? String.fromCharCode(parseInt(hex, 16)) : (STRINGS_ESCAPES[ch] ?? ch)));
}

function encodeStrings(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

const STRINGS_SYNTAX = /^[ \t]*"(?:[^"\\]|\\.)*"\s*=\s*"/m;

function scanComments(source) {
  const comments = [];
  let masked = '';
  let kept = 0;
  const mask = (from, to) => {
    const text = source.slice(from, to);
    comments.push(text.trim());
    masked += source.slice(kept, from) + text.replace(/[^\n]/g, ' ');
    kept = to;
  };
  let i = 0;
  while (i < source.length) {
    if (source[i] === '"') {
      i++;
      while (i < source.length && source[i] !== '"') i += source[i] === '\\' ? 2 : 1;
      i++;
    } else if (source[i] === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1) break;
      mask(i, close + 2);
      i = close + 2;
    } else if (source[i] === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i);
      const end = newline === -1 ? source.length : newline;
      mask(i, end);
      i = end;
    } else i++;
  }
  return { masked: masked + source.slice(kept), comments };
}

export function kvComments(source) {
  const found = STRINGS_SYNTAX.test(source) ? scanComments(source).comments : (source.match(/^[ \t]*[#!].*$/gm) ?? []).map((line) => line.trim());
  return found.sort();
}

function stringsEntries(source) {
  const { masked } = scanComments(source);
  const starts = lineStarts(source);
  const entries = [];
  const pattern = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gd;
  for (const match of masked.matchAll(pattern)) {
    const [valueStart, valueEnd] = match.indices[2];
    entries.push({
      key: decodeStrings(match[1]),
      value: decodeStrings(match[2]),
      line: lineAt(starts, valueStart),
      start: valueStart - 1,
      end: valueEnd + 1,
      encode: encodeStrings,
    });
  }
  return uniqueKeys(entries);
}

const ENTRY_FORMATS = new Set(['json', 'kv', 'csv', 'xml']);

export const isEntryFormat = (format) => ENTRY_FORMATS.has(format);

export function parseStructured(source, format, options = {}) {
  if (format === 'json') return jsonEntries(source);
  if (format === 'kv') return STRINGS_SYNTAX.test(source) ? stringsEntries(source) : propertyEntries(source);
  if (format === 'csv') return uniqueKeys(csvEntries(source, options));
  if (format === 'xml') return uniqueKeys(androidEntries(source));
  throw new SourceError(`Unknown structured format "${format}"`);
}

export function skeletonOf(source, entries) {
  let rest = '';
  let at = 0;
  for (const entry of entries) {
    rest += source.slice(at, entry.start);
    at = entry.end;
  }
  return (rest + source.slice(at)).replace(/\r\n?/g, '\n').trimEnd();
}

export function applyStructured(source, format, replacements, options = {}) {
  const byKey = new Map(parseStructured(source, format, options).map((entry) => [entry.key, entry]));
  const edits = [];
  for (const [key, value] of replacements) {
    const entry = byKey.get(key);
    if (!entry) throw new SourceError(`No string at key "${key}"`);
    if (entry.value !== value) edits.push({ start: entry.start, end: entry.end, text: entry.encode(value) });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}
