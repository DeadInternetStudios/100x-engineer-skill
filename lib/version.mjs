import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.mjs';
import { REPO_ROOT } from './paths.mjs';

// The version a bug report can name: the number in package.json and, when the install is a git checkout, the commit it is at and whether it was edited since.
// The install is a clone with links, so a pull changes the code under the same number, and the commit says which code ran.
export function versionLine() {
  const { version } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const commit = git(REPO_ROOT, ['rev-parse', '--short', 'HEAD']);
  if (!commit) return version;
  const dirty = git(REPO_ROOT, ['status', '--porcelain']);
  return `${version} (commit ${commit}${dirty ? ', with uncommitted changes' : ''})`;
}
