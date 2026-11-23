# Setup and plans

Recommended Claude Code setup, the lite preset and the standard setups for each plan. Back to the [README](../README.md).

## Recommended setup for Claude Code

This is the author's own setup, and none of it is needed to run 100x. It does not change your model, reasoning effort or sign-in, and it enables no paid API service. Paste the prompt below into Claude Code and let it work through the steps. It checks before it changes anything and tells you what failed.

What it sets up: [TokenEconomizer](https://github.com/microsoft/TokenEconomizer) with tool pruning on propose-only, `playwright-cli` for end-to-end tests instead of the Playwright MCP, a global `~/.claude/CLAUDE.md` of working preferences, and the experimental Code Mode. Code Mode turns off Claude in Chrome and computer use while it is on, and works in the terminal `claude` only. Both TokenEconomizer and Code Mode are young, so read what each step does before you accept it.

```text
Set up my Claude Code environment. Do each step in order, check before changing anything, and report what you did and anything that failed. Do not change my model, reasoning effort, or auth method. Do not enable paid API services.

1. Prerequisites: check that git, node/npm, python3 (3.10+) and jq are installed. Tell me what is missing rather than installing system packages silently.

2. TokenEconomizer (https://github.com/microsoft/TokenEconomizer):
   - Clone it into a durable folder, e.g. ~/Documents/GitHub/TokenEconomizer. The plugin runs from the clone, so it must stay there.
   - Run: claude plugin marketplace add "<clone path>" && claude plugin install tokeneconomizer@tokeneconomizer
   - Set tool pruning to propose-only so nothing is removed without my approval: ~/.tokeneconomizer/bin/te config set toolprune=propose --global
   - Leave micro-skills off. Tell me loopguard is on (its judge runs on Haiku) and ask whether I want it off.
   - Tell me I still need to run /tokeneconomizer:status and /tokeneconomizer:toolprune refresh-catalog in a new session.

3. playwright-cli (use it instead of Playwright MCP): if `playwright-cli` is not installed, run:
   npm install -g @playwright/cli@latest
   playwright-cli install --skills -g

4. Create or merge ~/.claude/CLAUDE.md. If it exists, merge without duplicating and show me the diff. Content:

# Communication policy
- Keep routine progress messages and final summaries concise.
- Avoid redundant explanations and repeated code dumps.
- Never omit important implementation details, trade-offs, errors, or uncertainty.
- Preserve exact identifiers, values, code, commands, and stack-trace details when relevant.
- Never reduce reasoning effort just to shorten a response.
- Never substitute brevity for verification.

# Browser / e2e testing
- Use `playwright-cli` (not Playwright MCP) for e2e tests. If missing: `npm install -g @playwright/cli@latest && playwright-cli install --skills -g`.
- Make E2E deterministic: wait on conditions/assertions, not fixed sleeps; use stable selectors (role, test id); isolate test data; rerun a failure to separate flake from regression before reporting.
- On E2E failure keep the evidence (assertion, trace, screenshot, console/network errors) and report it; never mask a failure with retries or loosened assertions.
- Never lower test rigor or coverage to save tokens.

# Project-specific instructions
- This file holds general preferences only. Project commands, paths and conventions belong in the project's own `CLAUDE.md`/`AGENTS.md`; read and follow them. If a repo has `AGENTS.md` but no `CLAUDE.md`, read `AGENTS.md` explicitly (Claude Code doesn't auto-load it).
- Don't paste docs or generated context into always-loaded files; link to them instead.

# Development workflow
- Search before reading: locate files with `rg`/glob first, then read targeted line ranges rather than whole files.
- Use code intelligence / LSP where available for definitions and references.
- Use `jq` or small deterministic scripts for structured data (JSON, CSV, logs), not eyeballing.
- Summarize passing test runs concisely (counts, duration). Keep full error evidence (messages, stack traces, failing assertions) for diagnosis.
- Filter routine command output, but never drop warnings or failure evidence. Never truncate relevant failures silently; if a filter may hide something important, inspect the original output.
- Don't re-read unchanged files already in context.
- Don't load large docs into context unless needed; read only the relevant section.
- Prefer on-demand skills over long always-loaded instructions (keep this file short).
- Avoid unnecessary browser actions and repeated exploration.

# Session & context management
- Use a fresh session for unrelated tasks.
- Compact only when genuinely useful during long tasks. Before compacting, preserve: requirements, decisions, unresolved problems, affected files, verification status.
- Prefer existing project docs (README, CLAUDE.md, notes) over reconstructing context.
- Avoid unnecessary subagents or agent teams; use isolated subagents only when their benefit justifies the extra usage.
- Never sacrifice necessary context to hit a token target.
- Never auto-clear active sessions or delete conversation histories.

# Usage-optimization constraints (subscription, not API billing)
- Preserve my selected model, reasoning effort, and extended-thinking settings. Never change them to save tokens.
- Never auto-route tasks to weaker models.
- Never switch authentication to API-key billing or enable paid API services / extra-usage purchases.
- Never disable debugging or verification capabilities.
- If an optimization could lower accuracy, leave it off and explain the trade-off.

5. Code Mode (experimental, terminal `claude` only; not the Desktop app):
   - Run `claude update` and make sure it is on the latest version.
   - Add "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE": "1" under "env" in ~/.claude/settings.json. Use jq to merge, back up the file first, and keep my other settings.
   - Warn me it disables Claude in Chrome and computer use while on.
   - Check `claude auth status`. If loggedIn is false, tell me to run `claude auth login` myself; do not attempt to sign in for me.

6. Finish with a short summary: what was installed or changed, what failed, and the manual steps left for me (trust the folder, /tokeneconomizer:status, refresh-catalog, claude auth login, confirm "Yes, turn on Code Mode").
```

## On a small plan

A normal run is built for a lot of budget: three polish passes with a judge each, five judge rounds, and five features built ahead. That is 8 fresh judge looks, and it is why a run takes hours. On a $20 plan, one normal run can use up the allowance of a whole usage window. The lite preset is the same pipeline with less of each:

```bash
100x config preset lite --global     # every project. Use --local for one project
100x config preset standard --global # back to the usual
```

| | Usual | Lite |
|---|---|---|
| **Made for** | A big budget, or a night away | A $20 plan, or a quick keeper |
| **Polish passes**, each with a judge | 3: structure, craft, the moment | 1: structure, plus the 3 details a stranger sees first |
| **Judge rounds** | 5: the code, UI and UX, then ship tests | 2: the code, then the ship test |
| **Features built ahead** | 5 | 2 |
| **Fresh judge looks in a run** | 8 | 3 |
| **Your models** | as you set them | the same |
| **A judge in every loop** | yes | yes |
| **The one careful test** of the one thing that must not break | yes | yes |
| **`100x finish` proof checks** | all | all |
| **Report and final message** | the plain numbers | say "1 of 3" polish passes and the lower round count |
| **Tokens** | not measured | not measured |
| **Set with** | `100x config preset standard` | `100x config preset lite` |

Lite does not touch your models, the judge in every loop, the one careful test of the one thing that must not break, or the checks `100x finish` makes. A lite run is proven as much as a normal one, over less. The report and the final message say `1 of 3` polish passes and a lower round count than usual, so it never reads as a full run.

What to know:

- **Tokens are not counted for the thread.** 3 judge looks against 8 is a count of looks, not of tokens. `budget.tokens` only adds up helpers started with `100x helper run`, which is Cursor. In Claude Code and Codex the thread's own use is not measured, and nobody has measured a lite run yet.
- **The quick mode is not the cheap one.** `100x-mockup` is fast and runs no judge, but in the bake-off it used about 6 times the tokens of a plain agent. Use it for a first look, and a plain agent when you only want a page.
- **A usage limit mid-run is not a failed run.** The state is in `.100x/STATE.md`. When the window resets, call `100x-continue` in the same folder and it picks up at the last true stage.
- **The judge has to be a different model from the builder.** On one plan, pick the smaller model of the same vendor as judge. With both a Claude and a Codex plan, the other vendor's command line can judge through `review.command`. That route has not come back with a review yet, so run `100x doctor` first. `100x-setup` sorts the models into jobs.
- **Say lite to `100x-setup`.** Call it and answer that you are on a small plan, and it turns lite on for you. On a Claude plan, name it instead (see the next section).

## Standard setups for Claude plans

In Claude Code or the Claude desktop app, `100x-setup` asks which plan you are on and shows the three standards, and you can write whatever you want instead. Say which one: **Pro**, **Max** (formerly 5x) or **Ultra** (formerly 20x). It applies that plan's standard, and anything you name yourself wins job by job. Nothing is detected: you say the plan, and with no plan said there is no standard. These are starting points, not limits. Which models your plan includes and how much it allows are yours to check, and nobody has measured the tokens of any of them.

| | Pro | Max | Ultra |
|---|---|---|---|
| Usage preset | `lite` | `medium` | `standard` |
| Polish passes, judge rounds, features built ahead | 1, 2, 2 | 2, 3, 3 | 3, 5, 5 |
| Fresh judge looks in a run | 3 | 5 | 8 |
| Builds | Sonnet, high | Opus, high | Opus, max |
| Judge, a different model | Opus, medium | Fable, high | Fable, high |
| Backup judge | none | Sonnet, high | Sonnet, high |
| Quick jobs | Haiku | Haiku | Sonnet |
| Overnight children | the builder's model | the builder's model | Opus, high |
| Helpers at once | 1 | 2 | 3 |
| Parallel versions | off | off | on |

- **Never Fable at max.** It is overkill for a prototype. Setup uses high for Fable on every plan.
- **Deploys are not in a plan.** Putting something online stays your call, so the preview and live deploy settings are left as they are.
- **Pro and the judge.** A judge on Opus uses a lot of the allowance. If a window runs out mid-run, call `100x-continue` after the reset.
- **Same vendor.** Every judge here is another model from the same vendor. A judge from another vendor is stronger, and needs `review.command`, which has not been proven.
- **By hand.** `100x config preset lite|medium|standard` sets just the usage part. The table is `100x ref plans`.

## Standard setups for OpenAI plans

In Codex, or when you mention OpenAI or ChatGPT, `100x-setup` shows these instead. Say **Go or Plus**, **Pro 100** or **Pro 200+**, or write whatever you want. This is a first guess: it comes from third-party pages and a few OpenAI help pages that disagree in places, and nobody has run these standards. Models are named by family, and setup uses the newest version your app lists, which is GPT-6.2 for Astra and Sol at the moment. Go may not list the newest ones.

| | Go or Plus | Pro 100 | Pro 200 or 500 |
|---|---|---|---|
| Usage preset | `lite` | `medium` | `standard` |
| Polish passes, judge rounds, features built ahead | 1, 2, 2 | 2, 3, 3 | 3, 5, 5 |
| Fresh judge looks in a run | 3 | 5 | 8 |
| Builds | Sol, medium | Sol, high | Sol, high |
| Judge, a different model | Astra, medium | Astra, high | Astra, high |
| Backup judge | none | none | none |
| Quick jobs | Luna | Luna | Luna |
| Overnight children | the builder's model | the builder's model | Sol, medium |
| Helpers at once | 1 | 2 | 3 |
| Parallel versions | off | off | on |

- **Astra judges and does not build.** It is the stronger model and has the smaller allowance, and a run needs only a few judge looks. Sol is cheaper for routine coding.
- **No backup judge.** The only other models are Sol, which builds, and Luna, which is too weak to judge. A backup from the builder's own family is a self-review, so add one from another vendor if you have it.
- **A caveat on Astra 6.2.** One source says its system card measured it hiding a known coding obstacle about twice as often as GPT-6 Astra, 22.28% of trials against 11.09%. The judge's ask tells it to report everything it saw, so the standard stays. If a judge's report looks too clean, say so.
- **No standard asks for a model's top effort.** Say so in words when you want more.
- **Limits are changing.** OpenAI has said the ChatGPT and Codex limits will be shared from December. Same as for Claude, deploys are not part of a standard. The table is `100x ref plans`.
