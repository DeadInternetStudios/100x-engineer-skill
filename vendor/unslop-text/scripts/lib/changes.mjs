// What a rewrite did, in numbers a reader can check: sentences kept, reworded, joined, replaced or cut,
// the voice marks that stayed, and the warnings those numbers raise.
import { stockSentences, commitsTo } from './claims.mjs';
import { addVoice, emptyVoice, compareVoice, compareCutVoice } from './voice.mjs';
import { contentStems } from './align.mjs';

// A rewrite that joins or splits this share of the sentences, and at least this many, has rebuilt the text.
const REBUILT_SHARE = 0.3;
const REBUILT_MIN = 4;
// "Because your journey deserves the best." makes a promise in four words and says nothing. A cut
// sentence has to carry this many content words before its promise counts as a claim that was lost. A rule
// or a condition ("Keep passwords in the vault.") is a claim in fewer words than a cause or a comparison.
const CLAIM_MIN_STEMS = 5;
const RULE_MIN_STEMS = 3;

const isLostClaim = (sentence) => {
  if (!commitsTo(sentence.tags)) return false;
  const rule = sentence.tags.includes('obligation') || sentence.tags.includes('condition');
  return contentStems(sentence.text).size >= (rule ? RULE_MIN_STEMS : CLAIM_MIN_STEMS);
};

const shorten = (text) => (text.length > 80 ? `${text.slice(0, 77)}…` : text);
const list = (sentences, limit = 3) => {
  const shown = sentences.slice(0, limit).map((s) => `"${shorten(s.shown)}" (line ${s.line})`);
  return sentences.length > limit ? `${shown.join('; ')}; +${sentences.length - limit} more` : shown.join('; ');
};
const noun = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The voice in the sentences that stayed: each pair is a sentence of the original and the sentence or
// sentences of the rewrite that carry it on. Pairs whose text did not change add the same to both sides.
// A sentence lint calls stock ("It's important to note that ...") is left out: stripping its opener is the job.
function voiceOfKept(report, stock) {
  const before = emptyVoice();
  const after = emptyVoice();
  const seen = new Set();
  report.alignment.before.forEach((entry, i) => {
    // A sentence with no content words ("Why?") has nothing to align, so it says nothing about the voice.
    if (!entry.to.length || !['kept', 'reworded', 'split', 'merged'].includes(entry.status)) return;
    if (stock.has(report.before[i].text.replace(/\s+/g, ' ').trim())) return;
    const now = entry.to.filter((j) => !seen.has(j));
    for (const j of entry.to) seen.add(j);
    const was = report.before[i].text;
    const text = now.map((j) => report.after[j].text).join(' ');
    if (now.length === 1 && text === was) return;
    addVoice(before, was);
    addVoice(after, text);
  });
  return { before, after };
}

// The voice the whole original and the whole rewrite hold, and what the cut sentences held. A cut stock
// sentence ("I hope this finds you well") is not the author's voice, so it does not count.
function voiceOfCut(report, stock) {
  const whole = emptyVoice();
  const left = emptyVoice();
  const cut = emptyVoice();
  for (const sentence of report.before) addVoice(whole, sentence.text);
  for (const sentence of report.after) addVoice(left, sentence.text);
  report.alignment.before.forEach((entry, i) => {
    if (entry.status === 'cut' && !stock.has(report.before[i].text.replace(/\s+/g, ' ').trim())) addVoice(cut, report.before[i].text);
  });
  return { whole, left, cut };
}

export function sentenceChanges(report, findings, { profile, level }, c) {
  const { counts } = report.alignment;
  const total = report.before.length;

  const stock = stockSentences(report.before, findings);
  let lostClaims = report.cut.filter((sentence) => isLostClaim(sentence) && !stock.has(sentence.text.replace(/\s+/g, ' ').trim()));
  let added = report.added;

  // A claim that was cut and a sentence that was added in the same place are most often one sentence worded
  // so differently that no words match. They get one warning, not two.
  const replaced = [];
  for (const claim of lostClaims) {
    const fresh = claim.nearby.find((sentence) => added.includes(sentence));
    if (!fresh) continue;
    replaced.push([claim, fresh]);
    added = added.filter((sentence) => sentence !== fresh);
  }
  lostClaims = lostClaims.filter((claim) => !replaced.some(([cut]) => cut === claim));
  if (replaced.length) {
    const pairs = replaced.slice(0, 3).map(([cut, fresh]) => `"${shorten(cut.shown)}" (line ${cut.line}) became "${shorten(fresh.shown)}" (line ${fresh.line})`);
    c.warn('sentence-replaced', `${noun(replaced.length, 'sentence')} that state${replaced.length === 1 ? 's' : ''} a claim ${replaced.length === 1 ? 'was' : 'were'} replaced by ${replaced.length === 1 ? 'one' : 'ones'} that share${replaced.length === 1 ? 's' : ''} almost no words: ${pairs.join('; ')}${replaced.length > 3 ? `; +${replaced.length - 3} more` : ''}. Check that the new sentence says the same thing`);
  }

  if (added.length) {
    c.warn(
      'sentence-added',
      `${noun(added.length, 'sentence')} in the rewrite say${added.length === 1 ? 's' : ''} something no sentence of the original says: ${list(added)}. Remove ${added.length === 1 ? 'it' : 'them'}, or check that the original says the same`,
    );
  }

  if (lostClaims.length) {
    c.warn('claim-cut', `${noun(lostClaims.length, 'sentence')} that state${lostClaims.length === 1 ? 's' : ''} a cause, condition, rule or comparison ${lostClaims.length === 1 ? 'has' : 'have'} no counterpart in the rewrite: ${list(lostClaims)}. Check that cutting ${lostClaims.length === 1 ? 'it' : 'them'} was on purpose`);
  }

  const rebuilt = Math.max(REBUILT_MIN, Math.ceil(total * REBUILT_SHARE));
  if (counts.merged >= rebuilt) c.warn('sentences-joined', `${counts.merged} of ${total} sentences were joined into longer ones. Check that the rhythm and the author's phrasing survive`);
  if (counts.split >= rebuilt) c.warn('sentences-split', `${counts.split} of ${total} sentences were split into shorter ones. Check that the rhythm and the author's phrasing survive`);

  const voice = voiceOfKept(report, stock);
  const warned = compareVoice(voice.before, voice.after, { profile, level }, c);
  compareCutVoice(voiceOfCut(report, stock), { profile, level }, c, warned);
  return { before: total, after: report.after.length, ...counts, extra: report.extra.length, voice };
}

// Rules that fired in the original and fire less in the rewrite, most removed first, and the ones that grew.
export function tellChanges(was, now) {
  const counts = (report) => new Map(report.byRule.filter((entry) => entry.kind === 'slop').map((entry) => [entry.rule, entry.count]));
  const before = counts(was);
  const after = counts(now);
  const removed = [];
  for (const [rule, count] of before) if ((after.get(rule) ?? 0) < count) removed.push({ rule, before: count, after: after.get(rule) ?? 0 });
  const added = [];
  for (const [rule, count] of after) if (count > (before.get(rule) ?? 0)) added.push({ rule, before: before.get(rule) ?? 0, after: count });
  removed.sort((x, y) => y.before - y.after - (x.before - x.after));
  return { removed, added };
}
