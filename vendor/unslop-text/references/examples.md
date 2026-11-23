# Examples

Every pair comes from the eval set in `evals/`. Each "after" text passes `check` and scores under 3 slop. Read the pair for your profile and match its depth of change. Do not copy its wording.

## UI strings (`ui`)

```text
menu.play              Embark on Your Journey
                    -> Play
menu.credits           Meet the Talented Team Behind Emberfall
                    -> Credits
save.saved             Your progress has been successfully saved!
                    -> Game saved.
save.failed            Oops! Something went wrong while saving. Please try again later.
                    -> Could not save your game. Try again.
inventory.full         Inventory full! You cannot carry any more items.
                    -> Your inventory is full.
inventory.drop_confirm Are you sure you want to drop <b>{item}</b>? This action cannot be undone.
                    -> Drop <b>{item}</b>? You cannot undo this.
combat.damage_dealt    You unleash a devastating blow, dealing {damage} damage to {enemy}!
                    -> You strike {enemy} for {damage} damage.
shop.not_enough_gold   You don't have enough gold to purchase this item.
                    -> Not enough gold.
```

Labels shrank to the action or the name. A message says what happened and what to do. The placeholders and the `<b>` tag did not move. `You cannot undo this` stayed because it warns about a real consequence. Keys and untouched strings stayed byte for byte, because `apply` splices only the changed values.

Properties files work the same way:

```text
home.empty.body  It looks like you haven't added any photos yet. Tap the button below to get
                 started on your creative journey!
              -> Tap the button below to add some.
share.error      Oops! We encountered an unexpected error. Please try again later.
              -> Could not share your photo. Try again.
delete.confirm   Are you sure you want to delete this photo? This action is irreversible and
                 cannot be undone.
              -> Delete this photo? You cannot undo this.
```

## README and docs (`docs`)

```text
Before:
It's important to note that collision queries are not automatically cached. If you call
`map.collides(x, y)` hundreds of times per frame, it is highly recommended that you build a
collision grid first using `map.buildGrid()`.

After:
Tessera does not cache collision queries. If you call `map.collides(x, y)` hundreds of times
per frame, build a collision grid first with `map.buildGrid()`.
```

The run-up went. `highly recommended that you build` became the imperative. The code stayed in backticks.

```text
Before:
Tessera is not just another tile library — it's a comprehensive solution that seamlessly bridges
the gap between level design and runtime performance. Whether you're a seasoned game developer or
a hobbyist just getting started, Tessera empowers you to build stunning 2D worlds with ease.

After:
Tessera is a tile engine for 2D games. It loads maps made in Tiled and renders them at runtime, so
you design levels in the editor and use them as they are.
```

The original said nothing a reader could use. The edit took the plain facts from the rest of the same README: what the tool loads and what it does. When the file holds no such facts, cut the paragraph and flag the gap.

A procedure written as one long sentence became a warning and numbered steps:

```text
Before:
When a `429` response is received, the client should not retry immediately. Instead, the
`Retry-After` header, which contains the number of seconds that must elapse before another request
can be made, should be consulted, and the request should be retried only after that period of time
has elapsed; if the header is missing, an exponential backoff starting at 1 second and capped at
32 seconds is recommended.

After:
Warning: If you retry without a delay, Meridian may temporarily suspend your API key for up to 15
minutes.

When you get a `429` response, do not retry immediately.

1. Read the `Retry-After` header. It holds the number of seconds you must wait before the next request.
2. Retry only after that time has passed.
3. If the header is missing, use exponential backoff. We recommend starting at 1 second and capping at 32 seconds.
```

The warning moved before the steps. Numbers, header names and the hedge `may` survived.

## Articles (`article`)

```text
Before:
In today's fast-paced digital world, remote work has emerged as a transformative force that is
reshaping how organizations operate. It's not just a temporary response to a global crisis — it's a
fundamental shift in the way we think about productivity, collaboration, and work-life balance. In
this article, we'll explore the key trends, challenges, and opportunities that define this pivotal
moment.

After:
Remote work is reshaping how organizations operate. It began as a response to a global crisis, but
it did not stay temporary. It has changed how people think about productivity, collaboration and
work-life balance.
```

The run-up, the signpost sentence and the contrast frame went. Each claim that remained came from the source. The two closing sections ("Looking Ahead" and "Final Thoughts") merged into one section named for its content, and the slogan ending became a plain claim. The whole article lost 36% of its words, and every statistic, name and source stayed.

## Messages (`message`)

```text
Before:
Hi Dana,

I hope this email finds you well! Thank you so much for your patience and for reaching out about
the status of the Q3 migration. That's a great question, and I'm happy to provide a comprehensive
update.

To be clear, nothing has been lost or corrupted. No data. No downtime. Just a delay.

After:
Hi Dana,

Thanks for your patience, and for asking about the Q3 migration. Here's where it stands.

Nothing has been lost or corrupted, and there was no downtime. The only effect so far is a delay.
```

The greeting, one thank-you and the contractions stayed. A message should sound like a person. The praise for the question, the offer to help and the staccato triple went.

