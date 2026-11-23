import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { browserSkip as skip, cli, ROOT, sandbox } from './helpers.mjs';
import { gradientPng } from './png.mjs';
import { makeProject, runJson } from './projects.mjs';

// The pages 100x writes for the owner are the product's own screen, so they have to hold up at phone, tablet and desktop sizes with
// nothing cut off and nothing overlapping. 100x shots is the check, the same one it runs on the owner's project.
const LONG = '0 broken of 212 elements across 15 viewports. Nothing is cut off and nothing overlaps at any size, and the first screen shows the picture and the title at every width.';

test('the gallery, the report page and the sheet of screen pictures have nothing broken at any size', { skip }, () => {
  const box = sandbox();
  const pages = {};
  for (const [name, overrides] of [['plain', {}], ['long', { mustNotBreak: { kind: 'screen-sizes', status: 'pass', summary: LONG }, tryFirst: ['Tap once', 'Rotate the phone and tap again to see the layout change'] }]]) {
    const root = path.join(box.dir, name);
    fs.mkdirSync(root, { recursive: true });
    makeProject(box, { root, run: runJson({ title: `Glow ${name}`, ...overrides }) });
    assert.equal(cli(['finish'], { cwd: root, env: box.env }).code, 0, name);
    // Real runs bring a phone-shaped picture as often as a wide one, so one of the two is tall, on the gallery and on the report page.
    if (name === 'long') fs.writeFileSync(path.join(root, '.100x', 'hero.png'), gradientPng(600, 1700));
    pages.report = path.join(root, '.100x', 'REPORT.html');
  }
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  pages.gallery = path.join(box.env.X100_HOME, 'morning', 'index.html');
  const sheetOut = path.join(box.dir, 'sheet');
  assert.ok([0, 1].includes(cli(['shots', path.join(ROOT, 'test', 'fixtures', 'clean.html'), '--matrix', 'standard', '--out', sheetOut], { cwd: box.project, env: box.env }).code));
  pages.sheet = path.join(sheetOut, 'contact-sheet.html');

  for (const [name, file] of Object.entries(pages)) {
    const out = path.join(box.dir, `shots-${name}`);
    const shots = cli(['shots', pathToFileURL(file).href, '--matrix', 'standard', '--out', out, '--fail-on-broken'], { cwd: box.project, env: box.env });
    assert.equal(shots.code, 0, `${name}: ${shots.out.slice(-1500)}${shots.err}`);
  }
  box.cleanup();
});
