# Inside the skills, and verifying the repo

Back to the [README](../README.md).

## Inside the skills

`skills/100x/` holds the router and the pipeline. `SKILL.md` is the router, `references/` holds the stage guides and the two helpers every run shares, `must-not-break.md` and `watchdog.md`, and `assets/` holds runnable test templates. Each other mode is a folder next to it with its own `SKILL.md`: `100x-mockup`, `100x-wrapup`, `100x-overnight`, `100x-report`, `100x-setup`, `100x-continue`, `100x-judge`, `100x-grind`, `100x-solo`, `100x-status`, `100x-adhd` and `100x-bakeoff`. They read what they share with `100x ref <name>`. You never open these. The agent does.

Every skill follows the [Agent Skills specification](https://agentskills.io/specification), the `SKILL.md` format that Claude Code, Codex, Cursor and the `skills` tool load: a `SKILL.md` with `name` and `description`, then `license`, `compatibility` and `metadata`, with the long guides in `references/` and the runnable files in `assets/`. The license, the compatibility sentence and the metadata come from `package.json`: `node scripts/stamp-skills.mjs` writes them into the thirteen files, and `100x validate` fails when one disagrees.
## The Claude plugin

Anthropic's plugin directory reads one folder of a repository, the one that holds `.claude-plugin/plugin.json`, and installs only that folder. This repository holds the CLI, the tests and the benchmarks too, so the plugin is `plugins/100x/`: the thirteen skills, a manifest, a README, an icon and the two notices. The directory refuses symbolic links, so the skills are real copies, and `node scripts/build-claude-plugin.mjs` writes them. Run it after you change a skill, the version, `LICENSE` or `NOTICE.md`. `--check` says whether the folder is current, and CI runs it. The README and the icon are the only files written by hand. The README is the listing text, and `test/claude-plugin.test.mjs` fails when a skill mentions something that leaves the machine and the README does not.

The plugin carries the skills and not the tool. A plugin install copies one folder, and the skills call `100x` on PATH, so the README tells people to install the tool from npm as well. The directory's checklist is at <https://claude.com/docs/plugins/pre-submission-checklist>. `claude plugin validate ./plugins/100x` runs the part of it that Claude Code can.

## Verify the repository

```bash
npm test                      # every test, including the ones that drive a real browser and seeded defects the matrix must catch
npm run test:fast             # the same without the browser tests: run it after every change, and npm test before you commit
100x validate --prose         # skill structure, the Agent Skills spec rules, links, command names, prose lint
npm run validate:spec         # the same thirteen skills through `skills-ref`, the specification's own validator
100x doctor --deep            # the install on this machine, including a real browser launch
```

The picture of the report page at the top of this file is stamped with the page it was drawn from. `npm test` fails when the page changes and the picture does not. `node scripts/readme-picture.mjs <page.html>` redraws it from a page the command in the `morning` row above wrote, and stamps it.
