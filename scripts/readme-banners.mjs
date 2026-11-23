// Draws the link cards the README shows, as PNG files in docs/img/banners. The look comes from the judge rows of the README diagrams:
// a small amber label, a plain title, one gray line, and a solid amber block with an arrow on the right.
//
// The spec, so the next edit follows it:
//   surface  README asset, shown at 760 px and drawn at twice that, so it stays sharp on a phone and a retina screen
//   rules    square corners, like every other 100x picture. Every card is the same height. One label, one title, one line, one arrow
//   color    the diagram palette: near-black panel, white title, gray line, amber label and sign block
//   type     monospace capitals for the label and the line, sans for the title, baked into the picture
//
// The translated READMEs in i18n/ use the same cards in their language, drawn from scripts/readme-banners.i18n.json into
// docs/img/banners/<code>/. A right-to-left language turns the card around and its → becomes ←.
//
//   node scripts/readme-banners.mjs     (needs Playwright: 100x browsers)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from '../lib/playwright.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'img', 'banners');

// name, label, title, line, and the sign on the button, which says what a click does: ↓ jumps down this page, @ writes an email,
// → opens another page. The README links each picture; its alt text says the same words.
export const BANNERS = [
  ['built', 'PROJECTS', 'Built something with 100x?', 'Send it to theory@deadinternet.com', '@'],
  ['install', 'INSTALL', 'Two commands, then /100x-setup', 'Claude Code, Cursor or Codex · Node 22+', '↓'],
  ['issue', 'ISSUES', 'Did a run go wrong?', 'Tell us what you typed and what happened', '→'],
  ['contribute', 'CONTRIBUTING', 'Help make 100x better', 'Fixes, checks, docs, translations', '→'],
];

const C = { bg: '#0b0e14', edge: '#262e3d', text: '#eef1f6', muted: '#a3acbb', amber: '#ffb000', ink: '#0b0e14' };
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// In a right-to-left card, a run of Latin text (a command, a product name) is isolated so its slash and plus stay where they belong.
const ltr = (s, dir) => (dir === 'rtl' ? esc(s).replace(/[\/A-Za-z0-9][\x20-\x7E·]*[A-Za-z0-9+]/g, (run) => `<bdi dir=ltr>${run}</bdi>`) : esc(s));
const page = (label, title, line, sign, dir = 'ltr') => `<!doctype html><meta charset=utf-8><style>
*{margin:0;box-sizing:border-box;border-radius:0}
body{background:${C.bg}}
.b{width:760px;height:150px;background:${C.bg};border:1px solid ${C.edge};display:flex;align-items:center;justify-content:space-between;padding:0 26px 0 34px}
.l{font-family:${MONO};font-size:16px;font-weight:700;letter-spacing:.16em;color:${C.amber}}
.t{font-family:${SANS};font-size:36px;font-weight:700;color:${C.text};margin-top:6px;letter-spacing:-.01em;white-space:nowrap}
.s{font-family:${MONO};font-size:21px;color:${C.muted};margin-top:6px}
.a{width:92px;height:92px;flex:none;background:${C.amber};color:${C.ink};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-size:46px;font-weight:800}
.b[dir=rtl] .l,.b[dir=rtl] .s{font-family:${SANS};letter-spacing:0}
</style><div class=b dir=${dir}><div><div class=l>${ltr(label, dir)}</div><div class=t>${ltr(title, dir)}</div><div class=s>${ltr(line, dir)}</div></div><div class=a>${esc(sign)}</div></div>`;

const RTL = new Set(['ar', 'he', 'fa', 'ur']);
const TRANSLATIONS = path.join(ROOT, 'scripts', 'readme-banners.i18n.json');

if (import.meta.url === `file://${process.argv[1]}`) {
  const { playwright } = resolvePlaywright(process.cwd());
  const browser = await playwright.chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 760, height: 400 }, deviceScaleFactor: 2 });
  const clashes = [];
  const draw = async (dir, entries, rtl) => {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, label, title, line, sign] of entries) {
      await tab.setContent(page(label, title, line, rtl && sign === '→' ? '←' : sign, rtl ? 'rtl' : 'ltr'));
      const clash = await tab.evaluate(() => { const a = document.querySelector('.a').getBoundingClientRect(); return [...document.querySelectorAll('.l,.t,.s')].some((el) => { const r = el.getBoundingClientRect(); return document.querySelector('.b').dir === 'rtl' ? r.left < a.right + 12 : r.right > a.left - 12; }); });
      if (clash) clashes.push(`${path.relative(ROOT, dir)}/${name}`);
      await tab.locator('.b').screenshot({ path: path.join(dir, `${name}.png`) });
      console.log(path.relative(ROOT, path.join(dir, `${name}.png`)));
    }
  };
  await draw(OUT, BANNERS, false);
  const translations = fs.existsSync(TRANSLATIONS) ? JSON.parse(fs.readFileSync(TRANSLATIONS, 'utf8')) : {};
  for (const [code, cards] of Object.entries(translations)) {
    await draw(path.join(OUT, code), BANNERS.map(([name, , , , sign]) => [name, cards[name].label, cards[name].title, cards[name].line, sign]), RTL.has(code));
  }
  await browser.close();
  if (clashes.length) throw new Error(`The text runs into the button on ${clashes.join(', ')}. Shorten it in scripts/readme-banners.i18n.json`);
}
