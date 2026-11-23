# Bad rewrites, and what `check` says about each

Each case is a rewrite that looks fine at a glance. The first twelve are ones `check` flags, and the last two are ones it cannot, so a reader has to. `npm test` runs every case through `check` and fails if the verdict changes, so this page stays true.

Read these before you hand a rewrite back. A rewrite that passes `check` can still contain the last two kinds of mistake, and a flag is a warning to read, not a proof.

## 1. The invented example

**Why it is wrong:** The rewrite explains with an example the author never gave. The reader now believes the author said it.
**Check:** `example-added`, `sentence-added`

```text original
Rotate your API key every 12 months.
```

```text rewrite
Rotate your API key every 12 months. For example, a key made in January should be replaced the next January.
```

## 2. The claim nobody made

**Why it is wrong:** No "for example" gives it away. The sentence sounds like the rest of the text, but nothing in the original says it. Padding and praise are the usual forms.
**Check:** `sentence-added`

```text original
The export job runs every night at 2:00. It writes one file per customer to the shared bucket.
```

```text rewrite
The export job runs every night at 2:00. It writes one file per customer to the shared bucket. Customers say it saves them hours every week.
```

## 3. A number that moved

**Why it is wrong:** "Plain" is not a reason to round, convert or tidy a figure. 30 days and 60 days are different promises.
**Check:** `number-missing`, `number-added`

```text original
Deleted workspaces stay recoverable for 30 days. After that, the backups rotate out.
```

```text rewrite
Deleted workspaces stay recoverable for 60 days. After that, the backups rotate out.
```

## 4. The "never" that got dropped

**Why it is wrong:** Short rewrites love to drop a negation, and the sentence still reads smoothly. This one now tells the reader to do the dangerous thing.
**Check:** `negation-dropped`

```text original
Never commit the key to the repository. Store it in the secrets manager instead.
```

```text rewrite
Commit the key to the repository. Store it in the secrets manager as well.
```

## 5. The hedge that went

**Why it is wrong:** "May take up to an hour" admits that the time varies. "Appears within an hour" promises it. When the author was unsure, the rewrite must stay unsure.
**Check:** `hedges-removed`

```text original
The change may take up to an hour to appear in the dashboard.
```

```text rewrite
The change appears in the dashboard within an hour.
```

## 6. The reason that was cut

**Why it is wrong:** The first sentence gives the rule and the reason. Cutting it as "wordy" removes the one sentence that tells the reader why to bother.
**Check:** `claim-cut`

```text original
Rotate the key before it expires, because an expired key locks the whole account. Keys last 90 days.
```

```text rewrite
Keys last 90 days.
```

## 7. A person turned into a form letter

**Why it is wrong:** Every fact is still there, and the voice is gone. The rewrite spells out every contraction and turns each question into a statement. The author sounds like a notice board.
**Profile:** message
**Check:** `voice-contractions`, `voice-questions`

```text original
I don't know why it's slow, and I can't promise a fix today. Did the cache change? Is the disk full? We'll keep looking, and I'm sure we'll find it.
```

```text rewrite
I do not know why it is slow, and I can not promise a fix today. Did the cache change. Is the disk full. We will keep looking, and I am sure we will find it.
```

## 8. One stock phrase for another

**Why it is wrong:** One stock opener became another, and one hype noun became another hype noun. The tells are the same, in new words.
**Check:** `slop-remains`

```text original
It's worth noting that the new plan is a game-changer for teams that ship every week.
```

```text rewrite
It is important to note that the new plan is a pivotal shift for teams that ship every week.
```

## 9. Short because it dropped content

**Why it is wrong:** The rewrite is as plain as it gets, because it says almost nothing. The log file, the month-end review and the summary message are gone.
**Check:** `shrank`, `claim-cut`

```text original
The importer reads each row of the spreadsheet, checks the date in column B against the billing calendar, and skips rows that are older than the current period. It writes the skipped rows to a log file so that finance can review them at the end of the month. It then sends one summary message to the finance channel.
```

```text rewrite
The importer reads the spreadsheet.
```

## 10. A name that changed by a letter

**Why it is wrong:** The rewrite misspells the product name twice, and the support instruction now points at nobody.
**Check:** `entity-missing`

```text original
Meridian signs every request with the shared secret. Contact Meridian support if signing fails.
```

```text rewrite
Meridan signs every request with the shared secret. Contact Meridan support if signing fails.
```

## 11. The permission swapped

**Why it is wrong:** Every word is still there, and so is the one "may". But the duty and the permission traded places: now managers may approve the large refunds and interns must approve the small ones. No number or name moved.
**Check:** `modal-changed`

```text original
Managers must approve refunds over $500. Interns may approve refunds up to $100.
```

```text rewrite
Managers may approve refunds over $500. Interns must approve refunds up to $100.
```

## 12. Before became after

**Why it is wrong:** One word changed the order of two jobs. Every word in the rewrite is also in the original, so only a check that knows "before" and "after" are opposites can see the difference.
**Check:** `opposite-word`

```text original
The job runs before the backup starts.
```

```text rewrite
The job runs after the backup starts.
```

## 13. The roles swapped

**Why it is wrong:** The same words, in the other order. Now members can delete projects and admins can only look at them. `check` sees a swap of names, numbers, code, placeholders, URLs and emails. It does not see two role words that trade places, because they are ordinary words.
**Check:** nothing

```text original
The admin can delete projects. The member can only view them.
```

```text rewrite
The member can delete projects. The admin can only view them.
```

## 14. The environment swapped

**Why it is wrong:** "Staging" and "production" are opposites only inside this team. `check` has a short list of words that say the opposite of each other, and these two are not on it. Test runs now use the live key.
**Check:** nothing

```text original
Use the staging key for test runs.
```

```text rewrite
Use the production key for test runs.
```

## What to do about the last two

Cases 13 and 14 are why the skill asks for a read-through after `check` passes. Run `unslop claims <before> <after>` on a long text. It lists every sentence of the original that the rewrite no longer says in the same words, so a reader checks those first.
