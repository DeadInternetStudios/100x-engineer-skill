// The made-up run the README shows: the stock comparison from "Why agents stop at almost works". The final message in the README,
// its picture (docs/img/diagrams/final-message.svg) and test/readme.test.mjs all read it from here, so a change to the wording of
// the message cannot leave the README behind.
export const SAMPLE = {
  title: 'Compare with the S&P 500',
  pitch: 'A chart in a research app that shows how any stock has moved against the S&P 500 since the first day both have prices.',
  verdict: 'ship',
  verdictWhy: 'The split math matches a hand count and both lines start on the same day. Dividends are not counted yet.',
  moment: 'Type a ticker and both lines start at 0% on the same day, so the gap is the whole story.',
  runCmd: 'npm run dev',
  url: 'http://localhost:5173/compare',
  tryFirst: ['Type a ticker you hold and read the gap to the index', 'Pick a stock that split two for one and check the split day shows no drop', 'Pick a stock listed this year and see where both lines start'],
  mustNotBreak: [{ kind: 'numbers', status: 'pass', summary: 'Percent change across a two-for-one split matches a hand count on 40 split cases, 0 failing' }],
  review: { status: 'reviewed', model: 'claude-opus-5-5', flags: 9, fixed: 7, rejected: 1, deferred: 1, rounds: { held: 5, planned: 5, lenses: ['the code and how it behaves', 'the code and how it behaves', 'the UI and UX', 'the UI and UX', 'whether it is ready to ship'], lastReady: true } },
  matrix: { totals: { broken: 0, weak: 2 }, viewports: 15, examined: 148 },
  asks: { closed: 9, total: 9 },
  path: '/Users/you/projects/research-app',
  nextAsks: ['Count dividends in the comparison', 'Show the gap for several stocks in one table'],
};
