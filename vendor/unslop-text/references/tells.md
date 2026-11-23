# Tells: stock phrases and padding patterns, and how to fix them

Read this when a text scores `heavy` or `severe`. Also read it when lint reports a rule you do not know, or when you review text by hand.

## Why the patterns exist

A language model writes the most likely next words. The most likely text is average text. Specific facts are rare. So the model fills the gap with phrases that are safe anywhere: a claim of importance, a balanced contrast, a tidy group of three, a closing summary.

Two things follow.

1. **The tells are patterns, not words.** Favorite words change with each model release. A text can avoid every word on a list and still read as padded.
2. **The fix is always the same.** Put back the specific thing. If the source has no specific thing, the sentence is empty. Cut it and flag the gap. Do not invent a fact to fill it.

## How to read the scores

`lint` gives two scores per 1,000 words. Short texts count as 300 words, so one hit in a short UI string does not look severe.

| Score | Bands |
|---|---|
| Slop (tells) | clean at 3 or less, light at 8 or less, heavy at 18 or less, severe above 18 |
| Clarity (sentence structure) | clear at 15 or less, fair at 35 or less, dense above 35 |

`lint` and `check` also print **burstiness**: how much sentence length varies, as the spread of the lengths divided by their mean. 0 means every sentence has the same length. `check` warns with `metronome` when it falls below 0.3 in a text of 10 or more sentences.

For calibration: 112 chapters of the Rust book have a median slop score of 1.6. One tell alone says little. Three different kinds of tell in one paragraph usually mean the paragraph is padded.

## Staging: the text performs a point instead of making it

<!-- unslop:off -->

| Tell | Rule | Looks like | Fix |
|---|---|---|---|
| Not X but Y | `negative-parallelism` | "It's not just a tool, it's a platform." "No setup, no fuss, just results." | State Y. |
| Corrective framing | `corrective-framing` | "This should be treated as a signal rather than a verdict." "That does not by itself establish a cause." | State the claim. Drop the objection nobody raised. |
| Staged run-up | `staged-runup` | "Here's the thing:" "Let's dive in." "It's important to note that" | Start with the point. |
| Arguing with no one | `arguing-with-no-one` | "You might think this is expensive. It's not." | Delete, unless a real person said it. |
| One-line closer | `one-line-closer`, `contrast-closer` | A paragraph ends: "That's the real power." "And that changes everything." | Cut it, or move the fact into the paragraph. |
| Profound saying | `profound-saying` | "Growth isn't a destination, it's a journey." | Cut it. |
| Staccato | `staccato` | "It's fast. It's simple. It just works." | One sentence with the fact: "It starts in 2 seconds." |
| Forced triad | `triad` | "fast, reliable, and scalable" | Keep the items that have evidence. |

<!-- unslop:on -->

## Inflation: importance and polish without content

<!-- unslop:off -->

| Tell | Rule | Looks like | Fix |
|---|---|---|---|
| Inflated significance | `inflated-significance` | "stands as a testament to", "plays a pivotal role in", "a rich tapestry of" | Say what happened. |
| Vague association | `vague-association` | "highlighting its deep connection to the region's heritage" | Name the connection, or delete the clause. |
| Trailing -ing clause | `ing-rider` | "The update ships Friday, ensuring a seamless experience." | Split it or delete it. |
| Sales language | `sales-language` | "powerful, seamless, world-class, game-changing" | Replace with a number or an example. |
| Unnamed authority | `borrowed-authority` | "Experts agree." "Studies show." | Name the source or delete. |
| Avoiding "is" and "has" | `avoid-copula` | "serves as", "boasts", "features", "stands as" | Use "is" or "has". |
| Stacked hedges | `stacked-hedges` | "could potentially, in some cases, possibly" | Keep one honest hedge. |
| Stock vocabulary | `stock-vocabulary` | A cluster such as "robust", "leverage", "foster", "landscape" in one paragraph | Replace each with the plain word. One alone is not a tell. |

<!-- unslop:on -->

## Structure and format

<!-- unslop:off -->

