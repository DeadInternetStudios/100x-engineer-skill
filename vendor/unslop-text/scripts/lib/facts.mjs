import { splitSentences, countWords, isLatinScript } from './text.mjs';
import { parseDocument } from './blocks.mjs';
import { groupsOf, visibleText } from './icu.mjs';
import { tableRowFlags, isDelimiterRow, cellsOf } from './tables.mjs';
import { TAG_RE, BRACKET_MARKUP_RE, CDATA_MARKS_RE, STRING_MARKUP_RE, placeholderRe } from './tokens.mjs';
import { unwrapLinks, removeComments } from './markdown.mjs';

const NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100, thousand: 1000, million: 1000000,
};
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi');
const NUMBER_RE = /(?<![\w.])[$€£]?\d[\d,]*(?:\.\d+)?(?:%|x|×|\+)?(?![\w])/g;
const VERSION_RE = /\bv?\d+(?:\.\d+){2,}[\w.-]*\b/g;
const IDENTIFIER_RES = [
  /\b[\w-]{0,256}_[\w-]{0,256}\b/g,
  /\b[\w-]{1,256}(?:\.[A-Za-z][\w-]{0,256})+\b/g,
  /\b[\w.-]{1,256}@[\w-]{1,256}(?:\.[\w-]{1,256})+\b/g,
  /\b[\w.-]{0,256}\/[\w./-]{0,256}[._][\w./-]{0,256}\b/g,
  /\b[\w-]{0,256}[a-z][A-Z][\w-]{0,256}\b/g,
  /\b[A-Z]{2,}-\d+\b/g,
  /#[0-9A-Fa-f]{3,8}\b/g,
  /\b[A-Z]\d+[A-Za-z0-9]*\b/g,
];
const ABBREVIATION = /^(?:e\.g|i\.e|a\.m|p\.m|u\.s|u\.k|ph\.d|vs|etc)$/i;
const HEDGES = /\b(?:may|might|could|perhaps|possibly|probably|likely|usually|typically|often|sometimes|generally|roughly|approximately|nearly|almost|appears?\s+to|seems?\s+to|tends?\s+to|in\s+most\s+cases|in\s+some\s+cases)\b/gi;
// Words that limit when a rule holds. Dropping one makes the rule apply more widely than the author said.
// "until" and "if" are left out: "wait until it ends" becomes "wait for it to end", and "if" appears in nearly every rewrite.
const CONDITIONS = /\b(?:unless|only\s+(?:if|when|after|before|once|while)|as\s+long\s+as|so\s+long\s+as|provided\s+that|otherwise|except\s+(?:when|if))\b/gi;
const ABSOLUTES = /\b(?:always|never|guarantee[sd]?|definitely|certainly|completely|entirely)\b/gi;
// "each" and "every" say the same, so a rewrite may swap one for the other. "each other" is not a quantifier.
const UNIVERSALS = /\b(?:every|each(?!\s+other\b))\b/gi;
const EXAMPLE_MARKERS = /\b(?:for\s+(?:example|instance)|such\s+as|e\.g\.)/gi;
const EXPLAINERS = /\b(?:which|this|that)\s+means\b|\bin\s+other\s+words\b|\bi\.e\./gi;

function stripFrontMatter(source) {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') return { frontMatter: '', body: source };
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end === -1) return { frontMatter: '', body: source };
  return { frontMatter: lines.slice(0, end + 1).join('\n'), body: lines.slice(end + 1).join('\n') };
}

export function protectedRegions(source) {
  const text = source.replace(/\r\n?/g, '\n');
  const { frontMatter, body } = stripFrontMatter(text);
  const lines = body.split('\n');
  const fences = [];
  const ignored = [];
  const covered = new Array(lines.length).fill(false);
  for (const { kind, start, end } of parseDocument(body).regions) {
    (kind === 'ignored' ? ignored : fences).push(lines.slice(start - 1, end).join('\n'));
    covered.fill(true, start - 1, end);
  }
  return { frontMatter, fences, ignored, prose: lines.filter((_, i) => !covered[i]).join('\n') };
}

