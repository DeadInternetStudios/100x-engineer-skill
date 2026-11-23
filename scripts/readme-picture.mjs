// Draws docs/img/morning-gallery.jpg, the picture the README shows, from the report page the code builds for the made-up runs in readme-stamp.mjs,
// then stamps it (see readme-stamp.mjs). The runs use the screenshots in docs/img/readme-art. Look at the picture before you commit it: it has to show
// the page the code builds now.
//
//   node scripts/readme-picture.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePlaywright } from '../lib/playwright.mjs';
import { PICTURE, writePage, writeStamp } from './readme-stamp.mjs';

// The picture leaves out each card's command drop-down and its folder and date lines, so the cards are shorter, and lines the buttons up
// along the bottom of the row. The page itself keeps all of them as they are.
// The page is drawn in its dark scheme, the one that matches the README diagrams, narrow and at twice the pixels, so its text is large when GitHub shows the picture at the width of the README.
const WIDTH = 1040;
const SCALE = 2;
const page = writePage();
const { playwright } = resolvePlaywright(process.cwd());
const browser = await playwright.chromium.launch({ args: ['--mute-audio'] });
try {
  const tab = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: SCALE, colorScheme: 'dark' });
  await tab.goto(pathToFileURL(page).href);
  await tab.addStyleTag({ content: 'main{padding-top:28px}.grid,.cards,ul.cards{grid-template-columns:repeat(3,1fr)!important}.cmd,.facts{display:none!important}.body{flex:1}.actions{margin-top:auto}' });
  await tab.waitForTimeout(600);
  const bottom = await tab.evaluate(() => Math.max(...[...document.querySelectorAll('.card')].map((card) => card.getBoundingClientRect().bottom + window.scrollY)));
  await tab.screenshot({ path: PICTURE, type: 'jpeg', quality: 86, fullPage: true, clip: { x: 0, y: 0, width: WIDTH, height: Math.ceil(bottom + 28) } });
} finally {
  await browser.close();
}
writeStamp();
console.log(`drew ${path.relative(process.cwd(), PICTURE)} and stamped it`);
