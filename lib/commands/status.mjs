import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { findProjectRoot } from '../paths.mjs';
import { formatStatus, projectStatus } from '../status.mjs';

const usage = `
100x status [--json]

Where this run stands. Stage and next step from .100x/STATE.md, asks open, decisions, git, review triage, whether the run is finished,
and any recorded watchdog. The scheduled watchdog message tells the agent to run this first.
`;

export default {
  name: 'status',
  summary: 'Show where this run stands, and whether it is finished.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' } } });
    const root = findProjectRoot();
    if (!root) throw new CliError('No run in this folder, so there is nothing to report or continue. A run starts when the 100x skill is given a brief, and it runs `100x init` here.');
    const status = projectStatus(root);
    console.log(values.json ? JSON.stringify(status, null, 2) : formatStatus(status));
    return undefined;
  },
};
