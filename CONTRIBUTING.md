# Contributing to 100x

Thanks for helping. Bug reports, fixes, new checks, clearer docs and translation fixes are all welcome. You don't need to ask before sending a small fix.

## Report a bug

[Open an issue](https://github.com/DeadInternetStudios/100x-engineer-skill/issues/new) and include:

- the line you typed, for example `/100x Let me compare any stock with the S&P 500`
- your agent and model (Claude Code, Cursor or Codex)
- the output of `100x doctor`
- what you expected, and what happened instead
- for a run that went wrong: the final message and `.100x/STATE.md` from the project

Take out anything private first, such as keys, client names or paths you don't want public.

## Suggest a change

For anything bigger than a fix, like a new mode, a new stage or a change to how judging works, open an issue first. Say what problem it solves. That way we agree on the idea before you spend time on the code.

## Make a change

```bash
git clone https://github.com/DeadInternetStudios/100x-engineer-skill
cd 100x-engineer-skill
./scripts/install.sh               # links your clone, so your edits are live in your agent
100x browsers                      # once, for the screenshot and browser tests
```

While you work:

```bash
npm run test:fast                  # after every change
```

Before you open a pull request:

```bash
npm test                           # every test, including the browser ones
node bin/100x.mjs validate --prose # skill structure, links, command names, prose
```

Then open a pull request. Keep it to one change and say how you checked it. CI runs the fast tests and the validator on Ubuntu and macOS with Node 22 and 24.

## Where things live

| Folder | What is in it |
|---|---|
| `skills/` | What the agent reads. One folder per mode, each with a `SKILL.md`. Most changes to how a run behaves happen here. |
| `lib/`, `bin/100x.mjs` | The `100x` command line tool: clock, screenshots, judge, proof checks, report. |
| `test/` | Tests, run with `node --test`. New behaviour needs a test. |
| `docs/` | The longer docs the README links to. |
| `vendor/` | A pinned copy of `unslop-text`. Don't edit it here. |

More detail: [inside the skills, and verifying the repo](docs/contributing.md), [CLI and file layout](docs/cli.md), [design notes](docs/design.md).

## Things the tests check for you

- The README's mode table and number phrases match the skills. Add or rename a mode and the tests tell you what else to update.
- The final message shown in the README is the one the code prints.
- Each skill's license and metadata come from `package.json`. After you change them, run `npm run stamp`.
- The report picture in the README is drawn from the current report page. If you change the report, the test failure tells you how to redraw it.

Two rules no test checks:

- **Square corners.** Nothing 100x draws has a border radius: reports, gallery, badges, diagrams.
- **Plain words.** Short sentences, no hype. Write for someone who codes with an agent and knows some things.

## Be decent

Be kind, stay on the work, and assume good intent. Maintainers may close issues or pull requests that don't follow this.

## License

By contributing, you agree that your work is released under the [MIT license](LICENSE), like the rest of the project.
