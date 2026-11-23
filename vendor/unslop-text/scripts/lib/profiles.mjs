import { xmlRoot } from './xml.mjs';

export const PROFILE_NAMES = ['ui', 'docs', 'article', 'message', 'marketing', 'narrative'];
export const LEVEL_NAMES = ['light', 'standard', 'strict'];

export const PROFILES = {
  ui: {
    label: 'UI strings: buttons, labels, tooltips, errors, dialogs',
    sentence: { instruction: [12, 18], description: [14, 22] },
    paragraphSentences: 3,
    weights: { 'emoji-decoration': 0.5, 'sales-language': 0.5 },
  },
  docs: {
    label: 'Documentation: README, guides, API docs, release notes, help articles',
    sentence: { instruction: [22, 28], description: [27, 34] },
    paragraphSentences: 6,
    weights: { 'bold-decoration': 0.5, 'meta-text': 0.5, 'ending-summary': 0.5, 'uniform-rhythm': 0.5, 'contrast-closer': 0.5 },
  },
  article: {
    label: 'Long-form prose: articles, essays, blog posts, reports, newsletters',
    sentence: { instruction: [30, 40], description: [32, 42] },
    paragraphSentences: 7,
    weights: { 'heading-case': 0.5, 'nominalization': 0.5, 'passive-voice': 0.5, 'plain-word': 0.5, 'idiom': 0.5, 'wordy-phrase': 0.5 },
  },
  message: {
    label: 'Messages: email, chat, comments, PR text, commit messages, replies',
    sentence: { instruction: [24, 32], description: [28, 36] },
    paragraphSentences: 6,
    weights: { 'exclamation-density': 0.5 },
  },
  marketing: {
    label: 'Marketing and product copy: landing pages, store pages, app descriptions',
    sentence: { instruction: [20, 28], description: [24, 32] },
    paragraphSentences: 5,
    weights: { triad: 0.5, 'sales-language': 0.5, 'passive-voice': 0.5, 'plain-word': 0.5, idiom: 0.5, 'wordy-phrase': 0.5 },
  },
  narrative: {
    label: 'Fiction, dialogue, flavor text, lore, speeches',
    sentence: { instruction: [60, 90], description: [60, 90] },
    paragraphSentences: 99,
    weights: { 'negative-parallelism': 0.5, 'stock-vocabulary': 0.5, 'profound-saying': 0.5, 'one-line-closer': 0, dashes: 0 },
  },
};

const LEVELS = {
  light: { sentenceScale: 1.3, strictRules: false, clarity: false },
  standard: { sentenceScale: 1, strictRules: false, clarity: true },
  strict: { sentenceScale: 1, strictRules: true, clarity: true, steLimits: { instruction: 20, description: 25 } },
};

export function sentenceLimits(profileName, levelName, kind) {
  const [warn, hard] = PROFILES[profileName].sentence[kind];
  const level = LEVELS[levelName];
  if (level.steLimits && profileName !== 'narrative') {
    const cap = level.steLimits[kind];
    return { warn: Math.min(warn, cap), hard: Math.min(hard, cap + 4) };
  }
  return { warn: Math.round(warn * level.sentenceScale), hard: Math.round(hard * level.sentenceScale) };
}

const STRUCTURED = { '.json': 'json', '.jsonc': 'json', '.arb': 'json', '.xcstrings': 'json', '.properties': 'kv', '.strings': 'kv', '.csv': 'csv', '.tsv': 'csv' };

// An .xml file is a list of strings only when it is Android resources, which the source shows.
export function structuredFormat(file, source) {
  const extension = file && file.includes('.') ? file.slice(file.lastIndexOf('.')).toLowerCase() : '';
  if (extension === '.xml') return source !== undefined && xmlRoot(source) === 'resources' ? 'xml' : null;
  return STRUCTURED[extension] ?? null;
}

// A line this long is a sentence or more, not a button label.
export const PROSE_LINE_WORDS = 15;

// A name of up to four words, two or more spaces (or a tab), then its text. A help screen, a status table or a list of commands
// reads this way, and its lines usually start in lower case, so no capital marks where one sentence ends and the next begins.
// Two spaces after a full stop are a typing habit, not a column.
const COLUMN_ROW = /^\s*\S+(?: \S+){0,3}(?<![.!?])(?: {2,}|\t)\S/;
const COLUMN_ROWS_MIN = 4;
const COLUMN_SHARE = 0.25;
const COLUMN_LINE_WORDS = 40;

// `format: 'prose'` is the person saying the text is paragraphs, so short text is not guessed to be button labels.
export function inferProfile(file, text, { format } = {}) {
  const guess = guessProfile(file, text);
  return guess === 'ui' && format === 'prose' ? 'docs' : guess;
}

function guessProfile(file, text) {
  if (structuredFormat(file, text)) return 'ui';
  if (/^\s*(?:subject|from|to|cc|date):\s/i.test(text)) return 'message';
  const words = text.split(/\s+/).filter(Boolean).length;
  const lines = text.split('\n').filter((line) => line.trim());
  const longest = Math.max(0, ...lines.map((line) => line.split(/\s+/).filter(Boolean).length));
  const hasCode = /^\s{0,3}(?:```|~~~)/m.test(text) || (text.match(/`[^`\n]+`/g) ?? []).length >= 3;
  const hasTable = /^[ \t]*\|.+\|[ \t]*$/m.test(text) && /^[ \t]*\|?[ \t]*:?-{2,}/m.test(text);
  const listLines = lines.filter((line) => /^\s*(?:[-*+]|\d+[.)])\s/.test(line)).length;
  if (hasCode || hasTable || (lines.length >= 4 && listLines / lines.length > 0.25)) return 'docs';
  const columnRows = lines.filter((line) => COLUMN_ROW.test(line)).length;
  if (columnRows >= COLUMN_ROWS_MIN && columnRows / lines.length >= COLUMN_SHARE && longest < COLUMN_LINE_WORDS && !/^\s{0,3}#{1,6}\s/m.test(text)) return 'ui';
  if (/^\s{0,3}#{1,6}\s/m.test(text)) {
    const headings = lines.filter((line) => /^\s{0,3}#{2,6}\s/.test(line));
    const questions = headings.filter((line) => /\?\s*$/.test(line)).length;
    if (headings.length >= 3 && questions / headings.length >= 0.5) return 'docs';
    const proseLines = lines.filter((line) => !/^\s{0,3}#{1,6}\s/.test(line) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(line));
    const average = proseLines.length ? words / proseLines.length : 0;
    return words >= 200 && average >= 30 ? 'article' : 'docs';
  }
  if (lines.length >= 3 && words / lines.length < 7 && longest < PROSE_LINE_WORDS) return 'ui';
  if (/^\s*(?:hi|hello|hey|dear|thanks|thank you)\b/i.test(text) && words < 400) return 'message';
  if (words < 40) return longest >= PROSE_LINE_WORDS ? 'docs' : 'ui';
  return 'article';
}
