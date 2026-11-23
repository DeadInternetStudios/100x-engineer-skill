import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The hash the skills CLI (skills.sh) records for an installed skill (`skillFolderHash` in ~/.agents/.skill-lock.json for a global install, `computedHash` in a project's skills-lock.json), worked out the way its README says: every file the
// installer copies, by relative path with `/`, sorted by the UTF-8 bytes of the path, each fed to one SHA-256 as `path NUL length NUL content`. A text file
// has its CRLF turned into LF first. metadata.json files and the .git, __pycache__ and __pypackages__ folders are not copied, so they are not counted. A symlink that
// is broken, points outside the folder, or loops back to a folder above it is left out, as the CLI leaves it out.
const SKIPPED_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);

function collect(root, dir, found, above = [root]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name) || entry.name === 'metadata.json') continue;
    const full = path.join(dir, entry.name);
    let real;
    try {
      real = fs.realpathSync(full);
    } catch {
      continue;
    }
    if (real !== root && !real.startsWith(root + path.sep) && entry.isSymbolicLink()) continue;
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      if (!above.includes(real)) collect(root, full, found, [...above, real]);
    }
    else if (stat.isFile()) found.push(full);
  }
}

export function skillHash(folder) {
  const root = fs.realpathSync(folder);
  const files = [];
  collect(root, folder, files);
  const rows = files.map((file) => ({ rel: path.relative(folder, file).split(path.sep).join('/'), file })).sort((a, b) => Buffer.compare(Buffer.from(a.rel), Buffer.from(b.rel)));
  const hash = crypto.createHash('sha256');
  for (const { rel, file } of rows) {
    let content = fs.readFileSync(file);
    if (!content.includes(0)) content = Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
    hash.update(`${rel}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}
