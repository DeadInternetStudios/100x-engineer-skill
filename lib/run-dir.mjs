import fs from 'node:fs';
import path from 'node:path';

const runIdIn = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'finished.json'), 'utf8')).runId;
  } catch {
    return null;
  }
};

// The folder that holds one finished run's own files: its report, its picture, its review. A project's .100x is that folder until the
// project starts another run. The earlier run's files then move to .100x/archive/<time>, and the finished.json inside names the run.
export function runDir(entry) {
  const state = path.join(entry.path, '.100x');
  const live = runIdIn(state);
  if (live === entry.id) return state;
  const archive = path.join(state, 'archive');
  let moved = [];
  try {
    moved = fs.readdirSync(archive).sort().reverse();
  } catch {
    // nothing was ever archived here
  }
  const found = moved.map((name) => path.join(archive, name)).find((dir) => runIdIn(dir) === entry.id);
  if (found) return found;
  // The live folder names another run, or this project archived runs and none of them names this one, so this run's files are gone. A
  // folder that cannot exist makes every reader say so, where the live folder would show a newer run's report, picture and reasons as this
  // run's, even when that run has not finished yet and has no marker. Only a project that never archived anything has one run, and the live
  // folder is its.
  return live || moved.length ? path.join(archive, `gone-${entry.id}`) : state;
}
