import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { screenshotTo } from '../lib/matrix.mjs';
import { browserSkip as skip, cli, ROOT, sandbox } from './helpers.mjs';

const fixture = (name) => path.join(ROOT, 'test', 'fixtures', name);

function shots(args, box) {
  const out = path.join(box.dir, 'out');
  const result = cli(['shots', ...args, '--out', out, '--json'], { cwd: box.project, env: box.env });
  assert.ok([0, 1].includes(result.code), `exit ${result.code}. ${result.err}`);
  assert.ok(result.out.trim().startsWith('{'), `exit ${result.code} with no JSON on stdout (${result.out.length} bytes). stderr: ${result.err}`);
  return { json: JSON.parse(result.out), out, code: result.code };
}

const checksOf = (viewport, state = 0) => new Set(viewport.states[state].findings.map((f) => f.check));

test('a clean page passes every viewport in the standard matrix and writes all artifacts', { skip }, () => {
  const box = sandbox();
  const { json, out } = shots([fixture('clean.html')], box);
  assert.equal(json.viewports.length, 6);
  assert.deepEqual(json.summary.totals, { broken: 0, weak: 0, info: 0 }, JSON.stringify(json.viewports.flatMap((v) => v.states.flatMap((s) => s.findings))));
  assert.ok(json.summary.examined > 30, 'the report states how many elements it looked at');
  for (const file of ['matrix.json', 'matrix.json.seal', 'matrix.md', 'contact-sheet.html', 'contact-sheet.png']) assert.ok(fs.existsSync(path.join(out, file)), file);
  const sheet = fs.readFileSync(path.join(out, 'contact-sheet.png'));
  assert.equal(sheet.subarray(1, 4).toString(), 'PNG', 'the contact sheet is one image an agent can read');
  assert.ok(sheet.readUInt32BE(20) > 600, 'tall enough to hold the shots');
  assert.equal(fs.readdirSync(out).filter((f) => f.endsWith('.png') && f !== 'contact-sheet.png').length, 6);
  box.cleanup();
});

