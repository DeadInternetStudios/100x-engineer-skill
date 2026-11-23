// A number, code span, placeholder, name, URL or email address that stays in the text but lands in another
// sentence or heading. "Keys last 90 days. Backups last 30 days." became "Keys last 30 days. Backups last
// 90 days.": every value is still there, so a count over the whole text sees nothing. Read sentence by
// sentence, the values changed hands. The same holds for the unit after a number: "per minute" became
// "per hour".
import { numbersOf, placeholdersOf, identifiersOf } from './facts.mjs';
import { contentStems } from './align.mjs';
import { unitsOf } from './units.mjs';
import { ruleWordsOf, ruleChanges, swappedModals } from './strength.mjs';
import { parseProseSource } from './lint.mjs';
import { CODE_SPAN_SOURCE, codeSpans, codeSpanTexts } from './markdown.mjs';

const URL_RE = /https?:\/\/[^\s)\]>"'|]+/g;
// The look-behind starts a match only at the start of a word, so a long run of word characters is read once.
const EMAIL_RE = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const NAME_RE = /(?<![\p{L}\p{N}_])(?:\p{Lu}\p{Ll}+|[A-Z]{2}[A-Z0-9]*)(?![\p{L}\p{N}_])/gu;
// A sentence the alignment found a home for. A cut sentence has no home, and its facts are for the counts over the whole text.
// Headings that share this much of their words are the same heading, reworded. Below it only the place can tell.
const SAME_HEADING = 0.8;
const SETTLED = new Set(['kept', 'reworded', 'split', 'merged']);

