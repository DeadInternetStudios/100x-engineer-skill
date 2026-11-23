import { parseArgs } from 'node:util';
import { initProject } from '../init.mjs';

const usage = `
100x init [dir] [--json] [--no-git] [--track] [--fresh]

Sets up <dir>/.100x (project.md, decisions.tsv, STATE.md, shots, must-not-break, review), keeps it out of git
through .git/info/exclude, runs git init when the folder has no repository, and detects the stack.
Safe to run again. It never overwrites a file. --track keeps .100x visible to git.
A folder can hold one run after another. When an earlier run is here, init says so. A new brief should start clean:
--fresh moves the earlier run's files (project.md, STATE.md, run.json, shots, loops, clock and the rest) into
.100x/archive/<time>, moves its stage tags (100x/core and the rest) to 100x/archive/<time>/, and keeps decisions.tsv and config.json. To pick the earlier run up instead, do not run init.
`;

export default {
  name: 'init',
  summary: 'Set up the .100x folder in a project and detect its stack.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, 'no-git': { type: 'boolean' }, track: { type: 'boolean' }, fresh: { type: 'boolean' } },
    });
    const result = initProject({ dir: positionals[0], git: !values['no-git'], track: values.track, fresh: values.fresh });
    if (values.json) return console.log(JSON.stringify(result, null, 2));
    const { stack, git, earlier } = result;
    console.log(`project   ${result.root}`);
    console.log(`created   ${result.created.length ? result.created.join(', ') : 'nothing, already set up'}`);
    if (earlier) {
      const was = earlier.finished ? 'finished' : `not finished${earlier.stage ? `, ${earlier.stage}` : ''}`;
      console.log(earlier.archivedTo
        ? `earlier   moved the earlier run (${was}) to ${earlier.archivedTo}. This run starts clean.${earlier.archivedTags ? ` Its ${earlier.archivedTags.length === 1 ? 'tag is' : `${earlier.archivedTags.length} stage tags are`} now under 100x/archive/, so this run can use the names again.` : ''}`
        : `earlier   a run is already here (${was}). A new brief starts clean with 100x init --fresh. To pick it up, skip init and call 100x-continue.`);
      if (earlier.archivedTo && earlier.watchdog) console.log(`watchdog  the earlier run armed ${earlier.watchdog}. Delete that scheduled task if it is still there.`);
    }
    console.log(`git       ${git.present ? `branch ${git.branch ?? 'none yet'}, head ${git.head ?? 'no commits'}, ${git.clean ? 'clean' : 'has changes'}` : 'no repository'}`);
    console.log(`stack     ${stack.kind === 'unknown' ? 'not detected. Nothing in this folder names a stack, so it is set once the first version exists' : `${stack.kind}${stack.packageManager ? ` (${stack.packageManager})` : ''}${stack.frameworks.length ? `, ${stack.frameworks.join(', ')}` : ''}`}`);
    console.log(`run       ${stack.devCommand ? `${stack.devCommand}${stack.urlGuess ? ` at ${stack.urlGuess}` : ''}` : 'not known yet. When the first version runs, set it with: 100x run set runCmd "<command>"'}`);
    if (stack.deployHints.length) console.log(`deploy    ${stack.deployHints.join(', ')} config found`);
    return undefined;
  },
};
