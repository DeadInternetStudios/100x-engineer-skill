// Pairs the sentences of a text with the sentences of its rewrite, so a report can say which sentences
// were kept, reworded, split, joined, replaced or cut, and which sentences of the rewrite have no source.
//
// The match is by content words. A rewrite that swaps `utilize` for `use` still shares most of its words
// with the original, so the match survives plain-word edits. It is a guide for a reader, not a proof.
// A sentence that no sentence of the rewrite resembles is `cut`, unless the rewrite has a sentence with
// no source at the same spot, which is then a `replaced` pair, a reworded sentence beyond recognition.
// What is left over is `cut` (nothing took its place) or `added` (it replaces nothing).

const STOPWORDS = new Set(`a about above after again all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here hers
him his how i if in into is it its itself just let me more most my no nor not of off on once only or other our out over own
same she should so some such than that the their theirs them then there these they this those through to too under until up cannot
very was we were what when where which while who whom why will with would you your yours yourself cannot`.split(/\s+/));

const STEM_LENGTH = 5;
// A number with its separators is one word: "1.4" and "2.0" share no stem, where "1", "4", "2" and "0" would pair sentences by their digits.
const WORD = /\d+(?:[.,]\d+)+|[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
// The text cleaner writes CODE where inline code stood. It says nothing about the sentence.
const CODE_MARK = /\bCODE\b/g;

// The words that carry a sentence: function words dropped, each word cut to its first five letters so
// `utilize` and `utilization`, or `restart` and `restarts`, count as one.
export function contentStems(sentence) {
  const stems = new Set();
  for (const raw of sentence.replace(CODE_MARK, ' ').toLowerCase().match(WORD) ?? []) {
    // "isn't" and "is not" are the same words: the ending is dropped, so a rewrite that spells a contraction out keeps its match.
    const word = raw.replace(/n['’]t$|['’](?:s|re|ve|ll|d|m)$/, '');
    if (STOPWORDS.has(word)) continue;
    if (word.length < 3 && !/\d/.test(word)) continue;
    stems.add(word.slice(0, STEM_LENGTH));
  }
  return stems;
}

const KEPT_SHARE = 0.8;
const KEPT_DICE = 0.7;
const REWORDED_SHARE = 0.4;
const SPLIT_COVERAGE = 0.6;
const PIECE_SHARE = 0.5;
// Two sentences that share this many content words are about the same thing, however they are worded.
const SAME_TOPIC_STEMS = 4;
const SAME_TOPIC_SUPPORT = 0.4;
const NEW_SUPPORT = 0.5;
// A bridging sentence such as "Here is where it stands." has too few content words to judge.
const NEW_MIN_STEMS = 6;

function inverted(sets) {
  const index = new Map();
  sets.forEach((set, i) => {
    for (const stem of set) {
      const list = index.get(stem);
      if (list) list.push(i);
      else index.set(stem, [i]);
    }
  });
  return index;
}

function sharedCounts(set, index) {
  const counts = new Map();
  for (const stem of set) for (const j of index.get(stem) ?? []) counts.set(j, (counts.get(j) ?? 0) + 1);
  return counts;
}

// The longest run of neighbors in `after`, each made mostly of words from one sentence of `before`.
function splitPieces(counts, A) {
  const ids = [...counts].filter(([j, shared]) => shared >= 2 && shared / A[j].size >= PIECE_SHARE).map(([j]) => j).sort((x, y) => x - y);
  let best = [];
  let run = [];
  for (const j of ids) {
    run = run.length && run.at(-1) === j - 1 ? [...run, j] : [j];
    if (run.length > best.length) best = run;
  }
  return best;
}

// A real split hands a different part of the sentence to each piece. Two neighbours that both repeat the
// same few words ("Keys last 90 days. Backups last 30 days.") are two sentences of their own.
const PIECE_OWN_STEMS = 2;

function eachPieceCarriesPart(set, pieces, A) {
  return pieces.every((j) => {
    let own = 0;
    for (const stem of A[j]) if (set.has(stem) && pieces.every((k) => k === j || !A[k].has(stem))) own++;
    return own >= PIECE_OWN_STEMS;
  });
}

// What became of one sentence of the original, judged from the sentences of the rewrite it shares words with.
function judgeBefore(set, i, counts, A, total) {
  let best = -1;
  let bestShared = 0;
  const expected = (i / Math.max(1, total)) * A.length;
  // Of two sentences that share as many words and both match almost word for word, the one with fewer words
  // of its own is the match, so "…/tagged/android" is not paired with "…/tagged/android-jetpack". Between
  // weaker matches, and between equals, position decides.
  const fits = (j, shared) => shared / set.size >= KEPT_SHARE && (2 * shared) / (set.size + A[j].size) >= KEPT_DICE;
  const nearer = (j) => Math.abs(j - expected) < Math.abs(best - expected);
  const tighter = (j, shared) => {
    const jFits = fits(j, shared);
    if (jFits && fits(best, bestShared)) return A[j].size < A[best].size || (A[j].size === A[best].size && nearer(j));
    return jFits === fits(best, bestShared) ? nearer(j) : jFits;
  };
  for (const [j, shared] of counts) {
    if (best === -1 || shared > bestShared || (shared === bestShared && tighter(j, shared))) {
      best = j;
      bestShared = shared;
    }
  }
  const share = bestShared / set.size;
  if (best === -1) return { status: 'cut', to: [], share };
  const dice = (2 * bestShared) / (set.size + A[best].size);
  if (share >= KEPT_SHARE && dice >= KEPT_DICE) return { status: 'kept', to: [best], share };
  const pieces = splitPieces(counts, A);
  if (pieces.length >= 2) {
    const covered = new Set();
    for (const j of pieces) for (const stem of A[j]) if (set.has(stem)) covered.add(stem);
    if (covered.size / set.size >= SPLIT_COVERAGE && eachPieceCarriesPart(set, pieces, A)) return { status: 'split', to: pieces, share };
  }
  const sameTopic = bestShared >= SAME_TOPIC_STEMS && bestShared / A[best].size >= SAME_TOPIC_SUPPORT;
  if (share >= REWORDED_SHARE || sameTopic) return { status: 'reworded', to: [best], share };
  return { status: 'cut', to: [], share };
}

// The sentences that still match almost word for word, in order, hold the two texts together. They are
// the anchors: a weaker match has to lie between the anchors on either side of its sentence, because in a
// long text a sentence of the rewrite far away shares words with almost anything.
// A reworded sentence may sit a few places from where it began, so the gap is widened by this many sentences.
const SLACK = 6;

// A sentence of the rewrite that one sentence of the original still matches this closely is spoken for.
// No other sentence may take it as its reworded form, because a sentence of the rewrite made of the same
// topic words as a cut sentence would hide the cut. Without this rule 7 of 68 cut claims in real READMEs
// passed: the cut sentence found an unrelated neighbor that an unchanged sentence already held.
const OWNER_DICE = 0.85;

function ownersOf(entries, B, A) {
  const owners = new Map();
  entries.forEach((entry, i) => {
    if (entry.status !== 'kept' || !entry.to.length) return;
    const [j] = entry.to;
    let shared = 0;
    for (const stem of B[i]) if (A[j].has(stem)) shared++;
    if ((2 * shared) / (B[i].size + A[j].size) >= OWNER_DICE) owners.set(j, i);
  });
  return owners;
}

function matchBefore(B, A, afterIndex) {
  const entries = B.map((set, i) => (set.size === 0 ? { status: 'kept', to: [], share: 1 } : judgeBefore(set, i, sharedCounts(set, afterIndex), A, B.length)));
  const owners = ownersOf(entries, B, A);
  const anchors = anchorsOf(entries.map((entry) => (entry.status === 'kept' ? entry : { to: [] })));
  let next = 0;
  entries.forEach((entry, i) => {
    if (entry.status === 'kept' || B[i].size === 0) return;
    while (next < anchors.length && anchors[next][0] < i) next++;
    const low = next > 0 ? anchors[next - 1][1] : -1;
    const high = next < anchors.length ? anchors[next][1] : A.length;
    const inside = [...sharedCounts(B[i], afterIndex)].filter(([j]) => j > low - SLACK && j < high + SLACK && (owners.get(j) ?? i) === i);
    entries[i] = judgeBefore(B[i], i, new Map(inside), A, B.length);
  });
  return entries;
}

// A sentence of the rewrite that no sentence of the original claimed is checked against the sentences
// of the original in the same gap between anchors. One source that holds half of its words is enough. A
// join of two neighbours holds only part of its words from each of them, so two sentences that follow one
// another count together, but then most of its words must come from them: a sentence that takes 60% of its
// words from the neighbours and the rest from nowhere says something the text never said.
// Words borrowed from sentences far apart never count together.
const MAX_JOIN = 2;
const JOIN_SUPPORT = 0.8;

function supportOf(set, B, candidates) {
  let single = 0;
  let joined = 0;
  for (const start of candidates) {
    const support = new Set();
    for (let i = start; i < start + MAX_JOIN && candidates.has(i); i++) {
      for (const stem of B[i]) if (set.has(stem)) support.add(stem);
      if (i === start) single = Math.max(single, support.size);
      else joined = Math.max(joined, support.size);
    }
  }
  return { single, joined };
}

function matchAfter(B, A, beforeIndex, before) {
  const claimed = new Set(before.flatMap((entry) => entry.to));
  const anchors = anchorsOf(before.map((entry) => (entry.status === 'kept' ? entry : { to: [] })));
  let next = 0;
  return A.map((set, j) => {
    if (claimed.has(j)) return { status: 'matched' };
    if (set.size < NEW_MIN_STEMS) return { status: 'short' };
    while (next < anchors.length && anchors[next][1] < j) next++;
    const low = next > 0 ? anchors[next - 1][0] : -1;
    const high = next < anchors.length ? anchors[next][0] : B.length;
    const candidates = new Set([...sharedCounts(set, beforeIndex)].filter(([i, shared]) => shared >= 2 && i > low - SLACK && i < high + SLACK).map(([i]) => i));
    const { single, joined } = supportOf(set, B, candidates);
    return { status: single / set.size >= NEW_SUPPORT || joined / set.size >= JOIN_SUPPORT ? 'matched' : 'new' };
  });
}

// Two or more sentences that land in one longer sentence were joined.
function markMerged(before, B, A) {
  const landing = new Map();
  before.forEach((entry, i) => {
    if (entry.to.length && (entry.status === 'kept' || entry.status === 'reworded')) landing.set(entry.to[0], [...(landing.get(entry.to[0]) ?? []), i]);
  });
  for (const [j, sources] of landing) {
    if (sources.length < 2 || !sources.every((i) => A[j].size > B[i].size)) continue;
    for (const i of sources) before[i] = { ...before[i], status: 'merged' };
  }
}

// The pairs that keep both texts in order: the longest increasing run of (sentence, where it went).
function anchorsOf(before) {
  const pairs = [];
  before.forEach((entry, i) => {
    if (entry.to.length) pairs.push([i, entry.to[0]]);
  });
  const tails = [];
  const prev = new Array(pairs.length).fill(-1);
  pairs.forEach(([, j], k) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (pairs[tails[mid]][1] < j) low = mid + 1;
      else high = mid;
    }
    if (low > 0) prev[k] = tails[low - 1];
    tails[low] = k;
  });
  const anchors = [];
  for (let k = tails.length ? tails.at(-1) : -1; k !== -1; k = prev[k]) anchors.push(pairs[k]);
  return anchors.reverse();
}

