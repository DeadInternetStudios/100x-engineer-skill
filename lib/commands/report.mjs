import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { readRun, requireRoot, stateFile } from '../project.mjs';
import { buildReport, buildReportHtml } from '../report.mjs';
import { listProblems } from '../runfile.mjs';

const usage = `
100x report [--print]

Rebuilds this run's own report, .100x/REPORT.md and the page .100x/REPORT.html, from run.json, the Asks ledger, the latest matrix and the decisions log.
Safe to run at any time. Missing parts show as unknown. --print also prints the markdown report.
The page with every finished run is made by 100x morning. That is the page the owner opens by calling 100x-report.
`;

export default {
  name: 'report',
  summary: "Rebuild this run's own REPORT.md and REPORT.html. The page with every run is made by morning.",
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { print: { type: 'boolean' } } });
    const root = requireRoot();
    const run = readRun(root) ?? {};
    const shape = listProblems(run);
    if (shape.length) throw new CliError(`The report cannot be written yet. ${shape.join(' ')}`);
    const text = buildReport(root, run);
    fs.writeFileSync(stateFile(root, 'REPORT.md'), text);
    fs.writeFileSync(stateFile(root, 'REPORT.html'), buildReportHtml(root, run));
    console.log(values.print ? text : `wrote ${stateFile(root, 'REPORT.md')} and ${stateFile(root, 'REPORT.html')}`);
    return undefined;
  },
};
