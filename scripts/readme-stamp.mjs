// The README shows a picture of the report page, docs/img/morning-gallery.jpg. A page that changes while its picture does not leaves the
// README selling a page that is gone. This file stamps the picture with what the page looked like when it was drawn, and
// test/readme.test.mjs fails when the page the code builds now and the stamp disagree.
//
//   node scripts/readme-stamp.mjs     stamp the picture as it is, after you have looked at it and it shows the page
//   node scripts/readme-picture.mjs <page.html>     draw the picture from a page that `100x morning --all` wrote, and stamp it
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderGallery } from '../lib/gallery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PICTURE = path.join(ROOT, 'docs', 'img', 'morning-gallery.jpg');
export const STAMP = path.join(ROOT, 'docs', 'img', 'morning-gallery.stamp');

const sha = (data) => crypto.createHash('sha1').update(data).digest('hex');

// Three made-up runs for the README picture: a game, a business app and a phone app, each with a real-looking screenshot from docs/img/readme-art.
// Their folders are written once under the temporary folder, so the page links files that exist. The runs are made up and say so in the README.
const ART_DIR = path.join(ROOT, 'docs', 'img', 'readme-art');
const reviewed = (flags, fixed, rejected, deferred) => ({ status: 'reviewed', model: 'claude-opus-5-5', flags, fixed, rejected, deferred, rounds: { held: 5, planned: 5, lastReady: true, why: [] } });
function fixture() {
  const dir = path.join(os.tmpdir(), '100x-readme-stamp');
  const rows = [
    ['hearthfield', 'Farm game', 'A cozy farming game you watch from above: plant, harvest and grow the farm.', 'Harvest day. Every pumpkin pops and the coin counter rolls up.', 'A stranger gets it on the first tap, and the first screen is worth sending.', 'hearthfield.png', reviewed(17, 13, 3, 1), 'main-flow', ['Seasons', 'Animal care', 'Daily orders']],
    ['ledgerline', 'Cash flow forecast', 'A cash flow forecast for a small business that shows how many months of runway are left.', 'Move a late invoice and the whole forecast redraws, with the low point marked.', 'The numbers add up to the cent and the first screen answers the question the owner came with.', 'ledgerline.png', reviewed(21, 16, 4, 1), 'money-math', ['Scenarios', 'CSV import', 'Tax reminders']],
    ['highwater', 'Flood map', 'A 3D flood map for city planners that shows which homes go under as the water rises.', 'Drag the water level up and the low streets turn red, with the count of homes at risk.', 'The count matches the map, and the first screen answers how bad it gets.', 'highwater.png', reviewed(14, 11, 2, 1), 'main-flow', ['Rain scenarios', 'Export to PDF']],
  ];
  return rows.map(([name, title, pitch, moment, verdictWhy, art, review, kind, features], index) => {
    const root = path.join(dir, name);
    fs.mkdirSync(path.join(root, '.100x'), { recursive: true });
    fs.copyFileSync(path.join(ART_DIR, art), path.join(root, '.100x', 'hero.png'));
    fs.writeFileSync(path.join(root, '.100x', 'REPORT.html'), '<p>report</p>');
    return {
      id: `stamp${index}`, title, pitch, moment, verdict: 'ship', verdictWhy,
      path: root, heroRel: '.100x/hero.png', runCmd: 'npm run dev', url: 'http://localhost:5173/', finishedAt: `2026-01-0${index + 1}T12:00:00.000Z`,
      review, matrix: { label: 'final', totals: { broken: 0, weak: index }, viewports: 15, states: 4, examined: 212 + index * 40 },
      mustNotBreak: [{ kind, status: 'pass', summary: 'ok' }], features: features.map((name) => ({ name, cutHint: 'delete the folder' })),
    };
  });
}

// Writes the report page the code builds for those runs, for the picture. The times and the folder are fixed so the page is the same each time.
export function writePage() {
  const entries = fixture();
  const dir = path.dirname(entries[0].path);
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, renderGallery(entries, { mode: 'static', generatedAt: new Date('2026-01-01T12:00:00.000Z'), windowLabel: 'so far', all: true }));
  return file;
}

// A hash of the page as the picture shows it: its markup and its style. The script is not in a picture, and the times depend on the
// time zone of the machine, so neither is in the hash. The folder the made-up runs live in depends on the machine too.
export function pageStamp() {
  const entries = fixture();
  const dir = path.dirname(entries[0].path);
  const html = renderGallery(entries, { mode: 'static', generatedAt: new Date('2026-01-01T12:00:00.000Z'), windowLabel: 'so far', all: true });
  return sha(html
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<span>Finished [^<]*<\/span>/g, '')
    .replace(/<p class="meta">Built [^<]*<\/p>/, '')
    .split(pathToFileURL(dir).href).join('FIXTURE')
    .split(dir).join('FIXTURE')
    // On Windows the folder is written with backslashes below that point, and the stamp was made where they are slashes.
    .replace(/FIXTURE[^\s"'<>&]*/g, (path) => path.replaceAll('\\', '/')));
}

export const pictureStamp = () => sha(fs.readFileSync(PICTURE));
export const readStamp = () => JSON.parse(fs.readFileSync(STAMP, 'utf8'));

export function writeStamp() {
  fs.writeFileSync(STAMP, `${JSON.stringify({ page: pageStamp(), picture: pictureStamp() }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeStamp();
  console.log(`stamped ${path.relative(process.cwd(), PICTURE)} with the page the code builds now`);
}
