const HEAD = /^\s*([\w.]+)\s*,\s*(plural|select|selectordinal|number|date|time)\b\s*(?:,\s*)?/;
const BRANCHING = new Set(['plural', 'select', 'selectordinal']);
const SELECTOR = /\s*([^\s{}]+)\s*/y;

function closingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function parseBranches(source) {
  const branches = [];
  let at = 0;
  while (at < source.length) {
    SELECTOR.lastIndex = at;
    const match = SELECTOR.exec(source);
    if (!match) break;
    at = SELECTOR.lastIndex;
    if (source[at] !== '{') {
      if (/^offset:\d+$/.test(match[1])) continue;
      return [];
    }
    const close = closingBrace(source, at);
    if (close === -1) return [];
    branches.push({ selector: match[1], body: source.slice(at + 1, close) });
    at = close + 1;
  }
  return branches;
}

function parseIcu(inner) {
  const head = HEAD.exec(inner);
  if (!head) return null;
  const [, name, type] = head;
  return { name, type, branches: BRANCHING.has(type) ? parseBranches(inner.slice(head[0].length)) : [] };
}

export function groupsOf(text) {
  const groups = [];
  let depth = 0;
  let start = -1;
  let blank = true;
  for (let i = 0; i < text.length; i++) {
    // A brace still open at a blank line was never a placeholder, and must not swallow the paragraphs below.
    if (text[i] === '\n') {
      if (blank) depth = 0;
      blank = true;
    } else if (text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\r') blank = false;
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        const inner = text.slice(start + 1, i);
        groups.push({ start, end: i + 1, inner, icu: parseIcu(inner) });
      }
    }
  }
  return groups;
}

export function visibleText(text, { plain = ' ', count = ' ', branches = true } = {}) {
  let out = '';
  let cursor = 0;
  for (const { start, end, icu } of groupsOf(text)) {
    out += text.slice(cursor, start);
    if (branches && icu?.branches.length) {
      const bodies = icu.branches.map(({ body }) => visibleText(icu.type === 'select' ? body : body.replace(/#/g, count), { plain, count }));
      out += bodies.reduce((joined, body) => (joined ? `${joined}${/[.!?…]\s*$/.test(joined) ? ' ' : '. '}${body}` : body), '');
    } else {
      out += plain;
    }
    cursor = end;
  }
  return out + text.slice(cursor);
}
