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
- One link for each skill in `~/.agents/skills`: `100x` and its modes `100x-mockup`, `100x-wrapup`, `100x-overnight`, `100x-report`, `100x-setup`, `100x-continue`, `100x-judge`, `100x-grind`, `100x-solo`, `100x-status`, `100x-adhd` and `100x-bakeoff`. Claude Code, Codex, OpenCode and Cursor read their own skills folders instead. When one is on your machine the installer says so at the end and prints the command that links the skills there too (`--also claude,codex,opencode,cursor`).
- One more link, for the helper skill `unslop-text`. It points at the pinned copy in `vendor/`, and the run uses it as `100x text`. A link you made to your own copy is kept unless you pass `--force`. Pass `--unslop-text <dir>` to link a checkout, or `--no-unslop` to skip it. An older install that linked `unslop-design` loses that link the next time you run the installer, and gets back the one you had made before.

Run it again any time. It reports `unchanged` for what is already right. It never replaces a real folder or file, and it replaces a link that points elsewhere only with `--force`. A `git pull` in this repo updates the install because everything is a link.

### Install a pinned release

Each release has one file, `100x-engineer-skill-<version>.tgz`. This page names the SHA-256 of the current one, so you can check it before npm runs anything from it. No clone is needed.

- Version: `0.1.1`
- SHA-256: `5b8ecf6ce51a61000fe09281324c7fa8ad4f09a84a96aae918ec0d193f9eb765`

On macOS and Linux:

```bash
curl -fsSLO https://github.com/DeadInternetStudios/100x-engineer-skill/releases/download/v0.1.1/100x-engineer-skill-0.1.1.tgz &&
echo "5b8ecf6ce51a61000fe09281324c7fa8ad4f09a84a96aae918ec0d193f9eb765  100x-engineer-skill-0.1.1.tgz" | shasum -a 256 -c - &&
npm install -g ./100x-engineer-skill-0.1.1.tgz &&
100x install
```

The check prints `100x-engineer-skill-0.1.1.tgz: OK`. Each line runs only if the one before it worked, so a wrong checksum stops the chain and nothing is installed.

On Windows, in PowerShell:

```powershell
curl.exe -fsSLO https://github.com/DeadInternetStudios/100x-engineer-skill/releases/download/v0.1.1/100x-engineer-skill-0.1.1.tgz
if ((Get-FileHash .\100x-engineer-skill-0.1.1.tgz -Algorithm SHA256).Hash -eq '5b8ecf6ce51a61000fe09281324c7fa8ad4f09a84a96aae918ec0d193f9eb765') { npm install -g .\100x-engineer-skill-0.1.1.tgz; 100x install } else { Write-Error 'The checksum does not match. Nothing was installed.' }
```

The install line puts the tool on your PATH, with the skills inside the package. `100x install` does what the installer above does, from there. To update, install the newer release the same way, with the checksum this page names for it, then run `100x install` again. `npm update -g` does not look for releases, because the package came from a file.

What 100x downloads later is pinned too. `100x browsers` installs Playwright 1.65.1 and `100x helper setup` installs `@cursor/sdk` 1.4.2. The tool holds both versions and the npm integrity hash (SHA-512) of each package. It checks the hash right after the install, before it runs a browser download or the helper. On a mismatch it deletes what it installed and stops. The browser build is the one that Playwright version names.

### On Windows

The same ways work in PowerShell, cmd and Git Bash. Three things differ.

- **A POSIX shell.** The commands you set for a judge or a prototype, such as `review.command`, are written for `sh` with `$VARIABLES`. 100x runs them with the `sh.exe` that Git for Windows installs. It looks on PATH and in the usual Git folders, and `X100_SH` names another one. Claude Code needs Git for Windows too, so you probably have it already.
- **Links.** Windows lets only an administrator, or a machine in Developer Mode, make a symlink. The installer tries one and, when Windows refuses, makes a junction for each skill folder, which the agent apps read the same way. The `100x` program is two small launchers that run `node` on this checkout, `100x.cmd` for cmd and PowerShell and `100x` for Git Bash. The installer says which kind it made. `100x doctor` counts all three as installed, and `--uninstall` removes them. `X100_NO_SYMLINK=1` asks for the junction and launcher path even where symlinks work.
- **Folders.** The launchers go to `%USERPROFILE%\.local\bin`, which is not on PATH until you add it in Windows Settings (search for "environment variables"). `npm install -g` puts `100x` on PATH by itself. Playwright keeps its browsers in `%LOCALAPPDATA%\ms-playwright`.

A `git pull` in this repo updates the install, because the junctions and launchers point at this checkout.

### With skills.sh

[skills.sh](https://skills.sh) is a directory of skills and a command line tool, `skills`, that copies them into the apps you use. There is nothing to submit: a repo is listed once people install it with that tool.

```bash
npx skills add DeadInternetStudios/100x-engineer-skill --skill '*' -g   # all thirteen skills, copied into your global skills folder (-g, or `100x install` does not see them)
npx skills add DeadInternetStudios/100x-engineer-skill --list         # what is in the repo, installing nothing
npx skills update -g                                                  # bring the copies up to date
```

The `skills` tool installs skills and nothing else, so the `100x` tool still has to come from one of the two ways above. Run `100x install` after it: it sees the copies, reports `present`, and does not touch them. `100x doctor` says whether each copy holds the same files as the checkout the tool runs from, because a skill written for a newer tool can call a command an older one does not have.

Every skill is complete in its own folder, so one installed alone is not broken. It names the other skills by their names and prints the guides they share with `100x ref <name>`, and `100x validate` fails on any skill that points at a file outside its own folder. The `skills` tool counts installs anonymously. `DISABLE_TELEMETRY=1` turns that off.
