import { fenceOpener, closesFence } from './fences.mjs';

const DELIMITER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const PIPED = /^\s*\|.*\|\s*$/;
const ENDS_TABLE = [/^\s{0,3}#{1,6}\s/, /^\s{0,3}([-*_])(\s*\1){2,}\s*$/, /^\s{0,3}>/, /^\s*(?:[-*+]|\d{1,3}[.)])\s+/];

export const isDelimiterRow = (line) => DELIMITER.test(line);

export function cellsOf(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
}

export function tableRowFlags(lines) {
  const flags = new Array(lines.length).fill(false);
  let inTable = false;
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const open = fenceOpener(line, { listIndent: Infinity });
    if (open) {
      fence = open;
      inTable = false;
      continue;
    }
    if (line.trim() === '' || ENDS_TABLE.some((pattern) => pattern.test(line))) inTable = false;
    if (inTable) {
      flags[i] = true;
      continue;
    }
    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && next.includes('|') && DELIMITER.test(next) && cellsOf(line).length === cellsOf(next).length) {
      inTable = true;
      flags[i] = true;
    } else if (PIPED.test(line)) {
      flags[i] = true;
    }
  }
  return flags;
}
