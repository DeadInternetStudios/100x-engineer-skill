import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolvePlaywright } from '../lib/playwright.mjs';
import { browserSkip as skip, cli, sandbox } from './helpers.mjs';
import { CHECK_OUTPUT, FINDINGS, makeProject, PROJECT_MD, runJson } from './projects.mjs';

const finish = (box) => cli(['finish'], { cwd: box.project, env: box.env });
const read = (box, name) => fs.readFileSync(path.join(box.project, '.100x', name), 'utf8');

const FAILING = {
  verdict: 'fine',
  mustNotBreak: [
    { kind: 'numbers', status: 'fail', summary: '3 of 5000 bills are off by a cent' },
    { kind: 'screen-sizes', status: 'pass', summary: '0 broken of 212 elements' },
  ],
};
const FAILING_OUTPUT = { numbers: '3 failing of 5000 random bills, off by one cent\n', 'screen-sizes': '0 broken of 212 elements across 15 viewports\n' };

test('a failing check is the first thing after the verdict in the message, the report and the page, in red before the good news', () => {
  const box = sandbox();
  makeProject(box, { run: runJson(FAILING), checkFiles: FAILING_OUTPUT });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Verdict: fine\. [^\n]*\nLook first: Numbers check FAILED\nThe moment:/);
  assert.match(read(box, 'REPORT.md'), /Verdict: fine\. [^\n]*\n\nLook first: Numbers check FAILED\n\nThe moment:/);
  const page = read(box, 'REPORT.html');
  assert.match(page, /<section class="alert" id="look-first" role="note" aria-label="Look first"><ul><li>Numbers check FAILED<\/li><\/ul><\/section>/, 'the red block starts with its first line, and its name is for a screen reader, because the pill above already says it');
  assert.doesNotMatch(page, /<h2>Look first<\/h2>/, 'one label for one thing');
  assert.ok(page.indexOf('id="look-first"') < page.indexOf('<h2>The moment</h2>'), 'the red block comes before the good news');
  assert.match(page, /<div class="bad"><dt>Must not break, numbers<\/dt><dd><span class="chip dud">FAILED<\/span>3 of 5000 bills are off by a cent<\/dd><\/div>/);
  assert.match(page, /<dt>Must not break, screen sizes<\/dt><dd><span class="chip ship">Passed<\/span>/);
  box.cleanup();
});

test('a run no judge looked at says so at the top and in red in the table', () => {
  const box = sandbox();
  makeProject(box, { judge: false, run: runJson({ verdict: 'fine', review: { status: 'unreviewed', note: 'the judge could not be reached' } }) });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /\nLook first: No judge looked at it\n/);
  const page = read(box, 'REPORT.html');
  assert.match(page, /aria-label="Look first"><ul><li>No judge looked at it<\/li><\/ul>/);
  assert.match(page, /<div class="bad"><dt>Review<\/dt><dd><span class="chip dud">Unreviewed<\/span>the judge could not be reached<\/dd><\/div>/);
  box.cleanup();
});

test('a judge that said not ready to ship is the first thing the report says, even when the verdict is ready to ship, and the reasons follow it in the judge\'s words', () => {
  const box = sandbox();
  makeProject(box, { findings: FINDINGS.replace('Ready to ship: yes', 'Ready to ship: no') });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /Verdict: ready to ship\. [^\n]*\nLook first: The judge said NOT ready to ship\nWhy not ready to ship: 1\) Upgrade button clipped at 320px \(fixed, not checked again\)\nThe moment:/);
  assert.match(read(box, 'REPORT.md'), /Verdict: ready to ship\. [^\n]*\n\nLook first: The judge said NOT ready to ship\n\nWhy not ready to ship:\n\n- Upgrade button clipped at 320px \(fixed, not checked again\)\n\nThe moment:/);
  const page = read(box, 'REPORT.html');
  assert.match(page, /<span class="chip dud">Not ready to ship<\/span>1 of 1 done/);
  assert.match(page, /<li>The judge said NOT ready to ship<ul class="reasons" aria-label="Why not ready to ship"><li>Upgrade button clipped at 320px<span class="state fixed">fixed, not checked again<\/span><\/li><\/ul><\/li>/);
  assert.ok(page.indexOf('class="reasons"') < page.indexOf('<h2>The moment</h2>'), 'the reasons come before the good news');
  const stored = JSON.parse(read(box, 'run.json')).review.rounds.why;
  assert.deepEqual(stored, [{ title: 'Upgrade button clipped at 320px', state: 'fixed' }], 'the run keeps its reasons, so a later run in the folder does not take them');
  box.cleanup();
});

