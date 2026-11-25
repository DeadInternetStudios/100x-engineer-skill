import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { readRun, requireRoot } from '../project.mjs';
import { challengeFile, challengeStatus, neededChallenges } from '../solo-check.mjs';
import { CHALLENGES, CHALLENGE_NAMES, QUESTION, challengeTemplate, isSolo } from '../solo.mjs';

const usage = `
100x solo [check] [--json]
100x solo new <${CHALLENGE_NAMES.join('|')}>

Helps a solo run (run.json says mode solo, set with \`100x run set mode solo\`): the whole pipeline done by one model, which attacks its own work in
writing at each stage, because no second model looks. The commands never start a model.
check  Says which challenge files the run owes, and what is wrong with each one. It is the same check \`100x finish\` makes. Exit code 1 when any is wrong or missing.
new    Writes .100x/solo/<name>.md: the seat to sit in, what to read, the questions to start from, and the form of a suspicion. It refuses to overwrite a file.
The challenges: ${CHALLENGE_NAMES.map((name) => `${name} (${CHALLENGES[name].stage})`).join('; ')}.
The procedure and the rules of a challenge are in \`100x ref solo\`.
`;

function requireSolo(root) {
  readRun(root);
  if (!isSolo(root)) throw new CliError('This is not a solo run. The 100x-solo skill starts one: for a new run, after `100x init` it runs `100x run set mode solo`. A run that began another way keeps its way. A normal run judges with another model.');
}

function check(root, json) {
  const run = readRun(root) ?? {};
  const status = challengeStatus(root, run);
  const owed = new Set(neededChallenges(root, run));
  if (json) {
    console.log(JSON.stringify({ challenges: status.map(({ name, file, exists, problems }) => ({ name, file, exists, problems, ok: problems.length === 0 })), notOwed: CHALLENGE_NAMES.filter((name) => !owed.has(name)) }, null, 2));
  } else {
    for (const { name, file, problems } of status) {
      console.log(`${name.padEnd(11)} ${problems.length ? 'NOT YET' : 'ok'}  ${file}`);
      for (const problem of problems) console.log(`            ${problem}`);
    }
    for (const name of CHALLENGE_NAMES.filter((n) => !owed.has(n))) console.log(`${name.padEnd(11)} not owed yet. ${CHALLENGES[name].stage}`);
    const passing = status.filter(({ problems }) => problems.length === 0).length;
    console.log(`${passing} of ${status.length} owed challenges pass. Rounds and loops are checked by \`100x finish\`.`);
  }
  if (status.some(({ problems }) => problems.length)) process.exitCode = 1;
}

function write(root, name) {
  if (!CHALLENGE_NAMES.includes(name ?? '')) throw new CliError(`100x solo new takes ${CHALLENGE_NAMES.join(', ')}. Got "${name ?? ''}".`);
  const file = challengeFile(root, name);
  if (fs.existsSync(file)) throw new CliError(`${path.relative(root, file)} already exists. Open it and add to it. A second look from another seat goes under "## Recheck". Nothing was overwritten.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, challengeTemplate(name));
  console.log(`Wrote ${path.relative(root, file)}. ${CHALLENGES[name].stage}.`);
  console.log(`Seat: ${CHALLENGES[name].seat}.`);
  console.log(`Read only: ${CHALLENGES[name].read}.`);
  console.log(QUESTION);
  console.log('Write the suspicions before you run anything, then test each one and fill in its proof and result. Run `100x solo check` when done.');
}

export default {
  name: 'solo',
  summary: 'Check and start the challenge files of a solo run.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' } } });
    const root = requireRoot();
    requireSolo(root);
    const [action = 'check', name, ...extra] = positionals;
    if (extra.length || (action !== 'new' && name)) throw new CliError('Usage: 100x solo [check] [--json] or 100x solo new <name>. Run `100x solo --help`.');
    if (action === 'check') return check(root, values.json);
    if (action === 'new') return write(root, name);
    throw new CliError(`100x solo takes check or new. Got "${action}". Run \`100x solo --help\`.`);
  },
};