```text
Before:
Hi Daniel,

Thank you so much for reaching out to us, and I sincerely apologize for any inconvenience this
may have caused! I completely understand how frustrating it must be to be charged twice, and I
want to assure you that we take this matter very seriously.

I've taken a look at your account and I can see that two charges of $29.00 were made on March
3rd due to a temporary issue with our payment processor. Rest assured, the duplicate charge has
been refunded and you should see it back on your card within 5 to 7 business days.

In the meantime, please don't hesitate to reach out if you have any further questions or
concerns. We truly value your business and are committed to providing you with the best possible
experience.

Thank you again for your patience and understanding!

Warm regards,
Priya
Customer Success Team

After:
Hi Daniel,

Sorry about the double charge. I checked your account: two charges of $29.00 went through on
March 3rd because of a temporary issue with our payment processor. I refunded the duplicate. It
should be back on your card within 5 to 7 business days.

Reply to this email if you have questions.

Warm regards,
Priya
Customer Success Team
```

The thank-you, the empathy line, both assurances and the sales closer went. The apology became one short sentence. Every amount, date and period stayed, and so did the sign-off. The rewrite is 59% shorter, because most of the original was padding. `check` accepts it with a `shrank` warning. Read that warning and confirm that the cut text held no fact.

## Marketing (`marketing`)

```text
Before:
- **Enterprise-Grade Security:** Your data is protected by state-of-the-art encryption and
  SOC 2 Type II certified infrastructure.
All paid plans include a 14-day free trial. No credit card required. No hidden fees. Just results.

After:
- Security: Plover encrypts your data and runs on SOC 2 Type II certified infrastructure.
All paid plans include a 14-day free trial. You don't need a credit card, and there are no hidden
fees.
```

The claims with a fact stayed: the certification, the 14 days, the price table, the 12,000 teams. `Enterprise-Grade`, `state-of-the-art` and `Just results` went because nothing backs them. The call-to-action link did not change.

## Release notes (`docs`)

```text
Before:
We're thrilled to announce the release of Cairn 3.0, a landmark update that marks a pivotal moment
in the evolution of our build tool.
- **A more robust plugin system:** Plugins now run in isolated worker threads, ensuring that a
  misbehaving plugin can no longer crash the entire build (#1204).

After:
Cairn 3.0 makes rebuilds faster and isolates plugins from each other. It also drops support for
Node.js 16, so read the breaking changes before you upgrade.
- Plugin isolation: Plugins now run in isolated worker threads, so a misbehaving plugin can no
  longer crash the build (#1204).
```

The new first sentence sums up the file's own highlights and adds no claim. Issue numbers, versions and flags did not change.

## FAQs (`docs`)

```text
Before:
Great question! Resetting your password is a quick and straightforward process. Simply click the
"Forgot password?" link on the sign-in page, enter the email address associated with your account,
and we'll send you a reset link. The link is valid for 30 minutes. If you don't see the email, be
sure to check your spam folder. I hope this helps!

After:
Click "Forgot password?" on the sign-in page, enter the email address for your account, and we'll
send you a reset link. The link is valid for 30 minutes. If you don't see the email, check your
spam folder.
```

The answer starts with the answer. The quoted label, the 30 minutes and the spam-folder advice stayed.

## Fiction and lore (`narrative`)

```text
Before:
The Whispering Woods have stood for countless ages, a living tapestry of ancient magic and
forgotten secrets. It is not merely a forest — it is a memory, a promise, and a warning, all woven
into one.
...
This was not the end of her journey. It was only the beginning.

After:
The Whispering Woods have stood for longer than anyone can say, and they still hold old magic and
secrets nobody remembers. The forest is a memory, a promise and a warning.
```

The voice and the dialogue stayed. The `living tapestry`, the `not merely X, it is Y` frame and the closing slogan went. The slogan paragraph was cut, not replaced, because the story gave no real beat to put there. Report the cut.

The lint also flags `Elara Voss` and `Whispering Woods` as stock fantasy names. Keep them. Add a line to the report: `Stock names: Elara Voss, Whispering Woods. Say if you want alternatives.`

## Restraint: clean text

```text
The nightly build failed on Tuesday because I merged the lockfile change without running the
full suite. That's on me. The short version: `libpng` 1.6.43 pulled in a newer `zlib` than our
Windows runners had, and the linker complained about a missing symbol.
```

Lint: slop 0, clarity clear. The right answer is: `This text is already clean. I changed nothing.` The text has a person in it: a first-person admission, a real cause, a number. A rewrite would only remove those.

## Do not rewrite: legal text

```text
9.2. The Company's aggregate liability arising out of or relating to these Terms shall not exceed
the greater of (a) the amounts paid by you to the Company in the twelve (12) months preceding the
event giving rise to the claim, or (b) one hundred U.S. dollars (US$100).
```

Lint reports long sentences. The exact words are the product. The right answer is to leave the text as it is and say so. If the user wants a plain-language version, write it as a separate summary and label it as one.

## A report

```text
Unslopped the PR description. Profile docs, level standard.
Slop 43.3 -> 0. Clarity 5 -> 0. Words 171 -> 142 (-17%).
Check: passed. 2 warnings kept: "not just a performance improvement" became a plain sentence, and
"could potentially" became "could".
Changed: cut the opening claim and the sales words, dropped the bold labels, made passives active.
Needs your input: none.
Left alone: issue number, file path, test count, timings.
```