test('a page that cannot be opened is one finding per size, says nothing was measured, and exits 1', { skip }, () => {
  const box = sandbox();
  const result = cli(['shots', 'http://127.0.0.1:1/', '--viewports', '390x844', '--out', path.join(box.dir, 'out')], { cwd: box.project, env: box.env });
  assert.equal(result.code, 1, result.err);
  assert.match(result.out, /^NOT OPENED at any size\. could not open http:\/\/127\.0\.0\.1:1\//m);
  assert.match(result.out, /Nothing was measured\. Start the app or check the address/);
  assert.doesNotMatch(result.out, /zoomedOut|BROKEN blank/, 'no verdict on the browser\'s own error page');
  assert.match(result.out, /broken 1 /);
  box.cleanup();
});

test('the sheet that shows the pictures names each size in words, wraps the long path, and is itself clean on a phone', { skip }, () => {
  const box = sandbox();
  const { out } = shots([fixture('clean.html'), '--matrix', 'phone'], box);
  const html = fs.readFileSync(path.join(out, 'contact-sheet.html'), 'utf8');
  assert.match(html, /<h1>Screen sizes<\/h1>/);
  assert.match(html, /<p class="target" title="file:\/\/[^"]*clean\.html">/, 'the whole path is kept as the title');
  for (const words of ['Small phone, 320 by 568', 'Phone, small, 360 by 640', 'Phone, 390 by 844', 'Large phone, 430 by 932', 'Phone on its side, 844 by 390', 'Small phone on its side, 640 by 360']) assert.ok(html.includes(words), words);
  assert.match(html, /first screen\. <span>0 broken<\/span>, 0 weak/);
  assert.match(html, /0 broken, 0 weak, across 6 sizes and 1 state\./);
  assert.doesNotMatch(html.replace(/<(a|img)\b[^>]*>/g, ''), /phone-small-landscape|custom-\d|\d+x\d+-\d+x/, 'no internal size id is shown to the reader, only in the names of the picture files');
  // The sheet is a page like any other. The old one was wider than a phone because its heading was a path that could not wrap.
  const sheet = path.join(box.dir, 'sheet-out');
  const result = cli(['shots', path.join(out, 'contact-sheet.html'), '--viewports', '390x844@3,320x568@2,844x390@3', '--out', sheet, '--json'], { cwd: box.project, env: box.env });
  const json = JSON.parse(result.out);
  assert.deepEqual(json.summary.totals, { broken: 0, weak: json.summary.totals.weak, info: json.summary.totals.info }, JSON.stringify(json.viewports.flatMap((v) => v.states.flatMap((state) => state.findings))));
  assert.equal(json.viewports.flatMap((v) => v.states.flatMap((state) => state.findings)).filter((f) => f.check === 'zoomedOut').length, 0, 'nothing is wider than the screen');
  box.cleanup();
});

test('a broken page is caught on a phone for every seeded defect', { skip }, () => {
  const box = sandbox();
  const { json } = shots([fixture('broken.html'), '--viewports', '390x844@3'], box);
  const checks = checksOf(json.viewports[0]);
  for (const expected of ['console', 'zoomedOut', 'truncated', 'brokenImage', 'canvas', 'tinyTap', 'tinyText', 'viewportMeta']) {
    assert.ok(checks.has(expected), `missing ${expected}. Found ${[...checks]}`);
  }
  const canvas = json.viewports[0].states[0].findings.filter((f) => f.check === 'canvas').map((f) => f.detail).join(' | ');
  assert.match(canvas, /blurry/);
  assert.match(canvas, /stretched/);
  const boom = json.viewports[0].states[0].findings.some((f) => f.check === 'console' && /boom/.test(f.detail));
  assert.ok(boom, 'console.error text is reported');
  box.cleanup();
});

// The shots command blocks this process while it runs, so the folder is served by a child process.
function serve(folder) {
  const script = `
    import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
    http.createServer((req, res) => {
      const file = path.join(${JSON.stringify(folder)}, req.url === '/' ? 'index.html' : req.url);
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(fs.readFileSync(file));
    }).listen(0, '127.0.0.1', function () { console.log(this.address().port); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.stdout.once('data', (data) => resolve({ child, port: Number(String(data).trim()) }));
    child.once('error', reject);
  });
}

test('a page that loads a module from a file says the file is the problem, and the same page served is clean', { skip }, async () => {
  const box = sandbox();
  const folder = fixture('module-page');
  const fromFile = shots([folder, '--viewports', '390x844'], box);
  assert.ok(fromFile.json.summary.totals.broken > 0, 'a browser blocks the module on a file');
  assert.match(fromFile.json.hint, /opened from a file[\s\S]*Serve the folder/);
  assert.match(fs.readFileSync(path.join(fromFile.out, 'matrix.md'), 'utf8'), /\nNote\. The page was opened from a file/);
  const { child, port } = await serve(folder);
  try {
    const fromServer = shots([`http://127.0.0.1:${port}/`, '--viewports', '390x844'], box);
    assert.equal(fromServer.json.summary.totals.broken, 0, JSON.stringify(fromServer.json.viewports[0].states[0].findings));
    assert.equal(fromServer.json.hint, null);
  } finally {
    child.kill();
  }
  box.cleanup();
});

test('a cap on listed elements never hides how many there are', { skip }, () => {
  const box = sandbox();
  const { json } = shots([fixture('many-clipped.html'), '--viewports', '390x844@3'], box);
  const findings = json.viewports[0].states[0].findings.filter((f) => f.check === 'truncated');
  const listed = findings.filter((f) => !f.count);
  const aggregate = findings.find((f) => f.count);
  assert.equal(listed.length, 12, 'twelve are listed one by one');
  assert.equal(aggregate.count, 18, 'the other eighteen are one line with their number');
  assert.equal(aggregate.severity, 'broken', 'cut off buttons are broken, even past the cap');
  assert.match(aggregate.detail, /^18 more elements with text cut off/);
  assert.equal(json.summary.byCheck['broken:truncated'], 30, 'the totals count every element');
  assert.ok(json.summary.totals.broken >= 30);
  box.cleanup();
});

