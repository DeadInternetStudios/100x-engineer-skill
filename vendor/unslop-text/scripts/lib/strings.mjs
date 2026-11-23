import { parseStructured, applyStructured } from './structured.mjs';
import { looksTranslatable, catalogNote } from './json-source.mjs';
import { SourceError } from './errors.mjs';
import { structuredFormat } from './profiles.mjs';

export function stringsFormat(file, requested, source) {
  if (requested && requested !== 'auto') return requested;
  return structuredFormat(file, source) ?? 'lines';
}

function lineEntries(source) {
  return source
    .split('\n')
    .map((raw, i) => ({ key: `line ${i + 1}`, value: raw.replace(/\r$/, ''), line: i + 1 }))
    .filter((entry) => entry.value.trim());
}

export function listStrings(source, format, { allStrings = false, column } = {}) {
  const entries = format === 'lines' ? lineEntries(source) : parseStructured(source, format, { column });
  const editable = allStrings ? entries : entries.filter((entry) => format === 'lines' || (!entry.locked && looksTranslatable(entry.text ?? entry.value)));
  return {
    total: entries.length,
    editable: editable.map(({ key, value, text, line }) => ({ key, value, text: text ?? value, line })),
    note: format === 'json' && !editable.length ? catalogNote(source) : null,
  };
}

export function applyEdits(source, format, edits, options = {}) {
  if (format !== 'lines') return applyStructured(source, format, edits, options);
  const lines = source.split('\n');
  for (const [key, value] of edits) {
    const match = /^line (\d+)$/.exec(key);
    const index = match ? Number(match[1]) - 1 : -1;
    if (index < 0 || index >= lines.length || !lines[index].trim()) throw new SourceError(`No string at key "${key}"`);
    if (/[\r\n]/.test(value)) throw new SourceError(`${key}: a line must not contain a line break`);
    lines[index] = lines[index].endsWith('\r') ? `${value}\r` : value;
  }
  return lines.join('\n');
}
