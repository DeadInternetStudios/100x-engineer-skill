# Bake-off protocol

This file governs a run from its `init`, which writes the hash of this file into `bakeoff.json`, so a run folder shows which text it ran under. Between runs the text changes in ordinary commits, and `git log -- evals/PROTOCOL.md` shows each one. After the first arm of a run starts, a change is an amendment under the last heading, with its date and its reason, and the text above that heading does not change.

## The question

Does an agent that follows the 100x-mockup skill make web prototypes that a blind judge prefers, compared with the same agent making the same prototypes without it?

That is the whole question. It covers one fast mode of the skill on small web prototypes. It says nothing about a full 100x run with its judge rounds, about other models, or about any other kind of work.

## Arms

There are two arms, named `skill-off` and `skill-on`.

- `skill-off` gets the brief and the task text.
- `skill-on` gets the same brief and the same task text, plus one method paragraph that tells it to follow the 100x-mockup skill from a pinned copy, with a clean home folder and the default profile.

Everything else is equal. The model is one slug for every arm and every judge, chosen before the first arm starts. The brief text, the folder rule (one folder, `index.html` as the entry file, no build step, no network) and the time limit are the same. The limit is 20 minutes by this machine's clock. Each arm works in a folder named `arm-1` or `arm-2`, so its path and its task do not say which arm it is.

An arm runs in a fresh helper that has seen nothing of the other arm, and only one helper runs at a time. Every helper, arm or judge, starts through the Cursor SDK with `100x helper run`, which prints the model the SDK reports it ran. The app's Task tool and the Cursor command line are not used, and `skills/100x/references/apps.md` says why.

A run that ends with no `index.html` failed, and it stays in the count. `pairs --blank-missing` puts a blank page in its place in the judge folders and never in the arm's own folder, so a judge that can see ranks it last, and the report names the run. The controls are made from a page that exists.

## Briefs

`evals/briefs.json` holds twenty briefs. The first three are the pilot: an idle game about a lighthouse, a dashboard for a coffee shop, a landing page for a dog walking service in Lisbon. A run that can say "ahead" uses all twenty, because the word needs at least 6 decisive pairs and a judge that flips with the order makes fewer of the pairs decisive. `init` prints the cost and the odds before anything starts. There is one trial for each brief and arm.

## Blinding

- A seed fixes which arm sits first in each pair. It is written in `bakeoff.json`, so anyone can redraw the key.
- Every pair is judged twice, once with each arm in the A place. A pair counts for an arm only when both orders pick that arm. Anything else is a tie, and a pick that follows the place and not the page is counted as a flip and shown.
- The key (`key.json`) sits next to the judge folders, not in them, and its sha256 is written to `key.sha256` before any judge has a folder to open, with a signature of that hash made with this machine's 100x key (`~/.100x/audit.key`, the key `lib/seal.mjs` signs everything else with). The hash is also logged. `score` refuses a key whose hash changed, withholds the verdict when the signature is missing or wrong, which is what a key remade by hand looks like, and withholds it when a verdict is placed before the seal. A verdict is placed by the hash it quotes: each `ask.md` asks the judge to copy the first 16 characters of the key's hash into `verdict.json` as `sealed`, and a verdict that does that was written after the key was sealed, wherever the folder has been copied since. A verdict that does not quote it is placed by its file's time, which a copy or a clone loses, and `score` says that in its reason. The signature stops anyone who does not read that key file. It does not stop one who does, and it is this machine's, so the word is printed only where the pairs were built. Anywhere else `score` prints the same counts as a recount and withholds the word. The signature does not travel, and that is the limit of this check.
- `pairs` scans every judge folder for `100x`, `SKILL.md`, `STATE.md`, `bakeoff`, the two arm names and `arm-1` or `arm-2`, the folder each arm is told it works in and so the one name every arm is certain to know about itself. It reads each file's content whatever its name ends in, so a file with no extension is read. A file with a zero byte in its first 8 KB is searched byte by byte for the names of 6 or more characters. A symbolic link or a file over 25 MB cannot be checked, so `pairs` refuses it. It refuses and names the file and line when it finds a name. A word that is only plain English can be let through with `--allow`, and the scan records what was allowed. `RUN.md`, `STATE.md`, `TASK.md`, `.log` files and the `.git`, `.100x` and `node_modules` folders are not copied to a judge.
- The judge is told nothing about arms or skills. It is pointed at one `judge/pair-NN-oK` folder at a time, in a fresh helper each time, and writes `verdict.json` there.
- Two controls ride along as ordinary pairs, each judged in both orders. The planted control is a page beside a blurred copy of itself, and the intact page must win in both orders. The identical control is one page twice, and no winner is the right answer. A judge that fails either is not trusted.

