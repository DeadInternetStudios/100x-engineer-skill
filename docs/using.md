# Using 100x

More on a normal run, a night away and the report page. Back to the [README](../README.md).

## Try it

```text
/100x an idle game about running a lighthouse. phone first.
/100x-mockup a tip splitter with big buttons
/100x-solo a habit tracker with streaks
/100x-overnight 3 versions of a farming game, for 8 hours, max 3 subagents
/100x-report
/100x-status
```

A normal run takes hours, not minutes. Every polish pass and every round of judging is another model at work, and that is where the time goes. `/100x-mockup` is the fast way: about fifteen minutes, and no judge looks at it. `100x helper run` writes each helper's tokens to `.100x/helpers.jsonl`, and `100x status` adds them up and says when a helper reported none. A helper started another way is not counted. The caps are time (`for 10 hours`), polish passes (`polish.passes`), parallel helpers (`max 3 subagents`) and, when you set it, tokens (`budget.tokens`). Past those, the limit is your app's own, so set it before a long run.

For a run where nobody else may touch the work, call `/100x-solo`. It is the same pipeline in one chat: no subagents, no helpers, no second model. Every look another model would give, the model in this chat gives its own work instead, in writing and from another chair. It writes down what could be wrong before it checks, names the command or screenshot that shows each one, and looks again when it finds nothing. `100x finish` refuses a solo run with a missing challenge, a round or loop without its list, or any helper in the log. It is weaker than a second model, because a model cannot see all of its own blind spots, so the report and the card say "solo run, no other model looked". `100x solo check` lists what a run still owes.

For a night, call `/100x-overnight`. One brief runs unattended in this thread. Several briefs run as children, at most as many at once as `max N subagents` allows, 1 by default. The rest queue.

To make it work for a set time, say so: "work for 10 hours", "work for 2 days", "until 6am". The run then uses all of it. `100x finish` refuses until the work time is over, and the time goes to rounds of testing and polish, each with one question and a before and after, and a judge in every round. The watchdog nudges the thread if it stops early. `100x clock stop "<reason>"` is the only way out, and the report shows it.

When you come back, call `/100x-report`. The agent prints the ranking and opens the report page. Each run gets a line on what it is, and a run the judge held back lists the judge's reasons, with what became of each. Runs that have begun and not finished are listed under the ranking, with where each stands and the line that picks it up, and one nobody has touched for 90 minutes is marked idle. A page opened from a file cannot start anything, so there a card copies the command that runs its prototype. The page the agent serves has a Run button. It starts a prototype's dev server, opens it, and has a Stop button. A command line tool has no address to open, so its card still copies the command and says so. If an older gallery server is still running, the same command restarts it so you get the new page, and says what to stop first when a prototype is running in it. If something else already answers at a prototype's address, the card says it did not start the run and opens nothing, and a link opens that address anyway for when you know it is the one. A run whose record is damaged is left out, and the page says how many.

## How 100x talks

Every mode answers in the same short shape: the result on line 1, one idea per line, and one question last with a guess attached. Nothing is dropped to get there. Errors, numbers and commands stay, and anything risky is written out in full. Say `more` and the agent gives that answer in full, or `shorter` and the next ones come at half the length. The final message that `100x finish` prints has the same shape, with the verdict alone on its first line. For a slower talk, one question at a time, call `/100x-adhd`. The rules are in [`skills/100x/references/voice.md`](../skills/100x/references/voice.md).

## The helper skill

`unslop-text` is part of the workflow, not an extra. It keeps its own repository, docs and tests. 100x ships a pinned copy in `vendor/`, unchanged, so a fresh install works with no network, and runs it as `100x text`.

- `100x text lint` checks the words. `100x shots` saves every string a screen showed, so the polish passes and the fill rounds lint what a person reads and not the source code. `100x validate --prose` runs the same lint over this skill's own files.

`unslop-design` is a separate skill in [its own repository](https://github.com/DeadInternetStudios/unslop-design). 100x does not ship it or run it. Install it from there if you want it.

After the helper skill changes, run `node scripts/vendor-companions.mjs` to pin its new commit. `--check` says whether `vendor/` still matches `companions.json`.
