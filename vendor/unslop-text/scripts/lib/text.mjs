const UNIT_WORDS = new Set([
  'ms', 's', 'sec', 'secs', 'min', 'mins', 'h', 'hr', 'hrs', 'kb', 'mb', 'gb', 'tb',
  'px', 'pt', 'kg', 'mg', 'lb', 'lbs', 'cm', 'mm', 'km', 'mi', 'ft', 'fps', 'hz',
  'khz', 'mhz', 'ghz', 'xp', 'hp', 'mp', 'dpi', 'rpm', 'bpm', 'mph', 'kph', 'kbps',
  'mbps', 'gbps',
]);

const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'no', 'fig',
  'approx', 'inc', 'ltd', 'co', 'cf', 'al', 'ca', 'vol', 'pp', 'ed', 'est', 'resp',
  'dept', 'etc',
]);
// Abbreviations that name a numbered thing. "NDK rev. 20 and" goes on, but "Wait 30 sec. Then retry." does not.
const NUMBERED = new Set(['rev', 'ver', 'eq', 'ref', 'ch', 'sec', 'ext', 'tel', 'art', 'sect', 'para', 'pt', 'nr']);

const WORD_RE = /\p{L}[\p{L}\p{M}\p{N}'’_-]*|\p{N}[\p{N}.,:/+%-]*/gu;
const NUMBER_START_RE = /^\p{N}/u;
const LAST_WORD_WINDOW = 16;
const LATIN_SHARE = 0.5;

// The rules are patterns for English words. Chinese, Japanese, Korean, Cyrillic or Arabic text has no
// English words to match, and in some of those scripts no spaces to count words by, so a score on it
// says nothing. English text, code names and accented European text all have mostly Latin letters.
export function isLatinScript(text) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return true;
  return letters.replace(/\P{Script=Latin}/gu, '').length / letters.length >= LATIN_SHARE;
}

export function tokenize(text) {
  return text.match(WORD_RE) ?? [];
}

export function countWords(text) {
  const tokens = tokenize(text);
  let count = 0;
  for (let i = 0; i < tokens.length; i++) {
    count++;
    const next = tokens[i + 1];
    if (NUMBER_START_RE.test(tokens[i]) && next && UNIT_WORDS.has(next.toLowerCase())) i++;
  }
  return count;
}

export function splitSentences(text) {
  const sentences = [];
  const boundary = /(?<![.!?…])([.!?…]+)(["'”’)\]]*)(\s+)/g;
  let start = 0;
  let match;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[1].length + match[2].length;
    const before = text.slice(start, match.index);
    const after = text.slice(boundary.lastIndex);
    if (!isBoundary(before, match[1], after)) continue;
    pushSentence(sentences, text.slice(start, end));
    start = boundary.lastIndex;
  }
  pushSentence(sentences, text.slice(start));
  return sentences;
}

function pushSentence(list, raw) {
  const trimmed = raw.trim();
  if (trimmed) list.push(trimmed);
}

function isBoundary(before, punctuation, after) {
  const next = after.trimStart()[0];
  if (next === undefined) return true;
  if (!/[\p{Lu}\p{N}"'“‘(\[¿¡]/u.test(next)) return false;
  if (punctuation !== '.') return true;
  const tail = (before.slice(-LAST_WORD_WINDOW).match(/([\p{L}.'’]+)$/u) ?? [])[1]?.toLowerCase() ?? '';
  // "can't." ends a sentence: the "t" after the apostrophe is the end of a word, not an initial.
  const lastWord = /\p{L}['’]\p{L}/u.test(tail) ? '' : tail.replace(/['’]/g, '');
  if (lastWord.length === 1 && /\p{L}/u.test(lastWord)) return false;
  if (ABBREVIATIONS.has(lastWord)) return lastWord === 'etc' && /\p{Lu}/u.test(next);
  if (NUMBERED.has(lastWord) && /\p{N}/u.test(next)) return false;
  return true;
}

export function countSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return w.length ? 1 : 0;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export function readability(wordCount, sentenceCount, syllableCount) {
  if (!wordCount || !sentenceCount) return { grade: 0, ease: 0 };
  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = syllableCount / wordCount;
  // Very short sentences push the raw formulas past what the report promises ("ease: 0 to 100"), so a button label list read ease 117.9 and grade -2.5.
  return {
    grade: round(Math.max(0, 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59)),
    ease: round(Math.min(100, Math.max(0, 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord))),
  };
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

export function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function lineLocator(lines) {
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push({ offset, no: line.no });
    offset += line.text.length + 1;
  }
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    let found = starts[0]?.no ?? 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (starts[middle].offset > index) {
        high = middle - 1;
      } else {
        found = starts[middle].no;
        low = middle + 1;
      }
    }
    return found;
  };
}

export function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

export function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}
