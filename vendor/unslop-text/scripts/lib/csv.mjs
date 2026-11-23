import { SourceError } from './errors.mjs';

const KEY_HEADER = /^(?:keys?|ids?|names?|terms?|identifiers?|string[ _-]?ids?|tokens?|resname|tag)$/i;

const wordsOf = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/);

const TEXT_HEADERS = [
  (name) => /^(?:en|eng|english)$/i.test(name),
  (name) => /^(?:en|eng|english)(?![a-z])/i.test(name) || /\(en(?:[-_][a-z]{2,4})?\)$/i.test(name),
  (name) => wordsOf(name).some((word) => word === 'en' || word === 'eng' || word === 'english'),
  (name) => /^(?:source(?:[ _-]?(?:text|string|language))?|sourcestring|original(?:[ _-]?text)?|master|base|default|reference)$/i.test(name),
  (name) => /^(?:text|string|message|msg|value|label|content|copy|caption|dialogue|dialog|sentence)$/i.test(name),
];

const SHOWN_COLUMNS = 12;

function detectDelimiter(source) {
  const newline = source.indexOf('\n');
  const end = Math.min(newline === -1 ? source.length : newline, 4096);
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let quoted = false;
  for (let i = 0; i < end; i++) {
    if (source[i] === '"') quoted = !quoted;
    else if (!quoted && source[i] in counts) counts[source[i]]++;
  }
  return Object.keys(counts).reduce((best, ch) => (counts[ch] > counts[best] ? ch : best), ',');
}

function countNewlines(source, from, to) {
  let count = 0;
  for (let at = source.indexOf('\n', from); at !== -1 && at < to; at = source.indexOf('\n', at + 1)) count++;
  return count;
}

function parseRows(source, delimiter) {
  const rows = [];
  const length = source.length;
  let i = source[0] === '\ufeff' ? 1 : 0;
  let line = 1;
  while (i < length) {
    const row = [];
    for (;;) {
      const cell = { start: i, line, quoted: false, value: '' };
      if (source[i] === '"') {
        cell.quoted = true;
        i++;
        for (;;) {
          const close = source.indexOf('"', i);
          if (close === -1) throw new SourceError(`Unterminated quoted field at line ${cell.line}`);
          cell.value += source.slice(i, close);
          if (source[close + 1] === '"') {
            cell.value += '"';
            i = close + 2;
          } else {
            i = close + 1;
            break;
          }
        }
        line += countNewlines(source, cell.start, i);
        cell.end = i;
        while (source[i] === ' ' || (source[i] === '\t' && delimiter !== '\t')) i++;
        const next = source[i];
        if (i < length && next !== delimiter && next !== '\n' && next !== '\r') {
          throw new SourceError(`Unexpected text after a closing quote at line ${line}`);
        }
      } else {
        while (i < length && source[i] !== delimiter && source[i] !== '\n' && source[i] !== '\r') i++;
        cell.value = source.slice(cell.start, i);
        cell.end = i;
      }
      row.push(cell);
      if (i >= length) break;
      if (source[i] === delimiter) {
        i++;
        continue;
      }
      i += source[i] === '\r' && source[i + 1] === '\n' ? 2 : 1;
      line++;
      break;
    }
    rows.push(row);
  }
  return rows;
}

function listColumns(header) {
  const shown = header.slice(0, SHOWN_COLUMNS).map((name) => `"${name}"`).join(', ');
  return header.length > SHOWN_COLUMNS ? `${shown} and ${header.length - SHOWN_COLUMNS} more` : shown;
}

function textColumn(header, requested) {
  if (requested !== undefined && requested !== '') {
    const wanted = String(requested).trim();
    let index = header.findIndex((name) => name.toLowerCase() === wanted.toLowerCase());
    if (index === -1 && /^\d+$/.test(wanted) && Number(wanted) >= 1 && Number(wanted) <= header.length) index = Number(wanted) - 1;
    if (index === -1) throw new SourceError(`No column named "${wanted}". The columns are: ${listColumns(header)}`);
    return index;
  }
  for (const matches of TEXT_HEADERS) {
    const index = header.findIndex(matches);
    if (index !== -1) return index;
  }
  throw new SourceError(`Cannot tell which column holds the English text. The columns are: ${listColumns(header)}. Pass --column <name> to choose one`);
}

function keyColumn(header, text) {
  const found = header.findIndex((name) => KEY_HEADER.test(name));
  const index = found === -1 ? 0 : found;
  return index === text ? -1 : index;
}

export function csvEntries(source, { column } = {}) {
  const delimiter = detectDelimiter(source);
  const rows = parseRows(source, delimiter);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => cell.value.trim());
  const text = textColumn(header, column);
  const keyAt = keyColumn(header, text);
  const needsQuotes = (value) => value.includes(delimiter) || /["\r\n]/.test(value) || value !== value.trim();
  const entries = [];
  for (let r = 1; r < rows.length; r++) {
    const cell = rows[r][text];
    if (!cell) continue;
    const key = keyAt === -1 ? '' : (rows[r][keyAt]?.value ?? '').trim();
    entries.push({
      key: key || `row ${r}`,
      value: cell.value,
      line: cell.line,
      start: cell.start,
      end: cell.end,
      encode: (value) => (cell.quoted || needsQuotes(value) ? `"${value.replaceAll('"', '""')}"` : value),
    });
  }
  return entries;
}
