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

// The second made-up run, the one docs/pipeline.md shows next to the list of stages. It has a work clock and three weak screens, so the page shows
// a message with the lines the first run does not have.
export const LEDGERLINE = {
  title: 'Ledgerline',
  pitch: 'A cash flow forecast for a small business that shows how many months of runway are left.',
  verdict: 'ship',
  verdictWhy: 'The numbers add up to the cent and the first screen answers the question the owner came with. The second day is thin.',
  moment: 'Move a late invoice and the whole forecast redraws, with the low point marked',
  runCmd: 'npm run dev',
  url: 'http://localhost:5173',
  tryFirst: ['Open the sample business and read the months of runway', 'Move a late invoice back two weeks and watch the low point', 'Add a one-off expense of 12000'],
  mustNotBreak: [{ kind: 'numbers', status: 'pass', summary: 'The balance after 24 months matches a hand-worked ledger to the cent on 5000 random invoice sets, 0 failing' }],
  review: { status: 'reviewed', model: 'claude-opus-5-5', flags: 14, fixed: 11, rejected: 2, deferred: 1, rounds: { held: 5, planned: 5, lenses: ['the code and how it behaves', 'the code and how it behaves', 'the UI and UX', 'the UI and UX', 'whether it is ready to ship'], lastReady: true } },
  matrix: { totals: { broken: 0, weak: 3 }, viewports: 15, examined: 212 },
  asks: { closed: 6, total: 6 },
  work: { minutes: 600, totalMinutes: 600, rounds: 14 },
  path: '/Users/you/projects/ledgerline',
  nextAsks: ['Import invoices from a CSV file', 'Show a best case and a worst case'],
};
