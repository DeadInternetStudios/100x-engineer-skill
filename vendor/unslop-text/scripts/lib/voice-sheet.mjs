// `unslop voice`: the measurable half of a voice sheet. It counts what a rewrite has to keep, so the
// sheet starts from numbers and the writer adds the parts only a reader can judge.
import { proseSentences } from './claims.mjs';
import { voiceOf, emptyVoice, addVoice } from './voice.mjs';
import { counted } from './counted.mjs';

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const CODE_MARK = /\bCODE\b/g;
const YOU = /\byou(?:r|rs|rself)?\b/i;
// A capitalized word in the middle of a sentence is a name or a product term.
const TERM = /(?<=[\p{Ll}\p{N},;:)] )\p{Lu}[\p{L}\p{N}]+/gu;
// Dates are capitalized too, and say nothing about a product.
const DATE_WORDS = new Set('January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split(' '));
const MIN_TERM_USES = 3;
const MAX_TERMS = 10;

const percentile = (sorted, share) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];

function registerOf(voice, sentences) {
  if (!sentences) return 'unknown';
  const rate = voice.contractions / sentences;
  if (rate >= 0.15) return 'friendly: contractions are common';
  if (rate >= 0.03) return 'neutral: a few contractions';
  return 'formal: almost no contractions';
}

export function voiceSheet(source, file) {
  const sentences = proseSentences(source, file);
  const lengths = sentences.map((s) => (s.text.match(WORD) ?? []).length).sort((a, b) => a - b);
  const voice = sentences.reduce((total, s) => addVoice(total, s.text), emptyVoice());
  const withFirstPerson = sentences.filter((s) => voiceOf(s.text).firstPerson > 0).length;
  const withYou = sentences.filter((s) => YOU.test(s.text)).length;
  // A word capitalized mid-sentence once is a candidate. Then every use counts, including at a sentence start.
  const prose = sentences.map((s) => s.text.replace(CODE_MARK, ' '));
  const candidates = new Set(prose.flatMap((text) => text.match(TERM) ?? []));
  const uses = new Map();
  for (const text of prose) for (const word of text.match(WORD) ?? []) if (candidates.has(word)) uses.set(word, (uses.get(word) ?? 0) + 1);
  const terms = [...uses].filter(([term, n]) => n >= MIN_TERM_USES && !DATE_WORDS.has(term)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_TERMS);
  const words = lengths.reduce((sum, n) => sum + n, 0);
  return {
    sentences: sentences.length,
    words,
    length: sentences.length ? { mean: Math.round((words / sentences.length) * 10) / 10, median: percentile(lengths, 0.5), p90: percentile(lengths, 0.9), max: lengths.at(-1) } : null,
    contractions: voice.contractions,
    firstPersonSentences: withFirstPerson,
    youSentences: withYou,
    questions: voice.questions,
    register: registerOf(voice, sentences.length),
    terms: terms.map(([term, n]) => ({ term, uses: n })),
  };
}

const ARROW = '\u2192';

const person = (sheet) => {
  const parts = [];
  if (sheet.youSentences) parts.push(`"you" in ${counted(sheet.youSentences, 'sentence')}`);
  if (sheet.firstPersonSentences) parts.push(`"I" or "we" in ${counted(sheet.firstPersonSentences, 'sentence')}`);
  return parts.join('; ') || 'neither "you" nor "I" or "we"';
};
const terms = (sheet) => (sheet.terms.length ? sheet.terms.map((t) => `${t.term} (${t.uses})`).join(', ') : `none used ${MIN_TERM_USES} or more times`);

// One sheet, or two to compare: `before \u2192 after` for each measure.
export function formatVoiceSheet(sheet, { file, after, afterFile } = {}) {
  const title = `Voice measures${file ? `: ${file}${afterFile ? ` ${ARROW} ${afterFile}` : ''}` : ''}`;
  if (!sheet.sentences || (after && !after.sentences)) {
    const empty = !sheet.sentences ? file : afterFile;
    return `${title}\n\nNo prose sentences found${empty ? ` in ${empty}` : ''}.`;
  }
  const both = (measure) => (after ? `${measure(sheet)} ${ARROW} ${measure(after)}` : measure(sheet));
  const rows = [
    ['Size', both((x) => `${counted(x.sentences, 'sentence')}, ${x.words} words`)],
    ['Rhythm', after
      ? `mean ${sheet.length.mean} ${ARROW} ${after.length.mean}, median ${sheet.length.median} ${ARROW} ${after.length.median}, 90% under ${sheet.length.p90 + 1} ${ARROW} ${after.length.p90 + 1}, longest ${sheet.length.max} ${ARROW} ${after.length.max}`
      : `mean ${sheet.length.mean} words, median ${sheet.length.median}, 90% under ${sheet.length.p90 + 1}, longest ${sheet.length.max}`],
    ['Register', both((x) => x.register)],
    ['Contractions', both((x) => x.contractions)],
    ['Person', both(person)],
    ['Questions', both((x) => x.questions)],
    ['Terms', after ? `${terms(sheet)} ${ARROW} ${terms(after)}` : terms(sheet)],
  ];
  return [
    title,
    '',
    ...rows.map(([label, value]) => `${`${label}:`.padEnd(15)}${value}`),
    '',
    'These numbers fill the measured lines of a voice sheet (references/long-text.md). A person writes the rest: Reader (who the text is for), Keep (what must survive) and Do not touch (code, quotes, names).',
  ].join('\n');
}
