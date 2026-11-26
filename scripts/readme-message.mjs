// The final message of a made-up run appears as plain text in the README, in the 19 translated READMEs and in docs/pipeline.md. The code prints it, so
// these copies are written from the code and never by hand, and test/readme.test.mjs fails when one of them differs.
//
//   node scripts/readme-message.mjs            write the message into every copy
//   node scripts/readme-message.mjs --check    say which copies differ, and exit 1 when one does
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatSummary } from '../lib/report.mjs';
import { LEDGERLINE, SAMPLE } from './readme-sample.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each file and the made-up run whose message it shows. The block is the text fence that starts with the run's title and a colon.
export const COPIES = [
  { file: 'README.md', run: SAMPLE },
  ...fs.readdirSync(path.join(ROOT, 'i18n')).filter((name) => name.endsWith('.md')).sort().map((name) => ({ file: path.join('i18n', name), run: SAMPLE })),
  { file: path.join('docs', 'pipeline.md'), run: LEDGERLINE },
];

const fence = (run) => new RegExp(`\`\`\`text\\n(${escape(run.title)}: [\\s\\S]*?)\\n\`\`\``);

// What the file shows now, or null when it holds no such block.
export const shown = ({ file, run }) => fs.readFileSync(path.join(ROOT, file), 'utf8').match(fence(run))?.[1] ?? null;

export function write({ file, run }) {
  const full = path.join(ROOT, file);
  const text = fs.readFileSync(full, 'utf8');
  if (!fence(run).test(text)) throw new Error(`${file} has no text block that starts with "${run.title}: "`);
  fs.writeFileSync(full, text.replace(fence(run), () => `\`\`\`text\n${chatSummary(run)}\n\`\`\``));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stale = COPIES.filter((copy) => shown(copy) !== chatSummary(copy.run));
  if (process.argv.includes('--check')) {
    for (const copy of stale) console.log(`${copy.file} shows an old message`);
    process.exitCode = stale.length ? 1 : 0;
  } else {
    for (const copy of stale) write(copy);
    console.log(`wrote the message into ${stale.length} of ${COPIES.length} files`);
  }
}
