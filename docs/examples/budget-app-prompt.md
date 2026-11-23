# What 100x does with a very bad prompt

The prompt was four words: `make me a budget app`. Below is the whole prompt 100x writes from it, saved as `.100x/project.md`. It was written by following the 100x skill and it passes `100x prompt check` ("12 written, 1 marked none, 9 asks"). Back to the [README](../../README.md).

Each part changes something the builder does. The rules say what to trade off. The asks carry a proof for each claim the stages cannot see for themselves. The hard test and the judge questions are the ones the second model presses on.

```markdown
# budget-app

## Brief
make me a budget app

## Goal
Build a budget app for one person that answers one question: how much can I still spend this month without going over? "Budget" here means a monthly limit per category plus the purchases entered against it. A coffee entered under Food lowers Food's remaining amount, and so does a refund that raises it back. It is not a bank connection, a net worth tracker or a bill splitter, and it shows no advice: it shows what is left.

## Read first
- `~/.100x/profile.md`, the repeat corrections. Placeholders get rejected, so the category icons and the empty states get real art.
- `100x registry list --all`, for earlier money prototypes. Take their Judge focus lines and reuse no code.
- The browser's Intl.NumberFormat page on MDN (not read, the core stage opens it). Look for how currency is rounded and shown, because money shown wrong is the first thing a user notices.

## Rules
- Whole cents, not floating point. Every amount is stored as an integer count of cents, and only the screen turns it into dollars. The limit is the display, which may round to a whole dollar for large totals and says so.
- What is left, not what was spent. The first number on the screen is the money remaining this month. The limit is the history page, where spending leads.
- One tap to add, not a form. Adding a purchase takes an amount, a category and Enter. The limit is editing an old purchase, which may open a form.
- Honest when over, not alarming. Going over a limit turns the number into a minus and a plain word, and never hides it. The limit is the total at the top, which never shows a warning color on its own.

## Riskiest unknown
The money left is wrong after a few edits. The first try answers three questions. Does adding, editing and deleting purchases always leave the remaining amount equal to the limit minus the sum of the purchases? Do cents survive a reload with no drift? Does a new month start clean without losing last month? If any answer is no, fix the storage before drawing anything more.

## Asks
- [ ] 1. A monthly limit per category, and a way to add a purchase against one, on a phone screen.
- [ ] 2. The screen opens on the money left this month, in total and per category.
- [ ] 3. Edit and delete a purchase, and the numbers follow at once.
- [ ] 4. A calm look with real art for each category, and an empty first screen that shows what to do next.
- [ ] 5. Proof, planted case. A test adds 3 purchases of 4.35, 12.10 and 0.05 against a limit of 50.00 and checks the remaining amount is 33.50 to the cent, worked out by hand inside the test.
- [ ] 6. Proof, drift. A test adds 1,000 random purchases, reloads and checks the remaining amount equals the limit minus the sum, with no cent lost.
- [ ] 7. Proof, new month. A test sets the clock to the first of next month and checks every category starts at its full limit and last month is still readable.
- [ ] 8. One command runs it. The README has a screenshot and the one line the app is about.
- [ ] 9. (stretch) A repeat purchase, such as rent, that adds itself each month.

## Scope
In: one person, six categories the user can rename, saving in the browser, a phone layout from 360 to 430 px wide that also works in a desktop window, US dollars. Out: accounts, bank links, cloud sync, other currencies, shared budgets. The settings screen says plainly that data lives in this browser only.

## Test material
none: no outside files are needed, because the tests run on fixed amounts and a fixed clock

## Do not
- Do not store or compute money as floating point, because 0.1 plus 0.2 is not 0.3 and the cents drift.
- Do not use the real clock in a test, because it would pass only on the right day of the month.
- Do not ask for a login, a bank, or any personal detail.
- Do not play sound while testing. Mute every browser you drive.

## Assumptions
- A web page that works well on a phone, not a store app, because the brief names no store.
- Monthly means the calendar month, because the brief gives no pay date.
- US dollars, because the brief names no currency, and the currency is one constant in one file.

## Must not break
Kind numbers. The money left equals the limit minus the sum of the purchases, to the cent, after any mix of adds, edits, deletes and reloads.

## Moment
You type 4.35 and Enter, and the money left for Food ticks down while the coffee slides into the list.

## Judge focus
- Does the money left after three purchases match a hand count to the cent?
- What does a new user do in the first 20 seconds with no help?
- Is any category icon a placeholder or an emoji?
- What does the screen show when a limit is exceeded, and is the minus honest?
- Does it work with a thumb on the smallest phone, with nothing clipped?

## Stack and run
(set once the first version exists)

## Modifiers
none

## Pre-flight
(sent at the start of the run)
```
