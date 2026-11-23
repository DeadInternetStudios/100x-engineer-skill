import fs from 'node:fs';
import { readRun, stateFile } from './project.mjs';
import { buildReportHtml } from './report.mjs';
import { runDir } from './run-dir.mjs';
import { listProblems } from './runfile.mjs';

// The page a card links is the page this code writes. A run that finished before a fix to the page keeps its old page until something
// rebuilds it, so the gallery rebuilds the page of every run it shows, from the facts in that run's own folder. A folder with no facts, or
// a page that will not build, keeps what it has, because one run must not take down the page that shows the others. A run whose files
// moved aside when its folder started another run keeps its page: the facts in the folder now belong to the other run.
export function refreshReports(entries) {
  for (const entry of entries) {
    const root = entry.path;
    try {
      if (runDir(entry) !== stateFile(root)) continue;
      const run = readRun(root);
      if (!run || listProblems(run).length) continue;
      const html = buildReportHtml(root, run);
      const file = stateFile(root, 'REPORT.html');
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== html) fs.writeFileSync(file, html);
    } catch {
      // the page that is there stays
    }
  }
}
