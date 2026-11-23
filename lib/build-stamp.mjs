import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.mjs';

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return files(full);
  return /\.(mjs|json)$/.test(entry.name) ? [full] : [];
}).sort();

// A short name for the code that is on disk now. A server keeps the code it started with, so a server whose stamp differs from this one
// is serving an old page. A stamp from the files, not the git head, because an unmerged edit changes the page too.
export function buildStamp(root = REPO_ROOT) {
  const hash = crypto.createHash('sha1');
  for (const file of [...files(path.join(root, 'lib')), path.join(root, 'package.json')]) hash.update(path.relative(root, file)).update(fs.readFileSync(file));
  return hash.digest('hex').slice(0, 10);
}
