import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { REPO_ROOT } from './paths.mjs';

// unslop-text has its own repository, tests and release pace. 100x ships a pinned copy of the folder it publishes as a skill,
// in vendor/, so a fresh clone of this repository is complete. companions.json records the commit the copy came from and a hash
// of its files, and `node scripts/vendor-companions.mjs` updates both.
export const COMPANIONS = {
  'unslop-text': { script: 'scripts/unslop.mjs', overrides: ['X100_UNSLOP_TEXT_CLI', 'X100_UNSLOP_TEXT'], command: 'text' },
};

export const vendorDir = (name, repo = REPO_ROOT) => path.join(repo, 'vendor', name);
export const pinsFile = (repo = REPO_ROOT) => path.join(repo, 'companions.json');

export function readPins(repo = REPO_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(pinsFile(repo), 'utf8'));
  } catch {
    return {};
  }
}

// The script to run. An environment variable points at a checkout while you work on the tool itself.
export function companionScript(name, repo = REPO_ROOT) {
  const spec = COMPANIONS[name];
  const override = spec.overrides.map((key) => process.env[key]).find(Boolean);
  return override ?? path.join(vendorDir(name, repo), spec.script);
}

const SKIP = new Set(['.DS_Store', 'node_modules', '.git']);

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

// One hash for a whole folder, from the relative path and the bytes of each file.
export function treeHash(dir) {
  const hash = crypto.createHash('sha256');
  for (const file of filesUnder(dir)) {
    hash.update(`${path.relative(dir, file).split(path.sep).join('/')}\0`);
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function checkVendored(repo = REPO_ROOT) {
  const pins = readPins(repo);
  return Object.keys(COMPANIONS).map((name) => {
    const pin = pins[name];
    const dir = vendorDir(name, repo);
    if (!pin) return { name, ok: false, problem: `${name} is not pinned in companions.json. Run node scripts/vendor-companions.mjs` };
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return { name, ok: false, problem: `vendor/${name} is missing. Run node scripts/vendor-companions.mjs` };
    if (treeHash(dir) !== pin.hash) return { name, ok: false, problem: `vendor/${name} differs from its pin (${pin.commit.slice(0, 7)}). Someone edited it by hand. Change the tool in its own repository, then run node scripts/vendor-companions.mjs` };
    return { name, ok: true, version: pin.version, commit: pin.commit.slice(0, 7) };
  });
}

function git(checkout, args) {
  const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Copy one companion's skill folder from a checkout into vendor/ and pin it.
export function vendorCompanion(name, checkout, { repo = REPO_ROOT, allowDirty = false } = {}) {
  const source = path.join(checkout, 'skills', name);
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) throw new CliError(`${source} has no SKILL.md. Point at the ${name} checkout.`);
  const commit = git(checkout, ['rev-parse', 'HEAD']);
  if (!commit) throw new CliError(`${checkout} is not a git checkout, so the pin has no commit to name.`);
  const dirty = git(checkout, ['status', '--porcelain', '--', `skills/${name}`]);
  if (dirty && !allowDirty) throw new CliError(`${name} has uncommitted changes in skills/${name}. Commit them first so the pin names real code, or pass --allow-dirty.`);
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8')).version ?? null;
  } catch {
    // a checkout without a package.json has no version to record
  }
  const target = vendorDir(name, repo);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, filter: (from) => !SKIP.has(path.basename(from)) });
  const pins = readPins(repo);
  pins[name] = { repo: git(checkout, ['remote', 'get-url', 'origin']), path: `skills/${name}`, version, commit, hash: treeHash(target) };
  fs.writeFileSync(pinsFile(repo), `${JSON.stringify(pins, null, 2)}\n`);
  return pins[name];
}

// Each tool prints its own program name in its help and in the commands it suggests. Through 100x those names do not run,
// so a name that starts one of the tool's commands is spelled the way 100x runs it. The tools themselves stay untouched.
const PRINTED = {
  'unslop-text': { name: 'unslop', script: 'unslop.mjs', as: '100x text', commands: ['lint', 'voice', 'plan', 'audit', 'check', 'claims', 'diff', 'begin', 'finish', 'restore', 'strings', 'apply', 'words', 'rules', 'profiles', 'demo', '<command>'] },
};

export function inOurWords(name, text) {
  const spec = PRINTED[name];
  const commands = spec.commands.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return text
    .replace(new RegExp(`(?<![\\w./-])${spec.name}(?= (?:${commands})(?![\\w-]))`, 'g'), spec.as)
    .replace(new RegExp(`(?<![\\w./-])${spec.name}(?= --help(?![\\w-]))`, 'g'), spec.as)
    .replace(new RegExp(`node \\S*/${spec.script.replace('.', '\\.')}(?= (?:${commands})(?![\\w-]))`, 'g'), spec.as)
    .replace(new RegExp(`^${spec.name}(?=: )`, 'gm'), spec.as)
    .replace(new RegExp(`^${spec.name}(?= [a-z])`), spec.as);
}

// With rename the output is read first, so the names in it can be respelled, and the input stays attached to the terminal.
export function runCompanion(name, args, { cwd = process.cwd(), stdio = 'inherit', rename = false } = {}) {
  const script = companionScript(name);
  if (!fs.existsSync(script)) throw new CliError(`${name} is not at ${script}. Run \`100x doctor\`.`);
  const piped = rename && stdio === 'inherit';
  const result = spawnSync(process.execPath, [script, ...args], { cwd, stdio: piped ? ['inherit', 'pipe', 'pipe'] : stdio, encoding: 'utf8', maxBuffer: 1 << 29 });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (piped) {
    process.stdout.write(inOurWords(name, stdout));
    process.stderr.write(inOurWords(name, stderr));
  }
  return { status: result.status ?? 1, stdout, stderr };
}