// Between two anchors, a cut sentence and a new sentence that share words stand for one reworded sentence.
// A new sentence that shares none with any cut sentence there says something new. What is left over
// was cut, or added.
const REPLACED_SHARED_STEMS = 2;

function settleGaps(before, after, B, A) {
  const anchors = [[-1, -1], ...anchorsOf(before), [before.length, after.length]];
  const sharedStems = (i, j) => {
    let shared = 0;
    for (const stem of A[j]) if (B[i].has(stem)) shared++;
    return shared;
  };
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [i0, j0] = anchors[k];
    const [i1, j1] = anchors[k + 1];
    const open = [];
    for (let i = i0 + 1; i < i1; i++) if (before[i].status === 'cut') open.push(i);
    for (let j = j0 + 1; j < j1; j++) {
      if (after[j].status !== 'new') continue;
      let best = -1;
      let bestShared = REPLACED_SHARED_STEMS - 1;
      for (const i of open) {
        const shared = sharedStems(i, j);
        if (shared > bestShared) {
          best = i;
          bestShared = shared;
        }
      }
      if (best === -1) {
        after[j] = { status: 'added' };
        continue;
      }
      open.splice(open.indexOf(best), 1);
      before[best] = { ...before[best], status: 'replaced', to: [j] };
      after[j] = { status: 'replaced' };
    }
  }
}

