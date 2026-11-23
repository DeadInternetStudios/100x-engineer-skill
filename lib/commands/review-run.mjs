import { parseArgs } from 'node:util';
import { load } from '../config.mjs';
import { requireRoot } from '../project.mjs';
import { reviewStatus, startReview, stopReview } from '../review-run.mjs';

const usage = `
100x review-run [--fallback] [--loop <name>] [--json]
100x review-run --status [--json]
100x review-run --stop

Starts the judge as a shell command, for any agent app that has a command line. The command is review.command in your
global config. It reads its settings from environment variables, so no model name or task text sits in shell quoting.

  X100_MODEL    X100_PROVIDER    X100_EFFORT   (effort or reasoning_effort, whichever the model has)
  X100_OPT_<ID> every other option, for example X100_OPT_CONTEXTWINDOW
  X100_TASK     the instruction for the judge       X100_BRIEF   the brief file     X100_FINDINGS   where it writes findings
  X100_ROOT     the project folder, also the working directory

The command starts in the background and the call returns at once, because a tool call that waits gives up after about a
minute. Wait in your own turn, then look at the findings file. --status says running, exited with its code, or died.
--stop ends it, for example at the deadline. --fallback runs the same command with the backup judge's model and options.
Output goes to .100x/review/run.log. macOS and Linux, or WSL on Windows.
`;

export default {
  name: 'review-run',
  summary: 'Start, check or stop the judge as a shell command.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { status: { type: 'boolean' }, stop: { type: 'boolean' }, fallback: { type: 'boolean' }, json: { type: 'boolean' }, loop: { type: 'string' } } });
    const root = requireRoot();
    const out = values.stop ? stopReview(root) : values.status ? reviewStatus(root) : startReview(root, load().effective, { fallback: values.fallback, loop: values.loop ?? null });
    if (values.json) return console.log(JSON.stringify(out, null, 2));
    if (values.stop || values.status) {
      if (out.state === 'none') return console.log('No judge has been started in this project.');
      const code = out.state === 'exited' ? ` with code ${out.code}` : '';
      return console.log(`Judge ${out.state}${code}. ${out.model || 'its own model'}, started ${out.minutes} minutes ago, findings file ${out.findingsBytes} bytes.${out.note ? ` ${out.note}.` : ''}`);
    }
    console.log(`Judge started in the background. pid ${out.pid}, ${out.model || 'the command picks its own model'}.`);
    console.log(`findings ${out.findings}`);
    console.log(`log      ${out.log}`);
    console.log('Wait in your own turn, then read the findings file. `100x review-run --status` says when it has ended.');
    return undefined;
  },
};
