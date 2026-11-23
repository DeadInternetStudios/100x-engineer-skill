import { parseProse, lineUnits, stringUnit, linesAreParagraphs } from './blocks.mjs';
import { RULES, appliesAt } from './rules/index.mjs';
import { regexHits, isProse } from './rules/helpers.mjs';
import { PROFILES, sentenceLimits, inferProfile, structuredFormat } from './profiles.mjs';
import { countWords, tokenize, countSyllables, readability, mean, stdev, round, isLatinScript } from './text.mjs';
import { parseStructured, isEntryFormat } from './structured.mjs';
import { looksTranslatable } from './json-source.mjs';
import { looksEnglish } from './facts.mjs';
import { codeSpanTexts } from './markdown.mjs';

const SCORE_FLOOR_WORDS = 300;
// Each limit belongs to its band: 3 is clean, 8 is light. `--fail-above 8` therefore fails exactly the heavy and severe files.
// The rules are patterns for English. A text in another language gets this word where an English text gets a band, in `--json` too.
const GUESS_NOTE_WORDS = 8;
export const NOT_ENGLISH = 'not English';
// Sentence lengths that vary less than this read like a metronome. Fewer sentences than the minimum say nothing about rhythm.
export const EVEN_BELOW = 0.3;
export const BURSTINESS_MIN_SENTENCES = 10;
export const burstinessBand = (metrics) => (metrics.sentences < BURSTINESS_MIN_SENTENCES ? null : metrics.burstiness < EVEN_BELOW ? 'even' : 'varied');
export const SLOP_BANDS = [[3, 'clean'], [8, 'light'], [18, 'heavy'], [Infinity, 'severe']];
export const CLARITY_BANDS = [[15, 'clear'], [35, 'fair'], [Infinity, 'dense']];
const PROSE_EXTENSIONS = /\.(?:md|mdx|markdown|rst|adoc)$/i;
const MARKUP_FILE = /\.(?:html?|xhtml|vue|svelte|astro|php)$/i;
const CODE_FILE = /\.(?:css|scss|sass|less|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|cs|c|cc|cpp|h|hpp|sh)$/i;
const HTML_START = /^\s*(?:<!doctype html|<html[\s>])/i;
const TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>/gi;

// What a file is when it holds code or markup and not text a person reads: 'markup', 'code' or null.
// The tags, selectors and variable names in it would all be counted as words.
export function sourceKind(file, source) {
  if (file && MARKUP_FILE.test(file)) return 'markup';
  if (file && CODE_FILE.test(file)) return 'code';
  if (HTML_START.test(source) || (source.match(TAG) ?? []).length >= 8) return 'markup';
  const lines = source.split('\n').filter((line) => line.trim());
  const codeLike = lines.filter((line) => /[{};]\s*$/.test(line)).length;
  return lines.length >= 8 && codeLike / lines.length > 0.3 ? 'code' : null;
}

export function band(score, bands) {
  return bands.find(([limit]) => score <= limit)[1];
}

export function chooseFormat(file, profile, requested, source) {
  if (requested && requested !== 'auto') return requested;
  const structured = structuredFormat(file, source);
  if (structured) return structured;
  if (file && PROSE_EXTENSIONS.test(file)) return 'prose';
  return profile === 'ui' ? 'lines' : 'prose';
}

// A file in a markup format reads a line break as a soft wrap. Plain text may keep one paragraph per line.
export function parseProseSource(source, file) {
  return parseProse(source, { lineParagraphs: !(file && PROSE_EXTENSIONS.test(file)) && linesAreParagraphs(source) });
}

function buildUnits(source, { format, allStrings = false, column, file }) {
  if (isEntryFormat(format)) {
    const entries = parseStructured(source, format, { column });
    const chosen = allStrings ? entries : entries.filter((entry) => !entry.locked && looksTranslatable(entry.text ?? entry.value));
    return chosen.map((entry) => stringUnit(entry.text ?? entry.value, { line: entry.line, key: entry.key }));
  }
  if (format === 'lines') return lineUnits(source);
  return parseProseSource(source, file);
}

function blockMatches(rule, block) {
  if (rule.blocks === 'heading') return block.type === 'heading';
  if (rule.blocks === 'all') return true;
  return isProse(block);
}

const clip = (text) => (text.length > 170 ? `${text.slice(0, 167)}…` : text);
const CODE_MARK = /\bCODE\b/g;

// The cleaner writes CODE where inline code stood. The reader of a finding wants the code back.
function withCode(block, start, text) {
  if (!block.raw || !text.includes('CODE')) return text;
  const spans = codeSpanTexts(block.raw);
  if (spans.length !== (block.text.match(CODE_MARK) ?? []).length) return text;
  let used = (block.text.slice(0, start).match(CODE_MARK) ?? []).length;
  return text.replace(CODE_MARK, () => spans[used++] ?? 'CODE');
}

function quoteFor(block, hit) {
  const span = block.spans.find((s) => hit.index >= s.start && hit.index < s.end) ?? block.spans[0];
  const text = span ? span.text : block.text;
  return { quote: clip(text), shown: clip(withCode(block, span ? span.start : 0, text)) };
}

function makeFinding(rule, hit, multiplier, block) {
  const quoted = hit.quote === undefined ? quoteFor(block, hit) : null;
  const finding = {
    rule: rule.id,
    kind: rule.kind,
    group: rule.group,
    line: hit.line ?? block?.locate(hit.index) ?? 1,
    quote: hit.quote ?? quoted.quote,
    weight: round((hit.weight ?? rule.weight) * multiplier, 2),
  };
  if (quoted && quoted.shown !== quoted.quote) finding.shown = quoted.shown;
  if (hit.text) finding.match = hit.text;
  if (hit.note) finding.note = hit.note;
  if (block?.key) finding.key = block.key;
  return finding;
}

