# Install, in full

The short version is in the [README](../README.md#install). This page has every option and every file the installer touches.

100x is two parts. The skills are folders an agent reads. They call one command line tool, `100x`, for what a prompt cannot do: the clock, the screenshots, the judge, the checks and the report. Both parts are in this repo. You need Node 22 or newer. Playwright is found in the project or in `~/.100x`. If neither has it, `100x browsers` installs it into `~/.100x`.

There are three ways in. The first gives you everything and is the one this repo is tested on.

### From a clone

Clone or download this repo, `cd` into it, then run the installer:

```bash
./scripts/install.sh --dry-run   # preview
./scripts/install.sh
```

The installer makes symlinks, a few small files and the folders for them, and nothing else. It never writes through a symlink it finds in the way.

- `~/.100x/` with the CLI link in `bin/`, `repo` (where this checkout lives), `config.json`, `profile.md` and a record of what it made (`install.json`).
- `~/.local/bin/100x`, so `100x` works in any shell that has that folder on its PATH.
- One link for each skill in `~/.agents/skills`: `100x` and its modes `100x-mockup`, `100x-wrapup`, `100x-overnight`, `100x-report`, `100x-setup`, `100x-continue`, `100x-judge`, `100x-grind`, `100x-status`, `100x-adhd` and `100x-bakeoff`. Claude Code, Codex, OpenCode and Cursor read their own skills folders instead. When one is on your machine the installer says so at the end and prints the command that links the skills there too (`--also claude,codex,opencode,cursor`).
- One more link, for the helper skill `unslop-text`. It points at the pinned copy in `vendor/`, and the run uses it as `100x text`. A link you made to your own copy is kept unless you pass `--force`. Pass `--unslop-text <dir>` to link a checkout, or `--no-unslop` to skip it. An older install that linked `unslop-design` loses that link the next time you run the installer, and gets back the one you had made before.

Run it again any time. It reports `unchanged` for what is already right. It never replaces a real folder or file, and it replaces a link that points elsewhere only with `--force`. A `git pull` in this repo updates the install because everything is a link.

### With npm, no clone

```bash
npm install -g github:DeadInternetStudios/100x-engineer-skill
100x install
```

The first line puts the tool on your PATH, with the skills inside the package. The second does what the installer above does, from there. `npm update -g` replaces the package, so run `100x install` again after it.

### With skills.sh

[skills.sh](https://skills.sh) is a directory of skills and a command line tool, `skills`, that copies them into the apps you use. There is nothing to submit: a repo is listed once people install it with that tool.

```bash
npx skills add DeadInternetStudios/100x-engineer-skill --skill '*' -g   # all twelve skills, copied into your global skills folder (-g, or `100x install` does not see them)
npx skills add DeadInternetStudios/100x-engineer-skill --list         # what is in the repo, installing nothing
npx skills update -g                                                  # bring the copies up to date
```

The `skills` tool installs skills and nothing else, so the `100x` tool still has to come from one of the two ways above. Run `100x install` after it: it sees the copies, reports `present`, and does not touch them. `100x doctor` says whether each copy holds the same files as the checkout the tool runs from, because a skill written for a newer tool can call a command an older one does not have.

Every skill is complete in its own folder, so one installed alone is not broken. It names the other skills by their names and prints the guides they share with `100x ref <name>`, and `100x validate` fails on any skill that points at a file outside its own folder. The `skills` tool counts installs anonymously. `DISABLE_TELEMETRY=1` turns that off.
