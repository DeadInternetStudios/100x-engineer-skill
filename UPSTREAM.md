# Upstream

100x was built from [pstack](https://github.com/cursor/plugins/tree/main/pstack), which is MIT licensed. See `NOTICE.md` for the credit and the license text.

Pinned commit: `bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7`. The same pin lives in `lib/upstream.json`, which is what `100x upstream` reads.

## Check for newer work

```bash
100x upstream
```

It lists pstack commits newer than the pin, or says the pin is current. It needs network access to GitHub through `gh`. Set `X100_GH` to use another command.

## Take something from upstream

1. Read the new commits. Decide what a one-thread prototype run gains from them.
2. Port the idea in your own words into the skill or reference it belongs to. Keep the wording short and the stage's done-when line first.
3. Add a line to `NOTICE.md` under what was adapted.
4. Note the commit in the pull request or the commit message.
5. Move the pin in `lib/upstream.json` and in this file, then run `npm test` and `100x validate --prose`.

## What stays out

Delegated implementation, swarm and arena panels, per-role subagent models and pull request endings. They serve a different way of working. The owner wants one thread and one second model for the review.
