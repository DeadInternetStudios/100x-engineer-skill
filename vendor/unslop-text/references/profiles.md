# Surface profiles

A profile says what the text is for. It sets sentence limits, which rules count and how hard, and what "good" looks like. Pick one before you rewrite. The same sentence can be right in one profile and wrong in another.

`lint --profile auto` guesses from the file type and shape. Do not trust the guess for marketing pages or for text pasted into chat. Set `--profile` yourself.

## Limits

Words per sentence. "Target" is where the lint starts to warn. "Hard" is where it counts a full finding. Instructions are sentences that start with a verb.

| Profile | Instructions (target / hard) | Descriptions (target / hard) | Sentences per paragraph |
|---|---|---|---|
| `ui` | 12 / 18 | 14 / 22 | 3 |
| `docs` | 22 / 28 | 27 / 34 | 6 |
| `article` | 30 / 40 | 32 / 42 | 7 |
| `message` | 24 / 32 | 28 / 36 | 6 |
| `marketing` | 20 / 28 | 24 / 32 | 5 |
| `narrative` | no limit | no limit | no limit |

Level `light` multiplies the sentence limits by 1.3. Level `strict` caps instructions at 20 words and descriptions at 25, except for `narrative`.

## ui: buttons, labels, tooltips, errors, dialogs

**Goal:** the shortest string that tells the user what this is or what to do.

- Labels and buttons: one to three words, no final period. Buttons name the action: "Save", "Delete save", "Send".
- Follow the existing capitalization of the product. If the product mixes styles, choose the majority and report it.
- Errors: what failed, then what to do. No apology, no "Oops", no "something went wrong".
- Confirmations: ask about the object and name the consequence. Buttons repeat the verb.
- Empty states: say what is missing, then the one action that fills it.
- Tooltips: eight words or fewer when you can.
- Progress and status: "Saving…", "Saved".
- Keep placeholders, markup tags, keys and line breaks exactly as they are.
- Do not make a string longer. Layouts and translations depend on length. The check warns above 30% growth for one string.

```text
Embark on Your Journey                      ->  Play
Oops! Something went wrong while saving.    ->  Could not save your game. Try again.
Your progress has been successfully saved!  ->  Game saved.
Are you sure you want to drop <b>{item}</b>? This action cannot be undone.
                                            ->  Drop <b>{item}</b>? You cannot undo this.
```

Details and the file workflow are in `ui-strings.md`.

## docs: README, guides, API docs, release notes, help articles

**Goal:** a reader can find the answer and do the next step.

- Lead with what the thing is or does, in one plain sentence. No mission statement.
- Procedures: numbered steps, imperative, one action each. Warnings come before the step.
- Descriptions: present tense, name the actor, say what happens.
- Keep every code block, command, flag, path, version, number and link exactly. These are the most valuable parts of the page.
- Do not add sections. Do not add a summary at the end. Cut "In this guide you will learn".
- Headings say what the section holds. Sentence case unless the doc already uses Title Case.
- Tables stay tables. Lists stay lists, unless a list holds reasoning that reads better as a paragraph.
- Release notes: say what changed and what the user must do. Keep issue numbers.

```text
This guide will walk you through the process of installing the library.
                                            ->  Install the library:
```

## article: essays, blog posts, reports, newsletters

**Goal:** the author's argument, at the author's pace, with the filler removed.

- Keep the author's voice, opinions, jokes and structure. Do not flatten them.
- Replace claims of importance with the thing that is important. `A pivotal moment` becomes what happened.
- Concrete beats general: a name, a number, an example, a place.
- Cut the opening that frames the topic (`In today's fast-paced world`) and the closing that restates it.
- Allow long sentences when they carry a chain of reasoning. Break up the ones that carry three unrelated ideas.
- Headings: cut generic ones ("Key Takeaways", "Conclusion").
- If the source states nothing specific, shorten the passage and add a `needs detail` flag in your report. Do not make up a statistic.

## message: email, chat, PR descriptions, comments, commit messages, replies

**Goal:** the reader knows what you want, or what happened, in the first two lines.

- Lead with the ask or the point. Greeting, then substance.
- One request per paragraph. Dates, times, names and numbers exactly as written.
- Say thanks once, if at all. Delete `I hope this finds you well` and `Please do not hesitate to reach out`.
- Support replies: say what happened, what you did and what happens next, with the dates and amounts. One short, specific apology. Cut `rest assured`, `we take this seriously` and `we value your business`.
- Cover letters and bios: replace each trait with something the writer did: the number, the name, the result. Cut `proven track record`, `team player` and `passionate about`. Keep every fact and the contact details.
- Keep the sender's level of formality. A note to a friend stays warm. A note to a customer stays polite.
- PR descriptions: what changed, why, how it was tested. Keep issue numbers, file paths and measurements.
- Commit messages: imperative subject under 72 characters. No "This commit".

## marketing: landing pages, store pages, app descriptions

**Goal:** a visitor learns what the product does and why to pick it, with a reason to believe it.

- Replace each adjective with a fact: "Fast" becomes "Starts in 2 seconds".
- If the page has no fact for a claim, cut the claim or write `needs a number` in the report. Do not invent one.
- Keep product names, prices, plan names, legal lines, required claims and quoted testimonials as they are.
- A slogan belongs to the brand. Rewrite it only when the user asks, or flag it.
- Verbs over nouns. Say what the user can do.
- Contractions are fine. A warm, direct voice is the goal.

## narrative: fiction, dialogue, lore, flavor text, speeches

**Goal:** remove stock habits, keep the voice. Narrative text gets the tell pass but not the clarity pass.

- Do not shorten sentences to a limit. Long sentences are part of the style.
- Remove the stock phrases (`fiction-cliche`) and the stock habits: "not X but Y", the one-line closer, the invented "whisper of ancient magic".
- Keep names, places, invented words and the world's rules exactly.
- Dialogue stays in the speaker's voice. Fix tells in the narration around it.
- If the text is already specific and strange, leave it alone.

## Which profile when

| Text | Profile |
|---|---|
| Button, label, toast, error, dialog, tooltip, menu, loading tip | `ui` |
| README, how-to, API reference, changelog, FAQ, help page | `docs` |
| Blog post, essay, report, newsletter | `article` |
| Email, Slack message, PR text, issue comment, commit message | `message` |
| Landing page, app store text, product description, ad copy | `marketing` |
| Story, quest text, NPC dialogue, item lore, speech | `narrative` |

Mixed files are common. A game's quest log has `ui` labels and `narrative` descriptions. Run the profiles separately on the parts, and say so in your report.
