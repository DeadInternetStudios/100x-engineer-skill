import { splitSentences, lineLocator } from './text.mjs';
import { visibleText } from './icu.mjs';
import { tableRowFlags, isDelimiterRow } from './tables.mjs';
import { STRING_PLACEHOLDER_RE, STRING_MARKUP_RE } from './tokens.mjs';
import { unwrapLinks, codeSpans } from './markdown.mjs';
import { fenceOpener, closesFence, indentWidth, QUOTE_PREFIX } from './fences.mjs';

const FRONT_MATTER_END = /^(---|\.\.\.)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
// Template and MDX lines are not prose. "export" and "import" count only in the forms MDX writes, because a
// hard-wrapped paragraph can start a line with "export shell functions to…" or "import your data from…".
const TEMPLATE_LINE = /^\s*(\{%.*%\}|\{\{[#/].*\}\}|import[ \t]+(?:[\w*${},\t ]+[ \t]from[ \t]+)?['"]|export[ \t]+(?:default\b|const\b|let\b|var\b|function\b|async\b|class\b|[{*]))/;
const LINK_DEFINITION = /^\s{0,3}\[(?!\^)[^\]\n]+\]:\s*\S+(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
const IGNORE_OFF = /<!--\s*unslop:off\s*-->/;
const IGNORE_ON = /<!--\s*unslop:on\s*-->/;
const BOLD_LABEL = /^\s*(?:\*\*|__)[^*_\n]{1,60}?(?:[:\u2013\u2014]\s*(?:\*\*|__)|(?:\*\*|__)\s*[:\u2013\u2014-])/;

const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", copy: '©', reg: '®', trade: '™',
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', middot: '·', bull: '•', times: '×', rarr: '→', larr: '←',
};
const ENTITY = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,9}));/gi;

function decodeEntities(text) {
  return text.replace(ENTITY, (_, decimal, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? ' ';
    const code = decimal ? Number(decimal) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  });
}

export function cleanInline(text) {
  return decodeEntities(unwrapLinks(text.replace(codeSpans(), 'CODE'))
    .replace(/<!--.*?-->/g, '')
    .replace(/<(?:https?|mailto):[^<>]+>/g, 'URL')
    .replace(/https?:\/\/[^\s)\]>]+/g, 'URL')
    .replace(/<\/?[A-Za-z][^<>]*>/g, '')
    .replace(/\[\^[^\[\]]+\]/g, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1')
    .replace(/(?<!\w)_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1'));
}

export function parseProse(source, options) {
  return parseDocument(source, options).blocks;
}

// Plain text often puts each paragraph on one long line with no blank line between them. Hard-wrapped
// text ends only about one line in ten at a full stop, so a document whose lines all end at one is not
// wrapped, and each line is a paragraph. Markdown files never take this reading: a line break there is a soft wrap.
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const LONG_LINE = 100;

export function linesAreParagraphs(source) {
  const lines = source.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2 || lines.some((line) => line.trim() === '')) return false;
  const lengths = lines.map((line) => line.trim().length).sort((a, b) => a - b);
  const ending = lines.filter((line) => SENTENCE_END.test(line.trimEnd())).length;
  return lengths[lengths.length >> 1] >= LONG_LINE && ending / lines.length >= 0.8;
}