const GRADE_MIN_WORDS = 30;

function computeMetrics(units) {
  const prose = units.filter(isProse);
  const words = units.reduce((sum, unit) => sum + countWords(unit.text), 0);
  const counts = prose.flatMap((unit) => unit.spans.map((span) => countWords(span.text)));
  const syllables = units.reduce((sum, unit) => sum + tokenize(unit.text).reduce((s, token) => s + countSyllables(token), 0), 0);
  const meanLength = mean(counts);
  const spread = stdev(counts);
  const { grade, ease } = readability(words, counts.length, syllables);
  return {
    words,
    sentences: counts.length,
    meanSentence: round(meanLength),
    stdevSentence: round(spread),
    burstiness: meanLength ? round(spread / meanLength, 2) : 0,
    grade,
    ease,
  };
}

function scoreOf(findings, kind, words) {
  const total = findings.filter((f) => f.kind === kind).reduce((sum, f) => sum + f.weight, 0);
  return { total: round(total, 2), perThousand: round((total / Math.max(words, SCORE_FLOOR_WORDS)) * 1000) };
}

function summarizeByRule(findings) {
  const map = new Map();
  for (const f of findings) {
    const entry = map.get(f.rule) ?? { rule: f.rule, kind: f.kind, count: 0, weight: 0 };
    entry.count++;
    entry.weight = round(entry.weight + f.weight, 2);
    map.set(f.rule, entry);
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

function worstUnits(units, findings, limit = 12) {
  const byLine = new Map();
  for (const f of findings) {
    const entry = byLine.get(f.line) ?? { line: f.line, key: f.key, weight: 0, rules: new Set() };
    entry.weight += f.weight;
    entry.rules.add(f.rule);
    byLine.set(f.line, entry);
  }
  return [...byLine.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((e) => ({ line: e.line, ...(e.key ? { key: e.key } : {}), weight: round(e.weight, 2), rules: [...e.rules] }));
}

function analyzeUnits(units, { profile, level = 'standard', file, format, inferred = false, english, leftOut }) {
  const profileConfig = PROFILES[profile];
  const limits = {
    instruction: sentenceLimits(profile, level, 'instruction'),
    description: sentenceLimits(profile, level, 'description'),
  };
  const doc = { blocks: units, profile, level };
  const findings = [];

  for (const rule of RULES) {
    if (!appliesAt(rule, profile, level)) continue;
    const multiplier = profileConfig.weights[rule.id] ?? 1;
    if (multiplier === 0) continue;
    const context = { doc, profile, level, limits, profileConfig };
    if (rule.scope === 'doc') {
      for (const hit of rule.detect(context)) findings.push(makeFinding(rule, hit, multiplier, null));
      continue;
    }
    for (const block of units) {
      if (!blockMatches(rule, block)) continue;
      const hits = rule.patterns ? regexHits(rule.patterns, block.text) : rule.detect({ ...context, block });
      for (const hit of hits) findings.push(makeFinding(rule, hit, multiplier, block));
    }
  }
  findings.sort((a, b) => a.line - b.line);

  const metrics = computeMetrics(units);
  // Reading grade and ease are formulas for English, and they say nothing about a handful of words.
  if (!english || metrics.words < GRADE_MIN_WORDS) {
    metrics.grade = null;
    metrics.ease = null;
  }
  const slop = scoreOf(findings, 'slop', metrics.words);
  const clarity = scoreOf(findings, 'clarity', metrics.words);
  return {
    file: file ?? null,
    format,
    profile,
    profileInferred: inferred,
    level,
    english,
    leftOut,
    metrics,
    scores: {
      slop: slop.perThousand,
      slopBand: english ? band(slop.perThousand, SLOP_BANDS) : NOT_ENGLISH,
      clarity: clarity.perThousand,
      clarityBand: english ? band(clarity.perThousand, CLARITY_BANDS) : NOT_ENGLISH,
    },
    totals: { slopWeight: slop.total, clarityWeight: clarity.total, findings: findings.length },
    byRule: summarizeByRule(findings),
    findings,
    worst: format === 'prose' ? [] : worstUnits(units, findings),
  };
}

export function lintSource(source, options = {}) {
  const level = options.level ?? 'standard';
  const requested = options.profile ?? 'auto';
  const profile = requested === 'auto' ? inferProfile(options.file, source, { format: options.format }) : requested;
  const format = chooseFormat(options.file, profile, options.format, source);
  const all = buildUnits(source, { format, allStrings: options.allStrings, column: options.column, file: options.file });
  // The rules are patterns for English words, so a block in another script is left out of the scoring.
  // `english` is false when most of the text was left out, or when the Latin-script text that is left
  // reads as another language (Spanish, German): the score says little then.
  const units = all.filter((unit) => isLatinScript(unit.text));
  const english = looksEnglish(all.map((unit) => unit.text).join(' '));
  const report = analyzeUnits(units, { profile, level, file: options.file, format, inferred: requested === 'auto', english, leftOut: all.length - units.length });
  // Code and markup count as words in every score. A page that reads as English keeps its scores, because it may be mostly prose.
  const kind = sourceKind(options.file, source);
  report.sourceKind = kind === 'code' || !english ? kind : null;
  // Text that no file name or layout placed is read as interface strings when every line is short. The person may have pasted prose.
  report.guessedUi = requested === 'auto' && profile === 'ui' && format === 'lines' ? { longest: Math.max(0, ...units.map((unit) => countWords(unit.text))) } : null;
  // A button label needs no note: the guess only matters once a line is long enough to be a sentence.
  if (report.guessedUi && report.guessedUi.longest < GUESS_NOTE_WORDS) report.guessedUi = null;
  return report;
}
