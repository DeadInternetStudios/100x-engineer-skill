import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { UsageError } from './errors.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'all-strings', 'force', 'write', 'strict', 'allow-outside', 'summary', 'full']);
export const PROSE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.unslop', 'out', 'dist', 'build']);

// `known` is the list of option names `command` takes. Without it, any `--name` is taken as an option
// and swallows the next word, so a typo such as `--proflie docs` would eat the file name.
export function parseArgs(argv, { known, command } = {}) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-') positional.push(arg);
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (known && !known.includes(name)) {
        const takes = known.length ? `Its options: ${known.map((option) => `--${option}`).join(', ')}` : 'It takes no options';
        throw new UsageError(`${command} does not take --${name}. ${takes}`);
      }
      if (eq !== -1) flags[name] = arg.slice(eq + 1);
      else if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
      else {
        const value = argv[++i];
        if (value === undefined) throw new UsageError(`--${name} needs a value`);
        flags[name] = value;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

export function collectFiles(paths) {
  const files = [];
  const visit = (path, explicit) => {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
        visit(join(path, name), false);
      }
    } else if (explicit || PROSE_EXTENSIONS.has(extname(path).toLowerCase())) files.push(path);
  };
  for (const path of paths) visit(path, true);
  return files;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const UTF16 = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true });

function utf16Order(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'be';
  return null;
}

export function readText(path) {
  const name = path === '-' ? 'stdin' : path;
  if (path !== '-' && statSync(path).isDirectory()) throw new UsageError(`${name} is a folder. Name one file, or use "unslop begin ${name}" and "unslop finish" to check every file in it`);
  const bytes = readFileSync(path === '-' ? 0 : path);
  const order = utf16Order(bytes);
  if (order) {
    try {
      return { text: UTF16.decode(order === 'be' ? Buffer.from(bytes).swap16() : bytes), encoding: `utf-16${order}` };
    } catch {
      throw new UsageError(`${name} starts like UTF-16 text but is not valid UTF-16. Convert it first, for example: iconv -f UTF-16 -t UTF-8 ${name}`);
    }
  }
  if (bytes.includes(0)) throw new UsageError(`${name} looks like a binary file: it contains NUL bytes. Convert UTF-16 text without a byte order mark to UTF-8 first`);
  try {
    return { text: UTF8.decode(bytes), encoding: 'utf-8' };
  } catch {
    throw new UsageError(`${name} is not valid UTF-8, and a rewrite would corrupt it. Convert it first, for example: iconv -f latin1 -t utf-8 ${name}`);
  }
}

export const readInput = (path) => readText(path).text;

export function encodeText(text, encoding) {
  if (encoding === 'utf-8') return Buffer.from(text, 'utf8');
  const bytes = Buffer.from(text, 'utf16le');
  return encoding === 'utf-16be' ? bytes.swap16() : bytes;
}

export function pick(flags, name, allowed, fallback) {
  const value = flags[name] ?? fallback;
  if (!allowed.includes(value)) throw new UsageError(`--${name} must be one of: ${allowed.join(', ')} (got "${value}")`);
  return value;
}
