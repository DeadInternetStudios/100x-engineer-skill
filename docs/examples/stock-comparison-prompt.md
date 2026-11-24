# What 100x writes from a one-line request

The request was one line: `Let me compare any stock with the S&P 500 in my stock market research app` Below is the prompt 100x writes from it before it builds anything, saved as `.100x/project.md`. It is an illustrated example for a research app we made up, and it passes `100x prompt check` ("14 written, 0 marked none, 9 asks"). Back to the [README](../../README.md).

Each part changes what the builder does. The rules settle the trade-offs. The asks end in something you can open or run, and two of them are tests that must first be shown to fail. The judge questions are what the second model presses on.

```markdown
# compare-with-index

## Brief
Let me compare any stock with the S&P 500 in my stock market research app

## Goal
Add a chart to the research app that shows how one stock has moved against the S&P 500, as percent change from the same start day. "Compare" means both lines start at 0% on the first day both have a price, so the gap between them is the answer. Counts: a stock bought in 2019 next to the index since 2019; a stock listed in March next to the index since March. Does not count: two lines in dollars on two scales; an index line that starts before the stock has a price. It is not a screener, a portfolio tracker or advice.

## Read first
- The research app's own price module and the screen that already shows one stock. Take its data shape and its chart component, and add no second chart library.
- The app's price source docs, on split and dividend adjusted prices (not read, the core stage opens it). Look for whether past prices come adjusted for splits, because a split that is not adjusted shows as a fake loss.
- `~/.100x/profile.md`. The repeat correction "numbers first, then the chart" becomes a rule.

## Rules
- Percent change from a shared start, not prices. Both lines are change since the first day both have a price. The limit is the tooltip, which may show the price in dollars too.
- Adjusted for splits, not raw. A two-for-one split is no change on the day it happens. The limit is dividends, which are left out and the chart says so.
- The gap first, not the chart. The number above the chart is the stock minus the index, in percentage points, for the chosen range. The limit is a range shorter than five trading days, which shows no number and says why.
- One ticker box, not a form. Type a ticker and press Enter. The limit is a ticker the source does not know, which gets a plain message and keeps the last chart.

## Riskiest unknown
Can the chart be right across splits and short price histories with the data the app already has? The first try answers three questions. Does a two-for-one split show 0% change on the split day? Does a stock listed this year start both lines on its first day? Does the gap number match a hand count for one stock and one range? If the source gives unadjusted prices, adjust them in one place before anything is drawn.

## Asks
- [ ] 1. Type a ticker and press Enter to see it against the S&P 500 as percent change from the first shared day (evidence: screenshot at desktop and phone sizes).
- [ ] 2. The gap in percentage points shows above the chart for the chosen range (evidence: number matches a hand count on one stock, written in the test).
- [ ] 3. Ranges: 1 month, 1 year, 5 years and since listing (evidence: screenshot of each).
- [ ] 4. Proof: a two-for-one split shows 0% change on the split day, on 40 split cases, and the test goes red when the adjustment is removed (evidence: test output, both runs).
- [ ] 5. Proof: the gap number above the chart equals the gap at the right edge of the chart on 10 tickers, and the test goes red when the range is off by one day (evidence: test output, both runs).
- [ ] 6. Honest limit: the chart says dividends are not counted (evidence: screenshot of the note).
- [ ] 7. An unknown ticker gets a plain message and the last chart stays (evidence: screenshot).
- [ ] 8. Packaging: the research app README says how to open the chart (evidence: README line).
- [ ] 9. (stretch) A second index, the Nasdaq 100, behind a switch.

## Scope
In: one chart screen inside the existing research app, its data adjustment and its tests. Out: new data sources, accounts, alerts, dividends. Sizes: desktop and phone. A history longer than 30 years is cut to 30 and says so.

## Test material
- The app's cached prices for 10 tickers, read only. Copy them into a fixture before any test changes them.
- 40 split cases built by hand in a fixture, each with the expected percent change worked out by hand.

## Do not
- Draw raw prices on a shared axis.
- Add a paid data source or a second chart library.
- Change how the rest of the app stores prices.

## Assumptions
- "Any stock" means any ticker the app's price source knows.
- The S&P 500 is the index the app already caches.

## Must not break
Percent change across a split and from a shared start day. Kind: numbers.

## Properties
- State: for each ticker, a list of dated closes and the splits with their dates and ratios.
- Transitions: pick a start day, add or remove a ticker, change the range.
- Preconditions: a percent change needs a close on the start day for every ticker shown.
- Postconditions: every line starts at 0 percent on the shared start day, and a split changes no percent.
- Invariants: adjusting for a split twice gives the same series as once, and a longer range never changes an earlier percent.
- Liveness: a chart is drawn or a named reason is shown for every ticker and range, under a data source that answers.

## Moment
Type a ticker and both lines start at 0% on the same day, so the gap is the whole story.

## Judge focus
- Does a hand count of percent change across a two-for-one split match the chart?
- Pick a stock listed this year: where does each line start?
- Is the gap number above the chart the same as the gap at the right edge?
```
