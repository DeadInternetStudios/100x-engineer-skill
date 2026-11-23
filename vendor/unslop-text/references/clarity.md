# Clarity: STE style at 80%

Read this when you do the clarity pass (levels `standard` and `strict`). Also read it when a text has no tells but is still hard to read.

## What this borrows

ASD-STE100 (Simplified Technical English) is a controlled English for aircraft maintenance manuals. It has two parts: writing rules for sentences, and a dictionary of approved words with one meaning each.

This skill takes the writing rules and the dictionary's best idea: one word, one meaning.

It drops the approved-word list and the aerospace limits. Andrej Karpathy's tip was to ask for "80% of the way to ASD-STE100", because the full spec is stiff. Level `standard` does that. Say "STE style" in your report. Never say a text is "STE compliant". That needs the official dictionary and a checker.

## Levels

| Level | Use it for | What changes |
|---|---|---|
| `light` | Text that is mostly fine, or an author who wants a gentle touch | Remove tells. Fix only sentences that are clearly too long. No restructuring. |
| `standard` | Default. Docs, UI, messages, articles, marketing | Remove tells and apply the rules below. |
| `strict` | Procedures, safety text, text for non-native readers or translation | Standard plus hard caps (20 words for instructions, 25 for descriptions), only can, must and will as modals, no semicolons. |

`narrative` text gets no clarity pass at any level. See `profiles.md`.

## The rules

Limits for each profile are in `profiles.md`. The numbers below are for `docs` at `standard`.

| # | Rule | Standard | Strict |
|---|---|---|---|
| 1 | One idea per sentence | Two linked facts joined by "and" or "because" are fine | One idea |
| 2 | Sentence length | Instructions up to 22 words, descriptions up to 27 | 20 and 25 |
| 3 | Paragraphs | Up to 6 sentences, one topic, topic sentence first | Up to 6 |
| 4 | Active voice | Name the actor. Passive is fine when the actor is unknown or does not matter | Same |
| 5 | Instructions | Imperative mood, one action per sentence, in the order the reader does them | Same |
| 6 | Warnings | Put them before the step. Say what goes wrong if the reader ignores them | Same |
| 7 | Small words | Keep "the", "a" and "that". Fragments are fine in labels, table cells and headings | Same |
| 8 | Word choice | Plain words. One name per thing in the whole text | Same |
| 9 | Tenses | Simple present, past and future. Avoid perfect and progressive forms when a simple form works | Same |
| 10 | Noun clusters | Three words at most. "Database connection timeout value" becomes "the timeout for the database connection" | Same |
| 11 | Lists | Three or more parallel items or steps go in a list. Do not bulletize narrative | Same |
| 12 | Clause chaining | Two sentences instead of a semicolon or a dash | No semicolons |
| 13 | Modals | "may", "might" and "should" stay when the doubt is real | Only can, must, will |
| 14 | Figures of speech | Say the literal thing. Idioms and business clichés go | Same |

## What the last 20% keeps

The 20% is what stops the text from sounding like a manual.

- **Real hedges.** If the source says "may", the writer was not sure. Keep it.
- **Contractions** in UI, messages, marketing and articles. Docs may use either. Use "do not" in warnings, so the word is easy to find and read.
- **Fragments** in UI labels, table cells, headings and the occasional deliberate beat.
- **Rhythm.** Mix sentence lengths. A text where every sentence has 10 to 14 words sounds like a drumbeat, and the lint flags it (`uniform-rhythm`). Let one sentence run to 25 words when it carries a real chain of reasoning.
- **Natural vocabulary.** "About" is fine for "approximately". "Let" is fine for "allow".
- **Opinions and voice** the author put there on purpose.

## Failure modes

These are the ways a clarity pass goes wrong.

| Failure | Looks like | Fix |
|---|---|---|
| Metronome | Every sentence is short and about the same length | Join two short sentences. Keep one longer one |
| Lost connectives | "The build failed. The cache was stale." (the "because" is gone) | Keep the word that links the facts |
| Lost hedges | "may fail" became "fails" | Restore it. `check` warns with `hedges-removed` |
| Lost negation | "Do not retry" became "Retry" | Restore it. `check` warns with `negation-dropped` |
| Over-splitting | One sentence with a real argument becomes five fragments | Keep the argument together |
| Talking down | Explaining what the reader already knows, adding steps | Cut it |
| Noun-cluster repair that makes it longer | Three "of the" phrases in a row | Choose a better noun, or keep the cluster if it is the product's term |
| Bulleting everything | A paragraph of reasoning becomes a list | Lists are for parallel items, not for reasoning |

## A worked pass

Original (docs, 54 words):

```text
In order to ensure that the configuration is properly applied, it is recommended that users restart the service after modifications have been made, as failure to do so may potentially result in the previous settings continuing to be used.
```

Pass 1 removes the tells: the wordy opener, the recommendation frame and the stacked hedge.

Pass 2 applies the rules: active voice, imperative, reason in its own clause.

```text
Restart the service after you change the configuration. If you do not, it may keep using the old settings.
```

The "may" stays because the source was not certain. The facts are the same: restart, after a change, or the old settings may stay.

## Procedures and descriptions

Treat them differently.

- **Procedure text** tells the reader to act. Use the imperative. One action per sentence. Number the steps. Put warnings before the step.
- **Descriptive text** tells the reader how something works. Use the present tense. Name the actor. Say what the thing does, then why.

A single paragraph that mixes both is hard to follow. Split it at the point where the reader moves from learning to doing.

## Plain words

Run `node scripts/unslop.mjs words` for the swap tables. They cover heavy words, wordy phrases, nouns that hide verbs and idioms. Swaps are a floor, not a method. If a sentence is empty, a better word does not help. Cut it.
