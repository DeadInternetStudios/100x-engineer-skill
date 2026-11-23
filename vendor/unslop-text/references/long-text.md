# Long text and many files

Read this when the text is longer than about 1,500 words, or when you edit a folder of documents.

Two problems show up at length. The voice drifts: chunk 9 stops sounding like chunk 1. And you cannot hold the whole text in mind, so you lose facts. The workflow below deals with both.

## The workflow

1. **Save the originals.** `node scripts/unslop.mjs begin docs/` (or a single file).
2. **Plan.** `node scripts/unslop.mjs plan docs/guide.md --profile docs`. The table lists chunks with line ranges, word counts, scores and the section name. Work from the worst score down when the user did not ask for the whole text.
3. **Write a voice sheet** before you edit. Read the headings and three paragraphs from different parts of the text. Run `node scripts/unslop.mjs voice <file>` for the numbers: rhythm, contractions, person, questions and recurring terms. Then write `.unslop/voice.md`. Use the template below, and fill the lines the numbers cover from the output.
4. **List the claims before you edit a chunk.** `node scripts/unslop.mjs claims <chunk or file>` prints every sentence as a checklist line with its line number and tags (number, cause, condition, obligation, comparison, name). The tags are hints. Read the tagged lines first: they are the ones a rewrite loses.
5. **Rewrite chunk by chunk, in document order.** Read the chunk's line range. Edit in place with small exact replacements. Do not rewrite the whole file in one write. A whole-file write loses things silently, and `check` cannot catch a paraphrase that drifted.
6. **Keep the seams.** Before each chunk, re-read the last paragraph of the one before. A transition that pointed to the old wording must still make sense.
7. **Check as you go.** After every few chunks run `node scripts/unslop.mjs check` against the saved original (`.unslop/main/files/<path>`), or run `finish` for the set. Fix errors now. They are cheaper to fix while the chunk is fresh. Then run `node scripts/unslop.mjs diff <saved original> <file>` to read the sentences that changed side by side, and `node scripts/unslop.mjs claims <saved original> <file>`. It lists each sentence of the original that the rewrite no longer says (cut), each one that survives only as a loose paraphrase (replaced) and each sentence of the rewrite with no source (added). Tick or explain every tagged one. A cut that holds a rule or a reason needs a reason of its own in the report. An added sentence goes unless the original says it.
8. **Do a consistency pass.** Search for the terms in the voice sheet. Look for the same opening phrase in several sections and for headings that changed style. Compare the first and last chunks for tone.
9. **Re-read the opening and the closing paragraphs.** Readers judge a text by them.
10. **Finish.** `node scripts/unslop.mjs finish`. Report the scores and any `needs detail` gaps.

## Voice sheet template

```text
Voice sheet: <title>

Reader:         <who, and what they already know>
Register:       <formal, neutral, friendly, playful>
Person:         "you" for the reader. "we" only for <who>.
Contractions:   yes / no / only in <where>
Terms:          <one spelling and one meaning for each product term>
Rhythm:         <e.g. mostly 10 to 20 words. Occasional long sentence for reasoning.>
Keep:           <opinions, jokes, quotes, examples the author put in on purpose>
Do not touch:   <code, tables, legal text, quotes, names>
Style guide:    <link or rules, if the project has one. They win over this sheet.>
```

## Drift: the failure to watch

After five or six chunks, rewrites tend to get shorter and more even. Sentences settle at 10 to 14 words. Paragraphs become uniform. The text starts to sound like a manual.

- Run `lint` on the file now and then. A `uniform-rhythm` finding is the signal.
- Re-read a paragraph from the middle with fresh eyes. Would you believe one person wrote it, start to end?
- Let some sentences run long when they hold a real argument. Let some be a fragment.

## Repeated structures

API references, changelogs and FAQs repeat one shape: name, what it does, parameters, example. Decide the shape of one entry. Then apply it to all of them, so a reader can scan. Do not vary the wording for variety. Variety in a repeated structure is a defect.

## Shrinkage

A tell-heavy text can lose a third or more: the reference rewrites in `evals/inputs` lose 17 to 59% of their words (median 38%), and a plain text loses almost nothing. If more than half goes, `check` warns with `shrank`. If you cut a lot, confirm that each cut was filler and not content. Never cut a fact to make a text shorter.

## Very long texts

Do not try to rewrite a book in one session unless the user asked for it. Do the chunks with the worst scores first. Report which chunks you finished and which you left. Offer to continue.

## Several files

`begin` takes a directory. `finish` checks every saved file against its original and prints one table with a status per file: `PASS`, `WARN`, `FAIL`, `UNCHANGED` or `MISSING`. Use `restore <file>` to undo a file that you cannot fix.

Files in one folder share terms. Write one voice sheet for the folder, not one per file.

## Do not parallelize by default

If the host agent offers subagents, it is tempting to give each one a chunk. Edits to line ranges of one file shift the lines for everyone else. Work sequentially. If the files are independent, one subagent per file is safe. Give each the voice sheet, the rules in `SKILL.md`, and the file path. Run `finish` yourself at the end.
