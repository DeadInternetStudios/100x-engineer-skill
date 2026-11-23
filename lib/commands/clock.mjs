import { parseArgs } from 'node:util';
import { clearClock, clockStatus, describe, setClock, stopClock } from '../clock.mjs';
import { CliError } from '../errors.mjs';
import { requireRoot } from '../project.mjs';

const usage = `
100x clock set <when> [--fill]   start the clock for this project. 17:30, 5pm, +90m, +2h or +1h30m
100x clock [--json]              minutes left, percent used and the deadline
100x clock stop "<reason>"       end a fill clock early, the report shows why
100x clock clear                 remove it

An agent has no sense of time, so a deadline is kept here and read back at every stage boundary. A time of day that has
passed today means tomorrow. The clock lives in .100x/clock.json of the project.
--fill means use all the time, for "work for 10 hours". finish refuses until the work time is over. The last tenth of
the time, at most an hour, is kept for the final review and finish. clock stop is the only way out before that.
`;

export default {
  name: 'clock',
  summary: 'Keep a deadline and say how much time is left.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, fill: { type: 'boolean' } } });
    const root = requireRoot();
    const [action = 'status', ...rest] = positionals;
    if (action === 'set') {
      if (rest.length === 0) throw new CliError('Usage: 100x clock set <when>. For example 17:30, 5pm, +90m or +2h.');
      const status = setClock(root, rest.join(' '), new Date(), { fill: values.fill });
      return console.log(values.json ? JSON.stringify(status, null, 2) : `Clock set. ${describe(status)}`);
    }
    if (action === 'stop') return console.log(describe(stopClock(root, rest.join(' '))));
    if (action === 'clear') return console.log(clearClock(root) ? 'Clock cleared.' : 'No clock was set.');
    if (action !== 'status') throw new CliError(`Unknown clock command "${action}". Use set, stop, clear or no argument.`);
    const status = clockStatus(root);
    return console.log(values.json ? JSON.stringify(status, null, 2) : describe(status));
  },
};
