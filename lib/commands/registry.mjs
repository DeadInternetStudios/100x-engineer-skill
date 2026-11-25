import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { decision } from '../look-first.mjs';
import { parseWindow, registryFile, remove, select } from '../registry.mjs';
import { plural, when } from '../text.mjs';

const usage = `
100x registry list [--since 18h|2d] [--all] [--json]
100x registry remove <id>      (the id is the last column of list)
100x registry path

The registry is ~/.100x/runs.jsonl, one line per finished run. 100x finish adds to it.
`;

export default {
  name: 'registry',
  summary: 'List or prune the finished runs behind the report page.',
  usage,
  async run(argv) {
    const [sub = 'list', ...rest] = argv;
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { since: { type: 'string' }, all: { type: 'boolean' }, json: { type: 'boolean' } } });
    if (sub === 'path') console.log(registryFile());
    else if (sub === 'remove') {
      if (!positionals[0]) throw new CliError('Usage: 100x registry remove <id>');
      const removed = remove(positionals[0]);
      console.log(removed ? `removed ${plural(removed, 'run')}` : 'no run has that id. `100x registry list` shows the finished ones, and the id is the last column. `100x morning` gives the id of one that is not finished.');
    } else if (sub === 'list') {
      const hours = values.since ? parseWindow(values.since) : undefined;
      if (values.since && !hours) throw new CliError('--since takes hours or days, for example 18h or 2d.');
      const entries = select({ sinceHours: hours, all: values.all || !hours });
      if (values.json) return console.log(JSON.stringify(entries, null, 2));
      if (!entries.length) return console.log('no finished runs');
      // The date and the word the gallery shows come first. The id is only for `registry remove`, so it goes last.
      for (const e of entries) console.log(`${when(e.finishedAt).padEnd(16)} ${decision(e).padEnd(4)} ${['mockup', 'solo'].includes(e.mode) ? `${e.title} (${e.mode})` : e.title}  ${e.path}  ${e.id}`);
    } else throw new CliError(`unknown registry command "${sub}".`);
    return undefined;
  },
};
