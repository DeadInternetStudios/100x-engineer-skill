import { lintSource, chooseFormat, burstinessBand, EVEN_BELOW, BURSTINESS_MIN_SENTENCES } from './lint.mjs';
import { inferProfile } from './profiles.mjs';
import { parseStructured, kvComments, isEntryFormat, skeletonOf } from './structured.mjs';
import { parseJsonStrings, entryKey, looksTranslatable } from './json-source.mjs';
import { SourceError } from './errors.mjs';
import { inspectXml, isAndroidResources, ANDROID_PROBLEMS } from './xml.mjs';
import { round, isLatinScript } from './text.mjs';
import { compareSentences } from './claims.mjs';
import { sentenceChanges, tellChanges } from './changes.mjs';
import { movedFacts } from './moved.mjs';
import { addVoice, emptyVoice, compareVoice } from './voice.mjs';
import {
  protectedRegions,
  factText,
  inlineCodeOf,
  linksOf,
  linkPairsOf,
  imagesOf,
  commentsOf,
  tablesOf,
  headingsOf,
  listsOf,
  numbersOf,
  placeholdersOf,
  stripPlaceholders,
  tagsOf,
  identifiersOf,
  entitiesOf,
  acronymsOf,
  quotesOf,
  toneOf,
  looksEnglish,
} from './facts.mjs';

const WRAPPER_RULES = ['chatbot-residue', 'template-leftover'];
const DEFAULT_GROWTH = { prose: 1.1, strings: 1.15 };
const STRING_GROWTH = 1.3;

function diffCounts(before, after) {
  const counts = new Map();
  for (const item of before) counts.set(item, (counts.get(item) ?? 0) + 1);
  const added = [];
  for (const item of after) {
    const left = counts.get(item) ?? 0;
    if (left > 0) counts.set(item, left - 1);
    else added.push(item);
  }
  const missing = [];
  for (const [item, left] of counts) for (let i = 0; i < left; i++) missing.push(item);
  return { missing, added };
}

function sameStem(x, y) {
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  return shared >= 3 && shared >= Math.min(x.length, y.length) * 0.6;
}

function diffNegations(before, after) {
  const unmatched = [...after];
  const missing = [];
  for (const word of before) {
    const i = unmatched.findIndex((other) => other === word || sameStem(word, other));
    if (i === -1) missing.push(word);
    else unmatched.splice(i, 1);
  }
  return { missing, added: unmatched };
}

function show(items, limit = 5) {
  const shown = items.slice(0, limit).map((item) => `"${item.length > 70 ? `${item.slice(0, 67)}…` : item}"`);
  return items.length > limit ? `${shown.join(', ')} (+${items.length - limit} more)` : shown.join(', ');
}

// How many times `name` stands as a whole token. "user_id" inside "user_ids" or "my_user_id" is
// another name, so a longer spelling cannot hide a change.
function tokenUses(text, name) {
  let count = 0;
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + name.length)) {
    const left = text.slice(Math.max(0, at - 2), at);
    const right = text.slice(at + name.length, at + name.length + 2);
    if (!/(?:\w|\w-)$/.test(left) && !/^(?:\w|-\w)/.test(right)) count++;
  }
  return count;
}