// `regions` lists the lines that are not prose, as { kind, start, end } with 1-based inclusive line
// numbers: `fence` (fences included), `indented` code and `ignored` (between unslop:off and unslop:on).
// Callers that must leave those lines alone (check) use this answer instead of a second copy of the rules.
export function parseDocument(source, { cleaner = cleanInline, lineParagraphs = false } = {}) {
  const blocks = [];
  const regions = [];
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
  const tableRows = tableRowFlags(rawLines);
  const hasFrontMatter = rawLines[0]?.trim() === '---' && rawLines.slice(1).some((line) => FRONT_MATTER_END.test(line));
  let current = null;
  let fence = null;
  let ignored = null;
  let inFront = false;
  let inComment = false;
  let inIndentedCode = false;
  let previousBlank = true;
  // The content column of each list item that is still open, innermost last. Code under an item sits
  // at that column plus 4, and a fence under an item may sit at any indent.
  const items = [];

  const flush = () => {
    if (current) blocks.push(finishBlock(current, cleaner));
    current = null;
  };

  const startRegion = (kind, no) => {
    const region = { kind, start: no, end: no };
    regions.push(region);
    return region;
  };

  const closeItemsAbove = (indent) => {
    while (items.length && items.at(-1) > indent) items.pop();
  };

  const begin = (type, no, raw, extra = {}) => {
    current = { type, line: no, raws: [raw], lines: [{ no, text: cleaner(raw).trim() }], ...extra };
  };

  const append = (no, raw) => {
    current.raws.push(raw);
    current.lines.push({ no, text: cleaner(raw).trim() });
  };

  for (let i = 0; i < rawLines.length; i++) {
    const no = i + 1;
    const line = rawLines[i];

    if (i === 0 && hasFrontMatter) {
      inFront = true;
      continue;
    }
    if (inFront) {
      if (FRONT_MATTER_END.test(line)) inFront = false;
      continue;
    }
    if (fence) {
      // A fence inside a block quote ends where the quote ends.
      if (fence.quoted && !QUOTE_PREFIX.test(line)) fence = null;
      else {
        fence.region.end = no;
        if (closesFence(line, fence)) fence = null;
        continue;
      }
    }
    if (IGNORE_OFF.test(line)) {
      flush();
      ignored ??= startRegion('ignored', no);
      ignored.end = no;
      continue;
    }
    if (IGNORE_ON.test(line)) {
      if (ignored) ignored.end = no;
      ignored = null;
      continue;
    }
    if (ignored) {
      ignored.end = no;
      continue;
    }

    const open = fenceOpener(line, { listIndent: items.at(-1) });
    if (open) {
      flush();
      if (!open.quoted) closeItemsAbove(indentWidth(line));
      fence = { ...open, region: startRegion('fence', no) };
      continue;
    }

    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (/^\s*<!--/.test(line) && !line.includes('-->')) {
      flush();
      inComment = true;
      continue;
    }
    if (/^\s*<!--.*-->\s*$/.test(line) || TEMPLATE_LINE.test(line)) {
      flush();
      continue;
    }
    if (!current && LINK_DEFINITION.test(line)) continue;

    if (line.trim() === '') {
      flush();
      previousBlank = true;
      continue;
    }

    const wasBlank = previousBlank;
    previousBlank = false;
    const lead = indentWidth(line);
    if (wasBlank) closeItemsAbove(lead);

    // An indented code block starts after a blank line and runs on for every indented line that follows.
    // A list marker cannot open the block, but inside one it is code: "      - 9999:8080" in a compose file.
    const continuesCode = inIndentedCode;
    const startsCode = wasBlank || continuesCode;
    inIndentedCode = startsCode && lead >= (items.at(-1) ?? 0) + 4 && (continuesCode || !LIST_ITEM.test(line));
    if (inIndentedCode) {
      const last = regions.at(-1);
      if (last?.kind === 'indented' && last.end === no - 1) last.end = no;
      else startRegion('indented', no);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      items.length = 0;
      begin('heading', no, heading[2], { level: heading[1].length });
      flush();
      continue;
    }
    if (THEMATIC_BREAK.test(line)) {
      flush();
      items.length = 0;
      continue;
    }
    if (tableRows[i]) {
      flush();
      if (!isDelimiterRow(line)) begin('table-row', no, line.trim().replace(/^\||\|$/g, '').replace(/\|/g, ' · '));
      flush();
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      flush();
      const markerEnd = item[1].length + item[2].length;
      const gap = line.length - item[3].length - markerEnd;
      closeItemsAbove(item[1].length);
      items.push(markerEnd + (gap > 4 ? 1 : gap));
      begin('list-item', no, item[3], { boldLabel: BOLD_LABEL.test(item[3]) });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      if (current?.type !== 'quote') {
        flush();
        begin('quote', no, quote[1]);
      } else {
        append(no, quote[1]);
      }
      continue;
    }

    if (current && !(lineParagraphs && current.type === 'paragraph')) {
      append(no, line.trim());
    } else {
      flush();
      closeItemsAbove(lead);
      begin('paragraph', no, line.trim());
    }
  }
  flush();
  return { blocks: blocks.map(withSpans), regions };
}

// Each line is cleaned on its own, which is enough until a link, a code span, a comment or a tag runs over
// a line break: then half of its markup is left in the words. A paragraph where the two readings differ is
// cleaned as one piece, and an offset in it maps back to a line in proportion.
function blockText(block, cleaner) {
  const byLine = block.lines.map((l) => l.text).join(' ');
  const locate = lineLocator(block.lines);
  if (block.raws.length === 1) return { text: byLine, locate };
  const whole = cleaner(block.raws.join(' ')).trim();
  const squash = (text) => text.replace(/\s+/g, ' ');
  if (squash(whole) === squash(byLine)) return { text: byLine, locate };
  const ratio = byLine.length / Math.max(1, whole.length);
  return { text: whole, locate: (index) => locate(Math.floor(index * ratio)) };
}

function finishBlock(block, cleaner) {
  const raw = block.raws.join('\n');
  const { text, locate } = blockText(block, cleaner);
  return {
    type: block.type,
    line: block.line,
    level: block.level,
    boldLabel: block.boldLabel ?? false,
    raw,
    text,
    boldCount: (raw.match(/\*\*[^*\n]+\*\*|__[^_\n]+__/g) ?? []).length,
    sentences: block.type === 'heading' ? [text] : splitSentences(text),
    locate,
  };
}

function withSpans(unit) {
  const spans = [];
  let cursor = 0;
  for (const sentence of unit.sentences) {
    const start = unit.text.indexOf(sentence, cursor);
    if (start === -1) continue;
    spans.push({ start, end: start + sentence.length, text: sentence });
    cursor = start + sentence.length;
  }
  return { ...unit, spans };
}

export function maskPlaceholders(text, { icu = true } = {}) {
  return visibleText(text, { plain: 'X', count: 'X', branches: icu })
    .replace(STRING_PLACEHOLDER_RE, 'X')
    .replace(STRING_MARKUP_RE, '')
    .replace(/<\/?[A-Za-z][^<>]*>/g, '')
    .replace(/\[\/?(?:b|i|u|color[^\[\]]*)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stringUnit(value, { line, key }) {
  const text = cleanInline(maskPlaceholders(value)).trim();
  return withSpans({
    type: 'string',
    line,
    key,
    raw: value,
    text,
    boldCount: 0,
    boldLabel: false,
    sentences: splitSentences(text),
    locate: () => line,
  });
}

export function lineUnits(source) {
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((text, i) => ({ text, no: i + 1 }))
    .filter((l) => l.text.trim() !== '')
    .map((l) => stringUnit(l.text, { line: l.no }));
}
