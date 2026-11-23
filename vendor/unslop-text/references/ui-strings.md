# UI strings: games and apps

Read this when the text is a set of short strings. Examples: a localization file, a string table, a list of labels, or a handful pasted from a design doc.

Supported files: JSON (including `.arb`, FormatJS and Chrome extension message files, comments and trailing commas), Xcode string catalogs (`.xcstrings`), `.properties`, Apple `.strings`, CSV and TSV sheets, Android `strings.xml`, and plain text with one string per line (`--format lines`).

## The workflow

1. **Save the originals.** `node scripts/unslop.mjs begin strings/en.json`
2. **Audit.** `node scripts/unslop.mjs audit strings/en.json`. It reports mixed capitalization, mixed final periods, two words for one action ("Quit" and "Exit"), mixed placeholder styles, long strings and near-duplicates.
3. **Write a wording sheet** from what the audit found. Use the template at the end of this file. Decide once, then apply everywhere.
4. **Export a batch.** `node scripts/unslop.mjs strings strings/en.json --limit 80 --out .unslop/batch-1.json`. Use `--offset 80` for the next batch. The export holds only text that looks like UI copy. Asset paths, ids and numbers stay out.
5. **Edit the values.** Keep each key. Delete the keys you do not change. `apply` touches only the keys that are in the file.
6. **Dry run.** `node scripts/unslop.mjs apply strings/en.json .unslop/batch-1.json`. Read the check. Fix every error.
7. **Write.** Add `--write`. The file keeps its comments, layout and every string you did not edit.
8. **Repeat** for each batch. Then run `audit` again and `finish`.

`apply` refuses to write when the check finds an error. `--force` overrides that. Use it only when you can explain the error.

## CSV and TSV sheets

Engines and translation tools often keep strings in a sheet: one row per string, one column per language, and a header row such as `keys,en,es,ja`.

- **The text column.** The tool reads it from the header. It tries `en`, `english`, `text_en` and `Text (EN)` first, then `source`, `original` and `default`, then a plain `text`, `message` or `value`. When it cannot tell, the command stops and lists the columns. Choose one with `--column <name or number>`, counting from 1. Pass the same flag to `begin`, `strings`, `apply` and `check`. `finish` remembers the one you gave to `begin`.
- **The key.** A column named `key`, `id`, `name` or `term`, otherwise the first column.
- **Every other cell is locked.** The other languages, notes, ids, delimiter, row order and the quoting of cells you do not edit stay as they are. `check` fails with `structure-changed` when any of them moves.
- **Quoting.** Write each new value as plain text in the edit file. `apply` quotes it when it holds a comma, a quote or a line break, and doubles the inner quotes.
- **Limits.** The first row is always the header. A sheet that escapes quotes with a backslash is refused with the line number. Fix the quoting first.

## Xcode string catalogs

A `.xcstrings` file is JSON that holds every language of every string. The tool offers only the text in the catalog's source language.

- **What you can edit.** The value under `localizations.<source language>`, including plural, device and substitution variants. The export names them `settings.title` and `items.count[plural.other]`.
- **What is locked.** Translator comments, review states, `extractionState` and every other language. `check` fails with `locked-string-changed` when one moves. The phrase sets in an App Shortcuts catalog (`stringSet`) hold alternatives on purpose, so the tool leaves them alone too.
- **Keys that hold the text.** In many catalogs the key is the English text, and the source language has no entry. There is nothing to edit, and `strings` says so. A key can only change together with the code that uses it. Give the user the rewrites as a list of old and new text, and let them change the code.

## Android strings.xml

A file with a `<resources>` root is read as Android strings. The tool offers each `<string>`, each `<item>` of a `<plurals>` (`items[one]`, `items[other]`) and each `<item>` of a `<string-array>` (`tips[0]`, `tips[1]`).

- **Raw text.** A value is the text between the tags, written as the file writes it: `Don\'t`, `&amp;`, `<b>%1$s</b>`, `<xliff:g id="n">%d</xliff:g>`, `<![CDATA[...]]>`. Keep that spelling in your edit. Write `&amp;` for `&` and `&lt;` for `<`, `\'` for an apostrophe and `\"` for a double quote, or wrap the whole string in double quotes.
- **What is locked.** A string with `translatable="false"`, and the items of an array or plurals marked that way. `strings` leaves them out and `check` fails with `locked-string-changed` when one changes.
- **What else is locked.** Every name, attribute, tag, comment, color, dimension and style, and the order of the elements. `check` fails with `structure-changed` when one of them moves. A comment you edit draws the warning `comments-changed`. Layout and indentation may change.
- **How `check` reads a string.** It decodes the escapes, the entities and the CDATA wrappers first, so `Don\'t` against `Do not` is a plain change of wording, and `&#8230;` against `…` is no change at all. Android collapses white space outside double quotes, so a string wrapped over three lines in the file is one line to the reader. A `\n` stays a line break, and losing one draws `newline-changed`. Tags and placeholders stay as they are, and a change to one is an error.
- **Mistakes in the edit.** `apply` stops with the line number when an edit leaves the file malformed, such as a bare `&`. A new unescaped double quote fails with `android-quote`, and a new bare apostrophe draws the warning `android-apostrophe`.
- **Empty strings** (`<string name="x"/>`) have nothing to edit. An empty item still counts in the numbering of its array.

## XLIFF, .resx and other XML files

These have no reader, so `strings` and `apply` do not work on them. Edit the file in place with small exact replacements, and run `check` after each batch.

- Change only the text between tags. Keep every `name`, `id` and other attribute, every tag and every `<xliff:g>` group.
- Write `&amp;` for `&` and `&lt;` for `<`. `check` fails with `invalid-rewrite` and the line number when the file stops being well-formed XML.

## Strings inside code