// A capitalised word that never appears in lower case in either text is a name. "Keep" opens a sentence, and
// "keep" is somewhere else, so it is not one.
function lowerCaseWords(texts) {
  const words = new Set();
  for (const text of texts) for (const word of text.match(/\p{Ll}[\p{L}'’]*/gu) ?? []) words.add(word.toLowerCase());
  return words;
}

function factsOf(text, lower) {
  const urls = (text.match(URL_RE) ?? []).map((url) => url.replace(/(?<![.,;:!?*_~])[.,;:!?*_~]+$/, ''));
  const emails = text.match(EMAIL_RE) ?? [];
  const plain = text.replace(URL_RE, ' ').replace(EMAIL_RE, ' ').replace(codeSpans(), ' ');
  const names = (plain.replace(/\{[^{}\n]*\}|%\d*\$?[sdif@]/g, ' ').match(NAME_RE) ?? []).filter((word) => word === word.toUpperCase() || !lower.has(word.toLowerCase()));
  return [...numbersOf(text.replace(URL_RE, ' ').replace(EMAIL_RE, ' '), { words: false }), ...codeSpanTexts(text), ...placeholdersOf(text), ...urls, ...emails, ...identifiersOf(plain), ...names];
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

// The values `a` holds more often than `b`.
function surplus(a, b) {
  const have = tally(b);
  const extra = [];
  for (const value of a) {
    if (have.get(value)) have.set(value, have.get(value) - 1);
    else extra.push(value);
  }
  return extra;
}

// Sentences that share a sentence of the rewrite are one group: a join or a split moves facts inside the group.
function groups(report) {
  const parent = new Map();
  const find = (node) => {
    while (parent.get(node) !== node) {
      parent.set(node, parent.get(parent.get(node)));
      node = parent.get(node);
    }
    return node;
  };
  const add = (node) => {
    if (!parent.has(node)) parent.set(node, node);
  };
  report.alignment.before.forEach((entry, i) => {
    if (!SETTLED.has(entry.status) || !entry.to.length) return;
    add(`b${i}`);
    for (const j of entry.to) {
      add(`a${j}`);
      parent.set(find(`b${i}`), find(`a${j}`));
    }
  });
  const found = new Map();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!found.has(root)) found.set(root, { before: [], after: [] });
    const group = found.get(root);
    if (node[0] === 'b') group.before.push(Number(node.slice(1)));
    else group.after.push(Number(node.slice(1)));
  }
  return [...found.values()].filter((group) => group.before.length && group.after.length);
}

// The values of a sentence in the order it writes them.
const VALUE = new RegExp(`${CODE_SPAN_SOURCE}|\\{[^{}\\n]*\\}|%\\d*\\$?[sdif@]|\\d+(?:[.,]\\d+)*`, 'g');
const inOrder = (sentence) => (sentence.match(VALUE) ?? []).map((value) => value.replace(/,/g, ''));

// One sentence kept almost word for word that now writes the same values in another order: "Set the timeout
// to 30 and the retries to 5" became "... timeout to 5 and the retries to 30". Rewording moves values on
// purpose, so this reads only sentences whose words did not change.
function tradedPlaces(report, c) {
  report.alignment.before.forEach((entry, i) => {
    if (entry.status !== 'kept' || entry.to.length !== 1) return;
    const was = inOrder(report.before[i].shown);
    const now = inOrder(report.after[entry.to[0]].shown);
    if (was.length < 2 || was.length !== now.length || new Set(was).size < 2) return;
    if (was.every((value, k) => value === now[k]) || [...was].sort().join('\n') !== [...now].sort().join('\n')) return;
    c.error('fact-moved', `"${shorten(report.before[i].shown)}" (line ${report.before[i].line}) writes ${quoted(was)} in this order, and its rewrite writes ${quoted(now)}. The values changed places`);
  });
}

// The rule words of several sentences, as one.
const mergedRules = (list) => ({ modals: list.flatMap((rules) => rules.modals), opposites: list.flatMap((rules) => rules.opposites) });

// One sentence kept or reworded whose modals trade places: "Managers must approve, interns may review" became
// "Managers may approve, interns must review". Every modal is still there, so only the order tells.
function modalsTraded(report, c) {
  report.alignment.before.forEach((entry, i) => {
    if ((entry.status !== 'kept' && entry.status !== 'reworded') || entry.to.length !== 1) return;
    const swapped = swappedModals(ruleWordsOf(report.before[i].shown).modals, ruleWordsOf(report.after[entry.to[0]].shown).modals);
    if (swapped) c.warn('modal-changed', `"${shorten(report.before[i].shown)}" (line ${report.before[i].line}) says ${swapped.was} in this order, and its rewrite says ${swapped.now}. The modals changed places, so a rule binds someone else now`);
  });
}

const shorten = (text) => (text.length > 70 ? `${text.slice(0, 67)}…` : text);
const quoted = (values) => values.slice(0, 4).map((value) => `"${value}"`).join(', ');

// The headings of a text as written, with the line each stands on, without the code blocks and the front matter.
const headingsIn = (source, file) =>
  parseProseSource(source, file)
    .filter((block) => block.type === 'heading' && block.raw.trim() !== '')
    .map((block) => ({ text: block.raw.trim(), line: block.locate(0) }));

const headingStems = (text) => contentStems(text.replace(codeSpans(), ' CODE '));

// Each heading of the original with the heading of the rewrite that carries it: the one that shares the most
// words, and the one in the same place when two share as many.
function pairHeadings(before, after, minimum = 0.5) {
  const stemsBefore = before.map(headingStems);
  const stemsAfter = after.map(headingStems);
  const candidates = [];
  stemsBefore.forEach((was, i) =>
    stemsAfter.forEach((now, j) => {
      const smaller = Math.min(was.size, now.size);
      const shared = [...was].filter((stem) => now.has(stem)).length;
      const score = smaller ? shared / smaller : i === j ? 1 : 0;
      if (score >= minimum) candidates.push({ i, j, score });
    }),
  );
  candidates.sort((x, y) => y.score - x.score || Math.abs(x.i - x.j) - Math.abs(y.i - y.j) || x.i - y.i);
  const usedBefore = new Set();
  const usedAfter = new Set();
  const pairs = [];
  for (const { i, j } of candidates) {
    if (usedBefore.has(i) || usedAfter.has(j)) continue;
    usedBefore.add(i);
    usedAfter.add(j);
    pairs.push([i, j]);
  }
  return pairs;
}

// What pairHeadings leaves unpaired, when both texts have the same number left: a rewrite that rewords every
// heading still keeps the sections in their order, so the first leftover of one pairs with the first of the other.
function pairByPlace(before, after, pairs) {
  const left = (count, used) => Array.from({ length: count }, (_, k) => k).filter((k) => !used.has(k));
  const restBefore = left(before.length, new Set(pairs.map(([i]) => i)));
  const restAfter = left(after.length, new Set(pairs.map(([, j]) => j)));
  return restBefore.length === restAfter.length ? [...pairs, ...restBefore.map((i, k) => [i, restAfter[k]])] : pairs;
}

// The section a sentence stands in: the last heading above it, or -1 before the first heading.
function sectionOf(headings, line) {
  let section = -1;
  headings.forEach((heading, k) => {
    if (heading.line < line) section = k;
  });
  return section;
}

// Indices of the longest run of `values` that only rises. What is left over is what moved.
function longestRise(values) {
  const tails = [];
  const before = new Array(values.length).fill(-1);
  values.forEach((value, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] <= value) low = mid + 1;
      else high = mid;
    }
    if (low > 0) before[i] = tails[low - 1];
    tails[low] = i;
  });
  const keep = new Set();
  for (let i = tails.length ? tails.at(-1) : -1; i !== -1; i = before[i]) keep.add(i);
  return keep;
}