// A sentence made only of function words, "I can't do it.", has no content word to match on. When the
// text and its rewrite hold the same number of them, the first goes with the first and so on.
function pairWordless(before, after, B, A) {
  const from = before.map((entry, i) => i).filter((i) => B[i].size === 0 && before[i].to.length === 0);
  const into = after.map((entry, j) => j).filter((j) => A[j].size === 0 && after[j].status === 'short');
  if (from.length !== into.length) return;
  from.forEach((i, k) => {
    before[i].to = [into[k]];
    after[into[k]].status = 'matched';
  });
}

// Returns { before: [{ status, to, share }], after: [{ status }], counts }.
// before status: kept | reworded | split | merged | replaced | cut.
// after status: matched | replaced | added | short.
export function alignSentences(beforeSentences, afterSentences) {
  const B = beforeSentences.map(contentStems);
  const A = afterSentences.map(contentStems);
  const before = matchBefore(B, A, inverted(A));
  const after = matchAfter(B, A, inverted(B), before);
  pairWordless(before, after, B, A);
  markMerged(before, B, A);
  settleGaps(before, after, B, A);
  const counts = { kept: 0, reworded: 0, split: 0, merged: 0, replaced: 0, cut: 0, added: 0 };
  for (const entry of before) counts[entry.status]++;
  for (const entry of after) if (entry.status === 'added') counts.added++;
  return { before, after, counts };
}
