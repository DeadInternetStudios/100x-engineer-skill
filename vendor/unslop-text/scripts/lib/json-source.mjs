import { SourceError } from './errors.mjs';

const MAX_DEPTH = 100;
const MESSAGE_KEYS = new Set(['defaultMessage', 'message']);
const NOTE_KEYS = new Set(['description', 'desc', 'comment', 'comments', 'note', 'notes', 'context', 'meaning', 'example', 'examples', 'placeholders']);

function catalogLanguage(strings) {
  const language = strings.find((s) => s.path.length === 1 && s.path[0] === 'sourceLanguage');
  return language && strings.some((s) => s.path[0] === 'strings') ? language.value : null;
}

// An Xcode string catalog keeps text at strings.<key>.localizations.<language>[.variations...].stringUnit.value.
// Only the value in the source language is UI text we may edit. It is named <key>, or <key>[plural.one].
function catalogName(path, language) {
  const [root, key, localizations, lang, ...rest] = path;
  if (root !== 'strings' || typeof key !== 'string' || localizations !== 'localizations' || lang !== language) return null;
  const leaf = rest.splice(-2);
  if (leaf[0] !== 'stringUnit' || leaf[1] !== 'value') return null;
  const where = rest.filter((part) => part !== 'variations');
  return where.length ? `${key}[${where.join('.')}]` : key;
}

export function catalogNote(source) {
  const language = catalogLanguage(parseJsonStrings(source));
  if (language === null) return null;
  return `this is an Xcode string catalog, and no string in it has a "${language}" entry. When a key has no "${language}" entry, the key is the text. A key can only change together with the code that uses it, so the tool leaves keys alone`;
}

function markMetadata(strings) {
  const language = catalogLanguage(strings);
  if (language !== null) {
    for (const entry of strings) {
      entry.name = catalogName(entry.path, language);
      entry.meta = entry.name === null;
    }
    return;
  }
  const descriptors = new Set();
  for (const { path } of strings) {
    if (path.length && MESSAGE_KEYS.has(path.at(-1))) descriptors.add(JSON.stringify(path.slice(0, -1)));
  }
  for (const entry of strings) {
    const arb = entry.path.some((part) => typeof part === 'string' && part.startsWith('@'));
    const note = entry.path.some((part, index) => NOTE_KEYS.has(part) && descriptors.has(JSON.stringify(entry.path.slice(0, index))));
    entry.meta = arb || note;
  }
}

export function parseJsonStrings(source) {
  const strings = [];
  let pos = 0;

  const fail = (message, at = pos) => {
    const before = source.slice(0, at);
    const line = before.split('\n').length;
    const column = at - before.lastIndexOf('\n');
    throw new SourceError(`${message} at line ${line}, column ${column}`);
  };

  const skipSpace = () => {
    for (;;) {
      const ch = source[pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\ufeff') pos++;
      else if (ch === '/' && source[pos + 1] === '/') {
        while (pos < source.length && source[pos] !== '\n') pos++;
      } else if (ch === '/' && source[pos + 1] === '*') {
        const end = source.indexOf('*/', pos + 2);
        if (end === -1) fail('Unterminated comment');
        pos = end + 2;
      } else return;
    }
  };

  const readString = () => {
    const start = pos;
    pos++;
    while (pos < source.length) {
      const ch = source[pos];
      if (ch === '\\') pos += 2;
      else if (ch === '"') {
        pos++;
        try {
          return { start, end: pos, value: JSON.parse(source.slice(start, pos)) };
        } catch {
          return fail('Invalid string (check the escapes, and replace raw line breaks and tabs)', start);
        }
      } else pos++;
    }
    return fail('Unterminated string', start);
  };

  const readValue = (path) => {
    skipSpace();
    if (path.length > MAX_DEPTH) fail(`Nested more than ${MAX_DEPTH} levels deep`);
    const ch = source[pos];
    if (ch === '"') {
      const str = readString();
      strings.push({ path, ...str });
    } else if (ch === '{') readObject(path);
    else if (ch === '[') readArray(path);
    else readLiteral();
  };

  const readLiteral = () => {
    const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(source.slice(pos, pos + 40));
    if (!match) fail('Unexpected token');
    pos += match[0].length;
  };

  const readObject = (path) => {
    pos++;
    skipSpace();
    if (source[pos] === '}') {
      pos++;
      return;
    }
    for (;;) {
      skipSpace();
      if (source[pos] === '}') {
        pos++;
        return;
      }
      if (source[pos] !== '"') fail('Expected a string key');
      const key = readString().value;
      skipSpace();
      if (source[pos] !== ':') fail('Expected ":"');
      pos++;
      readValue([...path, key]);
      skipSpace();
      if (source[pos] === ',') pos++;
      else if (source[pos] === '}') {
        pos++;
        return;
      } else fail('Expected "," or "}"');
    }
  };

  const readArray = (path) => {
    pos++;
    let index = 0;
    for (;;) {
      skipSpace();
      if (source[pos] === ']') {
        pos++;
        return;
      }
      readValue([...path, index++]);
      skipSpace();
      if (source[pos] === ',') pos++;
      else if (source[pos] === ']') {
        pos++;
        return;
      } else fail('Expected "," or "]"');
    }
  };

  readValue([]);
  skipSpace();
  if (pos < source.length) fail('Unexpected trailing content');

  let line = 1;
  let cursor = 0;
  for (const entry of strings) {
    for (; cursor < entry.start; cursor++) if (source[cursor] === '\n') line++;
    entry.line = line;
  }
  markMetadata(strings);
  return strings;
}

export function pathKey(path) {
  return path.map((part) => (typeof part === 'number' ? `[${part}]` : part)).join('.').replace(/\.\[/g, '[');
}

export function entryKey(entry) {
  return entry.name ?? pathKey(entry.path);
}

const NON_PROSE = [
  /^https?:\/\//i,
  /^[#@][\w-]+$/,
  /^[\w-]+\.(?:png|jpe?g|gif|webp|svg|ogg|wav|mp3|mp4|ttf|otf|json|ya?ml|txt|prefab|asset|tscn|glb|fbx)$/i,
  /^[a-z0-9]+(?:[._/-][a-z0-9]+)+$/,
  /^[a-z0-9_]+$/,
  /^[A-Z0-9_]{3,}$/,
];

export function looksTranslatable(value) {
  const text = value.trim();
  if (text.length < 2) return false;
  if (NON_PROSE.some((re) => re.test(text))) return false;
  if (/\s/.test(text)) return true;
  if (/^\p{Lu}\p{Ll}+$/u.test(text)) return true;
  return /[.!?…]$/.test(text) && text.length > 3;
}
