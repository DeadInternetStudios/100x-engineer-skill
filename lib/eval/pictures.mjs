import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError } from '../errors.mjs';
import { INSTALL_HINT, resolvePlaywright } from '../playwright.mjs';
import { loadConfig, ORDERS, paths, readJson } from './blind.mjs';
import { bakeoffReport, scoreBakeoff } from './tally.mjs';
import { are, plural } from './words.mjs';

// One picture per real pair, with the arms named, made after the scoring. The judge never sees these. They hold the same screenshots it saw.
export const MAX_PICTURE = 300 * 1024;
const QUALITIES = [80, 65, 50, 35];
const html = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Each arm gets a column named for it, and each screenshot a caption. The pages are drawn as large as the 300 KB limit allows, which is an overview. The originals are
// the screens folders of the judge folders.
const WIDTH = 1420;
const montage = (title, arms) => `<!doctype html><meta charset="utf-8"><title>${html(title)}</title>
<style>
body{margin:0;background:#efece6;color:#1b1b1b;font:15px/1.35 ui-sans-serif,system-ui,sans-serif}
.row{display:flex;gap:36px;padding:18px 22px 20px;width:${WIDTH}px;box-sizing:border-box}
.arm{flex:1}
h3{margin:0 0 10px;font-size:18px}
.shots{display:flex;gap:14px;align-items:flex-start}
figure{margin:0}
figcaption{margin-top:6px;font-size:13px;color:#555}
img{display:block;border:1px solid #cfc9bd;background:#fff}
.phone{width:200px}
.desktop{width:460px}
</style>
<div class="row">${arms.map((arm) => `<div class="arm"><h3>${html(arm.name)}${arm.blank ? ' (left no page)' : ''}</h3><div class="shots"><figure><img class="phone" src="${arm.phone}"><figcaption>${html(arm.name)} · phone</figcaption></figure><figure><img class="desktop" src="${arm.desktop}"><figcaption>${html(arm.name)} · desktop</figcaption></figure></div></div>`).join('')}</div>`;

export async function buildPictures(dir, out, { progress = () => {} } = {}) {
  const where = paths(dir);
  const config = loadConfig(dir);
  const result = scoreBakeoff(dir);
  // The pictures and the report name the arms. Before every verdict is in, that would show the arms to whoever is still judging.
  if (result.missing.length || result.voided.length) {
    throw new CliError(`Judging is not finished: ${result.missing.length ? `${plural(result.missing.length, 'verdict')} ${are(result.missing.length)} missing` : ''}${result.missing.length && result.voided.length ? ' and ' : ''}${result.voided.length ? `${result.voided.length} ${are(result.voided.length)} void` : ''}. The gallery names the arms, so it would unblind the judges. Finish judging, run score, then run the gallery.`);
  }
  const key = readJson(where.key, 'the key');
  const real = key.items.filter((item) => item.kind === 'real');
  const screen = (item, label, name) => {
    const side = item.first === label ? 'A' : 'B';
    const file = path.join(where.judge, `${item.id}-${ORDERS[0]}`, side, 'screens', name);
    return fs.existsSync(file) ? file : null;
  };
  const missing = real.flatMap((item) => key.arms.flatMap((arm) => ['phone.png', 'desktop.png'].filter((name) => !screen(item, arm, name)).map((name) => `${item.id} ${arm} ${name}`)));
  if (missing.length) throw new CliError(`The pairs were built without screenshots (${missing.slice(0, 2).join(', ')}${missing.length > 2 ? ', ...' : ''}), so there is nothing to put in a picture. Build them without --no-capture.`);
  const found = resolvePlaywright();
  if (!found) throw new CliError(`Pictures need a browser. ${INSTALL_HINT}`);

  fs.mkdirSync(out, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bakeoff-pictures-'));
  const written = [];
  progress(`Making ${plural(real.length, 'picture')}. The browser starts first, which takes a few seconds.`);
  const browser = await found.playwright.chromium.launch({ args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 560 }, deviceScaleFactor: 1 });
    for (const item of real) {
      const brief = config.briefs.find((b) => b.id === item.brief);
      const file = path.join(work, `${item.brief}.html`);
      fs.writeFileSync(file, montage(brief.title, key.arms.map((name) => ({ name, blank: (key.blank ?? []).some((run) => run.brief === item.brief && run.arm === name), phone: pathToFileURL(screen(item, name, 'phone.png')).href, desktop: pathToFileURL(screen(item, name, 'desktop.png')).href }))));
      await page.goto(pathToFileURL(file).href);
      await page.waitForLoadState('load');
      let buffer;
      for (const quality of QUALITIES) {
        buffer = await page.screenshot({ type: 'jpeg', quality, fullPage: true });
        if (buffer.length <= MAX_PICTURE) break;
      }
      if (buffer.length > MAX_PICTURE) throw new CliError(`The picture for ${item.brief} is ${Math.round(buffer.length / 1024)} KB at the lowest quality, over the ${MAX_PICTURE / 1024} KB limit.`);
      fs.writeFileSync(path.join(out, `${item.brief}.jpg`), buffer);
      written.push({ brief: item.brief, file: `${item.brief}.jpg`, bytes: buffer.length });
      progress(`  picture ${written.length} of ${real.length}: ${item.brief}, ${Math.round(buffer.length / 1024)} KB`);
    }
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }

  const outcome = (pair) => (!pair ? 'not judged' : pair.outcome === 'win' ? `${pair.winner} won in both orders` : pair.outcome === 'flip' ? 'a flip: each order picked the page in its own A place, counted as a tie' : 'a tie');
  const lines = [bakeoffReport(result, config).trimEnd(), '', '## Pictures', '', `Each picture holds the opening screen on a phone and on a wide screen, the same screenshots the judge saw, each labelled with its arm and size. ${key.arms[0]} is on the left and ${key.arms[1]} on the right. The arms are named here because the judging is over. A picture is an overview, shrunk to stay under ${MAX_PICTURE / 1024} KB. The full-size screenshots are in the screens folder beside this report, and each line below links them.`, ''];
  for (const { brief, file } of written) {
    const spec = config.briefs.find((b) => b.id === brief);
    const item = real.find((entry) => entry.brief === brief);
    // The originals are copied beside the report. Linking into the judge folders breaks as soon as the report is not inside the bake-off folder, and that is where it is usually put.
    const originals = key.arms.flatMap((arm) => ['phone', 'desktop'].map((size) => {
      const copy = path.join('screens', brief, `${arm}-${size}.png`);
      fs.mkdirSync(path.dirname(path.join(out, copy)), { recursive: true });
      fs.copyFileSync(screen(item, arm, `${size}.png`), path.join(out, copy));
      return [`${arm} ${size}`, copy];
    }));
    lines.push(`### ${spec.title}`, '', `![${spec.title}: ${key.arms.join(' and ')}](${file})`, '', `Result: ${outcome(result.pairs.find((pair) => pair.brief === brief))}. Full size: ${originals.map(([label, relative]) => `[${label}](${relative})`).join(', ')}.`, '');
  }
  fs.writeFileSync(path.join(out, 'report.md'), `${lines.join('\n')}\n`);
  return { result, pictures: written, screens: written.length * key.arms.length * 2, report: path.join(out, 'report.md') };
}
