import { parseArgs } from 'node:util';
import { load } from '../config.mjs';
import { CliError } from '../errors.mjs';
import { requireRoot } from '../project.mjs';
import { clear, record, recordFile, tickPrompt } from '../watchdog.mjs';

const usage = `
100x watchdog prompt                         the text the scheduled message posts into the thread
100x watchdog record <taskId> [--minutes N]  remember the id of the scheduled task your app made
100x watchdog clear                          forget it after you deleted the scheduled task

The agent makes a scheduled or looping task in its own app that posts \`100x watchdog prompt\` into this thread every
\`watchdog.intervalMinutes\` minutes (watchdog.mode schedule, the default). The agent ignores the message while working and
resumes from .100x/STATE.md when a turn ended on a failure. The watchdog is deleted when the run finishes.
`;

export default {
  name: 'watchdog',
  summary: 'Keep an unattended run alive with a scheduled message.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { minutes: { type: 'string' } } });
    const [sub, arg] = positionals;
    const number = (name, fallback) => {
      if (values[name] === undefined) return fallback;
      const n = Number(values[name]);
      if (!Number.isFinite(n) || n < 1) throw new CliError(`--${name} needs a positive number.`);
      return n;
    };
    const root = requireRoot();
    if (sub === 'prompt') return console.log(tickPrompt(root));
    if (sub === 'record') {
      if (!arg) throw new CliError('record needs the id of the scheduled task your app made.');
      record(root, arg, number('minutes', load().effective.watchdog.intervalMinutes));
      return console.log(`recorded ${arg} in ${recordFile(root)}`);
    }
    if (sub === 'clear') return console.log(clear(root) ? 'watchdog record removed. Confirm the scheduled task is deleted.' : 'no watchdog was recorded');
    throw new CliError('Usage: 100x watchdog prompt|record <id>|clear');
  },
};