When the words live in HTML, JSX or a script, there is no reader for the file. `lint` says so when you point it at one, because tags, selectors and names would all count as words.

1. **Take the words a person reads, one per line, into a text file.** The running page is the best source, because it also holds strings a script builds. Copy them from the page, or have a browser tool save its text. A text file of labels is read as interface strings.
2. **Lint that file.** `node scripts/unslop.mjs lint texts.txt --profile ui`. Keep it as `texts-before.txt`.
3. **Edit the source** with small exact replacements, one string at a time. Search for the old string first and change every place it appears. Keep placeholders and template parts exactly as they are (`${name}`, `{count}`, `%d`), and keep entities and tags.
4. **Take the words again** into `texts-after.txt` and run `check texts-before.txt texts-after.txt --profile ui`. A number, name or placeholder that moved shows up there.

## Leave these alone

- Names of items, characters, places, skills and factions. The export includes them because they look like text. Do not edit them unless the user asked.
- Stat names and abbreviations: HP, MP, XP, DPS.
- Strings that contain only placeholders or markup.
- Key names, and translator notes: the `description` that sits next to a `defaultMessage` or `message`, and the `@key` entries of an ARB file. `strings` leaves them out and `check` fails when one changes.
- Debug and developer strings the player never sees. Ask nothing. Skip them and list them in the report.

## Never change

- Placeholders: `{name}`, `{0}`, `%s`, `%d`, `%1$s`, `${var}`, `{{var}}`, and the codes game engines fill in: `%1`, `\V[1]`, `\N[1]`, `\G`, `__1__`, `%NAME%`, `$NAME$`. Do not rename, drop, add or reorder them. Reorder only if the sentence cannot work otherwise, and say so.
- ICU plurals and selects: `{count, plural, one {# item} other {# items}}`. You can reword the text inside the branches. Keep the variable, the type, every branch and every selector (`=0`, `one`, `other`). `check` fails when you drop, rename or add one, and it compares the numbers inside the branches.
- Markup: `<b>`, `<color=#ff0000>`, `[b]`, TextMeshPro and BBCode tags, and engine markup such as `[accent]Wave {0}[]`, `[#ff0000]`, `\C[2]`, `§c` or `|cffff0000...|r`. Keep them around the same words. In a `[]`-style file the empty `[]` closes a color, so it counts as a tag.
- Escapes and line breaks: `\n`, `\t`, `%%`. A string with a break keeps the break.
- Keyboard accelerators: `&Save`, `_Save`.
- Keys. A string is one unit. Do not merge, split or move strings between keys.

## Patterns by role

<!-- unslop:off -->

| Role | Pattern | Before | After |
|---|---|---|---|
| Primary button | The verb, or verb and object | Embark on Your Journey | Play |
| Menu item | The noun the user will find | Customize Your Experience | Settings |
| Helper text | One plain sentence or fragment | Fine-tune your audio experience for a truly immersive soundscape | Adjust music and sound effect volume. |
| Success | Object and past tense | Your progress has been successfully saved! | Game saved. |
| Error | What failed, then what to do | Oops! Something went wrong while saving. Please try again later. | Could not save your game. Try again. |
| Limit reached | State it, then the way out | It looks like all of your save slots are currently full. To continue, you will need to delete an existing save. | All save slots are full. Delete a save to continue. |
| Confirmation | Name the object and the consequence | Are you sure you want to drop {item}? This action cannot be undone. | Drop {item}? You cannot undo this. |
| Empty state | What is missing, then how it fills | Your inventory is empty. Explore the world to discover valuable items! | Your inventory is empty. Items you pick up appear here. |
| Tooltip | A fact the user can act on | Adjusting these settings may potentially impact performance on some devices. | Higher settings can slow down older devices. |
| Progress | The verb in the progressive form | Saving your progress... | Saving… |
| Title | The noun | Your Inventory | Inventory |
| Combat log | The event, with its numbers | You unleash a devastating blow, dealing {damage} damage to {enemy}! | You hit {enemy} for {damage} damage. |

<!-- unslop:on -->

Confirmation dialogs need button labels that repeat the verb: "Drop" and "Keep", not "Yes" and "No".

A game with a strong voice may keep one flavor word in the combat log: "You strike {enemy} for {damage} damage." Keep the flavor in the verb. Do not add it as a second sentence.

## Length

Do not make strings longer. The layout, the controller prompt and every translation depend on length. The check warns when one string grows by more than 30% and by at least 8 characters, and when the whole set grows by more than 15%.

Rules of thumb: a button is one to three words. A toast fits on one line. A tooltip fits in one breath.

## Translations

Changing a source string makes its existing translations out of date. Report how many source strings changed so the team can plan the update. If the project keeps a translation memory or a "do not translate" list, follow it.

## Other languages

English only. If the strings are not English, do not rewrite them. Say this skill covers English. `check` still compares placeholders, tags, numbers and keys in any file, because none of that depends on English. It skips its English wording warnings on other languages and says so.

## Wording sheet template

Save it as `.unslop/wording.md` and keep it open while you rewrite.

```text
Wording sheet: <product>

Who speaks:    the product, to "you". No "we" except on support lines.
Labels:        sentence case, no final period.   (or Title Case: pick one, match the majority)
Messages:      full sentences end with a period. "!" only for celebration (level up, achievement).
Errors:        what failed, then what to do. No "Oops", no "Please", no apology.
Confirmations: question with the object, then the consequence. Buttons repeat the verb.
Ellipsis:      "…" (one character) for progress and for actions that open a dialog.
Terms:         Quit (not Exit, Leave). Settings (not Options). Delete (not Remove). Cancel (not Dismiss).
Numbers:       digits. Keep units as the source has them.
Never touch:   item names, character names, stat names, placeholders, tags, keys.
```
