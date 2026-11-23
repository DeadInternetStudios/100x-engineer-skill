// The claim ledger and the sentence report: what the text says, sentence by sentence, and what became of
// each sentence in a rewrite.
import { parseProseSource } from './lint.mjs';
import { isProse } from './rules/helpers.mjs';
import { alignSentences } from './align.mjs';
import { unwrapLinks, codeSpans, codeSpanTexts } from './markdown.mjs';
import { counted } from './counted.mjs';

const LIST_MARKER = /^\d{1,3}[.)]$/;
const CODE_MARK = /\bCODE\b/g;
// The cleaner writes URL where a URL stood, in the order of the text. A word "URL" in the text stands for itself.
const URL_MARK = /\bURL\b/g;
const MARK = /\bCODE\b|\bURL\b/g;
const URL_TOKEN = /<(?:https?|mailto):[^<>]+>|https?:\/\/[^\s)\]>]+|\bURL\b/g;

// Every prose sentence with the line it starts on. Headings, code and tables of contents are not sentences.
// `text` is what the checks compare: the cleaner writes CODE where inline code stood. `shown` puts the
// code back, for the person who reads the list.
export function proseSentences(source, file) {
  const sentences = [];
  for (const block of parseProseSource(source, file)) {
    if (!isProse(block)) continue;
    const spans = codeSpanTexts(block.raw);
    const tokens = unwrapLinks(block.raw.replace(codeSpans(), 'CODE')).match(URL_TOKEN) ?? [];
    // Each mark takes the next span or URL of the block, in order. A block whose marks and originals do not
    // line up is shown as cleaned, because guessing would put the wrong text in a sentence.
    const codeLines = spans.length === (block.text.match(CODE_MARK) ?? []).length;
    const urlLines = tokens.length === (block.text.match(URL_MARK) ?? []).length;
    let usedCode = 0;
    let usedUrls = 0;
    const restore = (text) =>
      text.replace(MARK, (mark) => {
        if (mark === 'CODE') return codeLines ? (spans[usedCode++] ?? mark) : mark;
        return urlLines ? (tokens[usedUrls++] ?? mark).replace(/^<|>$/g, '') : mark;
      });
    let cursor = 0;
    for (const text of block.sentences) {
      const shown = restore(text);
      if (LIST_MARKER.test(text) || !/\p{L}/u.test(text)) continue;
      const at = block.text.indexOf(text, cursor);
      if (at !== -1) cursor = at + text.length;
      sentences.push({ text, shown, line: block.locate(Math.max(0, at)) });
    }
  }
  return sentences;
}

// A sentence that opens with one of these verbs in the base form gives an instruction, the commonest form
// of a rule in docs and interface text. Verbs that only steer the reader (read, imagine, consider, note,
// let's) are left out: cutting those loses nothing. So are the verbs of a call to action (start, sign up,
// contact us): those lines are written to sell, and a rewrite may cut them.
const INSTRUCTION_VERBS = [
  'add', 'allow', 'apply', 'approve', 'avoid', 'back up', 'call', 'change', 'check', 'choose', 'close', 'confirm', 'configure', 'copy', 'create', 'delete',
  'disable', 'enable', 'ensure', 'exclude', 'include', 'install', 'keep', 'limit', 'lock', 'log', 'make sure', 'move', 'notify', 'open', 'pass', 'place', 'put', 'remove',
  'rename', 'replace', 'report', 'restart', 'restrict', 'review', 'rotate', 'run', 'select', 'send', 'set', 'stop', 'store', 'submit', 'test', 'update',
  'use', 'verify', 'wait', 'write',
];
const INSTRUCTION = new RegExp(`^(?:(?:please|then|also|first|next|finally)[, ]+)?(?:${INSTRUCTION_VERBS.join('|')})\\b(?!['’]s)`, 'i');