function tokensOf(text) {
  return new Set(text.split(/[\s"'“”‘’()[\]<>]+/).map((token) => token.replace(/^[*:@$#%]+|(?<![*.,;:!?])[*.,;:!?]+$/g, '')).filter(Boolean));
}

// A copy of a name that was cut short, typed with another case or given a new ending.
function looksAltered(name, token) {
  if (token.toLowerCase() === name.toLowerCase()) return true;
  let shared = 0;
  while (shared < name.length && shared < token.length && name[shared] === token[shared]) shared++;
  return shared >= 3 && shared >= Math.min(name.length, token.length) * 0.8;
}

const wordCount = (text) => (text.match(/\S+/g) ?? []).length;

function collector({ english }) {
  const errors = [];
  const warnings = [];
  const facts = new Map();
  return {
    english,
    errors,
    warnings,
    facts,
    // The voice of the strings the rewrite touched, for the voice warnings.
    voice: { before: emptyVoice(), after: emptyVoice() },
    lengths: { shorter: 0, longer: 0 },
    error: (code, message, extra = {}) => errors.push({ code, message, ...extra }),
    warn: (code, message, extra = {}) => warnings.push({ code, message, ...extra }),
    // How many facts of one kind the original had, and how many are still there.
    tally: (label, total, kept) => {
      if (!total) return;
      const entry = facts.get(label) ?? { total: 0, kept: 0 };
      entry.total += total;
      entry.kept += kept;
      facts.set(label, entry);
    },
  };
}

function textFacts(raw, { strings = false } = {}) {
  const cleaned = stripPlaceholders(raw, { strings });
  const body = cleaned.split('\n').filter((line) => !/^\s{0,3}#{1,6}\s/.test(line)).join('\n');
  return {
    raw,
    cleaned,
    placeholders: placeholdersOf(raw, { strings }),
    tags: tagsOf(raw, { strings }),
    numbers: numbersOf(cleaned),
    digits: numbersOf(cleaned, { words: false }),
    identifiers: identifiersOf(raw, { strings }),
    entities: entitiesOf(body),
    acronyms: acronymsOf(body),
    quotes: quotesOf(cleaned),
    tone: toneOf(cleaned),
  };
}

const normalizeQuotes = (text) => text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
const wordSet = (text) => new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).map((w) => w.replace(/(?<!['’-])['’-]+$/, '').replace(/['’]s$/, '')));


// "Something went wrong while saving." becomes "Could not save your game.": the rewrite names the failure
// the original already reported, so its "could not save" is not a negation the original lacks.
const FAILURE_WORDS = /\b(?:wrong|errors?|fail(?:s|ed|ure|ures)?|problems?|unable|oops|unsuccessful|couldn['’]t|cannot|can['’]t)\b/i;
const verbStem = (word) => word.replace(/(?:ing|ed|es|e|s)$/, '');
function failureRestated(beforeRaw, afterRaw, word) {
  if (!FAILURE_WORDS.test(beforeRaw)) return false;
  const stem = verbStem(word);
  if (stem.length < 3) return false;
  const inOriginal = (beforeRaw.toLowerCase().match(/\p{L}+/gu) ?? []).some((w) => verbStem(w) === stem);
  const failure = new RegExp(String.raw`\b(?:could\s+not|couldn['’]t|cannot|can\s+not|can['’]t|unable\s+to|fail(?:s|ed)?\s+to|(?:did|do|does)\s+not|didn['’]t)\s+(?:be\s+)?${word}\b`, 'i');
  return inOriginal && failure.test(afterRaw);
}

function compareText(before, after, c, { key }) {
  const at = key === undefined ? {} : { key };
  const prefix = key === undefined ? '' : `${key}: `;

  const placeholders = diffCounts(before.placeholders, after.placeholders);
  if (placeholders.missing.length || placeholders.added.length) {
    const parts = [];
    if (placeholders.missing.length) parts.push(`missing ${show(placeholders.missing)}`);
    if (placeholders.added.length) parts.push(`added ${show(placeholders.added)}`);
    c.error('placeholder-changed', `${prefix}placeholders changed: ${parts.join('; ')}`, at);
  }

  const tags = diffCounts(before.tags, after.tags);
  if (tags.missing.length || tags.added.length) {
    const parts = [];
    if (tags.missing.length) parts.push(`missing ${show(tags.missing)}`);
    if (tags.added.length) parts.push(`added ${show(tags.added)}`);
    c.error('tag-changed', `${prefix}markup tags changed: ${parts.join('; ')}`, at);
  }

  c.tally('placeholders', before.placeholders.length, before.placeholders.length - placeholders.missing.length);

  const numbers = diffCounts(before.numbers, after.numbers);
  c.tally('numbers', before.numbers.length, before.numbers.length - numbers.missing.length);
  if (numbers.missing.length) c.error('number-missing', `${prefix}numbers lost or changed: ${show(numbers.missing)}`, at);
  if (numbers.added.length) {
    const knownBefore = new Set(before.numbers);
    const hardAdds = numbers.added.filter((n) => after.digits.includes(n) && !knownBefore.has(n));
    const softAdds = numbers.added.filter((n) => !hardAdds.includes(n));
    if (hardAdds.length) c.error('number-added', `${prefix}numbers added that the original does not have: ${show(hardAdds)}`, at);
    else if (softAdds.length) c.warn('number-added', `${prefix}counts added in words: ${show(softAdds)}. Check that they are in the original`, at);
  }

  const lostIdentifiers = before.identifiers.filter((id) => !after.raw.includes(id) || (tokenUses(before.raw, id) > 0 && tokenUses(after.raw, id) === 0));
  if (lostIdentifiers.length) c.error('identifier-missing', `${prefix}identifiers, paths or names changed: ${show(lostIdentifiers)}`, at);

  const fewer = before.identifiers.filter((id) => !lostIdentifiers.includes(id) && tokenUses(after.raw, id) < tokenUses(before.raw, id));
  if (fewer.length) {
    // Words split at spaces miss a name that sits against Chinese or Japanese text, so the names found
    // in the text count as words too.
    const known = new Set([...tokensOf(before.raw), ...before.identifiers]);
    const fresh = [...new Set([...tokensOf(after.raw), ...after.identifiers])].filter((token) => !known.has(token));
    const altered = fewer.flatMap((id) => {
      const copy = fresh.find((token) => looksAltered(id, token));
      return copy ? [`"${id}" may now read "${copy}" in one place`] : [];
    });
    if (altered.length) {
      const more = altered.length > 5 ? ` (+${altered.length - 5} more)` : '';
      c.warn('identifier-altered', `${prefix}a copy of a name, path or address may have been changed: ${altered.slice(0, 5).join('; ')}${more}`, at);
    }
  }

  const afterWords = wordSet(after.identifiers.reduce((text, id) => text.split(id).join(' '), after.raw));
  const lostEntities = before.entities.filter((e) => !afterWords.has(e.toLowerCase()));
  c.tally('names', before.entities.length, before.entities.length - lostEntities.length);
  if (lostEntities.length) c.warn('entity-missing', `${prefix}names no longer present: ${show(lostEntities)}`, at);

  const lostAcronyms = before.acronyms.filter((a) => !new RegExp(`(?<![\\p{L}\\p{N}])${a}(?![\\p{L}\\p{N}])`, 'u').test(after.cleaned));
  if (lostAcronyms.length) c.warn('acronym-missing', `${prefix}acronyms no longer present: ${show(lostAcronyms)}`, at);

  const afterQuoted = normalizeQuotes(after.cleaned);
  const lostQuotes = before.quotes.filter((q) => !afterQuoted.includes(normalizeQuotes(q)));
  c.tally('quotes', before.quotes.length, before.quotes.length - lostQuotes.length);
  if (lostQuotes.length) c.warn('quote-changed', `${prefix}quoted text changed: ${show(lostQuotes, 3)}`, at);

  if (!c.english) return;
  const b = before.tone;
  const a = after.tone;
  const negations = diffNegations(b.negated, a.negated);
  const swapped = Math.min(negations.missing.length, negations.added.length);
  const dropped = negations.missing.slice(swapped);
  const added = negations.added.slice(swapped).filter((word) => !failureRestated(before.raw, after.raw, word));
  if (swapped) {
    c.warn('negation-reworded', `${prefix}negated words changed from ${show(negations.missing.slice(0, swapped))} to ${show(negations.added.slice(0, swapped))}. Check that the meaning is the same`, at);
  }
  if (dropped.length) c.warn('negation-dropped', `${prefix}a negation may be lost or flipped. The original negates: ${show(dropped)}`, at);
  if (added.length) c.warn('negation-added', `${prefix}the rewrite negates words the original does not: ${show(added)}`, at);
  const modals = new Set(['may', 'might', 'could']);
  const available = key === undefined ? a.modalHedges : a.possibility;
  const lostHedges = diffCounts(b.hedgeWords, a.hedgeWords).missing.filter((word) => !(modals.has(word) && available >= b.modalHedges));
  c.tally('hedges', b.hedgeWords.length, b.hedgeWords.length - lostHedges.length);
  if (lostHedges.length) c.warn('hedges-removed', `${prefix}hedges removed: ${show(lostHedges)}. The rewrite may sound more certain than the original`, at);
  const lostConditions = diffCounts(b.conditions, a.conditions).missing;
  c.tally('conditions', b.conditions.length, b.conditions.length - lostConditions.length);
  if (lostConditions.length) c.warn('conditions-removed', `${prefix}words that limit a rule were removed: ${show(lostConditions)}. The rule may now apply more widely than the original says`, at);
  if (a.examples > b.examples) c.warn('example-added', `${prefix}the rewrite adds an example the original does not have ("for example", "such as", "e.g."). Remove it, or check that the original says the same`, at);
  if (a.explainers > b.explainers) c.warn('explanation-added', `${prefix}the rewrite adds an explanation the original does not have ("which means", "in other words", "i.e."). Remove it, or check that the original says the same`, at);
  if (a.absolutes > b.absolutes) c.warn('absolutes-added', `${prefix}absolute words (always, never, every, guarantee) went from ${b.absolutes} to ${a.absolutes}`, at);
}

function sameBlock(a, b) {
  const clean = (text) => text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
  return clean(a) === clean(b);
}

function firstDifference(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] ?? '').trimEnd() !== (right[i] ?? '').trimEnd()) return { line: i + 1, was: left[i] ?? '(missing)', now: right[i] ?? '(missing)' };
  }
  return null;
}

function compareSequences(label, code, before, after, c) {
  if (before.length !== after.length) {
    c.error(code, `${label} count changed from ${before.length} to ${after.length}`);
    return;
  }
  before.forEach((block, i) => {
    if (sameBlock(block, after[i])) return;
    const diff = firstDifference(block, after[i]);
    c.error(code, `${label} ${i + 1} changed${diff ? ` (line ${diff.line}: "${diff.was.trim().slice(0, 60)}" became "${diff.now.trim().slice(0, 60)}")` : ''}`);
  });
}

function compareProse(before, after, c) {
  const b = protectedRegions(before);
  const a = protectedRegions(after);
  if (!sameBlock(b.frontMatter, a.frontMatter)) c.error('front-matter-changed', 'front matter changed');
  compareSequences('code block', 'code-changed', b.fences, a.fences, c);
  compareSequences('protected region', 'protected-region-changed', b.ignored, a.ignored, c);

  const fencesKept = b.fences.length === a.fences.length ? b.fences.filter((block, i) => sameBlock(block, a.fences[i])).length : 0;
  const code = diffCounts(inlineCodeOf(b.prose), inlineCodeOf(a.prose));
  c.tally('code', inlineCodeOf(b.prose).length + b.fences.length, inlineCodeOf(b.prose).length - code.missing.length + fencesKept);
  if (code.missing.length) c.error('inline-code-changed', `inline code lost or changed: ${show(code.missing)}`);
  if (code.added.length) c.warn('inline-code-added', `inline code added: ${show(code.added)}`);

  const linksBefore = linksOf(b.prose);
  const linksAfter = linksOf(a.prose);
  const links = diffCounts(linksBefore.targets, linksAfter.targets);
  c.tally('links', linksBefore.targets.length, linksBefore.targets.length - links.missing.length);
  if (links.missing.length) c.error('link-missing', `link targets lost or changed: ${show(links.missing)}`);
  // The same words, a different place. Every target is still in the text, so the counts above see nothing.
  // A pair is words and target, counted one by one: a link text used twice may lose one pair and gain another.
  const pairKey = ({ words, target }) => `${words}\u0000${target}`;
  const pairs = diffCounts(linkPairsOf(b.prose).map(pairKey), linkPairsOf(a.prose).map(pairKey));
  const arrivedAt = new Map(pairs.added.map((key) => key.split('\u0000')));
  const lostTargets = new Set(links.missing);
  const redirected = new Set();
  for (const key of pairs.missing) {
    const [words, target] = key.split('\u0000');
    if (arrivedAt.has(words) && !lostTargets.has(target)) redirected.add(`"${words}" pointed to ${target} and now points to ${arrivedAt.get(words)}`);
  }
  if (redirected.size) c.error('link-moved', `a link now points somewhere else: ${[...redirected].slice(0, 3).join('; ')}`);
  if (links.added.length) c.warn('link-added', `link targets added: ${show(links.added)}`);
  // Two mentions of one URL may become one. A URL that is gone, or a copy that now reads differently, may not.
  const urls = diffCounts(linksBefore.bare, linksAfter.bare);
  const urlsKept = new Set(linksAfter.bare);
  const urlsLost = urls.missing.filter((url) => !urlsKept.has(url) || urls.added.length > 0);
  if (urlsLost.length) c.error('url-missing', `URLs lost or changed: ${show(urlsLost)}`);

  const images = diffCounts(imagesOf(b.prose), imagesOf(a.prose));
  if (images.missing.length || images.added.length) c.error('image-changed', 'images changed');

  const comments = diffCounts(commentsOf(b.prose), commentsOf(a.prose));
  if (comments.missing.length || comments.added.length) c.warn('comments-changed', `HTML comments changed: ${show([...comments.missing, ...comments.added])}`);

  const tb = tablesOf(b.prose);
  const ta = tablesOf(a.prose);
  if (tb.rows !== ta.rows || tb.columns !== ta.columns || tb.separators !== ta.separators) {
    c.error('table-changed', `table shape changed (${tb.rows} rows × ${tb.columns} columns became ${ta.rows} × ${ta.columns})`);
  }

  const hb = headingsOf(b.prose);
  const ha = headingsOf(a.prose);
  if (hb.length !== ha.length) c.warn('heading-count', `heading count went from ${hb.length} to ${ha.length}`);
  else if (hb.some((h, i) => h.level !== ha[i].level)) c.warn('heading-levels', 'heading levels changed');

  const lb = listsOf(b.prose);
  const la = listsOf(a.prose);
  if (la.numbered < lb.numbered || la.bullets < lb.bullets) {
    c.warn('list-items', `list items changed: numbered ${lb.numbered} to ${la.numbered}, bullets ${lb.bullets} to ${la.bullets}. Check that no step or point was dropped, merged or moved into a paragraph`);
  }
  if (lb.checked !== la.checked || lb.unchecked !== la.unchecked) {
    c.warn('task-boxes', `task boxes changed: checked ${lb.checked} to ${la.checked}, unchecked ${lb.unchecked} to ${la.unchecked}`);
  }

  compareText(textFacts(factText(b.prose)), textFacts(factText(a.prose)), c, {});
}

function nonEmptyLines(source) {
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter((entry) => entry.text.trim());
}

function compareStringPair(key, was, now, c, maxGrowth) {
  if (was === now) return false;
  if (!now.trim()) {
    c.error('string-emptied', `${key}: string is now empty`, { key });
    return true;
  }
  compareText(textFacts(was, { strings: true }), textFacts(now, { strings: true }), c, { key });
  // A string cut to a third of its words lost its contractions with the rest. Voice is compared on strings that stayed about as long.
  if (wordCount(now) * 3 >= wordCount(was) * 2) {
    addVoice(c.voice.before, was);
    addVoice(c.voice.after, now);
  }
  if (now.length < was.length) c.lengths.shorter++;
  else if (now.length > was.length) c.lengths.longer++;
  const newlines = (text) => (text.match(/\n/g) ?? []).length;
  if (newlines(was) !== newlines(now)) c.warn('newline-changed', `${key}: line breaks went from ${newlines(was)} to ${newlines(now)}`, { key });
  if (now.length > was.length * maxGrowth && now.length - was.length >= 8) {
    c.warn('string-grew', `${key}: ${was.length} characters became ${now.length}. Check that it still fits`, { key });
  }
  return true;
}

function compareLines(before, after, c, maxGrowth) {
  const b = nonEmptyLines(before);
  const a = nonEmptyLines(after);
  if (b.length !== a.length) {
    c.error('line-count-changed', `line count went from ${b.length} to ${a.length}. Keep one string per line`);
    return { total: b.length, changed: 0 };
  }
  let changed = 0;
  b.forEach((entry, i) => {
    if (compareStringPair(`line ${entry.line}`, entry.text, a[i].text, c, maxGrowth)) changed++;
  });
  return { total: b.length, changed };
}

function jsonSkeleton(source) {
  let out = '';
  let cursor = 0;
  for (const s of parseJsonStrings(source)) {
    out += `${source.slice(cursor, s.start)}""`;
    cursor = s.end;
  }
  return (out + source.slice(cursor)).replace(/\s+/g, '');
}

// What is left of an XML file without its string texts, comments and layout.
const xmlSkeleton = (source, entries) => skeletonOf(source, entries).replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, '');

function jsonStrings(source) {
  const seen = new Map();
  return parseJsonStrings(source).map((s) => {
    const base = entryKey(s);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const locked = s.meta || !looksTranslatable(s.value);
    return { key: n > 1 ? `${base}#${n}` : base, value: s.value, locked };
  });
}

function compareStructured(before, after, format, c, maxGrowth, options) {
  const entriesOf = (source) =>
    format === 'json'
      ? jsonStrings(source)
      : parseStructured(source, format, options).map((e) => {
          const value = e.text ?? e.value;
          return { key: e.key, value, locked: Boolean(e.locked) || !looksTranslatable(value), start: e.start, end: e.end };
        });
  let was;
  let now;
  try {
    was = entriesOf(before);
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    c.error('invalid-original', `the original does not parse as ${format}: ${error.message}`);
    return { total: 0, changed: 0 };
  }
  try {
    now = entriesOf(after);
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    c.error('invalid-rewrite', `the rewrite does not parse as ${format}: ${error.message}`);
    return { total: was.length, changed: 0 };
  }

  if (format === 'json' && jsonSkeleton(before) !== jsonSkeleton(after)) {
    c.error('structure-changed', 'keys, numbers, booleans, nesting or order changed outside the string values');
  }
  if (format === 'csv' && skeletonOf(before, was) !== skeletonOf(after, now)) {
    c.error('structure-changed', 'a header, key, delimiter, row or cell outside the text column changed');
  }
  if (format === 'kv') {
    const lost = diffCounts(kvComments(before), kvComments(after));
    if (lost.missing.length || lost.added.length) c.warn('comments-changed', `comment lines changed: ${show([...lost.missing, ...lost.added])}`);
  }
  if (format === 'xml') {
    if (xmlSkeleton(before, was) !== xmlSkeleton(after, now)) c.error('structure-changed', 'an element, attribute or text outside the strings changed');
    const lost = diffCounts(commentsOf(before), commentsOf(after));
    if (lost.missing.length || lost.added.length) c.warn('comments-changed', `XML comments changed: ${show([...lost.missing, ...lost.added])}`);
  }

  const afterByKey = new Map(now.map((entry) => [entry.key, entry]));
  const beforeKeys = new Set(was.map((entry) => entry.key));
  const missing = was.filter((entry) => !afterByKey.has(entry.key)).map((entry) => entry.key);
  const added = now.filter((entry) => !beforeKeys.has(entry.key)).map((entry) => entry.key);
  if (missing.length) c.error('key-missing', `keys missing from the rewrite: ${show(missing)}`);
  if (added.length) c.error('key-added', `keys added by the rewrite: ${show(added)}`);

  let changed = 0;
  for (const entry of was) {
    const other = afterByKey.get(entry.key);
    if (!other || other.value === entry.value) continue;
    if (entry.locked) {
      c.error('locked-string-changed', `${entry.key}: value is not UI text and must not change ("${entry.value.slice(0, 50)}" became "${other.value.slice(0, 50)}")`, { key: entry.key });
      continue;
    }
    if (compareStringPair(entry.key, entry.value, other.value, c, maxGrowth)) changed++;
  }
  return { total: was.filter((entry) => !entry.locked).length, changed };
}

function wrapperFindings(source, options) {
  return lintSource(source, { ...options, profile: 'article' }).findings.filter((finding) => WRAPPER_RULES.includes(finding.rule));
}

function weightOf(report, rule) {
  return report.byRule.find((entry) => entry.rule === rule)?.weight ?? 0;
}

function compareLint(before, after, context, c, maxGrowth, sentences) {
  const options = { profile: context.profile, level: context.level, format: context.format, file: context.file, column: context.column };
  let was;
  let now;
  let wrappersBefore;
  let wrappersAfter;
  try {
    was = lintSource(before, options);
    now = lintSource(after, options);
    wrappersBefore = wrapperFindings(before, options);
    wrappersAfter = wrapperFindings(after, options);
  } catch (error) {
    if (error instanceof SourceError) return null;
    throw error;
  }

  const signature = (finding) => `${finding.rule}:${(finding.match ?? finding.quote).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')}`;
  const inherited = new Map();
  for (const finding of wrappersBefore) {
    inherited.set(signature(finding), (inherited.get(signature(finding)) ?? 0) + 1);
  }
  for (const finding of wrappersAfter) {
    const left = inherited.get(signature(finding)) ?? 0;
    if (left > 0) {
      inherited.set(signature(finding), left - 1);
      continue;
    }
    c.error('wrapper-text', `the rewrite contains assistant or template text: "${finding.quote}"`);
    break;
  }

  const introduced = now.byRule
    .filter((entry) => entry.kind === 'slop')
    .map((entry) => ({ rule: entry.rule, grew: round(entry.weight - weightOf(was, entry.rule), 2) }))
    .filter((entry) => entry.grew > 0)
    .sort((x, y) => y.grew - x.grew);
  if (introduced.reduce((sum, entry) => sum + entry.grew, 0) >= 2) {
    const rules = introduced.slice(0, 4).map((entry) => entry.rule).join(', ');
    c.warn('more-tells', `the rewrite adds stock phrases or padding patterns: ${rules} (slop weight ${was.totals.slopWeight} to ${now.totals.slopWeight})`);
  }

  if (c.english && now.scores.slopBand !== 'clean') {
    c.warn('slop-remains', `the rewrite still scores ${now.scores.slop} slop per 1k words (${now.scores.slopBand}). Run lint to see what is left`);
  }

  if (c.english && now.scores.clarity > was.scores.clarity + 5 && now.scores.clarityBand !== 'clear') {
    c.warn('less-clear', `clarity score got worse (${was.scores.clarity} to ${now.scores.clarity} per 1k words)`);
  }

  if (context.format === 'prose' && now.metrics.sentences >= BURSTINESS_MIN_SENTENCES && now.metrics.burstiness < EVEN_BELOW && was.metrics.burstiness - now.metrics.burstiness >= 0.08) {
    c.warn('metronome', `sentence lengths are now very even (spread ${now.metrics.burstiness}, was ${was.metrics.burstiness}). Vary the rhythm`);
  }

  const growth = was.metrics.words ? now.metrics.words / was.metrics.words : 1;
  // Spelling out three contractions in a 12-word text adds 17%, which says nothing about padding. Under 5 new words is noise.
  if (growth > maxGrowth && now.metrics.words - was.metrics.words >= 5) c.warn('grew', `the text grew by ${Math.round((growth - 1) * 100)}% (${was.metrics.words} to ${now.metrics.words} words)`);
  if (context.format === 'prose' && was.metrics.words >= 40 && growth < 0.5) {
    c.warn('shrank', `the text lost ${Math.round((1 - growth) * 100)}% of its words. Check that no content was dropped`);
  }

  const changes = { tells: tellChanges(was, now) };
  if (sentences) movedFacts(sentences, c, { before, after, file: context.file });
  if (sentences && c.english) changes.sentences = sentenceChanges(sentences, was.findings, { profile: context.profile, level: context.level }, c);

  return {
    changes,
    words: { before: was.metrics.words, after: now.metrics.words, growth: round(growth, 2) },
    slop: { before: was.scores.slop, after: now.scores.slop, beforeBand: was.scores.slopBand, afterBand: now.scores.slopBand },
    clarity: { before: was.scores.clarity, after: now.scores.clarity, beforeBand: was.scores.clarityBand, afterBand: now.scores.clarityBand },
    burstiness: { before: was.metrics.burstiness, after: now.metrics.burstiness, beforeBand: burstinessBand(was.metrics), afterBand: burstinessBand(now.metrics) },
  };
}

// The strings of an Android resources file are read, and a broken rewrite reported, before this runs.
function compareXml(before, after, c, file, { syntaxReported = false } = {}) {
  if (!/^\uFEFF?\s*</.test(before)) return;
  const was = inspectXml(before);
  if (was.error) return;
  const now = inspectXml(after);
  if (now.error) {
    if (!syntaxReported) c.error('invalid-rewrite', `the rewrite does not parse as xml: ${now.error.message} at line ${now.error.line}`);
    return;
  }
    if (!isAndroidResources(before, file)) return;
  const keyOf = (problem) => `${problem.problem}\n${problem.string}`;
  const known = new Map();
  for (const problem of was.android) known.set(keyOf(problem), (known.get(keyOf(problem)) ?? 0) + 1);
  for (const problem of now.android) {
    const left = known.get(keyOf(problem)) ?? 0;
    if (left > 0) known.set(keyOf(problem), left - 1);
    else {
      const shown = problem.string.length > 60 ? `${problem.string.slice(0, 57)}...` : problem.string;
      const message = `line ${problem.line}: ${ANDROID_PROBLEMS[problem.problem]}: "${shown}"`;
      if (problem.problem === 'quote') c.error('android-quote', message);
      else c.warn('android-apostrophe', message);
    }
  }
}

// The English-only warnings read the words a reader sees. Links, badges, tags and code around them
// would drag the share of English function words down, and a README full of them would look foreign.
export function documentLooksEnglish(source) {
  return looksEnglish(stripPlaceholders(factText(protectedRegions(source).prose)));
}

// The strings of an Android file are English or not by their own words, not by the markup around them.
function androidStringsLookEnglish(source) {
  try {
    return looksEnglish(parseStructured(source, 'xml').filter((entry) => !entry.locked).map((entry) => entry.text).join('\n'));
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    return looksEnglish(source);
  }
}

export function checkRewrite(before, after, options = {}) {
  const requested = options.profile ?? 'auto';
  const profile = requested === 'auto' ? inferProfile(options.file, before, { format: options.format }) : requested;
  const format = chooseFormat(options.file, profile, options.format, before);
  const level = options.level ?? 'standard';
  const structured = isEntryFormat(format) || format === 'lines';
  const maxGrowth = options.maxGrowth ?? (structured ? DEFAULT_GROWTH.strings : DEFAULT_GROWTH.prose);
  // Line endings are not part of what prose says: a rewrite saved with CRLF or LF reads the same.
  const lineEnds = (text) => (structured ? text : text.replace(/\r\n?/g, '\n'));
  const was = lineEnds(before);
  const now = lineEnds(after);
  const english = format === 'xml' ? androidStringsLookEnglish(was) : structured ? looksEnglish(was) : documentLooksEnglish(was);
  const c = collector({ english });
  const identical = before === after;
  if (!identical && !after.trim() && before.trim()) c.error('rewrite-empty', 'the rewrite is empty');
  if (!identical && !before.trim() && after.trim()) c.error('original-empty', 'the original is empty, so every word of the rewrite is new and nothing can be compared');

  let strings = null;
  if (!identical && after.trim()) {
    if (isEntryFormat(format)) strings = compareStructured(before, after, format, c, STRING_GROWTH, { column: options.column });
    else if (format === 'lines') strings = compareLines(before, after, c, STRING_GROWTH);
    else compareProse(was, now, c);
    compareXml(before, after, c, options.file, { syntaxReported: format === 'xml' });
  }

  if (strings && c.english) compareVoice(c.voice.before, c.voice.after, { profile, level }, c);
  // Facts are bound to sentences in any Latin-script text. The warnings about wording need English.
  const sentences = format === 'prose' && !identical && after.trim() && isLatinScript(was) ? compareSentences(was, now, options.file) : null;
  const stats = identical || !after.trim() ? null : compareLint(was, now, { profile, level, format, file: options.file, column: options.column }, c, maxGrowth, sentences);
  if (stats) {
    stats.changes.facts = [...c.facts].map(([label, { total, kept }]) => ({ label, total, kept }));
    if (strings) stats.changes.strings = { ...strings, ...c.lengths };
  }
  return {
    ok: c.errors.length === 0,
    identical,
    format,
    profile,
    level,
    english,
    errors: c.errors,
    warnings: c.warnings,
    stats: stats ? { ...stats, ...(strings ? { strings } : {}) } : null,
  };
}