function normalizeNumber(token) {
  return token.replace(/,/g, '').replace(/^([$€£]?)0+(?=\d)/, '$1').replace(/(\.\d*?)0+(?=[%x×+]?$)/, '$1').replace(/\.(?=[%x×+]?$)/, '');
}

export function numbersOf(text, { words = true } = {}) {
  const withoutVersions = text.replace(VERSION_RE, ' ').replace(/(\d)\s*(?:percent|per\s+cent)\b/gi, '$1%');
  // The numeral 1 is not tracked, because "1 file" becomes "one file" or "a file". "1.0" and "01" are
  // written values, a version and an hour, and are tracked.
  const found = (withoutVersions.match(NUMBER_RE) ?? []).filter((token) => normalizeNumber(token) !== '1' || /\.\d|^0\d/.test(token)).map(normalizeNumber);
  if (words) for (const match of withoutVersions.matchAll(NUMBER_WORD_RE)) found.push(String(NUMBER_WORDS[match[1].toLowerCase()]));
  return found.sort();
}

// A placeholder that wraps onto a second line is the same placeholder.
const oneLine = (token) => token.replace(/\s+/g, ' ');

export function placeholdersOf(text, { strings = false } = {}) {
  const variable = placeholderRe(strings);
  const tokens = [];
  const collect = (source) => {
    for (const { inner, icu } of groupsOf(source)) {
      if (!icu) {
        tokens.push(`{${oneLine(inner.trim())}}`);
        continue;
      }
      tokens.push(`{${icu.name},${icu.type}}`);
      for (const { selector, body } of icu.branches) {
        tokens.push(`${icu.name},${icu.type}:${selector}`);
        collect(body);
      }
    }
  };
  collect(text.replace(variable, ' '));
  return [...tokens, ...(text.match(variable) ?? []).map(oneLine)].sort();
}

export function stripPlaceholders(text, { strings = false } = {}) {
  const stripped = visibleText(text.replace(placeholderRe(strings), ' ')).replace(TAG_RE, ' ');
  return strings ? stripped.replace(CDATA_MARKS_RE, ' ').replace(STRING_MARKUP_RE, ' ').replace(BRACKET_MARKUP_RE, ' ') : stripped;
}

export function tagsOf(text, { strings = false } = {}) {
  // Padding the cells of a table puts spaces beside its pipes, so "<IE9|use it >" and "<IE9 | use it >" are one run.
  const found = (text.match(TAG_RE) ?? []).map((tag) => tag.replace(/\s+/g, ' ').replace(/ ?\| ?/g, '|'));
  if (strings) {
    const rest = text.replace(TAG_RE, ' ').replace(CDATA_MARKS_RE, ' ');
    found.push(...(rest.match(STRING_MARKUP_RE) ?? []), ...(rest.replace(STRING_MARKUP_RE, ' ').match(BRACKET_MARKUP_RE) ?? []));
  }
  return found.sort();
}

export function identifiersOf(text, { strings = false } = {}) {
  const withoutTokens = text.replace(placeholderRe(strings), ' ').replace(/\{[^{}]*\}/g, ' ').replace(TAG_RE, ' ');
  const withoutPlaceholders = strings ? withoutTokens.replace(STRING_MARKUP_RE, ' ') : withoutTokens;
  const found = new Set();
  for (const re of IDENTIFIER_RES) for (const m of withoutPlaceholders.matchAll(re)) found.add(m[0].replace(/(?<![.,;:])[.,;:]+$/, ''));
  for (const m of withoutPlaceholders.matchAll(VERSION_RE)) found.add(m[0]);
  return [...found].filter((token) => !/^\d+(?:\.\d+)?$/.test(token) && !ABBREVIATION.test(token)).sort();
}

const TITLE_SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'if', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'via', 'with']);

function looksTitleCased(text, minWords = 3) {
  const words = text.split(/\s+/).map((w) => w.match(/\p{L}.*\p{L}|\p{L}/su)?.[0] ?? '').filter((w) => w && !TITLE_SMALL.has(w.toLowerCase()));
  if (words.length < minWords) return false;
  return words.filter((w) => /^\p{Lu}/u.test(w)).length / words.length >= 0.8;
}