## The rule that decides the word

The report says "ahead" only when all of these hold. It says "not shown" otherwise, with the reason.

1. At least 6 decisive pairs. A decisive pair is one where both orders pick the same arm. With 5 decisive pairs even a clean sweep gives p = 0.0625, so 5 can never be enough.
2. An exact two-sided sign test over the decisive pairs gives p below 0.05, with the leading arm winning more of them.
3. The judge passed both controls.
4. The key was sealed before the first verdict, the leak scan passed, every verdict is in, no verdict's reason names an arm, the key, a task or an arm folder, the arm runs all used one model at one setting, the model that ran is on record for every arm run and every judge folder and a signed receipt backs each record, the judges all used one model at one setting, and the sealed key carries a valid signature.

A pair whose page carries a label, `unreviewed` or `mockup`, tells the judge which arm made it. Those pairs are set aside from the count the word is worked from, so rules 1 and 2 hold over the pairs left. The report prints the count of every pair too, and says the word is not worked from it.

The counts, the p value and the Wilson 95% interval always print, so a small result is never hidden behind the word. A pilot of 3 pairs cannot reach "ahead", and the report says so.

## What is recorded

- Minutes for each run, from this machine's clock at `mark start` and `mark stop`. An arm's own account of how long it took is never used.
- The model asked for, the model that ran and its settings, for every arm run, and for every judge folder as `judge/<folder>` (or once as `judge` for all of them). The record comes from a receipt: `100x helper run --receipt <file>` saves what the SDK reported and signs it with this machine's 100x key, and `mark <key> stop --receipt <file>` takes the model, the reasoning effort, the context window and the tokens from it, keeps a copy under `receipts/`, and refuses one that was not signed here or that already backs another run. A name typed with `--ran` is recorded too, as the helper's word. `score` withholds the word when a record is missing or the runs did not all use one model at one setting, and it says "ahead" only when a receipt backs every record. The signature stops a receipt made by hand or edited since. It does not stop one who reads the code and signs a file on purpose.
- Edits made to an arm folder after the leak scan refused it are in the project log and in the reply, and each one goes to `pairs --edit "<what>"`, which keeps it in the scan record under `leakscan.json` so that `score` cautions that a person edited the pages. A run built before `--edit` existed has no such record.
- Tokens, when the app gives them. Otherwise "not recorded".
- Every verdict file as the judge wrote it, with its `why`.

## Threats, named before the first result

- The arms and the judge are one model family when the owner's rule allows only one. A judge can share its taste with an arm. The controls show that it can see and that it does not invent a winner, and they show nothing more.
- The pairs are few. Six decisive pairs is the least the test can use, and one trial per brief and arm means a second run could land on the other side.
- The briefs were written by the people who wrote the skill, and may suit it.
- `skill-on` runs the fast mode only. The judge rounds, polish passes and fill rounds of a full run are not measured.
- The `skill-off` arm could see installed skills if its app listed them. A helper started with `100x helper run` is given none: on 2026-11-20 a Muse helper in an empty folder was asked to list every skill, rule and subagent type in its context, and it listed no skill, no rule and eight built-in subagent types, with neither `100x` nor `mockup` anywhere in it. The instruction in the task not to use a skill is the second control. That probe was one helper on one day, and a later SDK version could load more.
- Time and effort are equal by the clock, and the first minutes of `skill-on` go to reading the skill. That cost is counted and not removed. A helper that is told 20 minutes and stops after one is not stopped, as the one pilot showed (26 seconds). The report prints the median time for each arm and says when they are more than twice apart.
- The judge reads pages and screenshots. It is not a user, and nobody pays for or returns to these prototypes.
- The key is on the same machine as the judge. A judge that goes looking for it can find it.
- The leak scan reads what files hold and what they are called, and refuses the arm names, the skill's name, and the two words the mockup skill tells a run to call itself, `unreviewed` and `mockup`. When `pairs` photographs the pages it also scans the text each page showed once it ran, and the key records that it did. The page title and an attribute are not in that text, so a name a script puts there passes, and so does a picture that shows an arm name. Pairs built with `--no-capture`, and the pilot's, were not run, so a name a script builds in the browser passes them.
- An arm can give itself away by what it writes on its page and not by a name. In the run of 2026-11-21 five of the twenty `skill-on` pages said "UNREVIEWED mockup" on the page, and in four of those five pairs the judge's reasons name it (7 of the 10 verdicts). That run's scan looked for names only, so it did not refuse them. Since then the task tells both arms to leave the words off the page, and `score` sets aside the pairs whose page carries them and prints the count of every pair beside the count it uses.
- An app can run another model than the one asked for. On 2026-11-20, in Cursor 3.31.11, the app's own hooks log listed 16 helpers for the two days before and every one ran `composer-2.5-fast`, including the ones started with a Muse slug. That was the log on that day. `100x review-verify --list --hours 48` shows what it lists now. The report lists the model that ran, and a run whose helpers ran another model is not a run of the model that was chosen.
- The path to the judge folders can hold words like `100x`. The build and the report both say when it does.

