import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST = 'install.json';

const records = (list, required, optional = []) =>
  Array.isArray(list) &&
  list.every((record) => record && typeof record === 'object' && required.every((key) => typeof record[key] === 'string') && optional.every((key) => record[key] === undefined || typeof record[key] === 'string'));

// What an install wrote down, or null when there is no record or it is damaged: not JSON, or not lists of records with paths.
export function readManifest(home) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(home, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
  const manifest = { links: [], files: [], dirs: [], ...parsed };
  const sound = records(manifest.links, ['path', 'target'], ['replaced']) && records(manifest.files, ['path'], ['sha256']) && Array.isArray(manifest.dirs) && manifest.dirs.every((dir) => typeof dir === 'string');
  return sound ? manifest : null;
}

// The links an older install made to a skill that this repository no longer ships. Each one is recorded in install.json with a
// target under skills/ or vendor/ here, that target is gone, and the link is still in the skills folder pointing at it.
// A link recorded twice is one link, and it keeps the record that can give the owner's link back, whichever came first.
const restorable = (record) => typeof record.replaced === 'string' && fs.existsSync(record.replaced);

export function staleLinks(manifest, repo) {
  const shipped = ['skills', 'vendor'].map((dir) => path.join(repo, dir) + path.sep);
  const byPath = new Map();
  for (const record of manifest?.links ?? []) {
    const target = path.resolve(record.target);
    if (!shipped.some((dir) => target.startsWith(dir)) || fs.existsSync(target)) continue;
    try {
      if (!fs.lstatSync(record.path).isSymbolicLink() || path.resolve(path.dirname(record.path), fs.readlinkSync(record.path)) !== target) continue;
    } catch {
      continue;
    }
    const kept = byPath.get(record.path);
    if (!kept || (!restorable(kept) && restorable(record))) byPath.set(record.path, record);
  }
  return [...byPath.values()];
}