const norm = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

// A sentence the rewrite keeps whole but under another heading, or after sentences it came before. The facts
// inside it are all still there and still together, so only its place tells. Port numbers and paths that
// belong to "Install" now sit under "Billing". A step that moved ahead of the step it follows changes the
// procedure. The sections count only when both headings are in both texts: a rewrite that merges or splits
// sections has no section to compare.
function sentencesMoved(report, c, headings, paired) {
  const after = new Map(paired);
  after.set(-1, -1);
  const origin = new Map(paired.map(([i, j]) => [j, i]));
  origin.set(-1, -1);
  const stayed = [];
  report.alignment.before.forEach((entry, i) => {
    if ((entry.status !== 'kept' && entry.status !== 'reworded') || entry.to.length !== 1) return;
    const j = entry.to[0];
    const from = sectionOf(headings.before, report.before[i].line);
    const to = sectionOf(headings.after, report.after[j].line);
    const home = origin.get(to);
    if (after.has(from) && home !== undefined && home !== from) {
      // The same sentence written in both sections is not a sentence that moved.
      const twin = report.after.some((sentence, k) => k !== j && norm(sentence.text) === norm(report.before[i].text) && sectionOf(headings.after, sentence.line) === after.get(from));
      if (twin) return;
      const name = (list, k) => (k === -1 ? 'the text before the first heading' : `the heading "${shorten(list[k].text)}"`);
      c.error('sentence-moved', `"${shorten(report.before[i].shown)}" (line ${report.before[i].line}) stood under ${name(headings.before, from)} and now stands under ${name(headings.after, to)}. Moving a sentence changes what both sections say. Put it back, or tell the owner that the rewrite moved it`);
      return;
    }
    stayed.push({ i, j });
  });
  const rising = longestRise(stayed.map((pair) => pair.j));
  const displaced = stayed.filter((_, k) => !rising.has(k));
  if (!displaced.length) return;
  const first = displaced[0];
  const anchor = stayed.find((pair, k) => rising.has(k) && (pair.i > first.i) === (pair.j < first.j));
  const was = report.before[first.i];
  const against = anchor ? `, and the sentence "${shorten(report.before[anchor.i].shown)}" (line ${report.before[anchor.i].line}) now comes ${anchor.i > first.i ? 'before' : 'after'} it` : '';
  c.warn('sentence-order', `${displaced.length} sentence${displaced.length === 1 ? '' : 's'} changed order: "${shorten(was.shown)}" (line ${was.line}) comes in another place in the rewrite${against}. Where order carries meaning, such as steps, check that it still reads right`);
}