## A run is void when

- A helper ran another model than the one chosen and the report does not say so.
- The arm runs did not all use one model. `score` withholds the word.
- The leak scan fails after any judge has started. The key stays as it is, because a second draw is a different experiment, and the report says the first draw was void.
- A judge's `why` names an arm, mentions a key or a skill, or says it looked outside its folder. That verdict is deleted, written down in the log, and judged again by a fresh helper. Both are kept.
- An arm touched the other arm's folder, or a folder after its minutes were up.

## Reporting

The report is the file `report.md` that `100x eval bakeoff score` writes. It goes into `docs/evals/` unedited, with a picture of each pair, the minutes for each arm and the limits above. The README quotes the tool's headline sentence (the `headline` field of `score --json`, which the report spells out as the counts, a verdict line and a bullet for each caution) and no other claim about the result. A number that is not in a file under `docs/evals/` is not in the README.

## Amendments

**Run of 2026-11-21, 20 briefs.** It began at 05:30 UTC under the text at commit `92d0b3e`, and `bakeoff.json` holds the hash of it, `421b5d2cfee47320`. At 06:39 UTC, with its arms still running, commit `ba963d0` reworded the leak-scan limit, which was a change to the text above this heading after the first arm started. The line was restored then and the change was recorded here. Round 6 of the review had found that `pairs` printed "found no arm name" for a scan that never ran a page. Since `ba963d0`, when `pairs` photographs the pages it also scans the text each page showed once it ran, refuses a name found there, and writes `rendered: true` into the key. The change makes the gate stricter, and it was in the code before that run's pairs were built, so its key records `rendered: true`. After the run, the limit above was reworded to say what the scan does now, and the scan gained the words `unreviewed` and `mockup` after the run showed five arms giving themselves away with them. That run's scan did not have those two words. Nothing else in the text changed after the first arm of that run.

**Earlier, the pilot of 2026-11-20.** It ran under the text at commit `3787c83`. Since then this file gained signed receipts for the model of every run, verdicts that quote the key's hash, a leak scan that reads what a file holds, the 20 briefs and the plan `init` prints, all on 2026-11-21. The pilot's records are typed, and its headline says so.

**After the run of 2026-11-21 (round 7 of the review).** Four changes to the text above this heading, none in force for a run that has already started. The shared task now tells both arms to leave `unreviewed` and `mockup` off the page. `pairs --edit` records hand edits. `score` sets aside the pairs whose page carries a label and works the word from the rest, so the run of 2026-11-21 now reads "not shown" (7 to 2 of 9 decisive pairs, p = 0.18), where it had read "ahead" from all 14 decisive pairs (12 to 2, p = 0.013). The pages and the README that had said "ahead" were respun with this change. And `score` says a receipt or a seal came from another machine when it did, instead of calling it typed.

**Reading the run of 2026-11-21.** Because the text above changed while that run was going and the set-aside rule came after its labelled results were seen, the run is exploratory. A run counts as confirmatory only when the protocol, the label rule included, is frozen before `init` and its hash in `bakeoff.json` matches the file at the end.

None for a run that has not started.