test('a judge that refused for many reasons gets three in the message and the rest counted, and the report lists them all', () => {
  const box = sandbox();
  const findings = `${[1, 2, 3, 4, 5].map((n) => `## F${n} [major] Reason number ${n}\nWhere: shop\n`).join('\n')}\n## Verdict\nReady to ship: no\n`;
  const triage = 'F1 accept. fixed in a1b2c3d\nF2 defer. later, ticket 12\nF3 defer. later, ticket 13\nF4 defer. later, ticket 14\nF5 defer. later, ticket 15\n';
  makeProject(box, { findings, triage });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /\nWhy not ready to ship: 1\) Reason number 2 \(left for later\); 2\) Reason number 3 \(left for later\); 3\) Reason number 4 \(left for later\); and 2 more in the report\n/, 'what still stands comes first, and the fixed one is among the rest');
  assert.equal([...read(box, 'REPORT.md').matchAll(/^- Reason number \d/gm)].length, 5, 'the markdown report lists all five');
  const page = read(box, 'REPORT.html');
  assert.equal([...page.slice(page.indexOf('class="reasons"'), page.indexOf('<h2>The moment</h2>')).matchAll(/<li>Reason number \d/g)].length, 5, 'and so does the page');
  assert.match(page, /<section class="alert" id="look-first" role="note" aria-label="Look first">/, 'a card can link to the red block');
  box.cleanup();
});

test('a report whose reasons all ended the same way says it once under them', () => {
  const box = sandbox();
  const findings = `${[1, 2, 3].map((n) => `## F${n} [major] Reason number ${n}\nWhere: shop\n`).join('\n')}\n## Verdict\nReady to ship: no\n`;
  makeProject(box, { findings, triage: 'F1 defer. later, ticket 11\nF2 defer. later, ticket 12\nF3 defer. later, ticket 13\n' });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(read(box, 'REPORT.html'), /<li>The judge said NOT ready to ship<ul class="reasons" aria-label="Why not ready to ship"><li>Reason number 1<\/li><li>Reason number 2<\/li><li>Reason number 3<\/li><\/ul><p class="state left">All 3 reasons were left for later\.<\/p><\/li>/);
  assert.match(done.out, /\nWhy not ready to ship: 1\) Reason number 1 \(left for later\); 2\) Reason number 2 \(left for later\); 3\) Reason number 3 \(left for later\)\n/, 'the message is plain text and keeps its own words on each reason');
  box.cleanup();
});

test('the final message names three next asks and says how many more the report has', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ nextAsks: ['Save a list of friends', 'Round up to the dollar', 'Share the split as a picture', 'Add a dark mode', 'Print the receipt'] }) });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /\nNext likely asks: Save a list of friends; Round up to the dollar; Share the split as a picture; and 2 more in the report\n/);
  assert.doesNotMatch(done.out, /Print the receipt/);
  assert.match(read(box, 'REPORT.html'), /<li>Add a dark mode<\/li><li>Print the receipt<\/li>/, 'the page lists all of them');
  box.cleanup();
});

test('a clean run says nothing is red anywhere', () => {
  const box = sandbox();
  makeProject(box);
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.doesNotMatch(done.out, /Look first|Why not ready to ship/);
  assert.doesNotMatch(read(box, 'REPORT.md'), /Look first|Why not ready to ship/);
  assert.doesNotMatch(read(box, 'REPORT.html'), /Look first|Why not ready to ship/);
  box.cleanup();
});

