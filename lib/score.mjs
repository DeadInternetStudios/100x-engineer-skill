import { mustNotBreakOutcome } from './must-not-break.mjs';
import { modern } from './runfile.mjs';

const VERDICT_RANK = { ship: 0, fine: 1, dud: 2 };
const OUTCOME_RANK = { pass: 0, skipped: 1, none: 1, fail: 2 };

// The facts a card is ranked on, in the order they decide. A mockup is the idea as running code with no judge by design, so it
// ranks after every run that was built and judged. Then the verdict, which is the builder's call. Inside a verdict, a run that only has
// the builder's word (no judge looked at it and no check held) goes after every run that has either, so the top of the page is never the
// run nobody backed. Everything after that is measured, so a run that says ready to ship with a red must-not-break check sorts below one that proved it.
export function factsOf(entry) {
  entry = modern(entry) ?? {};
  const m = entry.matrix;
  const reviewed = entry.review?.status === 'reviewed';
  const mustNotBreak = mustNotBreakOutcome(entry);
  return {
    mockup: entry.mode === 'mockup',
    verdict: entry.verdict,
    unbacked: !reviewed && mustNotBreak !== 'pass',
    refused: entry.review?.rounds?.lastReady === false,
    mustNotBreak,
    broken: m ? m.totals.broken : null,
    weak: m ? m.totals.weak : null,
    reviewed,
    polish: Number.isInteger(entry.polishPasses) ? entry.polishPasses : 0,
  };
}

const unmeasured = (value) => (value === null ? Infinity : value);

export function compareEntries(a, b) {
  const x = factsOf(a);
  const y = factsOf(b);
  return (
    Number(x.mockup) - Number(y.mockup) ||
    (VERDICT_RANK[x.verdict] ?? 3) - (VERDICT_RANK[y.verdict] ?? 3) ||
    Number(x.unbacked) - Number(y.unbacked) ||
    Number(x.refused) - Number(y.refused) ||
    OUTCOME_RANK[x.mustNotBreak] - OUTCOME_RANK[y.mustNotBreak] ||
    unmeasured(x.broken) - unmeasured(y.broken) ||
    unmeasured(x.weak) - unmeasured(y.weak) ||
    Number(y.reviewed) - Number(x.reviewed) ||
    y.polish - x.polish ||
    Date.parse(b.finishedAt) - Date.parse(a.finishedAt)
  );
}

export const RANKED_BY = 'Mockups come last, because no judge looks at one. The rest go by the builder\'s own word: ready to ship, then fine, then needs work. Inside each word, a run with some proof goes first: a judge looked at it, or its one thing that must not break was tested and held. A run with neither goes last. A run the judge said no to goes lower. After that come fewer broken things on screen, then more polish, then the newest.';
