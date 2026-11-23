import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { checkRewrite } from './check.mjs';
import { lintSource } from './lint.mjs';
import { readInput } from './cli.mjs';
import { UsageError, inFile } from './errors.mjs';

const ROOT = '.unslop';

export class SnapshotError extends Error {}

function storedPath(cwd, file) {
  const absolute = resolve(cwd, file);
  const inside = relative(cwd, absolute);
  if (!inside.startsWith('..') && !isAbsolute(inside)) return inside;
  return join('_outside', absolute.replace(/^[/\\]+/, '').replace(/[:\\/]/g, '_'));
}

// A snapshot name is a folder under .unslop, so it is one word: a path would put the saved originals
// outside the folder that .unslop/.gitignore covers.
const SNAPSHOT_NAME = /^(?!\.{1,2}$)[\w.-]+$/;

function snapshotRoot(cwd, name) {
  if (!SNAPSHOT_NAME.test(name)) throw new SnapshotError(`"${name}" cannot name a snapshot. Use one word of letters, digits, dots, dashes or underscores`);
  return join(cwd, ROOT, name);
}

function readManifest(cwd, name) {
  const path = join(snapshotRoot(cwd, name), 'manifest.json');
  if (!existsSync(path)) throw new SnapshotError(`no snapshot named "${name}". Run "unslop begin <files>" first`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new SnapshotError(`snapshot "${name}" is damaged: ${path} is not valid JSON. Delete the .unslop/${name} folder and run "unslop begin" again`);
  }
}

const leaves = (from, to) => {
  const path = relative(from, to);
  return path.startsWith('..') || isAbsolute(path);
};

// A manifest is a file a project can carry, so it is not trusted. Its saved copy has to sit inside the
// snapshot folder, still match the checksum written by "begin", and its file has to sit inside the
// working folder unless the person who runs the command says a file outside is meant.
function openEntry(cwd, name, entry, { allowOutside = false } = {}) {
  const folder = join(snapshotRoot(cwd, name), 'files');
  const saved = resolve(folder, String(entry.stored));
  const target = resolve(cwd, String(entry.path));
  if (leaves(folder, saved)) throw new SnapshotError(`snapshot "${name}" is damaged: the saved copy "${entry.stored}" points outside .unslop/${name}/files. Delete the .unslop/${name} folder and run "unslop begin" again`);
  if (!allowOutside && (leaves(cwd, target) || (existsSync(target) && leaves(realpathSync(cwd), realpathSync(target))))) {
    throw new SnapshotError(`"${entry.path}" is outside the working folder${leaves(cwd, target) ? '' : ' (a link leads there)'}. If you ran "unslop begin" on a file there, add --allow-outside`);
  }
  if (!existsSync(saved)) throw new SnapshotError(`snapshot "${name}" is damaged: the saved copy of "${entry.path}" is missing. Delete the .unslop/${name} folder and run "unslop begin" again`);
  const original = readInput(saved);
  if (createHash('sha1').update(original).digest('hex') !== entry.sha1) throw new SnapshotError(`the saved copy of "${entry.path}" changed after "unslop begin", so it cannot be trusted. Delete the .unslop/${name} folder and run "unslop begin" again`);
  return { saved, target, original };
}

export function begin(files, { cwd = process.cwd(), name = 'main', force = false, options = {} } = {}) {
  const root = snapshotRoot(cwd, name);
  if (existsSync(join(root, 'manifest.json')) && !force) {
    throw new SnapshotError(`snapshot "${name}" already exists. Run "unslop finish" to check it, use --name for a second one, or --force to replace it (this discards the saved originals)`);
  }
  const sources = files.map((file) => {
    const source = readInput(resolve(cwd, file));
    return { file, source, report: inFile(file, () => lintSource(source, { ...options, file })) };
  });
  mkdirSync(join(cwd, ROOT), { recursive: true });
  writeFileSync(join(cwd, ROOT, '.gitignore'), '*\n');
  mkdirSync(join(root, 'files'), { recursive: true });

  const entries = sources.map(({ file, source, report }) => {
    const stored = storedPath(cwd, file);
    const target = join(root, 'files', stored);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(cwd, file), target);
    return {
      path: file,
      stored,
      bytes: Buffer.byteLength(source),
      sha1: createHash('sha1').update(source).digest('hex'),
      profile: report.profile,
      format: report.format,
      ...(options.column === undefined ? {} : { column: options.column }),
      words: report.metrics.words,
      slop: report.scores.slop,
      slopBand: report.scores.slopBand,
      clarity: report.scores.clarity,
      clarityBand: report.scores.clarityBand,
    };
  });
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify({ version: 1, name, created: new Date().toISOString(), files: entries }, null, 2)}\n`);
  return { name, root, files: entries };
}

export function finish({ cwd = process.cwd(), name = 'main', allowOutside = false, options = {} } = {}) {
  const manifest = readManifest(cwd, name);
  const results = manifest.files.map((entry) => {
    // One damaged entry fails its own file, so the files around it still get their verdict.
    let opened;
    try {
      opened = openEntry(cwd, name, entry, { allowOutside });
    } catch (error) {
      if (!(error instanceof SnapshotError)) throw error;
      return { path: entry.path, status: 'FAIL', errors: [{ code: 'snapshot-damaged', message: error.message }], warnings: [], stats: null };
    }
    const { target: current, original: before } = opened;
    if (!existsSync(current)) return { path: entry.path, status: 'MISSING', errors: [{ code: 'file-missing', message: 'the file no longer exists' }], warnings: [], stats: null };
    let after;
    try {
      after = readInput(current);
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      return { path: entry.path, status: 'FAIL', errors: [{ code: 'invalid-text', message: error.message }], warnings: [], stats: null };
    }
    const result = checkRewrite(before, after, { profile: entry.profile, format: entry.format, column: entry.column, ...options, file: entry.path });
    let status = 'PASS';
    if (result.identical) status = 'UNCHANGED';
    else if (!result.ok) status = 'FAIL';
    else if (result.warnings.length) status = 'WARN';
    return { path: entry.path, status, errors: result.errors, warnings: result.warnings, stats: result.stats, profile: result.profile };
  });
  return { name, results };
}

export function restore(target, { cwd = process.cwd(), name = 'main', allowOutside = false } = {}) {
  const manifest = readManifest(cwd, name);
  const entries = target === 'all' ? manifest.files : manifest.files.filter((entry) => entry.path === target || resolve(cwd, entry.path) === resolve(cwd, target));
  if (!entries.length) throw new SnapshotError(`"${target}" is not in snapshot "${name}"`);
  // Every entry is opened before any file is written, so a damaged snapshot restores nothing.
  const opened = entries.map((entry) => openEntry(cwd, name, entry, { allowOutside }));
  for (const { saved, target: file } of opened) copyFileSync(saved, file);
  return entries.map((entry) => entry.path);
}
