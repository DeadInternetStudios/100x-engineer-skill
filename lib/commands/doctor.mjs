import { parseArgs } from 'node:util';
import { formatCheck, presentChecks, runDoctor } from '../doctor.mjs';

const usage = `
100x doctor [--quiet] [--json] [--deep]

Checks Node, ~/.100x, the config, the skill links, the pinned unslop-text, Playwright and Chromium.
--quiet prints only warnings and failures. A judge warning is printed first, skill links that fail the same way are one row, and the last line is a tally. --json keeps every check. --deep also launches Chromium once. Exit code 1 when anything fails.
`;

export default {
  name: 'doctor',
  summary: 'Check that the install and its tools are healthy.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { quiet: { type: 'boolean' }, json: { type: 'boolean' }, deep: { type: 'boolean' } } });
    const checks = await runDoctor({ deep: values.deep });
    if (values.json) {
      console.log(JSON.stringify(checks, null, 2));
    } else {
      const { first, rows, tally } = presentChecks(checks);
      if (first.length) console.log(`Read this first\n${first.map(formatCheck).join('\n')}\n`);
      for (const c of rows) {
        if (values.quiet && c.status === 'ok') continue;
        console.log(formatCheck(c));
      }
      console.log(`\n${tally}`);
    }
    if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
    return undefined;
  },
};