// Calls c.error for each group of sentences or headings whose values changed hands, and c.warn for each whose unit changed.
// `sources` holds the two texts, for their headings.
export function movedFacts(report, c, sources) {
  tradedPlaces(report, c);
  modalsTraded(report, c);
  const found = sources ? { before: headingsIn(sources.before, sources.file), after: headingsIn(sources.after, sources.file) } : { before: [], after: [] };
  const headings = { before: found.before.map((heading) => heading.text), after: found.after.map((heading) => heading.text) };
  const lower = lowerCaseWords([...report.before, ...report.after].map((sentence) => sentence.shown).concat(headings.before, headings.after));
  const factsBefore = report.before.map((sentence) => factsOf(sentence.shown, lower));
  const factsAfter = report.after.map((sentence) => factsOf(sentence.shown, lower));
  const headingFactsBefore = headings.before.map((text) => factsOf(text, lower));
  const headingFactsAfter = headings.after.map((text) => factsOf(text, lower));
  const inRewrite = tally([...factsAfter.flat(), ...headingFactsAfter.flat()]);
  const inOriginal = tally([...factsBefore.flat(), ...headingFactsBefore.flat()]);

  const units = [];
  for (const group of groups(report)) {
    units.push({
      had: group.before.flatMap((i) => factsBefore[i]),
      has: group.after.flatMap((j) => factsAfter[j]),
      hadUnits: group.before.flatMap((i) => unitsOf(report.before[i].shown)),
      hasUnits: group.after.flatMap((j) => unitsOf(report.after[j].shown)),
      hadRules: mergedRules(group.before.map((i) => ruleWordsOf(report.before[i].shown))),
      hasRules: mergedRules(group.after.map((j) => ruleWordsOf(report.after[j].shown))),
      where: `"${shorten(report.before[group.before[0]].shown)}" (line ${report.before[group.before[0]].line})`,
    });
  }
  const paired = pairHeadings(headings.before, headings.after);
  for (const [i, j] of paired) {
    units.push({
      had: headingFactsBefore[i],
      has: headingFactsAfter[j],
      hadUnits: unitsOf(headings.before[i]),
      hasUnits: unitsOf(headings.after[j]),
      hadRules: ruleWordsOf(headings.before[i]),
      hasRules: ruleWordsOf(headings.after[j]),
      where: `the heading "${shorten(headings.before[i])}"`,
    });
  }

  for (const { had, has, hadUnits, hasUnits, hadRules, hasRules, where } of units) {
    // A value gone from the whole rewrite, or new to the whole text, is the business of the counts over the whole text.
    const gone = surplus(had, has).filter((value) => inRewrite.has(value));
    const arrived = surplus(has, had).filter((value) => inOriginal.has(value));
    if (gone.length && arrived.length) {
      c.error('fact-moved', `a number, name, code span, placeholder, URL or email changed place: ${where} had ${quoted(gone)}, and its rewrite has ${quoted(arrived)} instead. Both are still in the text, so a count over the whole text cannot see it`);
    }
    const lostUnits = surplus(hadUnits, hasUnits);
    const newUnits = surplus(hasUnits, hadUnits);
    if (lostUnits.length && newUnits.length) {
      c.warn('unit-changed', `the unit of a quantity changed: ${where} had ${quoted(lostUnits)}, and its rewrite has ${quoted(newUnits)}. Check that the quantity still means the same`);
    }
    ruleChanges(hadRules, hasRules, c, where);
  }
  sentencesMoved(report, c, found, pairByPlace(found.before, found.after, pairHeadings(headings.before, headings.after, SAME_HEADING)));
}
