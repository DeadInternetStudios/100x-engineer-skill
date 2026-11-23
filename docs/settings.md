# Settings

Layers, keys and defaults. Back to the [README](../README.md).

## Settings

Layers, lowest to highest: built-in defaults, `~/.100x/config.json`, `<project>/.100x/config.json`. Change them with `100x config set <path> <value> --global` or `--local`, or call `100x-setup` and answer one question. A model and its options are written together with `100x config role builder|review|fallback|quick|overnight --model <id> --option effort=max`, which also switches off option keys the new model does not take.

| Key | Default | Meaning |
|---|---|---|
| `review.enabled` | `true` | Run the second-model review. |
| `review.provider`, `review.model` | none, none | Who reviews. 100x hardcodes no vendor. `100x-setup` proposes one from your app's own model list. Models change, so this is configuration and never hard-coded in a skill. |
| `review.options` | none | Passed to the reviewer as given. Any keys the model accepts. |
| `review.command` | none | The reviewer as a shell command, for any app with a command line. Global config only. Command templates for Claude Code, Cursor CLI, Codex, Gemini CLI and opencode are in `skills/100x/references/apps.md`. On Cursor use the SDK line there instead of the Cursor CLI one. |
| `review.fallbackModel`, `review.fallbackOptions` | none, none | Tried when the first reviewer cannot start, with its own options. |
| `review.rounds` | `5` | How many judge rounds. The lens runs code, then UI and UX, and the last round is always the ship test. A clean round skips the rest of its lens. `100x finish` refuses while a planned round is missing, unless the clock has no room. |
| `review.grind` | `false` | `true` plans one more ship test after the usual rounds for as long as no judge has said ready to ship with no blocker and no major finding. The `100x-grind` skill sets it for a project. It stops after three ship tests in a row that bring nothing better than the best so far, and at 15 rounds. `100x finish` refuses while another round is planned, unless the clock has no room. |
| `review.timeoutMinutes` | `90` | How long the agent waits for the reviewer before it cancels it. With a clock running the wait is shorter when the deadline is near, and with under 15 minutes left there is no review. |
| `builder.provider`, `builder.model`, `builder.options` | none | The model and effort you want this thread to run. 100x cannot switch the thread's model, so stage 0 only compares and says so in one line when they differ. |
| `variants.parallel` | `false` | `true` lets `variants` run as parallel children. It does not touch the judge, which always runs. A local choice per project. |
| `quick` | follow the thread | The model for `100x-mockup` and `100x-wrapup`. They run in the thread and only compare it with this model. |
| `overnight` | follow the thread | Provider, model and options for the children of `100x-overnight` and of parallel variants. Empty means the child uses the thread's own model, except where `helper.only` is set, where the child is the locked selection. |
| `core.enabled` | `true` | Stage 1. |
| `polish.passes`, `polish.dudPasses` | `3`, `1` | Polish passes for a normal run, and for a run that still needs work after two pivots. |
| `depth.predictedFollowups`, `depth.max` | `true`, `5` | Build the likely next asks, at most this many. |
| `variants.count` | `1` | Default number of variants. |
| `subagents.atOnce` | `1` | At most this many children at the same time, for a night, for parallel versions and for the routing runner. Set by the `max N subagents` phrase. Judges run one at a time, so this never blocks a judge, and the cap does not count judges or the thread itself. |
| `helper.only` | none | Global config only. `"<model id> <parameter>=<value> ..."`, for example `claude-opus-5-5 reasoning_effort=max context=300k`. Locks every helper on this machine to that one selection: `100x helper run` refuses any other, and `review-call`, `review-run` and `night next` refuse a Cursor target that is not it. A project file cannot set it. |
| `helper.ceiling` | none | Global config only. Holds `subagents.atOnce`, `night --parallel` and the routing runner at or under this number, whatever a project or a brief asks for. It is a limit on the number asked for, not a count of live sessions. |
| `test.budget` | `after-polish` | Or `quick-only`, or `full`. |
| `deploy.preview`, `deploy.prod` | `auto`, `on-say-so` | Previews follow the project's own setup. Production needs your word in the brief. |
| `watchdog.mode`, `watchdog.intervalMinutes` | `schedule`, `20` | Or `off`. |
| `morning.windowHours` | `18` | How far back the gallery looks. |
| `budget.tokens` | none | A cap on the tokens the helpers of one run may use. `100x helper run` writes each helper's tokens to `.100x/helpers.jsonl`, `100x status` adds them up, and no helper starts once the total reaches the cap. |

`~/.100x/profile.md` holds how you work and what you reject. Stage 0 reads it on every run. Edit it freely. The installer never overwrites it.
