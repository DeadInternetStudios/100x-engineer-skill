import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { requireRoot, stateFile } from '../project.mjs';
import { checkPrompt, renderPrompt } from '../prompt.mjs';

const usage = `
100x prompt [show] [--with-brief] [--where <dir>] [--out <file>]
100x prompt check [--json]

The prompt is the plan an agent writes for itself in .100x/project.md before it builds: what to read first, the rules, the riskiest
unknown, the asks, the scope, the test material, what not to do, and what the judge presses on. The guide to writing it is
references/prompt.md in the skill.
check lists what is wrong: a section that is missing, there twice or still the template's hint. A "none:" with no reason, or in a
section that cannot be none. Fewer than three rules, two judge questions, or three asks that count (a dropped ask does not). A riskiest
unknown with no question mark. A code fence or comment that never closes. Exit code 1 when anything is. It counts what is there, and
does not judge how good it is. A run that began before this step has no .100x/prompt-step file, and passes. So does a mockup.
show prints the prompt as one text to paste after the skill name in another chat: the goal first, then a WHERE line, then each section
that holds something. A section that says "none:" is left out, and so are dropped asks. It refuses while check has anything to say.
--with-brief adds the owner's words at the end. --where names the folder the other chat works in (a relative path starts at the project
folder), and the WHERE line then says nothing about this one. --out writes the text to a file.
Words in the text that would turn on a mode in the other chat are listed on stderr, with their line.
`;

const ONLY_FOR = { json: 'check', 'with-brief': 'show', where: 'show', out: 'show' };

export default {
  name: 'prompt',
  summary: 'Check the prompt in project.md, or print it to paste into another chat.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, 'with-brief': { type: 'boolean' }, where: { type: 'string' }, out: { type: 'string' } },
    });
    const [sub = 'show', ...extra] = positionals;
    if (extra.length || !['show', 'check'].includes(sub)) throw new CliError(`unknown prompt command "${positionals.join(' ')}". Use show or check.`);
    const stray = Object.keys(values).filter((flag) => ONLY_FOR[flag] !== sub);
    if (stray.length) throw new CliError(`--${stray[0]} is for \`100x prompt ${ONLY_FOR[stray[0]]}\`, not ${sub}.`);
    const root = requireRoot();
    if (!fs.existsSync(stateFile(root, 'project.md'))) throw new CliError('There is no .100x/project.md here. Write it first, from `100x init`.');
    const check = checkPrompt(root);
    if (sub === 'check') {
      if (values.json) console.log(JSON.stringify(check, null, 2));
      else if (check.style === 'older') console.log('project.md is from before the prompt step. Nothing to check.');
      else if (check.style === 'mockup') console.log('A mockup does not need the prompt. Nothing to check.');
      else if (check.ok) console.log(`prompt ok. ${check.written.length} written, ${check.none.length} marked none, ${check.asks} asks`);
      else {
        for (const message of check.errors) console.log(message);
        console.log('references/prompt.md in the skill says how to write each one.');
      }
      if (!check.ok) process.exitCode = 1;
      return undefined;
    }
    if (check.style === 'prompt' && !check.ok) {
      throw new CliError(`The prompt is not finished, so there is nothing to export yet.\n${check.errors.map((message) => `- ${message}`).join('\n')}\nFix these, then run this again.`);
    }
    if (check.style === 'older') console.error('note. This project.md is from before the prompt step, so the text holds only what it has.');
    if (check.style === 'mockup') console.error('note. A mockup has no prompt, so the text holds only what its project.md has.');
    const { text, notes } = renderPrompt(root, { withBrief: values['with-brief'], where: values.where });
    for (const note of notes) console.error(`note. ${note}`);
    if (!values.out) return process.stdout.write(text);
    const file = path.resolve(values.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`prompt ${file} (${text.split('\n').length} lines)`);
    return undefined;
  },
};
