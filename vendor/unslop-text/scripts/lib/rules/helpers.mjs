import { countWords } from '../text.mjs';

function dropOverlaps(hits) {
  const sorted = [...hits].sort((a, b) => a.index - b.index || b.length - a.length);
  const kept = [];
  let end = -1;
  for (const hit of sorted) {
    if (hit.index < end) continue;
    kept.push(hit);
    end = hit.index + hit.length;
  }
  return kept;
}

const globals = new WeakMap();
function globalOf(re) {
  if (re.global) return re;
  if (!globals.has(re)) globals.set(re, new RegExp(re.source, `${re.flags}g`));
  return globals.get(re);
}

export function regexHits(patterns, text) {
  const hits = [];
  for (const pattern of patterns) {
    const re = globalOf(pattern);
    for (const match of text.matchAll(re)) hits.push({ index: match.index, length: match[0].length, text: match[0] });
  }
  return dropOverlaps(hits);
}

export function weightedHits(entries, text) {
  const hits = [];
  for (const { re: pattern, weight } of entries) {
    const re = globalOf(pattern);
    for (const match of text.matchAll(re)) hits.push({ index: match.index, length: match[0].length, text: match[0], weight });
  }
  return dropOverlaps(hits);
}

export function sentenceHits(patterns, block) {
  const hits = [];
  for (const span of block.spans) {
    for (const pattern of patterns) {
      const re = globalOf(pattern);
      for (const match of span.text.matchAll(re)) {
        hits.push({ index: span.start + match.index, length: match[0].length, text: match[0] });
      }
    }
  }
  return dropOverlaps(hits);
}

export function runsOf(items, predicate, minLength) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= items.length; i++) {
    const ok = i < items.length && predicate(items[i], i);
    if (ok && start === -1) start = i;
    if (!ok && start !== -1) {
      if (i - start >= minLength) runs.push({ start, end: i });
      start = -1;
    }
  }
  return runs;
}

export function wordsIn(sentence) {
  return countWords(sentence);
}

const PROSE_TYPES = new Set(['paragraph', 'list-item', 'quote', 'table-row', 'string']);

export function isProse(block) {
  return PROSE_TYPES.has(block.type);
}

export function proseBlocks(doc) {
  return doc.blocks.filter(isProse);
}

export function hasCitation(text) {
  return /\[\d+\]|\(\w+(?: et al\.)?,? \d{4}\)|\bURL\b/.test(text);
}

const IMPERATIVE_VERBS = new Set(
  `add apply ask attach avoid back be bring build call cancel change check choose clear click close configure confirm connect copy create define delete deploy disable do download drag drop edit enable enter ensure export fill find follow generate get give go hold import include insert install keep launch leave let load log make mark move name navigate note open pass paste pick place press prepare provide pull push put read refer register remove rename replace report restart restore return review run save scroll search see select send set show sign skip start stop submit swipe switch take tap test try turn type undo uninstall update upload use verify visit wait write`.split(/\s+/),
);

export function isInstruction(sentence) {
  const first = sentence.match(/^\W*([A-Za-z]+)/)?.[1]?.toLowerCase();
  return first !== undefined && IMPERATIVE_VERBS.has(first);
}

export function proseSentenceCounts(doc) {
  const counts = [];
  for (const block of doc.blocks) {
    if (block.type !== 'paragraph' && block.type !== 'quote') continue;
    for (const span of block.spans) counts.push(wordsIn(span.text));
  }
  return counts;
}

export { dropOverlaps };
