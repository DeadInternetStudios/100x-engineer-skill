import fs from 'node:fs';
import path from 'node:path';
import { repositoryUrl } from './skill-meta.mjs';

// The Claude plugin is its own folder because the directory scans and ships only the folder that holds `.claude-plugin/plugin.json`, and this repository is
// much more than that: the CLI, the tests, the benchmarks and the docs. The folder holds the skills, a manifest, a README, an icon and the two notices. All of
// it except the two files in HAND_WRITTEN is written by `node scripts/build-claude-plugin.mjs` from package.json, skills/, LICENSE and NOTICE.md, so a release
// edits those and nothing else. A symbolic link would be refused by the directory, so every file is a real copy.
export const PLUGIN_DIR = path.join('plugins', '100x');
export const PLUGIN_NAME = '100x';
// The directory takes the listing icon from the first submission only, so it is a file of its own and the build never rewrites it.
export const ICON = 'assets/icon.png';
export const HAND_WRITTEN = ['README.md', ICON];
export const AUTHOR_NAME = 'Dead Internet Studios';
export const DESCRIPTION =
  'Runs one brief from plan to a reviewed, screenshot-proven prototype with a report: build, polish, a check on the one thing that must not break, and rounds of review by a second model. Needs the separate 100x command line tool.';

// What the directory lets through without a reviewer reading it. See https://claude.com/docs/plugins/pre-submission-checklist
export const LIMITS = { maxFiles: 512, maxTextBytes: 256 * 1024, minReadmeWords: 40 };

export function pluginManifest(pkg) {
  const repository = repositoryUrl(pkg);
  const owner = /github\.com\/([^/]+)\//.exec(repository)?.[1];
  return {
    name: PLUGIN_NAME,
    displayName: PLUGIN_NAME,
    icon: `./${ICON}`,
    version: pkg.version,
    description: DESCRIPTION,
    author: { name: AUTHOR_NAME, url: `https://github.com/${owner}` },
    homepage: repository,
    repository,
    license: pkg.license,
    keywords: pkg.keywords,
  };
}

// Every file under `dir` as a path with `/`, relative to `dir`, sorted. A missing folder has none.
export function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  if (fs.existsSync(dir)) walk('');
  return out.sort();
}

// The files the build owns, as relative path -> contents. The files in HAND_WRITTEN are not among them.
export function generatedFiles(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = new Map();
  files.set('.claude-plugin/plugin.json', Buffer.from(`${JSON.stringify(pluginManifest(pkg), null, 2)}\n`));
  for (const name of ['LICENSE', 'NOTICE.md']) files.set(name, fs.readFileSync(path.join(root, name)));
  for (const rel of listFiles(path.join(root, 'skills'))) files.set(`skills/${rel}`, fs.readFileSync(path.join(root, 'skills', rel)));
  return files;
}

// The ways the plugin folder differs from what the build would write: a file that is missing, one that differs, and one the build does not own.
export function pluginProblems(root) {
  const dir = path.join(root, PLUGIN_DIR);
  const want = generatedFiles(root);
  const problems = [];
  for (const [rel, bytes] of want) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) problems.push(`${rel} is missing`);
    else if (!fs.readFileSync(file).equals(bytes)) problems.push(`${rel} differs from its source`);
  }
  for (const rel of listFiles(dir)) if (!want.has(rel) && !HAND_WRITTEN.includes(rel)) problems.push(`${rel} is not written by the build`);
  for (const rel of HAND_WRITTEN) if (!fs.existsSync(path.join(dir, rel))) problems.push(`${rel} is missing`);
  return problems;
}

// Write the plugin folder, and remove what the build no longer owns so a renamed or deleted skill leaves nothing behind.
export function buildPlugin(root) {
  const dir = path.join(root, PLUGIN_DIR);
  const want = generatedFiles(root);
  let written = 0;
  for (const [rel, bytes] of want) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    written += 1;
  }
  let removed = 0;
  for (const rel of listFiles(dir)) {
    if (want.has(rel) || HAND_WRITTEN.includes(rel)) continue;
    fs.rmSync(path.join(dir, rel));
    removed += 1;
  }
  return { written, removed };
}