// What a sentence commits the author to. These are hints for a reader, not a parse.
const TAGS = [
  ['number', /\d/],
  ['cause', /\b(?:because|since|so that|therefore|thus|hence|due to|as a result|leads? to|results? in|caused? by|which means|that means)\b/i],
  ['condition', /\b(?:if|unless|provided that|as long as|whenever|until|only when|only after|only if)\b/i],
  ['obligation', new RegExp(`${/\b(?:must|required?|requires?|should|needs? to|have to|has to|never|always|do not|don['’]t|cannot|forbidden|mandatory)\b/i.source}|${INSTRUCTION.source}`, 'i')],
  ['comparison', /\b(?:more|less|fewer|faster|slower|better|worse|smaller|larger|bigger|cheaper|lighter|higher|lower|than|compared (?:to|with)|unlike|best|worst|fastest|slowest|lightest|smallest|largest|cheapest)\b/i],
  ['name', /(?<=[a-z,;:)] )\p{Lu}[\p{L}\p{N}]+/u],
];

// A cut sentence that makes one of these promises needs a second look.
const COMMITMENTS = new Set(['cause', 'condition', 'obligation', 'comparison']);

export function claimTags(sentence) {
  return TAGS.filter(([, pattern]) => pattern.test(sentence)).map(([name]) => name);
}

export const commitsTo = (tags) => tags.some((tag) => COMMITMENTS.has(tag));

export function ledgerOf(source, file) {
  return proseSentences(source, file).map((sentence) => ({ ...sentence, tags: claimTags(sentence.text) }));
}