test('a run written by hand with a title and nothing else still gets a page, and the page says what is missing', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  fs.writeFileSync(path.join(box.project, '.100x', 'run.json'), JSON.stringify({ title: 'Half <b>run</b>' }));
  const done = cli(['report'], { cwd: box.project, env: box.env });
  assert.equal(done.code, 0, done.err + done.out);
  const page = read(box, 'REPORT.html');
  assert.match(page, /<h1>Half &lt;b&gt;run&lt;\/b&gt;<\/h1><span class="badge fine">Not finished<\/span>/, 'a run with no verdict reads as one that is still going, not as a dud');
  assert.match(page, /This run has not finished, so most of this page is still empty\./);
  assert.doesNotMatch(page, /Look first|UNKNOWN|Unreviewed|not named|<h2>Run it<\/h2>|<h2>The moment<\/h2>/, 'nothing red, and nothing shown for a fact that is not there yet');
  assert.match(page, /<dt>Review<\/dt><dd>Not recorded yet\.<\/dd>/);
  assert.match(page, /<dt>Must not break<\/dt><dd>Not recorded yet\.<\/dd>/);
  box.cleanup();
});

test('a report with no run facts at all takes the name of its folder, and a run that has a verdict still says what it lacks', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  fs.rmSync(path.join(box.project, '.100x', 'run.json'), { force: true });
  assert.equal(cli(['report'], { cwd: box.project, env: box.env }).code, 0);
  assert.match(read(box, 'REPORT.html'), new RegExp(`<h1>${path.basename(box.project)}</h1><span class="badge fine">Not finished</span>`));
  fs.writeFileSync(path.join(box.project, '.100x', 'run.json'), JSON.stringify({ title: 'Done but bare', verdict: 'fine' }));
  assert.equal(cli(['report'], { cwd: box.project, env: box.env }).code, 0);
  const page = read(box, 'REPORT.html');
  assert.match(page, /<span class="badge look warn">No judge<\/span>/, 'a run that says it is done and has no proof wears the words its card wears, in the amber of proof that is only missing, and not its builder\'s fine');
  assert.match(page, /<section class="alert warn" id="look-first"/);
  assert.match(page, /<li>No check was recorded for the one thing that must not break<\/li><li>No judge looked at it<\/li>/);
  assert.match(page, /<span class="chip dud">Unreviewed<\/span>No reason given\./);
  assert.doesNotMatch(page, /<h2>Asks<\/h2>|0 of 0 closed|<summary>Trail\./, 'a run with no asks and no decisions on record has no section for them, because 0 of 0 reads as missing data');
  assert.doesNotMatch(read(box, 'REPORT.md'), /## Asks|## Trail|0 of 0/);
  fs.writeFileSync(path.join(box.project, '.100x', 'run.json'), JSON.stringify({ title: 'Done but failing', verdict: 'fine', mustNotBreak: { kind: 'main-flow', status: 'fail', summary: '1 of 3 flows failed' } }));
  assert.equal(cli(['report'], { cwd: box.project, env: box.env }).code, 0);
  const failing = read(box, 'REPORT.html');
  assert.match(failing, /<span class="badge look">Check failed<\/span>/, 'a check that failed is trouble found, which is red, and the word says which');
  assert.match(failing, /<section class="alert" id="look-first"/);
  box.cleanup();
});

test('on a phone the picture comes right after what the run is and takes a third of the screen at most, and a word with no break in it stays inside the screen', { skip }, async () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ moment: `Tap and ${'x'.repeat(120)} lights up`, tryFirst: ['Tap once', `Open ${'/very/long/path/'.repeat(8)}index.html`] }) });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  const browser = await resolvePlaywright().playwright.chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await tab.goto(pathToFileURL(path.join(box.project, '.100x', 'REPORT.html')).href);
    const look = await tab.evaluate(() => ({
      wider: document.documentElement.scrollWidth - window.innerWidth,
      introEnd: document.querySelector('.intro').getBoundingClientRect().bottom,
      pictureStart: document.querySelector('.hero').getBoundingClientRect().top,
      pictureEnd: document.querySelector('.hero').getBoundingClientRect().bottom,
      restStart: document.querySelector('.go').getBoundingClientRect().top,
    }));
    assert.ok(look.wider <= 0, `the page is ${look.wider}px wider than the phone`);
    assert.ok(look.pictureStart >= look.introEnd && look.pictureEnd <= look.restStart, 'the picture sits between what the run is and the rest, so the first screen has the picture too');
    assert.ok(look.pictureEnd - look.pictureStart <= 844 * 0.36 + 2, `the picture takes ${look.pictureEnd - look.pictureStart}px of an 844px screen, so the red block after it is on the first screen`);
  } finally {
    await browser.close();
  }
  box.cleanup();
});

