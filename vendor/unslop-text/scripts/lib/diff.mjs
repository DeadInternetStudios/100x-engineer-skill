// `unslop diff`: the sentences a rewrite changed, side by side, with the line numbers of the original.
// A line diff shows a reflowed paragraph as all changed. This one lines up sentences, so a rewrite
// that kept 20 of 30 sentences shows only the 10 that moved.
import { claimTags, nearbyAfter, claimedAfter } from './claims.mjs';
import { counted } from './counted.mjs';

const clip = (text, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const LABELS = { reworded: 'reworded', split: 'split', merged: 'joined', replaced: 'replaced', cut: 'cut' };
// A cut sentence with a sentence of the rewrite beside it is still a cut. `claims` counts it the same way.
const CUT_BESIDE = 'cut, the rewrite has a sentence in its place';

export function diffSentences(report) {
  const { before, after, alignment } = report;
  const claimed = claimedAfter(before, after, alignment);
  const shown = new Set();
  const changes = [];
  before.forEach((sentence, i) => {
    const entry = alignment.before[i];
    if (entry.status === 'kept') return;
    // A cut sentence and a new sentence in the same place are one edit, so show them together.
    const targets = entry.status === 'cut' ? nearbyAfter(alignment, i, after.length, claimed) : entry.to ?? [];
    const fresh = targets.filter((j) => !shown.has(j));
    for (const j of fresh) shown.add(j);
    const now = fresh.map((j) => after[j]);
    const kind = entry.status === 'cut' && now.length ? CUT_BESIDE : LABELS[entry.status];
    changes.push({ kind, line: sentence.line, was: sentence, tags: entry.status === 'cut' ? [...claimTags(sentence.text), ...(sentence.stock ? ['stock'] : [])] : [], now });
  });
  after.forEach((sentence, j) => {
    // A sentence nothing accounts for is added when the original says nothing like it, and short or split-off when it is a piece of one.
    if (!claimed.has(j) && !shown.has(j)) changes.push({ kind: alignment.after[j].status === 'added' ? 'added' : 'short or split-off', line: sentence.line, was: null, tags: [], now: [sentence] });
  });
  return changes;
}

export function formatDiff(report, { before, after } = {}) {
  const changes = diffSentences(report);
  const { counts } = report.alignment;
  const lines = [
    `${before && after ? `${before} → ${after}  ` : ''}${counted(report.before.length, 'prose sentence')} → ${report.after.length}`,
    `  ${counts.kept} kept word for word or nearly, ${changes.length} shown below`,
  ];
  for (const change of changes) {
    lines.push('', `${change.kind}${change.was ? ` · L${change.line}` : ` · L${change.line} of the rewrite`}${change.tags.length ? ` [${change.tags.join(', ')}]` : ''}`);
    if (change.was) lines.push(`  - ${clip(change.was.shown)}`);
    for (const piece of change.now) lines.push(`  + ${clip(piece.shown)}`);
  }
  if (!report.before.length) lines.push('', 'The original has no prose sentences, so there is nothing to compare the rewrite with.');
  else if (!changes.length) lines.push('', 'No sentence changed.');
  if (changes.some((change) => change.tags.includes('stock'))) lines.push('', '[stock] marks a sentence that lint flags as a stock phrase. Cutting it is usually on purpose.');
  return lines.join('\n');
}
