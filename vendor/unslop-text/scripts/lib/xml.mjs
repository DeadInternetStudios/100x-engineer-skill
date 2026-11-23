import { lineStarts, lineAt } from './text.mjs';
import { SourceError } from './errors.mjs';

class XmlError extends Error {
  constructor(message, at) {
    super(message);
    this.at = at;
  }
}

const PREDEFINED = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const BARE_AMPERSAND = /&(?!(?:[A-Za-z_][\w.-]*|#\d+|#x[0-9A-Fa-f]+);)/;
const REFERENCE = /&(?:([A-Za-z_][\w.-]*)|#(x[0-9A-Fa-f]+|\d+));/g;
const SPACE = '[ \\t\\r\\n]';
const QUOTED = (inner) => `(?:"${inner}"|'${inner}')`;
const XML_DECLARATION = new RegExp(
  `^<\\?xml${SPACE}+version${SPACE}*=${SPACE}*${QUOTED('1\\.[0-9]*')}` +
    `(?:${SPACE}+encoding${SPACE}*=${SPACE}*${QUOTED('[A-Za-z][\\w.-]*')})?` +
    `(?:${SPACE}+standalone${SPACE}*=${SPACE}*${QUOTED('(?:yes|no)')})?${SPACE}*\\?>$`,
);
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

const isXmlCharacter = (code) => code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);

const isSpace = (code) => code === 32 || code === 9 || code === 10 || code === 13;
const isNameStart = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 58 || code >= 128;
const isNameChar = (code) => isNameStart(code) || (code >= 48 && code <= 57) || code === 45 || code === 46;

function readName(source, at, what) {
  let end = at;
  if (!isNameStart(source.charCodeAt(end))) throw new XmlError(`Expected the name of ${what}`, at);
  while (isNameChar(source.charCodeAt(end))) end++;
  return end;
}

function skipDoctype(source, open) {
  if (!source.startsWith('<!DOCTYPE', open)) throw new XmlError('Unexpected "<!"', open);
  for (let i = open + 9; i < source.length; i++) {
    const ch = source[i];
    if (ch === '>') return i + 1;
    if (ch === '"' || ch === "'" || ch === '[') {
      const close = source.indexOf(ch === '[' ? ']' : ch, i + 1);
      if (close === -1) break;
      i = close;
    }
  }
  throw new XmlError('The DOCTYPE is never closed', open);
}

export const ANDROID_PROBLEMS = {
  apostrophe: 'an apostrophe is not escaped. Android\'s string guide asks for \\\' or double quotes around the whole string',
  quote: 'a double quote is not escaped, so Android drops it from the text. Write \\"',
};

function androidProblems(texts) {
  const whole = texts.map((part) => part.text).join('').trim();
  if (whole.length > 1 && whole.startsWith('"') && whole.endsWith('"')) return [];
  const found = new Map();
  for (const { text, at } of texts) {
    for (let k = 0; k < text.length; k++) {
      const ch = text[k];
      if (ch === '\\') k++;
      else if ((ch === "'" || ch === '"') && !found.has(ch)) found.set(ch, at + k);
    }
  }
  return [...found].map(([ch, at]) => ({ problem: ch === "'" ? 'apostrophe' : 'quote', at, string: whole }));
}

// A string, or an item of a plurals or string-array, is one entry. Its text is what lies between its tags,
// written the way the file writes it.
function androidEntry(element, parent, innerEnd) {
  const isString = element.name === 'string';
  const owner = isString ? element : parent;
  const name = owner.attrs.name;
  if (name === undefined) return null;
  const key = isString ? name : `${name}[${parent.name === 'plurals' ? (element.attrs.quantity ?? element.index) : element.index}]`;
  return { key, start: element.inner, end: innerEnd, locked: owner.attrs.translatable === 'false' || element.attrs.translatable === 'false' };
}

function scan(source) {
  const control = CONTROL_CHARACTER.exec(source);
  if (control) throw new XmlError(`The control character U+${source.charCodeAt(control.index).toString(16).toUpperCase().padStart(4, '0')} is not allowed in XML`, control.index);
  const length = source.length;
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let i = start;
  const stack = [];
  const android = [];
  const entries = [];
  let root = null;
  let rootClosed = false;
  let allowed = PREDEFINED;
  let anyEntity = false;

  const references = (text, from) => {
    if (!text.includes('&')) return;
    const bare = BARE_AMPERSAND.exec(text);
    if (bare) throw new XmlError('A bare "&" (write &amp;)', from + bare.index);
    for (const match of text.matchAll(REFERENCE)) {
      if (match[2] !== undefined) {
        const code = match[2][0] === 'x' ? parseInt(match[2].slice(1), 16) : Number(match[2]);
        if (!isXmlCharacter(code)) throw new XmlError(`&#${match[2]}; is not a character XML allows`, from + match.index);
      } else if (!anyEntity && !allowed.has(match[1])) {
        throw new XmlError(`The entity &${match[1]}; is not defined. XML defines only &amp; &lt; &gt; &quot; and &apos;. Write the character itself or a number such as &#160;`, from + match.index);
      }
    }
  };

  const text = (from, to) => {
    if (from === to) return;
    const chunk = source.slice(from, to);
    if (!stack.length) {
      if (chunk.trim()) throw new XmlError('Text outside the root element', from + chunk.search(/\S/));
      return;
    }
    references(chunk, from);
    const end = chunk.indexOf(']]>');
    if (end !== -1) throw new XmlError('"]]>" is not allowed in text', from + end);
    stack.at(-1).texts?.push({ text: chunk, at: from });
  };

  const startsCapture = (name, parent) => {
    if (root !== 'resources') return false;
    if (name === 'string') return stack.length === 1;
    return name === 'item' && stack.length === 2 && (parent.name === 'plurals' || parent.name === 'string-array');
  };

  while (i < length) {
    const open = source.indexOf('<', i);
    if (open === -1) {
      text(i, length);
      break;
    }
    text(i, open);
    if (source.startsWith('<!--', open)) {
      const close = source.indexOf('-->', open + 4);
      if (close === -1) throw new XmlError('A comment is never closed', open);
      const body = source.slice(open + 4, close);
      if (body.includes('--') || body.endsWith('-')) throw new XmlError('A comment contains "--", which XML does not allow', open);
      i = close + 3;
    } else if (source.startsWith('<![CDATA[', open)) {
      if (!stack.length) throw new XmlError('A CDATA section outside the root element', open);
      const close = source.indexOf(']]>', open + 9);
      if (close === -1) throw new XmlError('A CDATA section is never closed', open);
      i = close + 3;
    } else if (source.startsWith('<?', open)) {
      const nameEnd = readName(source, open + 2, 'a processing instruction');
      const declaration = /^xml$/i.test(source.slice(open + 2, nameEnd));
      if (declaration && open !== start) throw new XmlError('The XML declaration must be at the very start of the file', open);
      if (!isSpace(source.charCodeAt(nameEnd)) && !source.startsWith('?>', nameEnd)) throw new XmlError('The name of a processing instruction must be followed by a space', open);
      const close = source.indexOf('?>', nameEnd);
      if (close === -1) throw new XmlError('A processing instruction is never closed', open);
      if (declaration && !XML_DECLARATION.test(source.slice(open, close + 2))) throw new XmlError('The XML declaration is malformed. Write <?xml version="1.0" encoding="utf-8"?>', open);
      i = close + 2;
    } else if (source.startsWith('<!', open)) {
      const end = skipDoctype(source, open);
      const doctype = source.slice(open, end);
      if (/\b(?:PUBLIC|SYSTEM)\b/.test(doctype)) anyEntity = true;
      allowed = new Set([...PREDEFINED, ...Array.from(doctype.matchAll(/<!ENTITY\s+([^\s%]+)/g), (match) => match[1])]);
      i = end;
    } else if (source[open + 1] === '/') {
      let end = readName(source, open + 2, 'a closing tag');
      const name = source.slice(open + 2, end);
      while (isSpace(source.charCodeAt(end))) end++;
      if (source[end] !== '>') throw new XmlError(`The closing tag </${name}> is malformed`, open);
      const top = stack.pop();
      if (!top) throw new XmlError(`</${name}> has no opening tag`, open);
      if (top.name !== name) throw new XmlError(`</${name}> closes <${top.name}>, which is still open`, open);
      if (top.owns) {
        android.push(...androidProblems(top.texts));
        const entry = androidEntry(top, stack.at(-1), open);
        if (entry) entries.push(entry);
      }
      if (!stack.length) rootClosed = true;
      i = end + 1;
    } else {
      if (!isNameStart(source.charCodeAt(open + 1))) throw new XmlError('A "<" that does not start a tag. Write &lt; for a less-than sign', open);
      let end = readName(source, open + 1, 'a tag');
      const name = source.slice(open + 1, end);
      if (!stack.length) {
        if (rootClosed) throw new XmlError('More than one root element', open);
        root = name;
      }
      let selfClosing = false;
      const attributes = new Set();
      const attrs = {};
      for (;;) {
        const gapStart = end;
        while (isSpace(source.charCodeAt(end))) end++;
        if (source[end] === '>') {
          end++;
          break;
        }
        if (source[end] === '/' && source[end + 1] === '>') {
          selfClosing = true;
          end += 2;
          break;
        }
        if (end >= length) throw new XmlError(`<${name}> is never closed`, open);
        if (end === gapStart) throw new XmlError(`Attributes of <${name}> must follow a space`, end);
        const attributeEnd = readName(source, end, 'an attribute');
        const attribute = source.slice(end, attributeEnd);
        if (attributes.has(attribute)) throw new XmlError(`The attribute ${attribute} appears twice in <${name}>`, end);
        attributes.add(attribute);
        end = attributeEnd;
        while (isSpace(source.charCodeAt(end))) end++;
        if (source[end] !== '=') throw new XmlError(`The attribute ${attribute} has no value`, end);
        end++;
        while (isSpace(source.charCodeAt(end))) end++;
        const quote = source[end];
        if (quote !== '"' && quote !== "'") throw new XmlError(`The value of ${attribute} must be in quotes`, end);
        const close = source.indexOf(quote, end + 1);
        if (close === -1) throw new XmlError(`The value of ${attribute} is never closed`, end);
        const value = source.slice(end + 1, close);
        if (value.includes('<')) throw new XmlError(`The value of ${attribute} contains "<". Write &lt;`, end);
        references(value, end + 1);
        attrs[attribute] = value;
        end = close + 1;
      }
      const parent = stack.at(-1);
      const index = parent ? parent.children++ : 0;
      if (selfClosing) {
        if (!stack.length) rootClosed = true;
      } else {
        const owns = !parent?.texts && startsCapture(name, parent);
        stack.push({ name, at: open, texts: parent?.texts ?? (owns ? [] : null), owns, attrs, inner: end, index, children: 0 });
      }
      i = end;
    }
  }

  if (stack.length) throw new XmlError(`<${stack.at(-1).name}> is never closed`, stack.at(-1).at);
  if (root === null) throw new XmlError('There is no root element', 0);
  return { root, android, entries };
}

const ANDROID_PATH = /(?:^|[\\/])values(?:-[\w+-]+)?[\\/][^\\/]+$/;
const ANDROID_HINT = /xmlns:(?:xliff|tools)=|<plurals\b|<string-array\b|\btranslatable="|@string\/|\\'/;

export function isAndroidResources(source, file) {
  return ANDROID_PATH.test(file ?? '') || ANDROID_HINT.test(source);
}

export function inspectXml(source) {
  try {
    const { root, android } = scan(source);
    const starts = android.length ? lineStarts(source) : null;
    return { error: null, root, android: android.map((problem) => ({ ...problem, line: lineAt(starts, problem.at) })) };
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    return { error: { message: error.message, line: lineAt(lineStarts(source), error.at) }, root: null, android: [] };
  }
}

// The name of the root element, read without checking the rest of the file.
export function xmlRoot(source) {
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (isSpace(source.charCodeAt(at))) at++;
    const skip = source.startsWith('<?', at) ? ['?>', 2] : source.startsWith('<!--', at) ? ['-->', 4] : null;
    if (skip) {
      const close = source.indexOf(skip[0], at + skip[1]);
      if (close === -1) return null;
      at = close + skip[0].length;
    } else if (source.startsWith('<!', at)) {
      try {
        at = skipDoctype(source, at);
      } catch {
        return null;
      }
    } else break;
  }
  return /^<([A-Za-z_:][\w.:-]*)/.exec(source.slice(at, at + 200))?.[1] ?? null;
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g;

const character = (code) => (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ');
const unentity = (text) => text.replace(ENTITY, (_, decimal, hex, named) => (named ? NAMED_ENTITIES[named] : character(decimal ? Number(decimal) : parseInt(hex, 16))));

// What a reader of the app sees in a string, which is what the facts are about: entities, backslash
// escapes and CDATA wrappers are written out. Android collapses white space outside double quotes, so the
// way the file wraps a string is not part of its text, while a "\n" the writer asked for stays a real
// break. Tags stay, because the check protects them.
export function androidReading(raw) {
  let decoded = '';
  let at = 0;
  for (;;) {
    const open = raw.indexOf('<![CDATA[', at);
    const close = open === -1 ? -1 : raw.indexOf(']]>', open + 9);
    if (close === -1) break;
    decoded += unentity(raw.slice(at, open)) + raw.slice(open + 9, close);
    at = close + 3;
  }
  decoded += unentity(raw.slice(at));

  let out = '';
  let quoted = false;
  let gap = false;
  const put = (piece) => {
    if (gap && out) out += ' ';
    gap = false;
    out += piece;
  };
  for (let i = 0; i < decoded.length; i++) {
    const char = decoded[i];
    if (char === '\\' && i + 1 < decoded.length) {
      const next = decoded[i + 1];
      const unicode = next === 'u' ? /^[0-9a-fA-F]{4}/.exec(decoded.slice(i + 2, i + 6)) : null;
      put(unicode ? character(parseInt(unicode[0], 16)) : next === 'n' ? '\n' : next === 't' ? '\t' : next);
      i += unicode ? 5 : 1;
    } else if (char === '"') {
      quoted = !quoted;
      put(char);
    } else if (!quoted && /\s/.test(char)) {
      gap = true;
    } else {
      put(char);
    }
  }
  return out;
}

// The strings of an Android resources file: strings, plural items and array items, with their texts as
// written, so an edit goes back byte for byte.
export function androidEntries(source) {
  let found;
  try {
    found = scan(source);
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    throw new SourceError(`${error.message} at line ${lineAt(lineStarts(source), error.at)}`);
  }
  const starts = lineStarts(source);
  return found.entries.map((entry) => {
    const value = source.slice(entry.start, entry.end);
    return { ...entry, value, text: androidReading(value), line: lineAt(starts, entry.start), encode: (edited) => edited };
  });
}