const LIST_MARKER = /^\s*(?:[•◦▪▸►‣⁃·*+-]|\d{1,3}[.)])\s+/u;
const LABEL_BREAK = /:\s|\s[–—-]\s/u;

function proseParts(line) {
  const parts = line.replace(LIST_MARKER, '').split(LABEL_BREAK);
  return parts.filter((part, i) => !looksTitleCased(part, i < parts.length - 1 ? 2 : 3));
}

export function entitiesOf(text) {
  const found = new Set();
  for (const line of text.split('\n')) {
    for (const part of proseParts(line)) {
      for (const sentence of splitSentences(part)) {
        const words = sentence.split(/\s+/);
        for (let i = 1; i < words.length; i++) {
          const word = words[i].replace(/^[("'“‘[]+|(?<![)"'”’\].,;:!?])[)"'”’\].,;:!?]+$/g, '');
          if (/^\p{Lu}\p{Ll}+(?:['’]s)?$/u.test(word) && word !== 'I') found.add(word.replace(/['’]s$/, ''));
        }
      }
    }
  }
  return [...found].sort();
}

function isShouted(line) {
  const words = line.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
  return words.length >= 2 && words.every((word) => word === word.toUpperCase());
}

export function acronymsOf(raw) {
  const text = raw.split('\n').filter((line) => !isShouted(line)).join('\n');
  const words = text.split(/\s+/).filter(Boolean);
  const upper = words.filter((w) => /^[A-Z]{2}[A-Z0-9]*[.,;:!?]*$/.test(w)).length;
  if (words.length >= 12 && upper / words.length > 0.4) return [];
  return [...new Set(text.match(/(?<![\p{L}\p{N}_])[A-Z]{2}[A-Z0-9]*(?![\p{L}\p{N}_])/gu) ?? [])].sort();
}

