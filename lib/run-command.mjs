import fs from 'node:fs';
import path from 'node:path';

const SHELL_JOINS = /&&|\|\||[;|]|\bcd\b/;
const PACKAGE_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const INTERPRETERS = new Set(['node', 'deno', 'python', 'python3', 'ruby', 'bash', 'sh', 'php']);
const DENO_SUBCOMMANDS = new Set(['run', 'serve']);
const OPENERS = new Set(['open', 'xdg-open']);
// npm only runs a script by name after `run`, apart from these. The others take a bare name too.
const BARE_SCRIPTS = { npm: ['start', 'test'], pnpm: ['start', 'test', 'dev'], yarn: ['start', 'test', 'dev'], bun: ['start', 'test', 'dev'] };
// A command that points at another package or folder is not this folder's to judge.
const ELSEWHERE_FLAGS = new Set(['--prefix', '-C', '--cwd', '--dir', '--workspace', '-w', '--filter']);
// Only a name that is plainly a file is looked for. Node and deno also run `src/server` and `run`, and those are not judged.
const SCRIPT_FILE = /\.(?:[cm]?js|jsx|tsx?|py|rb|php|sh|html?)$/i;
const PAGE_FILE = /\.html?$/i;

const unquote = (word) => word.replace(/^["']+|["']+$/g, '');
// A fragment or a query belongs to the address, not to the file.
const filePart = (word) => word.replace(/[#?].*$/, '');

function scriptsOf(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  } catch (error) {
    return error.code === 'ENOENT' ? null : undefined;
  }
}

// An address, a variable, a glob or a path under the home folder is not a file in this folder.
const isHere = (root, file) => /[$*`:~]/.test(file) || fs.existsSync(path.resolve(root, filePart(file)));

function missingFile(root, file, verb) {
  return SCRIPT_FILE.test(filePart(file)) && !isHere(root, file) ? `${verb} ${file}, and the project folder has no such file` : null;
}

// The morning page runs a prototype's command in its folder, so a command that names a package script or a file that the folder
// does not have cannot start it. Only the clear cases are judged, because a wrong refusal costs the whole night. A command with a
// `cd`, a pipe or a tool this does not know passes.
export function runCmdProblem(root, command) {
  if (SHELL_JOINS.test(command)) return null;
  const words = command.trim().split(/\s+/).map(unquote).filter((word) => word && !/^[A-Za-z_]\w*=/.test(word));
  const [tool, ...args] = words;
  if (!tool || args.some((arg) => ELSEWHERE_FLAGS.has(arg.split('=')[0]))) return null;

  if (PACKAGE_RUNNERS.has(tool)) {
    const verb = args[0];
    const script = verb === 'run' || verb === 'run-script' ? args[1] : BARE_SCRIPTS[tool].includes(verb) ? verb : null;
    if (!script || script.startsWith('-')) return null;
    if (SCRIPT_FILE.test(script)) return missingFile(root, script, 'runs');
    const scripts = scriptsOf(root);
    if (scripts === undefined) return null;
    if (scripts === null) return `runs the package script "${script}", and the project folder has no package.json`;
    if (script in scripts) return null;
    if (tool === 'npm' && script === 'start' && fs.existsSync(path.join(root, 'server.js'))) return null;
    const have = Object.keys(scripts);
    return `runs the package script "${script}", and package.json has ${have.length ? `only ${have.join(', ')}` : 'no scripts'}`;
  }

  if (INTERPRETERS.has(tool)) {
    if (args.some((arg) => ['-m', '-c', '-e', '-r'].includes(arg))) return null;
    const rest = tool === 'deno' && DENO_SUBCOMMANDS.has(args[0]) ? args.slice(1) : args;
    const file = rest.find((arg) => !arg.startsWith('-'));
    return file ? missingFile(root, file, 'runs') : null;
  }

  if (OPENERS.has(tool)) {
    const targets = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '-a' || args[i] === '-b') i += 1;
      else if (!args[i].startsWith('-')) targets.push(args[i]);
    }
    if (targets.length === 0 || targets.some((target) => isHere(root, target))) return null;
    return PAGE_FILE.test(filePart(targets[0])) ? `opens ${targets[0]}, and the project folder has no such file` : null;
  }

  if (tool.includes('/') && !isHere(root, tool)) return `runs ${tool}, and the project folder has no such file`;
  return null;
}