export function formatLedger(entries, { file } = {}) {
  const tagged = entries.filter((entry) => entry.tags.length).length;
  const lines = [
    `# Claim ledger${file ? `: ${file}` : ''}`,
    '',
    `${counted(entries.length, 'sentence')}, ${tagged} with a tag. Tick a line when the rewrite still says it. For a line you cut, write why.`,
    'Tags are hints: number, cause, condition, obligation, comparison, name.',
    '',
  ];
  for (const entry of entries) lines.push(`- [ ] L${entry.line}${entry.tags.length ? ` [${entry.tags.join(', ')}]` : ''} ${entry.shown}`);
  return lines.join('\n');
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

// Rules about how sentences are shaped, not about what they say. A short rule such as "Do not retry."
// can sit in a staccato run, and cutting it still loses the rule.
const SHAPE_RULES = new Set(['staccato', 'triad', 'repeated-openings', 'dashes', 'uniform-rhythm', 'punctuation-monotony', 'list-overuse', 'exclamation-density', 'heading-case', 'heading-generic', 'heading-echo', 'bold-decoration', 'emoji-decoration']);

// Lint finds the stock sentences. A sentence it flags for a stock phrase was written to be cut.
export function stockSentences(sentences, findings) {
  const quotes = findings.filter((finding) => finding.kind === 'slop' && !SHAPE_RULES.has(finding.rule)).map((finding) => normalize(finding.quote));
  return new Set(
    sentences
      .map((sentence) => normalize(sentence.text))
      .filter((text) => quotes.some((quote) => (quote.endsWith('…') ? text.startsWith(quote.slice(0, -1)) : quote === text))),
  );
}

// The sentences of the rewrite that no sentence of the original maps to, and that sit between the
// neighbours of before-sentence `i`. A sentence cut from the original and a short new sentence in the
// same place are usually one edit: "It's been hard, but it's been rewarding" became "It's been hard, but worthwhile."
export function nearbyAfter(alignment, i, afterLength, claimed) {
  let low = -1;
  for (let k = i - 1; k >= 0; k--) {
    const to = alignment.before[k].to ?? [];
    if (to.length) { low = Math.max(...to); break; }
  }
  let high = afterLength;
  for (let k = i + 1; k < alignment.before.length; k++) {
    const to = alignment.before[k].to ?? [];
    if (to.length) { high = Math.min(...to); break; }
  }
  const found = [];
  for (let j = low + 1; j < high; j++) if (!claimed.has(j)) found.push(j);
  return found;
}

// The sentences of the rewrite that the original accounts for: the ones a sentence maps to, and the ones
// that repeat a sentence of the original word for word. A short sentence kept as it was maps to nothing.
export function claimedAfter(before, after, alignment) {
  const original = new Set(before.map((sentence) => normalize(sentence.text)));
  const claimed = new Set(alignment.before.flatMap((entry) => entry.to ?? []));
  after.forEach((sentence, j) => {
    if (original.has(normalize(sentence.text))) claimed.add(j);
  });
  return claimed;
}

// What happened to each sentence: { before, after, alignment, cut, replaced, added }. Pass the lint
// `findings` for the original to mark the cut sentences that are stock phrases (`stock: true`).
export function compareSentences(beforeSource, afterSource, file, { findings } = {}) {
  const plain = proseSentences(beforeSource, file);
  const stock = findings ? stockSentences(plain, findings) : new Set();
  const before = findings ? plain.map((sentence) => ({ ...sentence, stock: stock.has(normalize(sentence.text)) })) : plain;
  const after = proseSentences(afterSource, file);
  const alignment = alignSentences(before.map((s) => s.text), after.map((s) => s.text));
  const withStatus = (sentences, entries, status) => sentences.filter((_, i) => entries[i].status === status);
  const claimedBy = claimedAfter(before, after, alignment);
  const nearby = (i) => nearbyAfter(alignment, i, after.length, claimedBy);
  const nearbyShown = new Set(alignment.before.flatMap((entry, i) => (entry.status === 'cut' ? nearby(i) : [])));
  return {
    before,
    after,
    alignment,
    cut: before
      .map((sentence, i) => ({ sentence, i }))
      .filter(({ i }) => alignment.before[i].status === 'cut')
      .map(({ sentence, i }) => ({ ...sentence, tags: claimTags(sentence.text), nearby: nearby(i).map((j) => after[j]) })),
    replaced: before
      .map((sentence, i) => ({ sentence, entry: alignment.before[i] }))
      .filter(({ entry }) => entry.status === 'replaced')
      .map(({ sentence, entry }) => ({ ...sentence, tags: claimTags(sentence.text), now: after[entry.to[0]] })),
    added: withStatus(after, alignment.after, 'added'),
    // Sentences of the rewrite that nothing maps to and that no cut sentence sits beside. `check` ignores the
    // short ones, because a sentence of a few words proves little. A reader of the list still wants to see them, under their own heading, because they are not claims the rewrite invented.
    extra: after.filter((_, j) => !claimedBy.has(j) && alignment.after[j].status !== 'added' && !nearbyShown.has(j)),
  };
}

const quoted = (text) => `"${text.length > 120 ? `${text.slice(0, 117)}…` : text}"`;
const marks = (sentence) => [...sentence.tags, ...(sentence.stock ? ['stock'] : [])];

export function formatCoverage(report, { before, after } = {}) {
  const { counts } = report.alignment;
  const lines = [
    `${before && after ? `${before} → ${after}  ` : ''}${counted(report.before.length, 'prose sentence')} → ${report.after.length}`,
    `  kept ${counts.kept} · reworded ${counts.reworded} · split ${counts.split} · joined ${counts.merged} · replaced ${counts.replaced} · cut ${counts.cut} · added ${report.added.length} · short or split-off ${report.extra.length}`,
  ];
  const section = (label, items, show) => {
    if (!items.length) return;
    lines.push('', `${label} (${items.length})`);
    for (const item of items) lines.push(`  ${show(item)}`);
  };
  section('Cut: no sentence in the rewrite says this', report.cut, (s) => `L${s.line}${marks(s).length ? ` [${marks(s).join(', ')}]` : ''} ${quoted(s.shown)}${s.nearby.length ? `\n      nearby in the rewrite: ${s.nearby.map((n) => `L${n.line} ${quoted(n.shown)}`).join(' ')}` : ''}`);
  section('Replaced: a sentence that shares few words with its replacement', report.replaced, (s) => `L${s.line} ${quoted(s.shown)}\n      became L${s.now.line} ${quoted(s.now.shown)}`);
  section('Added: no sentence in the original says this', report.added, (s) => `L${s.line} ${quoted(s.shown)}`);
  section('Short or split-off: no single sentence in the original accounts for these. Check each against the sentence it came from', report.extra, (s) => `L${s.line} ${quoted(s.shown)}`);
  if (!report.before.length) lines.push('', 'The original has no prose sentences, so there is nothing to compare the rewrite with.');
  lines.push('', 'The match is by shared words. A sentence reworded beyond recognition shows as a cut plus an addition. Read each one against the original.');
  if (report.cut.some((s) => s.stock)) lines.push('[stock] marks a sentence that lint flags as a stock phrase. Cutting it is usually on purpose.');
  lines.push('This list holds only what was cut, replaced, added or left without a single source. "unslop diff" also shows the reworded sentences.');
  return lines.join('\n');
}
