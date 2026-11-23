# A real review: this README

This README went through a 100x run before it was published. Below is what the second model found in its first review round, and what happened to each finding. Nothing here is illustrated. Back to the [README](../../README.md).

The run used Claude Opus 5.5 as the builder and a fresh Claude Opus 5.5 session as the reviewer. The reviewer only saw the brief, the files and the screenshots. It ran the tests, rendered the page at phone and desktop sizes, and planted broken links to check the link test.

## Round 1: the code and how it behaves

| # | Severity | What the reviewer found | What happened |
|---|---|---|---|
| F1 | major | The 20 language links at the top lead to translations that do not exist yet, and the link test let them through. | Waited for the launch. The translations are written before the repo goes public, and the test now fails as soon as an `i18n/` folder exists with any file missing. |
| F2 | minor | Two badges show red errors. | Waited for the launch. They cannot load while the repo is private. |
| F3 | minor | On a phone, labels in the pictures fall under 10 px. | Fixed. Labels grew from 15 to 17 px to 20 to 22 px, and the final message picture is narrower so its text stays large. |
| F4 | minor | Two proof screenshots were older than the commit they claimed to show. | Fixed. Taken again from the latest commit. |
| F5 | minor | The link test missed wrong letter case, reference links, single quotes and anchors in other files. | Fixed. The test now plants each of those and catches them. |
| F6 | minor | Nothing kept the worked prompt examples passing the prompt check they quote. | Fixed. A test runs the check on both examples. |
| F7 | nit | Only one picture was tested against the script that draws it. | Fixed. CI redraws every diagram and fails on any difference. |
| F8 | nit | One picture worded the example request differently. | Fixed. |
| F9 | nit | The Docs table had an empty header row. | Fixed. |

Its verdict after round 1: not ready to ship, "what is left is small and mechanical". A second round then judged the whole page as a reader would, and its findings were answered the same way.