test('text that runs out of its chip or button is found, and text that fits or hides for screen readers is not', { skip }, () => {
  const box = sandbox();
  const { json } = shots([fixture('spill.html'), '--viewports', '390x844@3'], box);
  const findings = json.viewports[0].states[0].findings;
  const spill = findings.filter((f) => f.check === 'spill');
  const sels = spill.map((f) => f.sel);
  assert.ok(sels.includes('#narrow > b'), `the number is wider than its chip. Found ${sels}`);
  assert.ok(sels.includes('#narrow > small'), 'so is the line under it');
  assert.ok(sels.includes('#dear'), 'a button whose label is wider than the button');
  assert.equal(sels.some((sel) => /#roomy|#wrap/.test(sel)), false, 'text that fits, or wraps, is left alone');
  assert.ok(spill.every((f) => f.severity === 'broken'), 'text that leaves its box by more than a few pixels is broken');
  assert.match(spill.find((f) => f.sel === '#dear').detail, /sticks out of its own box by \d+px on the right/);
  assert.equal(findings.some((f) => f.check === 'truncated'), false, 'the visually hidden screen reader label is not a clipped text');
  box.cleanup();
});

test('content inside a closed details is not measured, the same content in an open one is', { skip }, () => {
  const box = sandbox();
  const { json } = shots([fixture('closed-details.html'), '--viewports', '390x844@3'], box);
  const findings = json.viewports[0].states[0].findings;
  const where = findings.map((f) => f.sel).join(' | ');
  assert.equal(/hidden-/.test(where), false, `nobody sees what is inside a closed details. Found ${where}`);
  assert.ok(findings.some((f) => f.check === 'spill' && /shown-chip/.test(f.sel)), `the open copy still spills. Found ${where}`);
  assert.equal(findings.some((f) => f.sel.endsWith('summary')), false, 'the summary of a closed details is always shown and is fine');
  box.cleanup();
});

test('with a modal open only its controls are compared, and a plain overlap is still reported', { skip }, () => {
  const box = sandbox();
  const modal = shots([fixture('modal-open.html'), '--viewports', '390x844@3'], box).json;
  assert.equal(modal.viewports[0].states[0].findings.some((f) => f.check === 'overlap'), false, JSON.stringify(modal.viewports[0].states[0].findings));
  const plain = shots([fixture('overlay-open.html'), '--viewports', '390x844@3'], box).json;
  assert.ok(plain.viewports[0].states[0].findings.some((f) => f.check === 'overlap'), 'two buttons on top of each other are weak');
  box.cleanup();
});

test('a modal that is still fading in when the page is checked counts as a modal', { skip }, () => {
  const box = sandbox();
  const { json, out } = shots([fixture('modal-entrance.html'), '--viewports', '390x844@3'], box);
  const state = json.viewports[0].states[0];
  assert.equal(state.findings.some((f) => f.check === 'overlap'), false, JSON.stringify(state.findings));
  assert.ok(fs.existsSync(path.join(out, state.shot)));
  box.cleanup();
});

test('a step that names a state twice gets a number instead of overwriting the first shot', { skip }, () => {
  const box = sandbox();
  const steps = JSON.stringify([{ shot: 'initial' }, { shot: 'initial' }, { shot: 'play' }]);
  const { json, out } = shots([fixture('clean.html'), '--viewports', '390x844@3', '--steps', steps], box);
  const states = json.viewports[0].states;
  assert.deepEqual(states.map((s) => s.name), ['initial', 'initial-2', 'initial-3', 'play']);
  assert.equal(new Set(states.map((s) => s.shot)).size, 4, 'four different files');
  for (const state of states) assert.ok(fs.existsSync(path.join(out, state.shot)), state.shot);
  box.cleanup();
});

test('texts.txt holds the strings a person reads, each once, including text a script wrote and excluding what nobody sees', { skip }, () => {
  const box = sandbox();
  const out = path.join(box.dir, 'out');
  const run = cli(['shots', fixture('strings.html'), '--viewports', '390x844@2,1440x900@1', '--out', out], { cwd: box.project, env: box.env });
  assert.ok([0, 1].includes(run.code), `exit ${run.code}. ${run.err}`);
  const lines = fs.readFileSync(path.join(out, 'texts.txt'), 'utf8').trimEnd().split('\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'matrix.json'), 'utf8')).strings, lines.length);
  assert.match(run.out, new RegExp(`texts +\\S+texts\\.txt \\(${lines.length} strings the page showed, one per line\\)\\. Lint the copy with 100x text lint <that file> --profile ui`));
  assert.equal(new Set(lines).size, lines.length, 'each string once, though two viewports showed it');
  for (const shown of [
    'Welcome back, friend', // the source case, not the uppercase CSS shows
    'Press Start to begin, or read the rules first.', // inline markup stays inside its sentence
    'First line', 'Second line after a break', 'One item', 'Another item',
    'Open the settings menu', 'A friendly fox', 'Type your name here', 'Your name', 'Send it now',
    'Screen reader only words', 'Closed details summary', 'Open details summary', 'Text inside an open details',
    'Chart title for readers', 'Chart label', 'Words a script wrote after load',
  ]) assert.ok(lines.includes(shown), `missing "${shown}". Got ${JSON.stringify(lines)}`);
  for (const hidden of ['Display none text', 'Hidden visibility text', 'Text inside a closed details', 'A string inside the script source', 'Please turn on scripts', 'Meta text nobody sees on the page', 'Strings page title', 'WELCOME BACK, FRIEND']) {
    assert.ok(!lines.some((line) => line.includes(hidden)), `"${hidden}" should not be there`);
  }
  assert.ok(!lines.includes('⚙'), 'a lone symbol is not copy');
  const none = cli(['shots', fixture('strings.html'), '--viewports', '390x844@1', '--no-checks', '--out', path.join(box.dir, 'plain')], { cwd: box.project, env: box.env });
  assert.equal(fs.existsSync(path.join(box.dir, 'plain', 'texts.txt')), false, 'screenshots only means no checks and no strings');
  assert.doesNotMatch(none.out, /texts /);
  box.cleanup();
});

test('a full-page shot of a very tall page is a picture, not a broken viewport', { skip }, () => {
  const box = sandbox();
  const { json, out } = shots([fixture('tall.html'), '--viewports', '390x844@2', '--full-page'], box);
  const state = json.viewports[0].states[0];
  assert.equal(json.summary.totals.broken, 0, JSON.stringify(state.findings));
  const png = fs.readFileSync(path.join(out, state.shot));
  assert.ok(png.readUInt32BE(20) >= 16000, `the picture is ${png.readUInt32BE(20)} px tall`);
  box.cleanup();
});

test('a capture that fails once is taken again, and one that keeps failing is cut and says so', async () => {
  const calls = [];
  const page = (failures) => ({
    viewportSize: () => ({ width: 390, height: 844 }),
    waitForTimeout: async () => {},
    evaluate: async () => 24000,
    screenshot: async (options) => {
      calls.push(options);
      if (calls.length <= failures) throw new Error('page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot');
    },
  });
  assert.equal(await screenshotTo(page(1), 'a.png', { fullPage: true, dpr: 2 }), null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].clip, undefined, 'the second try asks for the whole page');

  calls.length = 0;
  const cut = await screenshotTo(page(2), 'b.png', { fullPage: true, dpr: 2 });
  assert.deepEqual(cut, { height: 24000, limit: 8000 });
  assert.deepEqual(calls.at(-1).clip, { x: 0, y: 0, width: 390, height: 8000 });

  calls.length = 0;
  await assert.rejects(() => screenshotTo({ ...page(5), screenshot: async () => { throw new Error('Target closed'); } }, 'c.png', { fullPage: true, dpr: 1 }), /Target closed/);
  await assert.rejects(() => screenshotTo({ ...page(5), screenshot: async () => { throw new Error('Unable to capture screenshot'); } }, 'd.png', { fullPage: false, dpr: 1 }), /Unable to capture/);
});

test('one viewport that cannot be captured is a broken finding and the others still report', { skip }, () => {
  const box = sandbox();
  const { json, out } = shots([fixture('clean.html'), '--viewports', '390x844@3,30000x30000@1'], box);
  assert.equal(json.viewports.length, 2);
  assert.equal(json.viewports[0].states[0].counts.broken, 0, 'the normal viewport is untouched');
  const failed = json.viewports[1].states[0];
  assert.equal(failed.shot, null);
  assert.equal(failed.findings[0].check, 'viewportFailed');
  assert.equal(json.summary.totals.broken, 1);
  assert.match(fs.readFileSync(path.join(out, 'matrix.md'), 'utf8'), /\| none \|/);
  assert.ok(fs.existsSync(path.join(out, 'contact-sheet.png')));
  box.cleanup();
});

test('touch-only checks stay quiet on desktop while real defects are still reported', { skip }, () => {
  const box = sandbox();
  const { json } = shots([fixture('broken.html'), '--viewports', '1440x900@1'], box);
  const checks = checksOf(json.viewports[0]);
  for (const touchOnly of ['tinyTap', 'zoomedOut', 'viewportMeta']) assert.equal(checks.has(touchOnly), false, touchOnly);
  for (const real of ['canvas', 'truncated', 'brokenImage', 'tinyText']) assert.ok(checks.has(real), real);
  box.cleanup();
});

test('the laptop and short desktop sizes are not emulated as touch screens, and phones and tablets are', { skip }, () => {
  const named = sandbox();
  const { json: desktop } = shots([fixture('clean.html'), '--matrix', 'desktop'], named);
  for (const viewport of desktop.viewports) assert.equal(viewport.touch, false, viewport.name);
  const { json: phone } = shots([fixture('clean.html'), '--matrix', 'phone'], named);
  for (const viewport of phone.viewports) assert.equal(viewport.touch, true, viewport.name);
  named.cleanup();
});

test('a page of more than 4000 elements says how many were left unmeasured', { skip }, () => {
  const box = sandbox();
  const page = path.join(box.dir, 'long.html');
  fs.writeFileSync(page, `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>long</title><main>${'<p>row</p>'.repeat(4100)}</main>`);
  const { json } = shots([page, '--viewports', '390x844@2'], box);
  const state = json.viewports[0].states[0];
  assert.equal(state.examined.skipped, 4100 + 1 - 4000, 'the main element and the rows, less the cap');
  const note = state.findings.find((finding) => finding.check === 'notExamined');
  assert.ok(note, 'a clean count is not left standing for a page that was only partly checked');
  assert.equal(note.severity, 'weak');
  assert.match(note.detail, /were not measured/);
  box.cleanup();
});

test('a page whose main thread stops answering is one broken viewport, and the next size is still shot', { skip }, () => {
  const box = sandbox();
  const page = path.join(box.dir, 'hang.html');
  fs.writeFileSync(page, '<!doctype html><title>hang</title><p>hello</p><script>setTimeout(() => { for (;;) {} }, 100)</script>');
  const result = cli(['shots', page, '--viewports', '390x844@1', '--out', path.join(box.dir, 'out'), '--json'], { cwd: box.project, env: { ...box.env, X100_VIEWPORT_TIMEOUT_MS: '6000' } });
  assert.ok([0, 1].includes(result.code), result.err);
  const json = JSON.parse(result.out);
  const failed = json.viewports[0].states[0].findings.find((finding) => finding.check === 'viewportFailed');
  assert.ok(failed, JSON.stringify(json.viewports[0]));
  assert.match(failed.detail, /took longer than 6 s and was stopped, because the page stopped answering/);
  assert.ok(fs.existsSync(path.join(box.dir, 'out', 'matrix.json.seal')), 'the run still writes and signs its result');
  box.cleanup();
});

test('steps reach named states and a failing step is reported instead of crashing the run', { skip }, () => {
  const box = sandbox();
  const seed = path.join(box.dir, 'seed.js');
  fs.writeFileSync(seed, "localStorage.setItem('score', '1e300')");
  const steps = JSON.stringify([{ click: 'text=Start' }, { wait: 50 }, { shot: 'playing' }, { click: '#nope' }]);
  const { json, out } = shots([fixture('steps.html'), '--viewports', '390x844@3', '--steps', steps, '--init-script', seed], box);
  const names = json.viewports[0].states.map((s) => s.name);
  assert.deepEqual(names, ['initial', 'playing', 'step-4-failed']);
  assert.ok(checksOf(json.viewports[0], 2).has('stepFailed'));
  assert.equal(checksOf(json.viewports[0], 0).has('console'), false, 'the init script seeded the score before the page ran');
  assert.ok(fs.existsSync(path.join(out, json.viewports[0].states[1].shot)));
  box.cleanup();
});

test('without the init script the same page reports its console error', { skip }, () => {
  const box = sandbox();
  const { json } = shots([fixture('steps.html'), '--viewports', '390x844@3'], box);
  assert.ok(json.viewports[0].states[0].findings.some((f) => /no seeded score/.test(f.detail)));
  box.cleanup();
});

test('rotating without a reload exposes a layout that does not adapt', { skip }, () => {
  const box = sandbox();
  const bad = shots([fixture('static-canvas.html'), '--viewports', '844x390@2', '--resize-test'], box).json;
  assert.equal(bad.viewports[0].states[0].counts.broken, 0);
  assert.match(bad.viewports[0].states[1].name, /^rotated-390x844$/);
  assert.ok(bad.viewports[0].states[1].counts.broken > 0, 'the rotated state is broken');
  const good = shots([fixture('clean.html'), '--viewports', '844x390@2', '--resize-test'], box).json;
  assert.equal(good.viewports[0].states.length, 2);
  assert.equal(good.summary.totals.broken, 0);
  box.cleanup();
});

test('pixel art canvases are not called blurry and WebGL renders under software GL', { skip }, () => {
  const box = sandbox();
  const pixel = shots([fixture('pixel.html'), '--viewports', '390x844@3'], box).json;
  assert.equal(pixel.summary.totals.broken, 0, JSON.stringify(pixel.viewports[0].states[0].findings));
  const gl = shots([fixture('webgl.html'), '--viewports', '390x844@3'], box).json;
  assert.equal(gl.summary.totals.broken, 0, JSON.stringify(gl.viewports[0].states[0].findings));
  box.cleanup();
});

test('--fail-on-broken sets the exit code', { skip }, () => {
  const box = sandbox();
  assert.equal(shots([fixture('broken.html'), '--viewports', '390x844@3', '--fail-on-broken'], box).code, 1);
  assert.equal(shots([fixture('clean.html'), '--viewports', '390x844@3', '--fail-on-broken'], box).code, 0);
  box.cleanup();
});

test('--no-checks takes screenshots without findings', { skip }, () => {
  const box = sandbox();
  const { json, out } = shots([fixture('broken.html'), '--viewports', '390x844@3', '--no-checks'], box);
  assert.equal(json.viewports[0].states[0].findings.filter((f) => f.check !== 'console').length, 0);
  assert.ok(fs.readdirSync(out).some((f) => f.endsWith('.png')));
  box.cleanup();
});

test('inside a project the default output folder is .100x/shots/<label>', { skip }, () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const result = cli(['shots', fixture('clean.html'), '--viewports', '390x844@3', '--label', 'core'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.ok(fs.existsSync(path.join(box.project, '.100x', 'shots', 'core', 'matrix.json')));
  box.cleanup();
});

test('bad input is explained, not thrown', () => {
  const box = sandbox();
  const run = (...args) => cli(['shots', ...args], { cwd: box.project, env: box.env });
  assert.match(run().err, /Usage: 100x shots/);
  assert.match(run(fixture('clean.html'), '--matrix', 'huge').err, /Unknown matrix "huge"/);
  assert.match(run(fixture('clean.html'), '--viewports', '390').err, /Bad viewport "390"/);
  assert.match(run('nope.html').err, /no such file/);
  assert.match(run(fixture('clean.html'), '--steps', '{"click":1}').err, /Steps must be a JSON array|not valid JSON/);
  box.cleanup();
});

test('the sizes the skills quote for each matrix are the sizes the code runs', async () => {
  const { viewportsFor } = await import('../lib/matrix.mjs');
  const sizes = (name) => viewportsFor(name).map((v) => `${v.w}x${v.h}`);
  assert.deepEqual(sizes('phone'), ['320x568', '360x640', '390x844', '430x932', '844x390', '640x360']);
  const all = sizes('all');
  assert.equal(all.length, 15);
  assert.ok(all.includes('280x653') && all.includes('3440x1440'));
  assert.equal(viewportsFor('all').filter((v) => v.name.startsWith('tablet')).length, 2);
  assert.equal(viewportsFor('all').filter((v) => v.w >= 1024 && v.dpr === 1).length, 6);
  assert.deepEqual(sizes('all-rotate'), all);
});
