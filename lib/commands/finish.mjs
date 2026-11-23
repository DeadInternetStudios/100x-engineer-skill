import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { paddedFacts } from '../fact-words.mjs';
import { finishRun, validateRun } from '../finish.mjs';
import { requireRoot } from '../project.mjs';

const usage = `
100x finish [--check] [--json]

Closes a run. Reads .100x/run.json and the Asks ledger in .100x/project.md, refuses to finish while anything
required is missing or an ask is still open, then copies the hero screenshot, writes the report as a page (.100x/REPORT.html) and as
markdown (.100x/REPORT.md), adds the run to the registry behind the report page (~/.100x/runs.jsonl) and prints the summary to send as the final message.
--check validates only, and also reads the pitch, the moment, the reason for the verdict, the first steps and the next asks with the
writing tool, naming stock phrases as warnings. Exit code 1 when something blocks the finish.
`;

export default {
  name: 'finish',
  summary: 'Validate and close a run, write the report, register it for the report page.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { check: { type: 'boolean' }, json: { type: 'boolean' } } });
    const root = requireRoot();
    if (values.check) {
      const { errors, warnings, run } = validateRun(root);
      if (run) warnings.push(...paddedFacts(run));
      for (const error of errors) console.log(`error ${error}`);
      for (const warning of warnings) console.log(`warn  ${warning}`);
      if (!errors.length) console.log('ready to finish');
      if (errors.length) process.exitCode = 1;
      return undefined;
    }
    let result;
    try {
      result = finishRun(root);
    } catch (error) {
      throw error instanceof CliError ? error : new CliError(error.message);
    }
    if (values.json) return console.log(JSON.stringify(result.entry, null, 2));
    console.log(result.summary);
    for (const warning of result.warnings) console.log(`warn  ${warning}`);
    for (const reminder of result.reminders) console.log(`note  ${reminder}`);
    console.log('It is on the report page with every finished run. Call `100x-report` to open that page.');
    return undefined;
  },
};
