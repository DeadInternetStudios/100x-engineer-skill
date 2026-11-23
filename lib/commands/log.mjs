import { parseArgs } from 'node:util';
import { appendRow, formatRows, readRows, startRow } from '../decisions.mjs';
import { CliError } from '../errors.mjs';
import { track } from '../in-progress.mjs';
import { findProjectRoot, projectFile } from '../paths.mjs';

const usage = `
100x log <phase> <decision> <why> [evidence] [result]
100x log --start <run-id>
100x log --tail <N>

One row per decision. Phase is a short word such as start, core, build, polish, must-not-break, review, ship, pivot, cut.
Evidence says how you know. Leave it out and the row is stored as a guess.
Options. --file <path>. Default is .100x/decisions.tsv in the current project, or $X100_DECISIONS.
Cells are flattened to one line. Cells that start with = + - @ get a leading quote.
The file keeps UTC times, and --tail shows them in the time zone of this machine.
`;

export default {
  name: 'log',
  summary: 'Append a row to the decisions log, or show the last rows.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { file: { type: 'string' }, tail: { type: 'string' }, start: { type: 'string' } },
    });
    const file = values.file ?? process.env.X100_DECISIONS ?? projectFile('decisions.tsv');
    if (!file) throw new CliError('No .100x folder found here. Run `100x init` in the project, or pass --file.');
    if (values.tail !== undefined) {
      const count = Number(values.tail);
      if (!Number.isInteger(count) || count < 1) throw new CliError('--tail needs a positive whole number.');
      console.log(formatRows(readRows(file).slice(-count)) || '(no rows yet)');
      return undefined;
    }
    if (values.start !== undefined) {
      startRow(file, values.start);
      console.log(`logged start row for ${values.start}`);
      return undefined;
    }
    const [phase, decision, why, evidence, result] = positionals;
    try {
      appendRow(file, { phase, decision, why, evidence, result });
    } catch (error) {
      throw new CliError(`${error.message}. Usage: 100x log <phase> <decision> <why> [evidence] [result]`);
    }
    // The run joins the report from its first decision, so a night that stops half way is still listed. Only the project's own log counts.
    if (values.file === undefined && !process.env.X100_DECISIONS) {
      const root = findProjectRoot(process.cwd());
      if (root) track(root);
    }
    console.log(`logged ${phase} to ${file}`);
    return undefined;
  },
};
