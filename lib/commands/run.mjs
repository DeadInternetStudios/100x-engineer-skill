import { CliError } from '../errors.mjs';
import { readRun, requireRoot, writeRun } from '../project.mjs';
import { canonicalKey, parseValue, pushPath, RUN_KEYS, setPath, unsetPath } from '../runfile.mjs';
import { refuseModeChange } from '../solo.mjs';

const usage = `
100x run show [--json]
100x run set <key> <value>
100x run push <key> <value>
100x run unset <key>

Edits .100x/run.json, the facts about this run that \`100x finish\` checks and the report page shows.
A value is read as JSON when it parses (3, true, {"a":1}, ["x"]) and as plain text otherwise, so
\`100x run set verdict ship\` and \`100x run set polishPasses 3\` both work. A key that holds text keeps its text as typed.
\`push\` appends to a list and makes it when missing. Pushing a second must-not-break check turns a single one into a list of two.
A dotted key reaches inside objects and lists, for example review.status or mustNotBreak.0.status.
Once a run is solo (\`100x run set mode solo\`) the flag stays: only the owner takes it off, by editing run.json by hand.
Keys: ${RUN_KEYS.join(', ')}.
Examples
  100x run set verdict ship
  100x run set verdictWhy "The core stage held attention for a full minute."
  100x run push tryFirst "Tap the big button twenty times"
  100x run set tryFirst '["Tap the big button twenty times","Open the shop"]'
  100x run push mustNotBreak '{"kind":"screen-sizes","status":"pass","summary":"0 broken of 212 elements across 15 viewports"}'
  100x run set review '{"status":"unreviewed","note":"review is off in config"}'
`;

export default {
  name: 'run',
  summary: 'Read and write the run facts in .100x/run.json without hand editing JSON.',
  usage,
  async run(argv) {
    const [sub = 'show', ...rest] = argv;
    const root = requireRoot();
    if (sub === 'show') {
      const run = readRun(root) ?? {};
      return console.log(rest.includes('--json') ? JSON.stringify(run) : JSON.stringify(run, null, 2));
    }
    if (!['set', 'push', 'unset'].includes(sub)) throw new CliError(`unknown run command "${sub}". Use show, set, push or unset.`);
    const [key, ...words] = rest;
    if (!key) throw new CliError(`Usage: 100x run ${sub} <key>${sub === 'unset' ? '' : ' <value>'}`);
    const run = readRun(root) ?? {};
    refuseModeChange(root, canonicalKey(key), sub === 'unset' ? null : words.join(' '));
    if (sub === 'unset') {
      if (!unsetPath(run, key)) return console.log(`${canonicalKey(key)} was not set`);
      writeRun(root, run);
      return console.log(`removed ${canonicalKey(key)}`);
    }
    if (words.length === 0) throw new CliError(`Usage: 100x run ${sub} <key> <value>`);
    const value = parseValue(key, words.join(' '), { push: sub === 'push' });
    if (sub === 'set') setPath(run, key, value);
    else pushPath(run, key, value);
    writeRun(root, run);
    return console.log(`${sub === 'set' ? 'set' : 'pushed onto'} ${canonicalKey(key)}`);
  },
};
