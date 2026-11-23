import { execFileSync } from 'node:child_process';

export function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).toString().trim();
  } catch {
    return null;
  }
}

// A run tags each stage 100x/core, 100x/build and so on. The tags of an earlier run in the same project live under this prefix, so a
// second run finds its own names free, and the report of a run lists only that run's tags.
const EARLIER = '100x/archive/';

export function stageTags(root) {
  const out = git(root, ['tag', '-l', '100x/*']);
  return (out ? out.split('\n').filter(Boolean) : []).filter((tag) => !tag.startsWith(EARLIER));
}

// Moves the tags of the run that is being put aside to 100x/archive/<stamp>/<name>. The commits they name do not move. Returns the old names.
export function archiveStageTags(root, stamp) {
  const moved = [];
  for (const tag of stageTags(root)) {
    const to = `refs/tags/${EARLIER}${stamp}/${tag.slice('100x/'.length)}`;
    if (git(root, ['update-ref', to, `refs/tags/${tag}`]) === null) continue;
    git(root, ['update-ref', '-d', `refs/tags/${tag}`]);
    moved.push(tag);
  }
  return moved;
}

export function recentCommits(root, count = 30) {
  return git(root, ['log', `-${count}`, '--pretty=format:%h %s']) ?? '';
}

export const headCommit = (root) => git(root, ['rev-parse', 'HEAD']);

export const commitsAfter = (root, hash) => git(root, ['log', `${hash}..HEAD`, '--pretty=format:%h %s']) ?? '';

export function commitsSince(root, iso) {
  return git(root, ['log', `--since=${iso}`, '--pretty=format:%h %s']) ?? '';
}