export function quotesOf(text) {
  const found = [];
  for (const m of text.matchAll(/["“]([^"”\n]{12,})["”]/g)) {
    if (countWords(m[1]) >= 3) found.push(m[1].trim());
  }
  return found;
}

function count(text, re) {
  return (text.match(re) ?? []).length;
}

const NEGATION_LEADS = 'a|an|the|that|this|to|be|been|just|only|yet|always|ever|really|need|want|even|any|your|our|their|its|in|on|at|of|for|with|from|by|about|into|than';
const NEGATION_TARGET = new RegExp(
  String.raw`\b(?:(?:not|no|never|cannot|without|neither|nor|\w+n['’]t)\s+((?:\(?(?:${NEGATION_LEADS})\)?\s+){0,3})|(?:unable|fail(?:s|ed|ing)?|refus(?:e|es|ed|ing))\s+to\s+(?:be\s+)?)\(?([\p{L}\p{N}][\p{L}\p{N}'’-]*)`,
  'giu',
);
const NEGATION_FILLER = new Set(['a', 'an', 'the', 'to', 'be', 'been', 'just', 'only', 'yet', 'always', 'ever', 'really', 'even', 'any', 'your', 'our', 'their', 'its', 'is', 'are', 'was', 'were', 'it', 'this', 'that', 'in', 'on', 'of', 'for', 'and', 'or', 'but', 'with', 'if', 'you', 'we', 'they', 'i']);

function negationTargets(text) {
  const targets = [];
  for (const match of text.matchAll(NEGATION_TARGET)) {
    const word = match[2].toLowerCase().replace(/['’]s$/, '');
    if (!NEGATION_FILLER.has(word)) {
      targets.push(word);
      continue;
    }
    // "do not need it": the object is filler, so the verb carries the negation.
    const verb = /\b(need|want)\b/i.exec(match[1] ?? '');
    if (verb) targets.push(verb[1].toLowerCase());
  }
  return targets;
}

const ENGLISH_MARKERS = new Set([
  'the', 'and', 'you', 'your', 'are', 'were', 'is', 'to', 'of', 'it', 'for', 'this', 'that', 'with', 'be', 'not', 'cannot', 'can', 'we', 'our', 'if', 'have', 'has',
  'they', 'their', 'but', 'from', 'will', 'would', 'should', 'could', 'may', 'what', 'which', 'when', 'there', 'here', 'how', 'about', 'into', 'more', 'all', 'any',
  'just', 'never', 'always', 'without',
]);
const ENGLISH_SHARE = 0.08;
// Function words of the languages most often mistaken for English, minus every one English also uses
// ("as", "die", "per", "van", "met", "con", "sin", "los", "las", "y", "os", "den", "non", "en", "la", "le",
// "ne", "est", "pas", "sur", "me", "no", "a", "on"). A short text with more of these than English ones is not English.
const FOREIGN_MARKERS = new Set(`
  de el al un que una para por como pero muy tu tus sus mis nuestro nuestra esta este
  der das und nicht ist ein eine mit für auf zu dem von sie wir ich auch sich oder aber wie wird
  les des une et dans avec vous nous qui cette sont votre vos
  não uma dos você seu sua mais
  il gli che di sono della nel più questo
  het een niet voor zijn dat maar ook`.split(/\s+/).filter(Boolean));
// A word with an accent English does not use also counts as foreign, except these borrowed ones.
const ACCENTED = /[áéíóúñüöäßçãõàèìòùâêîôûœ]/;
const BORROWED = new Set(['café', 'résumé', 'naïve', 'fiancé', 'fiancée', 'déjà', 'façade', 'jalapeño', 'piñata', 'touché', 'cliché', 'entrée', 'señor', 'über', 'crème', 'brûlée', 'pokémon', 'beyoncé', 'zoë', 'noël', 'doppelgänger', 'smörgåsbord']);
// Under this many words the share of English function words proves little: "Save", "Cancel" and "Delete item" have none.
const GUESS_MIN_WORDS = 25;
// A table of names, numbers and file names has no function words in any language. Only another language's own function words,
// at least this share of all the words, show that a long text with few English ones is not English.
const FOREIGN_SHARE = 0.04;
const isForeign = (word) => FOREIGN_MARKERS.has(word) || (ACCENTED.test(word) && !BORROWED.has(word));

export function looksEnglish(text) {
  if (!isLatinScript(text)) return false;
  const words = text.toLowerCase().match(/\p{L}[\p{L}'’]*/gu) ?? [];
  const english = words.filter((word) => ENGLISH_MARKERS.has(word)).length;
  const foreign = words.filter(isForeign).length;
  if (words.length >= GUESS_MIN_WORDS) return english / words.length >= ENGLISH_SHARE || foreign / words.length < FOREIGN_SHARE;
  return foreign <= english;
}

const TONE_IDIOMS = [
  /\b(?:do\s+not|don['’]t|never)\s+hesitate\s+to\b/gi,
  /\b(?:this|that|it)\s+(?:may|might)\s+have\s+caused\b/gi,
  /\bcan(?:not|['’]t)\s+wait\s+to\b/gi,
  // "Not just X, but Y" and "whether or not" do not deny what follows.
  /\bnot\s+(?:just|only|merely|simply)\b/gi,
  /\bor\s+not\b/gi,
];

export function toneOf(raw) {
  const text = TONE_IDIOMS.reduce((rest, idiom) => rest.replace(idiom, ' '), raw);
  return {
    absolutes: count(text, ABSOLUTES) + count(text, UNIVERSALS),
    examples: count(text, EXAMPLE_MARKERS),
    explainers: count(text, EXPLAINERS),
    negated: negationTargets(text),
    hedgeWords: (text.match(HEDGES) ?? []).map((w) => w.toLowerCase().replace(/\s+/g, ' ')),
    conditions: (text.match(CONDITIONS) ?? []).map((w) => w.toLowerCase().replace(/\s+/g, ' ')),
    modalHedges: count(text, /\b(?:may|might|could)\b/gi),
    possibility: count(text, /\b(?:may|might|could|can)\b/gi),
  };
}

// An image may be a shortcut reference, ![label], with nothing after the brackets. The lookahead keeps
// each image to one reading, so a long run of them cannot be split in two ways at every step.
const IMAGE_SOURCE = String.raw`!\[[^\[\]]*\](?:\([^)\[\]]*\)|\[[^\[\]]*\]|(?![(\[]))`;
// A destination in angle brackets may hold spaces, as in [file](<my notes.md>).
const LINK_TARGET = String.raw`\(\s*(<[^<>\n]*>|[^)\s>\[\]]+)(?:\s+"[^"]*")?\s*\)`;
const destination = (raw) => raw.replace(/^<([^<>]*)>$/, '$1').replace(/^</, '');
// The text may hold one level of brackets, as in [[pdf]](https://example.org/paper.pdf), but not an
// image: a badge, [![build](badge.svg)](https://ci.example/job), is an image LINK reads and a link
// around it that LINKED_IMAGE reads.
const LINK = new RegExp(String.raw`!?\[(?:[^\[\]]|(?<!!)\[[^\[\]]*\])*\]${LINK_TARGET}`, 'g');
const LINKED_IMAGE = new RegExp(String.raw`\[((?:[^\[\]]|${IMAGE_SOURCE})*)\]${LINK_TARGET}`, 'g');

// A reference link is a use of a label, [text][label], [label][] or [label], and a definition line,
// [label]: target, that says where the label points. Footnotes, [^1]: note, look the same and are not links.
const DEFINITION_LINE = /^[ \t]{0,3}\[(?!\^)([^\[\]\n]+)\]:[ \t]*(\S*)/;
// A line after which a new block starts, so a definition may follow it without a blank line: a heading, a
// thematic break, a setext underline or the end of an HTML comment.
const BLOCK_END = /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|(?:[-*_][ \t]*){3,}$|=+[ \t]*$)|-->[ \t]*$/;

// A definition is a block of its own and cannot interrupt a paragraph, so "[label]:" at the start of a
// wrapped line is text. Its target is on the same line or the next one, never after a blank line.
function scanDefinitions(text) {
  const lines = text.split('\n');
  const found = [];
  let inParagraph = false;
  for (let i = 0; i < lines.length; i++) {
    const start = inParagraph ? null : DEFINITION_LINE.exec(lines[i]);
    const target = start && (start[2] || lines[i + 1]?.trim().split(/\s/)[0]);
    if (target) {
      const last = start[2] ? i : i + 1;
      found.push({ label: start[1], target, first: i, last });
      i = last;
      continue;
    }
    inParagraph = lines[i].trim() !== '' && !BLOCK_END.test(lines[i]);
  }
  return found;
}

const REFERENCE_TEXT = String.raw`\[((?:[^\[\]\\\n]|\\.|\n(?![ \t]*\n)|!\[(?:[^\[\]\n]|\n(?![ \t]*\n))*\](?:\([^()\n]*\)|\[(?:[^\[\]\n]|\n(?![ \t]*\n))*\]))+)\]`;
const REFERENCE_USE = new RegExp(String.raw`(?<![\]\\!])${REFERENCE_TEXT}(?![(:])(?:\[((?:[^\[\]\\\n]|\\.|\n(?![ \t]*\n))*)\])?`, 'g');
const labelOf = (raw) => raw.trim().replace(/\s+/g, ' ').toLowerCase();

// Where each defined label points. The first definition of a label wins.
function definitionsOf(source) {
  const definitions = new Map();
  for (const { label, target } of scanDefinitions(source)) if (!definitions.has(labelOf(label))) definitions.set(labelOf(label), target);
  return definitions;
}

// Each inline link as its words and where it points, so a link that now points elsewhere can be told from a link that is gone.
export function linkPairsOf(source) {
  const pairs = [];
  for (const m of source.matchAll(LINK)) {
    if (m[0].startsWith('!')) continue;
    const words = m[0].slice(1, m[0].lastIndexOf('](')).replace(/\s+/g, ' ').trim().toLowerCase();
    pairs.push({ words, target: destination(m[1]) });
  }
  return pairs;
}

export function linksOf(source) {
  const targets = [];
  for (const m of source.matchAll(LINK)) targets.push(destination(m[1]));
  for (const m of source.matchAll(LINKED_IMAGE)) if (m[1].includes('![')) targets.push(destination(m[2]));
  for (const { target } of scanDefinitions(source)) targets.push(target);
  const definitions = definitionsOf(source);
  for (const m of source.matchAll(REFERENCE_USE)) {
    const target = definitions.get(labelOf(m[2] || m[1]));
    if (target !== undefined) targets.push(target);
  }
  // One entry per mention, so a URL written twice that changes in one place is seen. A pipe ends a URL, as
  // it ends a table cell, and an emphasis mark right after it is not part of it.
  const bare = (source.replace(/\]\([^)\[\]]*\)/g, ']').match(/https?:\/\/[^\s)\]>"'|]+/g) ?? []).map((u) => u.replace(/(?<![.,;:!?*_~])[.,;:!?*_~]+$/, ''));
  return { targets: [...targets].sort(), bare: bare.sort() };
}

// Comments are invisible to readers, but tools read them: `prettier-ignore`, `omit in toc`, the markers
// that generated sections sit between.
export function commentsOf(source) {
  return (source.match(/<!--[\s\S]*?-->/g) ?? []).map((comment) => comment.replace(/\s+/g, ' ').trim());
}

// ![alt][label], ![label][] and ![label] use a defined label like a link does. A renamed label leaves
// the definition in place and the image gone.
const IMAGE_REFERENCE = /!\[((?:[^\[\]\n]|\n(?![ \t]*\n))*)\](?![(:])(?:\[((?:[^\[\]\\\n]|\\.|\n(?![ \t]*\n))*)\])?/g;

export function imagesOf(source) {
  const images = (source.match(/!\[[^\[\]]*\]\([^)\[\]]*\)/g) ?? []).map((m) => m.replace(/^!\[[^\[\]]*\]/, ''));
  const definitions = definitionsOf(source);
  for (const m of source.matchAll(IMAGE_REFERENCE)) {
    const target = definitions.get(labelOf(m[2] || m[1]));
    if (target !== undefined) images.push(`(${target})`);
  }
  return images;
}

export function tablesOf(source) {
  const lines = source.split('\n');
  const flags = tableRowFlags(lines);
  const rows = lines.filter((_, index) => flags[index]);
  const widths = rows.map((line) => cellsOf(line).length);
  return { rows: rows.length, separators: rows.filter(isDelimiterRow).length, columns: widths.length ? Math.max(...widths) : 0 };
}

export function headingsOf(source) {
  return source
    .split('\n')
    .map((line) => line.match(/^\s{0,3}(#{1,6})(?=\s|$)(?:\s+(.*?))?\s*#*\s*$/))
    .filter(Boolean)
    .map((m) => ({ level: m[1].length, text: (m[2] ?? '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim() }));
}

const LIST_LINE = /^[ \t]*(?:>[ \t]*)*(?:([-*+])|(\d{1,3})[.)])[ \t]+(\S.*)$/;
const THEMATIC_BREAK = /^[ \t]*([-*+])(?:[ \t]*\1){2,}[ \t]*$/;
const TASK_BOX = /^\[([ xX])\](?:[ \t]|$)/;

export function listsOf(source) {
  const lists = { numbered: 0, bullets: 0, checked: 0, unchecked: 0 };
  for (const line of source.split('\n')) {
    const match = LIST_LINE.exec(line);
    if (!match || THEMATIC_BREAK.test(line)) continue;
    if (match[2] === undefined) lists.bullets++;
    else lists.numbered++;
    const box = TASK_BOX.exec(match[3]);
    if (box) lists[box[1] === ' ' ? 'unchecked' : 'checked']++;
  }
  return lists;
}

// A code span opens with a run of backticks and closes at the next run of the same length: `a`,
// ``a ` b`` or ```a```. It may wrap onto the next line but cannot cross a blank line or run into a new
// block (a list item, heading, quote or fence), so a stray backtick in one paragraph or item cannot
// swallow the next. A run of another length is part of the code. A run with no match is plain text.
const SPAN_BREAK = '\\n(?![ \\t]*(?:\\n|[-*+][ \\t]|\\d{1,3}[.)][ \\t]|#{1,6}[ \\t]|>|`{3}|~{3}))';
const OTHER_RUN = '(?<!`)(?!\\1(?!`))`+';
const INLINE_CODE = new RegExp(`(?<!\`)(\`+)(?!\`)(?:[^\`\\n]|${SPAN_BREAK}|${OTHER_RUN})*(?<!\`)\\1(?!\`)`, 'g');
// A bold label opens a paragraph or a list item, such as "**3. Scale it**" or "- **Quick Start** works". It
// may wrap onto a second line. A bold phrase that a wrap leaves at the start of a line is text, so the
// place is the paragraph or the item and never the line.
const BOLD_LABEL = new RegExp(`^([ \\t]*)((?:[-*+]|\\d{1,3}[.)])[ \\t]+)?(\\[?)\\*\\*((?:[^*\\n]|${SPAN_BREAK}){3,60}?)\\*\\*`, 'gm');

// Numbering is structure, not a fact: "1.", "-" and the "1." in "**1. Scale**". It is read from the line as
// written. Cutting out links and code spans first can leave a number and a dot at the start of a line
// that were never a marker, as in "[version\n2](LICENSE.md). Note".
const ITEM_MARKER = /^([ \t]*(?:>[ \t]*)*)(?:[-*+](?:[ \t]+|$)|\d{1,3}[.)][ \t]+(?=\S))/gm;
const LABEL_NUMBER = /^([ \t]*(?:>[ \t]*)*)\*\*\d{1,3}[.)][ \t]+/gm;
const removeListMarkers = (text) => text.replace(ITEM_MARKER, (_, lead) => lead.trimStart()).replace(LABEL_NUMBER, '$1**');

// The first line of the text, or a line after a blank one or a heading.
function opensParagraph(text, lineStart) {
  if (lineStart === 0) return true;
  const previous = text.lastIndexOf('\n', lineStart - 2) + 1;
  const line = text.slice(previous, lineStart - 1);
  return line.trim() === '' || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line);
}

// A title-cased label such as "**Quick Start Guide**" may change its capitalization in a rewrite.
function lowercaseLabels(text) {
  return text.replace(BOLD_LABEL, (match, indent, marker, bracket, label, offset) => {
    if (!marker && !opensParagraph(text, offset)) return match;
    return `${indent}${marker ?? ''}${bracket}${looksTitleCased(label) ? label.toLowerCase() : label}`;
  });
}

function blankDefinitions(text) {
  const lines = text.split('\n');
  for (const { first, last } of scanDefinitions(text)) lines.fill(' ', first, last + 1);
  return lines.join('\n');
}

// Definitions go first, from the line as written. Once a list marker is gone, "- [Beyond]: the story"
// would read as a definition.
export function factText(prose) {
  return unwrapLinks(removeListMarkers(lowercaseLabels(blankDefinitions(removeComments(prose, ' ')))).replace(INLINE_CODE, ' '))
    .replace(/\[\^[^\[\]\s]{1,80}\]:?/g, '')
    .replace(/https?:\/\/[^\s)\]>"'|]+/g, ' ')
    // An empty numbered item, "9." alone, is a marker only after a blank line. Inside a paragraph, the
    // line "38." continues the sentence and 38 is a number.
    .replace(/(^|\n[ \t]*\n)[ \t]*\d{1,3}[.)][ \t]*(?=\n|$)/g, '$1')
    .replace(/^[ \t]*>+[ \t]?/gm, '')
    .replace(/(?:\*\*|__|~~)/g, '')
    .replace(/(?<![\w*])\*(?=\S)((?:[^*\n]|\n(?![ \t]*\n))*?\S)\*(?![\w*])/g, '$1')
    // An underscore between two word characters belongs to a name and cannot close the emphasis.
    .replace(/(?<!\w)_(?=\S)((?:[^_\n]|(?<=\w)_(?=\w)|\n(?![ \t]*\n))*?\S)_(?!\w)/g, '$1');
}

export function inlineCodeOf(prose) {
  return (prose.match(INLINE_CODE) ?? []).map((code) => code.replace(/\s+/g, (gap) => (gap.includes('\n') ? ' ' : gap))).sort();
}