test('the checks table keeps its own words when a run has no screen sizes to show', () => {
  const box = sandbox();
  makeProject(box, { matrix: null, run: runJson({ matrixSkipped: 'a command line tool has no screen', mustNotBreak: { kind: 'main-flow', status: 'pass', summary: '3 of 3 flows' } }), checkFiles: { 'main-flow': CHECK_OUTPUT } });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(read(box, 'REPORT.html'), /<dt>Screen sizes<\/dt><dd>Skipped, a command line tool has no screen<\/dd>/);
  box.cleanup();
});

test('the markdown report keeps each fact on its own line in a viewer: paragraphs and a list, never lines that run together', () => {
  const box = sandbox();
  makeProject(box, { run: runJson() });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  const text = read(box, 'REPORT.md');
  const checks = text.split('## Checks\n\n')[1].split('\n\n## Asks')[0].split('\n');
  assert.ok(checks.length >= 4, 'the checks section lists the checks');
  assert.ok(checks.every((line) => line.startsWith('- ')), `every check is a list item, got ${JSON.stringify(checks.filter((line) => !line.startsWith('- ')))}`);
  assert.match(text, /\nVerdict: [^\n]*\n\nThe moment: [^\n]*\n\nRun: /);
  box.cleanup();
});

test('the page lets the owner run it and look at it: the command with its folder and a copy button, and the picture as a link to the full one', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ runCmd: 'PORT=4173 npm start' }) });
  fs.writeFileSync(path.join(box.project, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  const page = read(box, 'REPORT.html');
  assert.match(page, /<code data-command>cd [^<]*project &amp;&amp; PORT=4173 npm start<\/code>/);
  assert.match(page, /<button type="button" data-copy="cd [^"]*project &amp;&amp; PORT=4173 npm start">Copy run command<\/button><a href="http:\/\/127\.0\.0\.1:5999\/">Then open http:\/\/127\.0\.0\.1:5999\/<\/a>/);
  assert.match(page, /<figure class="hero"><a href="hero\.png"><img src="hero\.png"/);
  assert.match(page, /<script>[^<]*data-copy[^<]*<\/script>/, 'the copy button has its script');
  box.cleanup();
});