| Tell | Rule | Looks like | Fix |
|---|---|---|---|
| Even rhythm | `uniform-rhythm`, `punctuation-monotony` | Every sentence has 10 to 14 words and only commas and periods | Vary the length. Add the occasional colon, parenthesis or question where a person would. |
| Lists for prose | `list-overuse` | A paragraph of reasoning split into bullets | Write it as a paragraph. |
| Bold as decoration | `bold-decoration` | Bold on every key phrase | Keep bold for labels and warnings. |
| Emoji as decoration | `emoji-decoration` | A rocket before every heading | Remove. |
| Heading problems | `heading-case`, `heading-generic`, `heading-echo` | "Key Takeaways", "Conclusion", a first line that repeats the heading | Use a heading that says what the section holds. Delete the echo. |
| Text about the text | `meta-text` | "In this section we will explore." "The table below shows." | Say the thing. |
| Summary closer | `ending-summary` | "In conclusion, ..." "Overall, ..." | Delete, unless the text is long and the reader needs it. |
| Dashes as joints | `dashes` | An em dash in most sentences, or a spaced hyphen at half the weight. Not counted: `--` and a spaced en dash, which people type and models rarely write, the first dash after a label in a list entry (`name - description`), and a dash alone in a table cell. A bold label followed by an em dash is counted | Use a period, a comma or a colon. |
| Exclamations | `exclamation-density` | "Great news!" in every paragraph | Keep them for real celebration. |
| Same opening word | `repeated-openings` | Three sentences in a row start with "This" | Reorder. |

<!-- unslop:on -->

## Residue from the chat window

<!-- unslop:off -->

| Tell | Rule | Looks like | Fix |
|---|---|---|---|
| Chatbot residue | `chatbot-residue` | "Great question!" "I hope this helps." "Let me know if you need anything else." | Delete. |
| Knowledge limit | `knowledge-limit` | "As of my last update", "based on available information" | Delete. State the date if it matters. |
| Template leftover | `template-leftover` | "[Your Name]", "INSERT LINK", "{{company}}" | Do not guess. Flag it to the user. |

<!-- unslop:on -->

## Boilerplate: stock lines people and models both write

<!-- unslop:off -->

| Tell | Rule | Looks like | Fix |
|---|---|---|---|
| Courtesy and service boilerplate | `courtesy-padding` | "Thank you so much for reaching out." "We sincerely apologize for any inconvenience this may have caused." "I completely understand how frustrating this must be." "Rest assured." "We take this matter very seriously." "If you have any further questions" | Keep one thank-you and one specific apology. Say what happened and what you did. Cut the rest. |
| Stock self-description | `self-promotion` | "a proven track record", "a strong communicator and team player who thrives in fast-paced environments", "a valuable addition to your team", "my enthusiastic interest" | Say what you did, with the number and the name. Cut the trait. |

<!-- unslop:on -->

A strong phrase counts alone. A mild one, such as "Thanks for your patience", counts only when another mild phrase appears in the same text. A person who writes one is polite. Two in a short text is padding. A specific apology (`I apologize for the delay`) is not boilerplate.

## Surface-specific

<!-- unslop:off -->

| Tell | Rule | Looks like | Fix |
|---|---|---|---|
| Fluff in an interface | `ui-fluff` | "Embark on Your Journey" on a Play button | Use the plain action: "Play". |
| Vague error | `ui-vague-error` | "Oops! Something went wrong." | Say what failed and what to do. |
| Empty link text | `click-here` | "Click here" | Make the link text name the target. |
| Fiction cliché | `fiction-cliche` | "a shiver ran down her spine", "little did he know" | Write the specific image. |

<!-- unslop:on -->

## Vocabulary drift

The words in the table come from public lists of overused model phrasing, such as Wikipedia's "Signs of AI writing". Each model generation changes the list. Treat the table as examples, not a word list.

<!-- unslop:off -->

| Period | Words and habits reported |
|---|---|
| 2023 to 2024 | delve, tapestry, testament, pivotal, intricate, meticulous, vibrant, showcase, underscore, landscape, realm |
| 2024 to 2025 | align with, enhance, foster, highlight, showcase, crucial, leverage, seamless |
| Mid 2026 | challenge, clearer, dependable, practical, steady, quietly, matters, prioritize, together with short, even, comma-and-period sentences and corrective framing |

<!-- unslop:on -->

The lesson of the last row: newer models avoid the old flagged words and show other patterns. A rewrite that swaps `delve` for `explore` has not fixed anything.

## What is not a tell

Leave these alone. A text with all of them scrubbed out reads flat.

- Contractions, curly quotes, and dashes used sparingly by a person.
- "Let's walk through" in a tutorial. That is the genre.
- Words such as `robust` in engineering text, where they have a defined meaning. One occurrence is not a cluster.
- Short sentences in a UI. Short is the goal there.
- Bold labels at the start of list items in docs.
- Title Case headings, if the style guide asks for it. The lint weights them lightly.
- Qualifiers and hedges the author chose: "very", "perhaps", "tends to". They show the author was unsure, so keep them.
- Plain, even slightly clumsy sentences that carry a specific fact.
