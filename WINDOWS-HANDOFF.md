# Windows port: handoff

Read this first. It is a working note, not documentation. Delete it when the port is done.

## Goal
Make the 100x CLI and its tests work on native Windows (not only WSL). The owner has a Windows machine and runs the agent on it. Work on a branch off `launch`, push to `origin main` normally when `npm test` exits 0 and `node bin/100x.mjs validate --prose` is ok. CI has a Windows job (`windows-latest`, Node 22) that is allowed to fail until the port is done. When it is green, remove `continue-on-error` from `.github/workflows/ci.yml`.

## State at handoff (main at 7347f85)
- `npm run test:fast` now runs `scripts/test-fast.mjs` (sets X100_FAST from Node), so it starts on Windows.
- CI jobs have `timeout-minutes: 25` because the Windows test run hangs after about 346 tests.
- First Windows run: 301 ok, 45 not ok before the hang. The real number of failures is higher.

## Known causes
1. **Paths.** `new URL(import.meta.url).pathname` gives `/D:/a/...` and joins into `D:\\D:\\a\\...`. Use `fileURLToPath`. Search: `rg "import.meta.url" lib bin scripts test`.
2. **npm not found.** `spawnSync('npm')` gives ENOENT. Windows needs `npm.cmd` or `shell: true` (lib/playwright.mjs, "Installing Playwright failed (spawnSync npm ENOENT)").
3. **Stop and process groups.** `100x morning` starts a gallery server. `100x stop` ends it with a Unix process group, which Windows has not. The server stays up, which is what keeps `node --test` from exiting. Tests: test/morning-stop.test.mjs ("The gallery server did not start").
4. **Symlinks.** The installer links skills into `~/.agents/skills`, `~/.100x` and `~/.local/bin`. Windows needs Developer Mode or admin for symlinks. Plan: try a symlink, fall back to a junction for folders and a copy for files, and say which one it did. `100x doctor` must read all three as installed.
5. **Vendored companions hash.** test "the copy in vendor/ is exactly what companions.json pins" fails. Suspect backslash paths or line endings in the hash input. CI sets `core.autocrlf false` before checkout.
6. **Platform branches.** lib/commands/morning.mjs uses `open` or `xdg-open` (needs `start`). lib/playwright.mjs and lib/provenance.mjs know only the macOS and Linux cache and log folders.
7. **scripts/install.sh** is bash only. The Node installer (`100x install`) must be the Windows path.

## Failing tests in the first run (45, then it hung)
- the documented apps are the ones the test knows about
- a documented template works end to end through review-run
- browsers installs without printing a progress line for every ten percent
- a failed install shows the end of what the installer said
- the copy in vendor/ is exactly what companions.json pins
- a hand edit of a pinned copy is found, and so is a missing one
- the command that 100x text check suggests next is spelled the way 100x runs it, not as a path into vendor/
- doctor warns about a link an older install made to a skill this repo dropped, and install clears it
- a damaged install record is a warning with the fix, not a crash, in doctor and in install
- a judge command that is also the builder reads as one sentence
- a leak in an arm folder refuses before any screenshot is taken, so minutes of photographs are not spent on a run that cannot go on
- the leak scan reads what a file holds, so a name in a file with no extension, an odd extension or a binary file is caught, and a file it cannot read is refused
- init makes a task per brief and arm that differ only in the method note, and refuses repeated ids, a third arm and an existing folder
- pairs refuses and names the file and line when an arm folder carries an arm name or the skill, writes no key, and passes on a clean copy
- pairs refuses while an arm folder has no index.html and names it
- status says what is built, what is judged and the next step
- a run that left no page stays in the count: pairs refuses until --blank-missing, which puts a blank page in the judge copy only and names the run
- status says which finished runs left no page and what to do about them
- --pin copies the skill into the bake-off folder with a clean home and a command that runs it, and only the second arm is told to use it
- the run order is a seeded shuffle of every brief and arm, the same for the same seed, and --first and the default briefs are checked
- evals/briefs.json holds 20 briefs with the three pilot briefs first, and none names a skill
- score prints a screen for a person, not the report file: counts, a verdict line, one bullet for each reason, no table, and where the whole report is
- every flag the eval commands take is on the page of a command and in the combined usage
- status prints the next step as commands that run as they stand, lists every waiting folder, and a score with no key points at status
- a clock file that cannot be read is said, not read as no clock, and no half file is left by a write
- registry list reads like the gallery, the date and the verdict first, and the id last for registry remove
- a judge command that names the builder's model is a self-review too, and a command with no model is not compared
- the command line in apps.md runs as written with the variables 100x review-run sets, and starts the helper on the model, effort and context window of the review setting
- init --fresh moves one run aside, keeps the decision trail and the settings, and starts clean
- init --fresh says where the stage tags went, and says nothing about tags when there were none
- the closing line names the apps a default install does not reach, and the command that reaches them
- a fresh install links every skill, the CLI and the PATH entry, and the linked CLI runs
- a dry run ends the way a real install does, marked as a preview, with the apps it would not reach
- a link that points elsewhere is a conflict until --force, and uninstall restores it
- an unslop-text checkout is linked when given, and a bad path is reported without failing the install
- without a checkout the pinned copy in vendor/ is linked, and uninstall removes that link
- a link to your own copy of unslop-text is kept, never recorded, and --force swaps it for the pinned one
- an install from before unslop-design left 100x loses the link to the removed copy and gets the owner link back
- an old install record that lists the removed link twice is cleaned up once, without an error
- an old install record that lists the removed link twice gives the owner link back whichever record came first
- --no-bin skips the PATH entry and prints a hint when the folder is not on PATH
- --also links the skills into other apps folders too, and uninstall removes only what was made
- skill folders that npx skills add copied count as installed: the installer and doctor accept them and say when one differs
- a detached gallery server starts, is found again, and --stop ends it
- a gallery server from an older build is restarted by --serve, and doctor fails it until then

## Rules the owner set
- No period at the end of a label, caption, heading or fragment bullet. Periods only in full-sentence prose.
- Square corners (border-radius 0) on everything visual.
- Do not add OS or Windows talk to the README without asking. This is for the code and for `docs/`.
- Before every push: `npm test` exits 0 (gate the push on the exit code), `node bin/100x.mjs validate --prose`, and `README_PUBLISH=1 node --test test/readme-links.test.mjs`.
- Commit messages end with the attribution line from the session's system reminder.

## Last step on the owner's machine
After CI is green, run for real: `npm install -g github:DeadInternetStudios/100x-engineer-skill`, `100x install`, `100x doctor`, then start Claude Code and check it lists the skills. Then run `/100x-mockup a tiny todo app` end to end and look at the report.