test('the page links the contact sheet it names when there is one, and shows the run command as a block that wraps', () => {
  const sheet = (box) => write(path.join(box.project, '.100x', 'shots', 'final', 'contact-sheet.html'), '<!doctype html><title>sheet</title>');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const withSheet = sandbox();
  makeProject(withSheet, {});
  sheet(withSheet);
  assert.equal(finish(withSheet).code, 0);
  const linked = read(withSheet, 'REPORT.html');
  assert.match(linked, /<dt>Screen sizes<\/dt><dd>.*<a href="shots\/final\/contact-sheet\.html">Open the contact sheet<\/a><\/dd>/s);
  assert.match(linked, /\.run code\{display:block;overflow-wrap:anywhere/, 'the run command is one block that wraps, not pills');
  withSheet.cleanup();
  const without = sandbox();
  makeProject(without, {});
  assert.equal(finish(without).code, 0);
  assert.doesNotMatch(read(without, 'REPORT.html'), /Open the contact sheet/, 'no link to a page that is not there');
  without.cleanup();
});

test('a judge that never answered the ship question is not ready to ship on the page, and the page says what is missing in plain words', () => {
  const box = sandbox();
  makeProject(box, { findings: FINDINGS.replace(/^Ready to ship:.*$/m, '') });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  const page = read(box, 'REPORT.html');
  assert.match(page, /aria-label="Look first"[^>]*><ul><li>The judge never said whether it is ready to ship<\/li>/);
  assert.doesNotMatch(page, /class="badge ship"/, 'no ready to ship badge');
  box.cleanup();
});

test('a check with a long sentence says its first words in the row and keeps the whole of it behind them, and a short one stays as it was', () => {
  const box = sandbox();
  const medium = 'The main flow ran over 12 fixture repos with planted defects, and every one was found by name in the output, with the file and the line, in under a second each.';
  const long = `${medium} The seven that print colors were run again with the colors off, so the words were checked and not the escape codes around them.`;
  makeProject(box, { run: runJson({ mustNotBreak: { kind: 'screen-sizes', status: 'pass', summary: medium } }) });
  assert.equal(finish(box).code, 0);
  assert.match(read(box, 'REPORT.html'), /<dt>Must not break, screen sizes<\/dt><dd><span class="chip ship">Passed<\/span>The main flow ran over 12 fixture repos with planted defects, and every one was found by name in the output, with the file and the line, in under a second each\.<\/dd>/, 'a sentence that fits on a screen or two is read in the row, with no tap to open it');
  makeProject(box, { run: runJson({ mustNotBreak: { kind: 'screen-sizes', status: 'pass', summary: long } }) });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  const page = read(box, 'REPORT.html');
  const [, head, full] = /<dt>Must not break, screen sizes<\/dt><dd><span class="chip ship">Passed<\/span><details class="more"><summary>([^<]*)…<\/summary><p>([^<]*)<\/p><\/details><\/dd>/.exec(page) ?? [];
  assert.equal(full, long, 'the whole sentence is behind the row');
  assert.ok(long.startsWith(head) && head.length > medium.length && head.length <= 220 && /^\s/.test(long.slice(head.length)), `the row says as much as fits and stops at a word, it says ${JSON.stringify(head)}`);
  assert.match(page, /<dt>Polish passes<\/dt><dd>3<\/dd>/, 'a short fact is one line');
  box.cleanup();
});

test('asks read as "11 of 11 closed" with the ledger behind a click, and an ask that is still open stays in view', () => {
  const box = sandbox();
  const asks = Array.from({ length: 6 }, (_, i) => `- [x] ask number ${i + 1} (evidence: shots/final, ${i} broken)`).join('\n');
  makeProject(box, { projectMd: `# Demo\n\n## Asks\n${asks}\n- [~] print view (dropped: out of scope)\n- [ ] share link\n\n## Moment\nIt glows.\n` });
  cli(['report'], { cwd: box.project, env: box.env });
  const page = read(box, 'REPORT.html');
  assert.match(page, /<p class="count">7 of 8 closed\.<\/p><ul class="asks"><li><span class="chip dropped">Dropped<\/span><span>print view \(dropped: out of scope\)<\/span><\/li><li><span class="chip open">Open<\/span><span>share link<\/span><\/li><\/ul><details class="asksfold"><summary>All 8 asks<\/summary>/);
  assert.match(page, /<details class="asksfold">.*<span>ask number 1<\/span><\/li>.*What each one rests on is in <a href="REPORT\.md">REPORT\.md<\/a>, next to this page\./s, 'the fold lists each ask without the sentence it rests on, and links the file that keeps it');
  assert.doesNotMatch(page.slice(page.indexOf('asksfold')), /evidence: shots\/final/, 'that sentence stays in REPORT.md');
  assert.match(read(box, 'REPORT.md'), /ask number 1 \(evidence: shots\/final, 0 broken\)/);
  makeProject(box, { projectMd: `# Demo\n\n## Asks\n${asks}\n\n## Moment\nIt glows.\n` });
  cli(['report'], { cwd: box.project, env: box.env });
  const done = read(box, 'REPORT.html');
  assert.match(done, /<p class="count">6 of 6 closed\.<\/p><details class="asksfold">/, 'with nothing loose the count and the fold are all there is');
  makeProject(box, { projectMd: PROJECT_MD });
  cli(['report'], { cwd: box.project, env: box.env });
  assert.doesNotMatch(read(box, 'REPORT.html'), /<details class="asksfold">/, 'two asks are short enough to list');
  assert.match(read(box, 'REPORT.html'), /<section id="features">/);
  box.cleanup();
});
