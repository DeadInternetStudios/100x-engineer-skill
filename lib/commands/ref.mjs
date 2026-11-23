import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../errors.mjs';
import { REPO_ROOT } from '../paths.mjs';

const usage = `
100x ref [<name>]

Prints a shared reference of the 100x suite, such as \`100x ref apps\`. The files live in the references folder of the 100x skill. The other skills of the suite call
them by name instead of by a path out of their own folder, so a skill installed on its own with \`npx skills add\` still reads them.
With no name it lists every reference and what it is for. A name that is not listed exits with code 1.
`;

const dir = () => path.join(REPO_ROOT, 'skills', '100x', 'references');
export const references = () => (fs.existsSync(dir()) ? fs.readdirSync(dir()).filter((file) => file.endsWith('.md')).map((file) => file.slice(0, -3)).sort() : []);

// The first sentence under the title says what the file is for.
function purpose(name) {
  const lines = fs.readFileSync(path.join(dir(), `${name}.md`), 'utf8').split('\n').filter((line) => line.trim() && !line.startsWith('#'));
  const first = lines[0] ?? '';
  const sentence = first.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? first;
  return sentence.length > 110 ? `${sentence.slice(0, 107)}...` : sentence;
}

export default {
  name: 'ref',
  summary: 'Print a shared reference of the 100x suite by name.',
  usage,
  async run(argv) {
    const [name, ...extra] = argv;
    const names = references();
    if (!name) {
      const width = Math.max(...names.map((n) => n.length));
      for (const n of names) console.log(`${n.padEnd(width)}  ${purpose(n)}`);
      return undefined;
    }
    if (extra.length || !names.includes(name)) throw new CliError(`No reference called "${extra.length ? argv.join(' ') : name}". Run \`100x ref\` for the list: ${names.join(', ')}.`);
    process.stdout.write(fs.readFileSync(path.join(dir(), `${name}.md`), 'utf8'));
    return undefined;
  },
};
