import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { freePort } from '../morning-server.mjs';

const usage = `
100x port [--count N]

Prints a free TCP port on 127.0.0.1, one per line with --count. Start a dev server on it with
\`PORT=$(100x port) npm run dev\` or the framework's own port flag, so parallel runs and the report page
never fight over 3000 or 5173. The port is free when printed and nothing holds it for you.
`;

export default {
  name: 'port',
  summary: 'Print a free local port for a dev server.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { count: { type: 'string' } } });
    const count = values.count === undefined ? 1 : Number(values.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new CliError('--count takes a whole number from 1 to 50.');
    const ports = new Set();
    while (ports.size < count) ports.add(await freePort());
    console.log([...ports].join('\n'));
  },
};
