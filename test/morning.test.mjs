import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { freePort, listening, startServer } from '../lib/morning-server.mjs';
import { resolvePlaywright } from '../lib/playwright.mjs';
import { browserSkip as skip, cli, noFileLinks, sandbox, symlink } from './helpers.mjs';
import { gradientPng } from './png.mjs';
import { FINDINGS, makeProject, PNG, runJson } from './projects.mjs';

function finishedRuns(box, specs) {
  const roots = [];
  for (const [name, overrides, extra, project] of specs) {
    const root = path.join(box.dir, name);
    fs.mkdirSync(root, { recursive: true });
    makeProject(box, { root, run: runJson({ title: name, ...overrides }), ...project });
    if (/\btool\.mjs\b/.test(overrides.runCmd ?? '')) fs.writeFileSync(path.join(root, 'tool.mjs'), 'console.log("tool");\n');
    const result = cli(['finish'], { cwd: root, env: box.env });
    assert.equal(result.code, 0, result.err);
    roots.push(root);
    if (extra) extra(root);
  }
  return roots;
}

function request(base, route, { method = 'GET', headers = {}, host } = {}) {
  const url = new URL(route, base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { ...headers, ...(host ? { Host: host } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('morning ranks best verdict first, escapes text and writes a static gallery', () => {
  const box = sandbox();
  finishedRuns(box, [
    ['dud-one', { verdict: 'dud', verdictWhy: 'the core loop is dull' }],
    ['ship-one', { verdict: 'ship', title: '<script>alert(1)</script>' }],
    ['fine-one', { verdict: 'fine' }],
  ]);
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  const order = [...result.out.matchAll(/^0(\d) (ship|fine|dud)/gm)].map((m) => m[2]);
  assert.deepEqual(order, ['ship', 'fine', 'dud']);
  assert.match(result.out, /Report\. 3 prototypes/);
  const html = fs.readFileSync(path.join(box.home, '.100x', 'morning', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /data-copy="cd [^"]*ship-one &amp;&amp; npm run dev"/);
  box.cleanup();
});

test('a registry row the page cannot read is left out and named, and every other run still shows', () => {
  const box = sandbox();
  finishedRuns(box, [['good-one', {}]]);
  const registry = path.join(box.home, '.100x', 'runs.jsonl');
  const half = { id: 'half-row', title: 'Half', verdict: 'ship', finishedAt: '2026-11-19T00:00:00Z', path: '/tmp', heroRel: '.100x/hero.png', runCmd: 'npm start', review: null };
  fs.appendFileSync(registry, `${JSON.stringify(half)}\n${JSON.stringify({ id: 'old-shape', title: 'Old' })}\nnot json at all\n`);
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Report\. 1 prototype so far/);
  assert.match(result.err, /left out the registry row half-row in .*runs\.jsonl: pitch is missing\./);
  assert.match(result.err, /left out the registry row old-shape in .*runs\.jsonl: pitch is missing\. The other runs are shown\. `100x registry remove old-shape` drops it\./);
  assert.match(galleryHtml(box), /<p class="lede left-out">2 finished runs are left out of this page because their records are damaged\. <code>100x report<\/code> in a terminal names them\.<\/p>/, 'the page says it left runs out, so a missing run is not a mystery');
  assert.equal(cli(['registry', 'remove', 'half-row'], { env: box.env }).out.trim(), 'removed 1 run');
  assert.match(cli(['registry', 'remove', 'half-row'], { env: box.env }).out, /^no run has that id\./);
  box.cleanup();
});

test('the page counts a damaged run in the window it shows and no other, and says nothing when none is damaged', () => {
  const box = sandbox();
  finishedRuns(box, [['sound', {}]]);
  const registry = path.join(box.home, '.100x', 'runs.jsonl');
  const damaged = (id, finishedAt) => JSON.stringify({ id, title: id, finishedAt });
  cli(['morning'], { env: box.env });
  assert.doesNotMatch(galleryHtml(box), /left out of this page/, 'nothing is damaged, so the page says nothing');
  fs.appendFileSync(registry, `${damaged('recent', new Date().toISOString())}\n${damaged('old', new Date(Date.now() - 3 * 86400000).toISOString())}\n${damaged('undated', 'not a date')}\n`);
  cli(['morning'], { env: box.env });
  assert.match(galleryHtml(box), /2 finished runs are left out of this page because their records are damaged/, 'the last 18 hours hold the recent one and the one with no date, which cannot be shown to be old, and not the old one');
  fs.writeFileSync(registry, fs.readFileSync(registry, 'utf8').split('\n').filter((line) => !line.includes('"undated"')).join('\n'));
  cli(['morning'], { env: box.env });
  assert.match(galleryHtml(box), /1 finished run is left out of this page because its record is damaged/, 'one is left once the undated one is dropped');
  cli(['morning', '--all'], { env: box.env });
  assert.match(galleryHtml(box), /2 finished runs are left out of this page/, 'with every run in view the old one counts too');
  box.cleanup();
});

test('a row with a thin matrix, a hollow check or a broken reason list is left out and named, and the page still shows every other run', () => {
  const box = sandbox();
  finishedRuns(box, [['good-one', {}], ['thin-matrix', {}], ['hollow-check', {}], ['broken-reasons', {}]]);
  rewriteRegistry(box, (row) => {
    if (row.title === 'thin-matrix') row.matrix = {};
    if (row.title === 'hollow-check') row.mustNotBreak = [{}];
    if (row.title === 'broken-reasons') row.review = { ...row.review, rounds: { held: 1, planned: 1, lastReady: false, why: [null, { title: 'A reason' }] } };
  });
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Report\. 1 prototype so far/, 'the one good run is shown');
  assert.match(result.err, /left out the registry row \w+ in .*runs\.jsonl: the screen size counts are not numbers\./);
  assert.match(result.err, /left out the registry row \w+ in .*runs\.jsonl: a check has no status of pass, fail, skipped\./);
  assert.match(result.err, /left out the registry row \w+ in .*runs\.jsonl: the stored reasons are not a list of titles\./);
  assert.doesNotMatch(result.err, /TypeError|Cannot (read|destructure)/, 'the owner reads plain words, not a stack message');
  assert.match(galleryHtml(box), /<h2>good-one<\/h2>/);
  assert.doesNotMatch(galleryHtml(box), /thin-matrix|hollow-check|broken-reasons/, 'a damaged row has no card, so a check list with nothing in it makes no green line');
  assert.match(galleryHtml(box), /3 finished runs are left out of this page because their records are damaged/);
  box.cleanup();
});

test('a registry row from before the verdict and moment words changed shows in the gallery as Ready to ship', () => {
  const box = sandbox();
  finishedRuns(box, [['legacy-one', {}]]);
  rewriteRegistry(box, (row) => {
    row.verdict = 'wow';
    row.wow = row.moment;
    delete row.moment;
  });
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.doesNotMatch(result.err, /left out the registry row/, 'the old row is not damaged');
  assert.match(result.out, /1 ready to ship\./);
  assert.match(result.out, /\n01 ship legacy-one\. A thing that glows\.\n {3}moment The first tap lights the whole screen\./);
  const html = galleryHtml(box);
  assert.match(html, /<span class="badge ship">Ready to ship<\/span>/);
  assert.match(html, /<p class="lede">1 prototype so far\. 1 ready to ship\.<\/p>/);
  assert.match(html, /<p class="momentline"><span>The moment<\/span>The first tap lights the whole screen\.<\/p>/);
  assert.match(html, /data-filter="ship" aria-pressed="false">Ready to ship 1<\/button>/);
  box.cleanup();
});

test('a mockup is named in the ranking and counted on its own, not as a run no judge looked at', () => {
  const box = sandbox();
  finishedRuns(box, [['solid-one', {}], ['quick-idea', {}]]);
  const registry = path.join(box.home, '.100x', 'runs.jsonl');
  const rows = fs.readFileSync(registry, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const mock = rows.find((row) => row.title === 'quick-idea');
  mock.mode = 'mockup';
  mock.review = { status: 'unreviewed', note: 'mockup mode, no judges by design' };
  fs.writeFileSync(registry, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const out = cli(['morning', '--all'], { env: box.env }).out;
  assert.match(out, /2 prototypes so far, ranked by the builder's word\. 1 ready to ship, 1 mockup\./, 'a mockup is counted as a mockup, and the one ready to ship is a run that was judged');
  assert.ok(out.indexOf('solid-one') < out.indexOf('quick-idea'), 'a mockup ranks after every run that was built and judged');
  assert.doesNotMatch(out, /to look at first|never checked/, 'a mockup has no judge by design, so it is not a run to look at first');
  assert.match(out, /quick-idea \(mockup\)\./);
  assert.match(out, /a mockup, no judge by design/);
  assert.doesNotMatch(out, /solid-one \(mockup\)/);
  box.cleanup();
});

test('a run the judge refused says why in the ranking even past the best five, with how many more its card has, and the others stay one line', () => {
  const box = sandbox();
  finishedRuns(box, Array.from({ length: 8 }, (_, i) => [`run-${i}`, { verdict: i < 5 ? 'ship' : 'fine', title: `Run ${i}` }]));
  rewriteRegistry(box, (row) => {
    const rounds = { held: 3, planned: 5, lenses: ['code'] };
    row.review = { ...row.review, rounds: ['Run 5', 'Run 6'].includes(row.title) ? { ...rounds, lastReady: false, why: row.title === 'Run 5' ? REFUSED_WHY : [{ title: 'Only one reason', state: 'left' }] } : { ...rounds, lastReady: true } };
  });
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  const rest = result.out.slice(result.out.indexOf('The rest, one line each.'));
  assert.match(rest, /\n\d\d look Run 5\. A thing that glows\.[^\n]*\n {3}why {4}A second tab erases newer progress \(left for later\); and 2 more on its card\n/, 'the first reason and the count of the others');
  assert.match(rest, /\n\d\d look Run 6\. A thing that glows\.[^\n]*\n {3}why {4}Only one reason \(left for later\)\n/, 'a run with one reason has no count');
  assert.match(rest, /\n\d\d fine Run 7\. A thing that glows\.[^\n]*\n\d\d look Run 6\./, 'a run the judge passed stays one line');
  assert.equal([...rest.matchAll(/ {3}why /g)].length, 2, 'only the refused runs get the line');
  box.cleanup();
});

test('the best five get four lines in the ranking and every run after them gets one, and a gone picture is a quiet tile', () => {
  const box = sandbox();
  const longMoment = 'the moment of this one runs on past ninety characters, so its row leaves the moment out and does not stop it in the middle.';
  const roots = finishedRuns(box, Array.from({ length: 8 }, (_, i) => [`run-${i}`, { verdict: i < 2 ? 'ship' : 'fine', title: `Run ${i}`, moment: i === 3 ? longMoment : `the moment of run ${i}` }]));
  fs.rmSync(path.join(roots[3], '.100x', 'hero.png'));
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  const lines = result.out.split('\n');
  assert.equal(lines.filter((line) => /^ {3}run /.test(line)).length, 5, 'five runs show their run command');
  assert.match(result.out, /\nThe rest, one line each\. The gallery has the detail\.\n06 fine Run 4\. A thing that glows\. Moment: the moment of run 4\n07 fine Run 3\. A thing that glows\.\n08 fine Run 2\. A thing that glows\. Moment: the moment of run 2\n/, 'a row carries a moment that fits and leaves out one that would be cut');
  assert.ok(!result.out.includes('runs on past ninety'), 'the long moment is not cut into a row');
  const html = fs.readFileSync(path.join(box.home, '.100x', 'morning', 'index.html'), 'utf8');
  assert.equal([...html.matchAll(/class="shot none"/g)].length, 1, 'the run whose picture is gone gets the tile');
  assert.equal([...html.matchAll(/<img /g)].length, 7, 'the others keep their picture');
  assert.match(html, /<details class="ranked"><summary>How 100x ranks them<\/summary>/);
  box.cleanup();
});

const galleryHtml = (box) => fs.readFileSync(path.join(box.home, '.100x', 'morning', 'index.html'), 'utf8');
const rewriteRegistry = (box, change) => {
  const registry = path.join(box.home, '.100x', 'runs.jsonl');
  const rows = fs.readFileSync(registry, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  // A run that logged a decision before it finished left a started row, with the id its finished row replaced. That row is not a run to rewrite.
  for (const row of rows) if (row.started !== true) change(row);
  fs.writeFileSync(registry, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
};

test('a card is the decision: the picture, the title, how far to trust it, the moment and the buttons, with the command in a fold, and the facts left to the report', () => {
  const box = sandbox();
  finishedRuns(box, [['lantern', { tryFirst: ['Open /Users/someone/Documents/GitHub/lantern-hollow/index.html', 'Tap once'] }]]);
  rewriteRegistry(box, (row) => {
    row.review = { status: 'unreviewed', note: 'no judge was reachable' };
    row.mustNotBreak = [{ kind: 'game-economy', status: 'pass', summary: '6 golden cases, 0 failing' }];
  });
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /checks game economy passed\. UNREVIEWED\. screen sizes 0 broken 2 weak/);
  const html = galleryHtml(box);
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('class="trust') < at('class="momentline"') && at('class="momentline"') < at('class="actions"') && at('class="actions"') < at('class="cmd"'), 'the risk line and the moment come before the buttons, and the command comes last');
  assert.match(html, /<details class="cmd"><summary>The command<\/summary><code data-command>cd [^<]*lantern &amp;&amp; npm run dev<\/code><\/details>/);
  assert.doesNotMatch(html, /Try first|<dl class="facts"|<dt>Screen sizes|Why this verdict|Next likely asks/, 'the card leaves the facts to the report');
  assert.match(html, /1 prototype so far\. 1 to look at first\./);
  assert.match(html, /<div class="pic"><a class="shot"[^>]*>.*?<\/a><span class="badge look warn">No judge<\/span><\/div>/s, 'the badge sits on the picture and says what is missing, in amber because nothing was found wrong, and it does not say ready to ship');
  assert.doesNotMatch(html, /badge ship|<dt>Matrix|without a second-model review/);
  assert.match(result.out, /\n01 look lantern\./, 'the ranking uses the same word');
  box.cleanup();
});

test('every card says how far to trust its run in the same place, from its review and its checks and not from a flag a run may have lost', () => {
  const box = sandbox();
  finishedRuns(box, [['solid', {}], ['unjudged', {}], ['refused', {}], ['quick', {}], ['borrowed', {}]]);
  rewriteRegistry(box, (row) => {
    if (row.title === 'unjudged') row.review = { status: 'unreviewed', note: 'no judge was reachable' };
    if (row.title === 'refused') row.review = { ...row.review, rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false } };
    if (row.title === 'quick') {
      row.mode = 'mockup';
      row.review = { status: 'unreviewed', note: 'mockup mode, no judges by design' };
    }
    if (row.title === 'borrowed') row.review = { ...row.review, sameAsBuilder: true };
  });
  cli(['morning', '--all'], { env: box.env });
  const listed = cli(['registry', 'list'], { env: box.env }).out;
  assert.match(listed, /\blook +refused\b/, 'the registry list says look where the page does, and not the builder\'s ship');
  assert.match(listed, /\bship +quick \(mockup\)/);
  assert.match(listed, /\bship +solid\b/);
  let html = galleryHtml(box);
  const lineOf = (title) => new RegExp(`<h2>${title}</h2>[\\s\\S]*?<div class="trust (\\w+)"><p>([^<]*(?:<b>[^<]*</b>)?[^<]*)</p>`).exec(html);
  assert.deepEqual(lineOf('solid').slice(1), ['ok', 'A judge looked at it, and the checks pass.']);
  assert.deepEqual(lineOf('unjudged').slice(1), ['warn', 'No judge looked at it.'], 'a judge that is only missing is missing proof, which is amber');
  assert.deepEqual(lineOf('refused').slice(1), ['bad', 'The judge said NOT ready to ship.'], 'a judge that said no is trouble found, which is red');
  assert.deepEqual(lineOf('quick').slice(1), ['warn', 'A mockup, nobody judged it.']);
  assert.deepEqual(lineOf('borrowed').slice(1), ['warn', 'The judge was the model that built it.']);
  assert.match(html, /5 prototypes so far, ranked by the builder&#39;s word\. 2 ready to ship, 2 to look at first, 1 mockup\./, 'each run is counted once, under the one word its card carries');
  const cardOf = (title) => {
    const end = html.indexOf(`<h2>${title}</h2>`);
    return html.slice(html.lastIndexOf('<article', end), end);
  };
  const badge = (title) => /<span class="badge ([^"]+)">([^<]*)</.exec(cardOf(title)).slice(1);
  const builderSaid = (title) => />builder said ([^<]+)</.exec(cardOf(title))?.[1] ?? null;
  assert.deepEqual(badge('solid'), ['ship', 'Ready to ship']);
  assert.deepEqual(badge('refused'), ['look bad', 'Judge said no'], 'a ready to ship the judge refused does not wear the green badge, it says what the judge said, in red');
  assert.deepEqual(badge('unjudged'), ['look warn', 'No judge'], 'a missing judge is amber');
  assert.deepEqual(badge('quick'), ['mockup', 'Mockup'], 'a mockup says what it is, and does not wear a verdict nobody backed');
  assert.deepEqual(badge('borrowed'), ['ship', 'Ready to ship']);
  assert.deepEqual(['solid', 'refused', 'unjudged', 'quick', 'borrowed'].map(builderSaid), [null, 'ready to ship', 'ready to ship', 'ready to ship', null], 'where the badge no longer says the builder\'s word, the line under the picture does');
  const wholeCardOf = (title) => {
    const start = html.lastIndexOf('<article', html.indexOf(`<h2>${title}</h2>`));
    return html.slice(start, html.indexOf('</article>', start));
  };
  const blackButton = (title) => /<button type="button"( class="primary")? data-copy/.exec(wholeCardOf(title))[1] !== undefined;
  assert.deepEqual(['solid', 'refused', 'unjudged', 'quick', 'borrowed'].map(blackButton), [true, false, false, false, true], 'the black button is the one to press, so a run with something to look at first does not get it, and a mockup, which no judge backs, does not either');
  // A mockup row from before runs carried a mode is still a mockup when its folder has the mockup's file, and a run no judge looked at when it has not.
  rewriteRegistry(box, (row) => {
    delete row.mode;
  });
  cli(['morning', '--all'], { env: box.env });
  html = galleryHtml(box);
  assert.deepEqual(lineOf('quick').slice(1), ['warn', 'No judge looked at it.']);
  fs.writeFileSync(path.join(box.dir, 'quick', 'MOCKUP.md'), '# Quick idea\n');
  cli(['morning', '--all'], { env: box.env });
  html = galleryHtml(box);
  assert.deepEqual(lineOf('quick').slice(1), ['warn', 'A mockup, nobody judged it.']);
  box.cleanup();
});

test('a link on a card goes only where a file is: the report page, rebuilt from the run facts when it is old or gone, else a line that says it is gone, never the raw text, and a contact sheet only when it exists', () => {
  const box = sandbox();
  const roots = finishedRuns(box, [['paged', {}], ['plain', {}], ['bare', {}]]);
  fs.rmSync(path.join(roots[1], '.100x', 'REPORT.html'));
  fs.rmSync(path.join(roots[2], '.100x', 'REPORT.html'));
  fs.rmSync(path.join(roots[2], '.100x', 'REPORT.md'));
  fs.rmSync(path.join(roots[2], '.100x', 'run.json'));
  fs.writeFileSync(path.join(roots[0], '.100x', 'shots', 'final', 'contact-sheet.html'), '<p>sheet</p>');
  cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  const card = (title) => html.slice(html.indexOf(`<h2>${title}</h2>`), html.indexOf('</article>', html.indexOf(`<h2>${title}</h2>`)));
  assert.match(card('paged'), /<a href="[^"]*paged\/\.100x\/REPORT\.html">Report<\/a><a href="[^"]*paged\/\.100x\/shots\/final\/contact-sheet\.html">Contact sheet<\/a>/);
  assert.match(card('paged'), /<a href="[^"]*paged\/\.100x\/REPORT\.html#features">1 feature you can cut<\/a>/);
  assert.match(card('plain'), /<a href="[^"]*plain\/\.100x\/REPORT\.html">Report<\/a>/, 'a run whose page is gone gets it back from its facts');
  assert.ok(fs.existsSync(path.join(roots[1], '.100x', 'REPORT.html')));
  assert.doesNotMatch(card('plain'), /Contact sheet|REPORT\.md/, 'a contact sheet that is not there has no link, and the raw text has none ever');
  assert.doesNotMatch(card('bare'), /REPORT\.(md|html)|>Report</);
  assert.match(card('bare'), /<p class="note">The report of this run is gone from its folder\.<\/p>/);
  assert.doesNotMatch(card('bare'), /you can cut<\/a>/, 'the count of features is not a link when there is no report to open');
  box.cleanup();
});

test('a portrait picture is shown whole and a landscape one fills its box, and the page keeps a hidden button hidden', () => {
  const box = sandbox();
  finishedRuns(box, [['phone-game', {}], ['laptop-tool', {}]]);
  const heroOf = (name) => path.join(box.dir, name, '.100x', 'hero.png');
  fs.writeFileSync(heroOf('phone-game'), gradientPng(390, 844));
  cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  assert.equal([...html.matchAll(/<a class="shot tall" /g)].length, 1);
  assert.match(html, /<a class="shot tall" href="[^"]*phone-game\/\.100x\/hero\.png">/);
  assert.match(html, /<a class="shot" href="[^"]*laptop-tool\/\.100x\/hero\.png">/);
  assert.match(html, /\[hidden\]\{display:none!important\}/, 'the Stop and Open buttons are hidden by the page and not only by the attribute');
  box.cleanup();
});

test('a static page says that its buttons copy and where the one that runs is, and a served page says why a card has no Run', async () => {
  const box = sandbox();
  finishedRuns(box, [['with-address', {}], ['no-address', { url: undefined, runCmd: 'node tool.mjs' }]]);
  cli(['morning', '--all'], { env: box.env });
  const page = galleryHtml(box);
  assert.match(page, /<footer><details class="ranked"><summary>How 100x ranks them<\/summary><p>[^<]*<\/p><\/details><p class="how">This page copies each run command\. The page that <code>100x-report<\/code> opens in your browser has a Run button\.<\/p>/, 'the line is on the page below the cards, where the buttons are');
  assert.doesNotMatch(page.slice(0, page.indexOf('<footer>')), /This page copies each run command|How 100x ranks them/, 'the header holds the title, the counts and the filters, so the first card comes up the screen');
  assert.match(cli(['morning', '--all'], { env: box.env }).out, /\nThis page copies each run command\. The page that 100x-report opens in your browser has a Run button\.\n/, 'the terminal says it too');
  assert.doesNotMatch(page, /100x morning/, 'the owner says report, so no line on the page tells them to say morning');
  assert.match(page, /The page lost its server\. Call 100x-report and it starts again\./, 'the line the page shows when its server is gone names the skill to call');
  assert.doesNotMatch(page, /\bSay 100x\b/, 'no line on the page tells the owner to say a word');
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    const html = (await request(gallery.url, '')).body.toString();
    assert.doesNotMatch(html, /This page copies each run command|100x morning/);
    assert.equal([...html.matchAll(/No address is on record for it\. Copy the command and run it in a terminal\./g)].length, 1, 'only the card with nothing to open says so');
    assert.match(html, /<button type="button" class="primary" data-run="[^"]*">Run and open<\/button>/, 'the button says what a click does');
    assert.equal([...html.matchAll(/data-problem /g)].length, 1, 'the card with a Run button has a line for a start that fails');
    assert.doesNotMatch(html, /alert\(/, 'a start that fails is a line on the card and not a dialog');
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('a card, the ranking and the report always say what the run is, and the report adds the rest of the pitch unless it is the moment said again', () => {
  const box = sandbox();
  finishedRuns(box, [
    ['twice', { pitch: 'A glow toy for a phone. Tap once and the first screen lights up with a glow.', moment: 'The first tap lights up the whole screen with a glow.' }],
    ['apart', { verdict: 'fine', pitch: 'A tip splitter with big keys for the dinner table. It rounds each share to the cent.', moment: 'Tap a tip and the whole screen answers.' }],
    ['alone', { verdict: 'fine', pitch: 'Tap once and the first screen lights up with a glow.', moment: 'The first tap lights up the whole screen with a glow.' }],
  ]);
  const result = cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  const card = (title) => html.slice(html.indexOf(`<h2>${title}</h2>`), html.indexOf('</article>', html.indexOf(`<h2>${title}</h2>`)));
  assert.match(card('twice'), /<p class="what">A glow toy for a phone\.<\/p>/, 'the card says what it is, one sentence');
  assert.match(card('apart'), /<p class="what">A tip splitter with big keys for the dinner table\.<\/p>/);
  assert.match(card('alone'), /<p class="what">Tap once and the first screen lights up with a glow\.<\/p>/, 'a pitch that is the moment said again is still what the run is, because the name alone says nothing');
  assert.doesNotMatch(html, /rounds each share/, 'the card keeps the rest for the report');
  assert.ok(card('twice').indexOf('class="what"') < card('twice').indexOf('class="trust'), 'what it is comes before how far to trust it');
  assert.match(result.out, /\n01 ship twice\. A glow toy for a phone\.\n {3}moment The first tap lights up/, 'the ranking gives the title, what it is, and then the moment');
  assert.match(result.out, /\n\d\d fine apart\. A tip splitter with big keys for the dinner table\.\n/);
  assert.match(result.out, /\n\d\d fine alone\. Tap once and the first screen lights up with a glow\.\n/);
  assert.doesNotMatch(result.out, /rounds each share/);
  const page = (name) => fs.readFileSync(path.join(box.dir, name, '.100x', 'REPORT.html'), 'utf8');
  assert.match(page('twice'), /<p class="pitch">A glow toy for a phone\.<\/p>/, 'the rest of the pitch is the moment again, so the page leaves it out');
  assert.match(page('apart'), /<p class="pitch">A tip splitter with big keys for the dinner table\. It rounds each share to the cent\.<\/p>/);
  assert.match(page('alone'), /<p class="pitch">Tap once and the first screen lights up with a glow\.<\/p>/);
  box.cleanup();
});

test('the gallery rebuilds the report page of each run it shows from the run facts, so a card never links a page the code no longer writes', async () => {
  const box = sandbox();
  const [root] = finishedRuns(box, [['aged', {}]]);
  const page = path.join(root, '.100x', 'REPORT.html');
  fs.writeFileSync(page, '<!doctype html><title>old page</title><pre>| a | b |</pre>');
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const fresh = fs.readFileSync(page, 'utf8');
  assert.match(fresh, /<h1>aged<\/h1>/);
  assert.match(fresh, /data-copy="cd [^"]*aged &amp;&amp; npm run dev"/, 'the folder-named run command and its copy button, which the old page did not have');
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    fs.writeFileSync(page, '<p>old again</p>');
    await request(gallery.url, '');
    assert.match(fs.readFileSync(page, 'utf8'), /<h1>aged<\/h1>/, 'the served page does the same');
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  // A run whose facts cannot be read keeps the page it has, and the gallery still builds.
  fs.writeFileSync(path.join(root, '.100x', 'run.json'), '{broken');
  fs.writeFileSync(page, '<p>kept</p>');
  const again = cli(['morning', '--all'], { env: box.env });
  assert.equal(again.code, 0, again.err);
  assert.equal(fs.readFileSync(page, 'utf8'), '<p>kept</p>');
  box.cleanup();
});

test('a quiet window links to a page with every run in it, built beside it, so showing older runs is a tap and not a command to retype', () => {
  const box = sandbox();
  finishedRuns(box, [['older', {}]]);
  rewriteRegistry(box, (row) => {
    row.finishedAt = new Date(Date.now() - 3 * 86400000).toISOString();
  });
  const quiet = cli(['morning'], { env: box.env });
  assert.equal(quiet.code, 0, quiet.err);
  const dir = path.join(box.home, '.100x', 'morning');
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /<div class="empty"><p><b>Nothing finished in the last 18 hours\.<\/b><\/p><p><a href="index-all\.html">Show every finished run<\/a><\/p><\/div>/);
  assert.match(fs.readFileSync(path.join(dir, 'index-all.html'), 'utf8'), /<h2>older<\/h2>/);
  const shown = cli(['morning', '--all'], { env: box.env });
  assert.match(fs.readFileSync(/gallery (.*)/.exec(shown.out)[1], 'utf8'), /<h2>older<\/h2>/, 'with every run in view there is no link to follow');
  box.cleanup();
});

test('the filters sit in one row that scrolls sideways and stays at the top at every screen height, and a wide screen gets more columns', () => {
  const box = sandbox();
  finishedRuns(box, [['one', {}]]);
  cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  assert.match(html, /<\/header>\s*<div class="bar"><div class="filters" role="group"[^>]*>.*?<\/div><p class="shown" role="status"><\/p><\/div>\s*<div class="grid">/s, 'the bar comes after the title and before the cards, so it can stay while they scroll');
  assert.match(html, /\.bar\{position:sticky;top:0;z-index:5;/, 'it stays at every height, because it is one row that never grows');
  assert.doesNotMatch(html, /min-height:641px/, 'there is no height at which it behaves another way');
  assert.match(html, /\.filters\{display:flex;gap:8px;overflow-x:auto;/, 'one row that scrolls sideways, and not rows that wrap and grow the bar');
  assert.match(html, /\.shown\{position:absolute;[^}]*clip:rect\(0 0 0 0\)/, 'the count of what is shown is for a screen reader, and takes no room from the eye');
  assert.doesNotMatch(html, /\.rank\{display:none\}/, 'a run keeps its place in the whole list when the list is filtered');
  assert.match(html, /@media \(min-width:1800px\)\{main\{max-width:min\(2400px,100%\)\}\}/);
  box.cleanup();
});

test('in a real browser a filter says how many runs it keeps, each keeps its own rank, and the bar stays at the top while the cards scroll', { skip }, async () => {
  const box = sandbox();
  finishedRuns(box, [['one', {}], ['two', {}], ['three', {}]]);
  rewriteRegistry(box, (row) => {
    if (row.title === 'two') row.review = { status: 'unreviewed', note: 'no judge was reachable' };
    if (row.title === 'three') {
      row.mode = 'mockup';
      row.review = { status: 'unreviewed', note: 'mockup mode, no judges by design' };
    }
  });
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
    const shown = page.locator('.shown');
    assert.deepEqual(await page.$$eval('.filters button', (buttons) => buttons.map((button) => button.textContent)), ['All 3', 'No judge 1', 'Ready to ship 1', 'Mockup 1'], 'a button for each word a badge says');
    await page.click('[data-filter="no-judge"]');
    assert.equal(await shown.innerText(), 'Showing 1 of 3');
    assert.match(await page.$eval('.card:not([hidden]) .rank', (rank) => rank.textContent), /^No\. 02/, 'the run with no judge, and only that one');
    await page.click('[data-filter="all"]');
    assert.equal(await shown.innerText(), '', 'with every run in view there is nothing to count');
    const barHeight = () => page.evaluate(() => document.querySelector('.bar').getBoundingClientRect().height);
    const before = await barHeight();
    assert.equal(await page.$$eval('.filters button', (buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size), 1, 'every button is in one row');
    await page.click('[data-filter="mockup"]');
    assert.equal(await shown.innerText(), 'Showing 1 of 3');
    assert.equal(await barHeight(), before, 'pressing a button does not make the bar taller');
    const visible = await page.$$eval('.card:not([hidden])', (cards) => cards.map((card) => card.querySelector('.rank').textContent));
    assert.equal(visible.length, 1);
    assert.match(visible[0], /^No\. 03/, 'the mockup is still the third run, and is not renumbered as the first');
    await page.click('[data-filter="all"]');
    assert.equal(await shown.innerText(), '');
    await page.evaluate(() => window.scrollTo(0, 900));
    const top = await page.evaluate(() => document.querySelector('.bar').getBoundingClientRect().top);
    assert.ok(Math.abs(top) <= 1, `the bar is at the top of the screen after scrolling, it is ${top}px from it`);
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('in a real browser the ring that shows which picture has the keyboard is drawn inside its card, which cuts off anything outside it', { skip }, async () => {
  const box = sandbox();
  const roots = finishedRuns(box, [['tall-shot', {}], ['wide-shot', {}]]);
  fs.writeFileSync(path.join(roots[0], '.100x', 'hero.png'), gradientPng(600, 1700));
  fs.writeFileSync(path.join(roots[1], '.100x', 'hero.png'), gradientPng(1280, 720));
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
    const rings = [];
    for (let press = 0; press < 40 && rings.length < 2; press += 1) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const link = document.activeElement;
        if (!link?.matches('a.shot')) return null;
        const style = getComputedStyle(link);
        return { tall: link.classList.contains('tall'), style: style.outlineStyle, reach: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset) };
      });
      if (ring) rings.push(ring);
    }
    assert.deepEqual(rings.map((ring) => ring.tall).sort(), [false, true], 'Tab reached a tall picture and a wide one');
    for (const ring of rings) assert.ok(ring.style !== 'none' && ring.reach <= 0, `the ring stays inside the link, so the card does not cut it: ${JSON.stringify(ring)}`);
    await page.goto(pathToFileURL(path.join(roots[1], '.100x', 'REPORT.html')).href);
    let report = null;
    for (let press = 0; press < 20 && !report; press += 1) {
      await page.keyboard.press('Tab');
      report = await page.evaluate(() => {
        const link = document.activeElement;
        if (!link?.matches('.hero a')) return null;
        const style = getComputedStyle(link);
        return { style: style.outlineStyle, reach: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset) };
      });
    }
    assert.ok(report && report.style !== 'none' && report.reach <= 0, `the report page keeps the ring inside the picture's link too: ${JSON.stringify(report)}`);
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('in a real browser the badge sits on the seam under the picture, and beside it on a phone on its side, and the first reason of the first card is on the first screen of both', { skip }, async () => {
  const box = sandbox();
  finishedRuns(box, [['lantern-point', { title: 'Lantern Point' }], ['unicorn-academy', { title: 'Unicorn Academy' }]]);
  const why = ['Quitting the game in the middle of a purchase loses the purchase and gives no way to ask for it back', 'The sound plays on load before anyone has pressed anything at all', 'Nothing says what happens at zero people'].map((title) => ({ title, state: 'left' }));
  rewriteRegistry(box, (row) => {
    row.review = { ...row.review, rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false, why } };
  });
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
    const measure = () => page.evaluate(() => {
      const card = document.querySelector('.card');
      const at = (selector) => {
        const { top, bottom, left, right } = card.querySelector(selector).getBoundingClientRect();
        return { top, bottom, left, right };
      };
      return { pic: at('.pic'), badge: at('.badge'), title: at('h2'), rank: at('.rank'), reason: at('.reasons li'), screen: innerHeight };
    });
    const upright = await measure();
    assert.ok(upright.badge.top < upright.pic.bottom && upright.badge.bottom > upright.pic.bottom, 'the badge crosses the bottom edge of the picture');
    assert.ok(upright.badge.top > upright.pic.top + (upright.pic.bottom - upright.pic.top) / 2, 'and covers none of the top of the picture, where a screenshot has its title and its menu');
    assert.ok(upright.badge.bottom <= upright.rank.top, 'and the words under it start below it');
    assert.ok(upright.reason.bottom <= upright.screen, `the first reason ends at ${upright.reason.bottom}px on a screen ${upright.screen}px tall`);
    await page.setViewportSize({ width: 844, height: 390 });
    const sideways = await measure();
    assert.ok(sideways.badge.left < sideways.pic.right && sideways.badge.right > sideways.pic.right, 'on its side the badge crosses the right edge of the picture');
    assert.ok(sideways.badge.right <= sideways.title.left, 'and the title starts after it');
    assert.ok(sideways.title.top < sideways.screen / 2, 'the card is a row, so its title is in the top half of the screen');
    assert.ok(sideways.reason.bottom <= sideways.screen, `the first reason ends at ${sideways.reason.bottom}px on a screen ${sideways.screen}px tall`);
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('in a real browser the first reason of the longest first card is on the first screen of a short phone, ahead of the sentence there and after it on a tall one', { skip }, async () => {
  const box = sandbox();
  // The worst case seen on the owner's runs: a three-line title, a six-line sentence, a tall terminal picture and five reasons.
  const roots = finishedRuns(box, [['tells', {
    title: 'tells: what a git repo is about, in thirty seconds',
    pitch: 'Run it in any git repo and one screen shows where the weight is, what changed lately and who touched it, which files change together, and the files to fear, each with its reason in numbers.',
  }]]);
  fs.writeFileSync(path.join(roots[0], '.100x', 'hero.png'), gradientPng(600, 1700));
  const why = ['SCARY flags healthy, actively-owned files: size plus churn alone guarantee a listing', 'People do not match git: a mailmap is ignored and different people who share a name are merged into one', 'The graph of files that change together has no scale', 'Nothing says what happens in a repo with one commit', 'The command is not on a path after install'].map((title) => ({ title, state: 'fixed' }));
  rewriteRegistry(box, (row) => {
    row.review = { ...row.review, rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false, why } };
  });
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
    const measure = () => page.evaluate(() => {
      const card = document.querySelector('.card');
      const at = (selector) => {
        const { top, bottom } = card.querySelector(selector).getBoundingClientRect();
        return { top, bottom };
      };
      return { what: at('.what'), trust: at('.trust'), reason: at('.reasons li'), screen: innerHeight };
    });
    const tall = await measure();
    assert.ok(tall.what.bottom <= tall.trust.top, 'on a tall phone the sentence that says what the run is comes first');
    assert.ok(tall.reason.bottom <= tall.screen, `and the first reason ends at ${tall.reason.bottom}px of ${tall.screen}`);
    for (const [width, height] of [[375, 667], [360, 640], [320, 568], [280, 653], [640, 360], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const small = await measure();
      assert.ok(small.trust.bottom <= small.what.top, `${width}x${height}: the verdict and its reasons come before the sentence`);
      assert.ok(small.reason.bottom <= small.screen, `${width}x${height}: the first reason ends at ${small.reason.bottom}px of ${small.screen}`);
    }
    await page.setViewportSize({ width: 320, height: 568 });
    assert.ok(await page.$eval('.lede', (lede) => lede.getBoundingClientRect().height <= 1), 'the line of counts waits for a screen reader on a short phone, because the buttons say the same');
    assert.match(await page.$eval('.lede', (lede) => lede.textContent), /1 prototype so far/, 'and it is still there to be read');
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('in a real browser the filter row fades at its right edge while there is more of it to scroll to, and not at its end', { skip }, async () => {
  const box = sandbox();
  finishedRuns(box, [['one', {}], ['two', {}], ['three', {}]]);
  rewriteRegistry(box, (row) => {
    if (row.title === 'two') row.review = { status: 'unreviewed', note: 'no judge was reachable' };
    if (row.title === 'three') {
      row.mode = 'mockup';
      row.review = { status: 'unreviewed', note: 'mockup mode, no judges by design' };
    }
  });
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 320, height: 568 } })).newPage();
    await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
    const more = () => page.$eval('.filters', (row) => row.hasAttribute('data-more'));
    assert.equal(await more(), true, 'four buttons do not fit in 320 pixels, so the row says it goes on');
    assert.match(await page.$eval('.filters', (row) => getComputedStyle(row).maskImage || getComputedStyle(row).webkitMaskImage), /linear-gradient/, 'by fading its last button');
    await page.$eval('.filters', (row) => { row.scrollLeft = row.scrollWidth; });
    await page.waitForFunction(() => !document.querySelector('.filters').hasAttribute('data-more'), null, { timeout: 5000 });
    assert.equal(await more(), false, 'at its end there is nothing to fade to');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => !document.querySelector('.filters').hasAttribute('data-more'), null, { timeout: 5000 });
    assert.equal(await more(), false, 'on a wide screen all of it shows, and nothing fades');
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('in a real browser no title is broken in the middle of a word on the narrowest phone, and the widest badge sits inside its picture', { skip }, async () => {
  const box = sandbox();
  finishedRuns(box, [['lantern-point', { title: 'Lantern Point' }], ['unicorn-academy', { title: 'Unicorn Academy' }]]);
  rewriteRegistry(box, (row) => {
    if (row.title === 'Lantern Point') row.review = { status: 'unreviewed', note: 'off' };
    else row.matrix = { ...row.matrix, totals: { ...row.matrix.totals, broken: 3 } };
  });
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 280, height: 653 } })).newPage();
    await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
    const badges = await page.evaluate(() => [...document.querySelectorAll('.card')].map((card) => {
      const badge = card.querySelector('.badge').getBoundingClientRect();
      const picture = card.querySelector('.pic').getBoundingClientRect();
      return { text: card.querySelector('.badge').textContent, inside: badge.left >= picture.left && badge.right <= picture.right };
    }).sort((a, b) => a.text.localeCompare(b.text)));
    assert.deepEqual(badges, [{ text: 'Broken screens', inside: true }, { text: 'No judge', inside: true }], 'the longest badges fit inside the picture they sit on');
    const broken = await page.evaluate(() => [...document.querySelectorAll('.card h2')].filter((title) => {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(title).font}`;
      document.body.append(probe);
      const widest = Math.max(...title.textContent.split(/\s+/).map((word) => {
        probe.textContent = word;
        return probe.getBoundingClientRect().width;
      }));
      probe.remove();
      return widest > title.clientWidth + 0.5;
    }).map((title) => title.textContent));
    assert.deepEqual(broken, [], 'every word of a title fits the width the title has');
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('in a real browser with the text twice as large on a phone, no title is broken in the middle of a word and no filter button is cut off at the edge', { skip }, async () => {
  const box = sandbox();
  finishedRuns(box, [['lantern-point', { title: 'Lantern Point' }], ['second', {}], ['third', {}]]);
  rewriteRegistry(box, (row) => {
    row.review = { status: 'unreviewed', note: 'off' };
  });
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
    // The text size a phone's settings give: every font size doubles and the width of the screen stays.
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('body, body *')];
      const sizes = all.map((el) => parseFloat(getComputedStyle(el).fontSize));
      all.forEach((el, i) => el.style.setProperty('font-size', `${sizes[i] * 2}px`, 'important'));
    });
    const broken = await page.evaluate(() => [...document.querySelectorAll('.card h2')].filter((title) => {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(title).font}`;
      document.body.append(probe);
      const widest = Math.max(...title.textContent.split(/\s+/).map((word) => {
        probe.textContent = word;
        return probe.getBoundingClientRect().width;
      }));
      probe.remove();
      return widest > title.clientWidth + 0.5;
    }).map((title) => title.textContent));
    assert.deepEqual(broken, [], 'every word of a title fits the width the title has, because the badge goes under the title');
    const cut = await page.evaluate(() => [...document.querySelectorAll('.filters button')].filter((button) => button.getBoundingClientRect().right > window.innerWidth + 0.5).map((button) => button.textContent));
    assert.deepEqual(cut, [], 'the filter buttons wrap and none runs off the edge');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page does not scroll sideways');
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('in a real browser the first screen of a phone holds the title, the trust line and the start of the moment, even above a tall picture, and a phone held sideways holds the title', { skip }, async () => {
  const box = sandbox();
  finishedRuns(box, [['tall-shot', {}]]);
  fs.writeFileSync(path.join(box.dir, 'tall-shot', '.100x', 'hero.png'), gradientPng(600, 1700));
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const url = pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href;
    const edges = async (width, height) => {
      const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
      await page.goto(url);
      return page.evaluate(() => {
        const at = (selector) => document.querySelector(`.card ${selector}`).getBoundingClientRect();
        return { title: Math.round(at('h2').bottom), trust: Math.round(at('.trust').bottom), momentStarts: Math.round(at('.momentline').top) };
      });
    };
    const phone = await edges(390, 844);
    assert.ok(phone.title < 844 && phone.trust < 844 && phone.momentStarts < 800, `the decision is on the first screen of a phone: ${JSON.stringify(phone)}`);
    const small = await edges(320, 568);
    assert.ok(small.title < 568 && small.trust < 568, `the decision is on the first screen of the smallest phone: ${JSON.stringify(small)}`);
    const sideways = await edges(844, 390);
    assert.ok(sideways.title < 390, `the title is on the first screen of a phone held sideways: ${JSON.stringify(sideways)}`);
  } finally {
    await browser.close();
    box.cleanup();
  }
});

test('morning --since leaves out older runs and --all brings them back', () => {
  const box = sandbox();
  finishedRuns(box, [['recent', {}], ['old', {}]]);
  const registry = path.join(box.home, '.100x', 'runs.jsonl');
  const lines = fs.readFileSync(registry, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  lines.find((e) => e.title === 'old').finishedAt = new Date(Date.now() - 3 * 86400000).toISOString();
  fs.writeFileSync(registry, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  assert.match(cli(['morning', '--since', '18h'], { env: box.env }).out, /Report\. 1 prototype in the last 18 hours/);
  assert.match(cli(['morning', '--all'], { env: box.env }).out, /Report\. 2 prototypes/);
  assert.match(cli(['morning', '--since', 'soon'], { env: box.env }).err, /--since takes hours or days/);
  box.cleanup();
});

test('a registry with nothing in it says how a first run gets there, in the terminal and on the page, and never points at older runs that do not exist', () => {
  const box = sandbox();
  const quiet = cli(['morning'], { env: box.env });
  assert.equal(quiet.code, 0, quiet.err);
  assert.match(quiet.out, /Report\. No finished runs yet\. Run the 100x skill with a brief in your agent app/);
  assert.doesNotMatch(quiet.out, /older runs/, 'a first morning has no older runs to look for');
  const quietHtml = fs.readFileSync(/gallery (.*)/.exec(quiet.out)[1], 'utf8');
  const empty = cli(['morning', '--all'], { env: box.env });
  assert.equal(empty.code, 0, empty.err);
  assert.match(empty.out, /Report\. No finished runs yet\. Run the 100x skill with a brief in your agent app/);
  const html = fs.readFileSync(/gallery (.*)/.exec(empty.out)[1], 'utf8');
  assert.match(html, /<div class="empty"><p><b>No finished runs yet\.<\/b><\/p>/);
  assert.doesNotMatch(html, /registry list --all|No runs to show/, 'the page never sends the owner to find runs it just said do not exist');
  assert.match(quietHtml, /<div class="empty"><p><b>No finished runs yet\.<\/b><\/p><p>Run the 100x skill with a brief in your agent app/);
  assert.doesNotMatch(quietHtml, /older runs|index-all|Show every finished run/, 'the page of a first morning links to nothing');
  assert.equal(fs.existsSync(path.join(box.home, '.100x', 'morning', 'index-all.html')), false, 'no second page is built when there is nothing to put in it');
  box.cleanup();
});

test('a window with nothing in it, over a registry that has runs, points at them, in the terminal and on the page', () => {
  const box = sandbox();
  finishedRuns(box, [['older', {}]]);
  rewriteRegistry(box, (row) => {
    row.finishedAt = new Date(Date.now() - 3 * 86400000).toISOString();
  });
  const quiet = cli(['morning'], { env: box.env });
  assert.match(quiet.out, /Report\. Nothing finished in the last 18 hours\. `100x-report all` shows older runs\./);
  assert.match(fs.readFileSync(/gallery (.*)/.exec(quiet.out)[1], 'utf8'), /<a href="index-all\.html">Show every finished run<\/a>/);
  assert.match(cli(['morning', '--since', '1h'], { env: box.env }).out, /Report\. Nothing finished in the last hour\. /, 'one hour is not "1 hours"');
  assert.match(cli(['morning', '--since', '4d'], { env: box.env }).out, /Report\. 1 prototype in the last 96 hours/, 'days are said as hours, and the many say hours');
  box.cleanup();
});

test('the served page of an empty registry says how a first run gets there and offers no older runs', async () => {
  const box = sandbox();
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, hours: 18 });
  try {
    const html = (await request(gallery.url, '')).body.toString();
    assert.match(html, /<div class="empty"><p><b>No finished runs yet\.<\/b><\/p><p>Run the 100x skill with a brief in your agent app/);
    assert.doesNotMatch(html, /older runs|\?all=1|Show every finished run/);
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('a quiet window in the served page links to every run, and the link shows them', async () => {
  const box = sandbox();
  finishedRuns(box, [['older', {}]]);
  rewriteRegistry(box, (row) => {
    row.finishedAt = new Date(Date.now() - 3 * 86400000).toISOString();
  });
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, hours: 18 });
  try {
    const quiet = (await request(gallery.url, '')).body.toString();
    assert.match(quiet, /<p><a href="\?all=1">Show every finished run<\/a><\/p>/);
    assert.doesNotMatch(quiet, /<h2>older<\/h2>/);
    const all = (await request(gallery.url, '?all=1')).body.toString();
    assert.match(all, /<h2>older<\/h2>/);
    assert.doesNotMatch(all, /Show every finished run/);
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('the gallery server checks token, host and header, and serves only the run folder', async () => {
  const box = sandbox();
  const [root] = finishedRuns(box, [['served', {}]]);
  const id = JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out)[0].id;
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    const base = gallery.url;
    const home = await request(base, '');
    assert.equal(home.status, 200);
    assert.match(home.body.toString(), /data-mode="serve"/);
    const expired = await request(base.replace(gallery.token, 'wrong'), '');
    assert.equal(expired.status, 404);
    assert.match(expired.type, /^text\/html/);
    assert.match(expired.body.toString(), /<h1>This link has expired\.<\/h1><p>Call <code>100x-report<\/code> and you get a new one\.<\/p>/, 'an old link says what to do in a page of its own look, and not two bare words');
    assert.equal((await request(base, '', { host: 'evil.example' })).status, 403);
    assert.equal((await request(base, `api/run/${id}`, { method: 'POST' })).status, 403, 'POST needs the header');
    const hero = await request(base, `file/${id}/hero.png`);
    assert.equal(hero.status, 200);
    assert.equal(hero.type, 'image/png');
    assert.deepEqual(hero.body, PNG);
    fs.writeFileSync(path.join(root, 'secret.txt'), 'nope');
    assert.ok([403, 404].includes((await request(base, `file/${id}/..%2Fsecret.txt`)).status), 'no path traversal out of .100x');
    if (!noFileLinks) {
      symlink(path.join(root, 'secret.txt'), path.join(root, '.100x', 'link.txt'));
      assert.equal((await request(base, `file/${id}/link.txt`)).status, 403, 'no symlink escape');
    }
  } finally {
    await gallery.close();
    process.env.X100_HOME = previous ?? '';
    if (previous === undefined) delete process.env.X100_HOME;
  }
  box.cleanup();
});

test('a run\'s report links back to the page with every run, and the report the served page opens links to the served page', async () => {
  const box = sandbox();
  const [root] = finishedRuns(box, [['linked', {}]]);
  const id = JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out)[0].id;
  const index = pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href;
  const onDisk = fs.readFileSync(path.join(root, '.100x', 'REPORT.html'), 'utf8');
  assert.ok(onDisk.includes(`<a class="back" href="${index}">All finished runs</a>`), 'the report opened from a file goes back to the page file');
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    const served = (await request(gallery.url, `file/${id}/REPORT.html`)).body.toString();
    assert.ok(served.includes('<a class="back" href="../../">All finished runs</a>'), 'the same report opened from the served page goes back to the served page');
    assert.ok(!served.includes('file://'), 'and holds no address of a file on this machine');
    assert.equal(new URL('../../', new URL(`file/${id}/REPORT.html`, gallery.url)).href, gallery.url, 'two folders up from the report is the served page');
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('a run with no address gets the command to copy in the served page too, because Run has nothing to open, and the others keep Run', async () => {
  const box = sandbox();
  finishedRuns(box, [['with-address', {}], ['no-address', { url: undefined, runCmd: 'node tool.mjs' }]]);
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    const html = (await request(gallery.url, '')).body.toString();
    assert.equal(html.match(/data-run="/g).length, 1, 'only the run with an address has a Run button');
    assert.match(html, /data-copy="cd [^"]*no-address &amp;&amp; node tool\.mjs"/);
    assert.match(html, /if\(!run\)continue;/, 'the status paint skips a card that has no Run button instead of stopping');
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('a run whose address is a file or lives online gets the command to copy in the served page, and Run refuses to start it', async () => {
  const box = sandbox();
  const marker = path.join(box.dir, 'ran.txt');
  finishedRuns(box, [['local-run', {}], ['a-file', {}], ['online', {}]]);
  rewriteRegistry(box, (row) => {
    if (row.title === 'a-file') Object.assign(row, { url: `file://${row.path}/index.html`, runCmd: `touch ${marker}` });
    if (row.title === 'online') Object.assign(row, { url: 'https://preview.example.com/', runCmd: `touch ${marker}` });
  });
  const ids = Object.fromEntries(JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out).map((row) => [row.title, row.id]));
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    const html = (await request(gallery.url, '')).body.toString();
    assert.equal(html.match(/data-run="/g).length, 1, 'only the run with an address on this machine has a Run button');
    assert.equal([...html.matchAll(/Its address is not a server on this machine\. Copy the command and run it in a terminal\./g)].length, 2, 'the two others say why they have no Run button');
    assert.doesNotMatch(html, /Open the file/, 'no button promises what the page cannot do');
    assert.equal([...html.matchAll(/data-copy="[^"]*touch /g)].length, 2, 'and they keep the command to copy');
    for (const title of ['a-file', 'online']) {
      const refused = await request(gallery.url, `api/run/${ids[title]}`, { method: 'POST', headers: { 'X-100x': '1' } });
      assert.equal(refused.status, 422, `${title}: ${refused.body}`);
      assert.match(JSON.parse(refused.body).error, /not a server on this machine/);
    }
    assert.equal(fs.existsSync(marker), false, 'the command of a run the page cannot start was not run');
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('Run starts the prototype, waits for its port, Stop ends it', async () => {
  const box = sandbox();
  const port = await freePort();
  const server = `node -e "require('http').createServer((q,s)=>s.end('hello from the prototype')).listen(process.env.PORT,'127.0.0.1')"`;
  finishedRuns(box, [['runnable', { runCmd: server, url: `http://127.0.0.1:${port}/` }]]);
  const id = JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out)[0].id;
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    const started = await request(gallery.url, `api/run/${id}`, { method: 'POST', headers: { 'X-100x': '1' } });
    assert.equal(started.status, 200, started.body.toString());
    assert.equal(JSON.parse(started.body).url, `http://127.0.0.1:${port}/`);
    assert.equal(await listening(port), true);
    const page = await request(`http://127.0.0.1:${port}/`, '');
    assert.equal(page.body.toString(), 'hello from the prototype');
    const status = JSON.parse((await request(gallery.url, 'api/status')).body);
    assert.equal(status[id].running, true);
    const stopped = await request(gallery.url, `api/stop/${id}`, { method: 'POST', headers: { 'X-100x': '1' } });
    assert.equal(JSON.parse(stopped.body).ok, true);
    for (let i = 0; i < 20 && (await listening(port)); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await listening(port), false, 'the port is closed after Stop');
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('Run reports a crash with the log path instead of hanging, and the log is one of the files the page serves', async () => {
  const box = sandbox();
  const port = await freePort();
  finishedRuns(box, [['crashy', { runCmd: 'echo boom; exit 3', url: `http://127.0.0.1:${port}/` }]]);
  const id = JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out)[0].id;
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  try {
    const result = await request(gallery.url, `api/run/${id}`, { method: 'POST', headers: { 'X-100x': '1' } });
    assert.equal(result.status, 500);
    const answer = JSON.parse(result.body);
    assert.match(answer.error, /exited with code 3\. See .*dev\.log/);
    assert.equal(answer.log, `file/${id}/dev.log`, 'the page can link the log through the files it serves');
    const log = await request(gallery.url, answer.log);
    assert.equal(log.status, 200);
    assert.match(log.type, /^text\/plain/, 'a log opens in the browser and does not download');
    assert.match(log.body.toString(), /boom/);
  } finally {
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('Run does not open a prototype it did not start: it says who holds the address, or offers to open it anyway when it cannot tell', async () => {
  const box = sandbox();
  const port = await freePort();
  const marker = path.join(box.dir, 'ran.txt');
  const server = `node -e "require('http').createServer((q,s)=>s.end('hello from the prototype')).listen(process.env.PORT,'127.0.0.1')"`;
  // Two runs recorded at one address, as two prototypes of one night that both took the port the dev server picks first.
  finishedRuns(box, [
    ['lantern-point', { runCmd: server, url: `http://127.0.0.1:${port}/` }],
    ['unicorn-academy', { runCmd: `echo started > ${marker}; ${server}`, url: `http://127.0.0.1:${port}/` }],
  ]);
  const ids = Object.fromEntries(JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out).map((row) => [row.title, row.id]));
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  const post = (route) => request(gallery.url, route, { method: 'POST', headers: { 'X-100x': '1' } });
  const stranger = http.createServer((q, s) => s.end('something else'));
  await new Promise((resolve) => stranger.listen(port, '127.0.0.1', resolve));
  try {
    const refused = await post(`api/run/${ids['unicorn-academy']}`);
    assert.equal(refused.status, 409, 'a held address is a conflict, and not a start');
    const answer = JSON.parse(refused.body);
    assert.equal(answer.ok, false);
    assert.equal(answer.error, `Something is already running at http://127.0.0.1:${port}/, so this page did not start unicorn-academy. Open it only if that is unicorn-academy.`);
    assert.equal(answer.openAnyway, `http://127.0.0.1:${port}/`, 'what to open is the owner\'s call, and the page gives the link');
    assert.equal(fs.existsSync(marker), false, 'the command did not run');
    await new Promise((resolve) => stranger.close(resolve));

    const first = await post(`api/run/${ids['lantern-point']}`);
    assert.equal(first.status, 200, first.body.toString());
    const second = await post(`api/run/${ids['unicorn-academy']}`);
    assert.equal(second.status, 409);
    const named = JSON.parse(second.body);
    assert.equal(named.error, `lantern-point, which this page started, is already running at http://127.0.0.1:${port}/. Stop it to run unicorn-academy.`, 'when this page started the one that holds it, it says which');
    assert.equal(named.openAnyway, undefined, 'and there is nothing to open anyway, because that would show the other prototype');
    await post(`api/stop/${ids['lantern-point']}`);
  } finally {
    if (stranger.listening) await new Promise((resolve) => stranger.close(resolve));
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
  }
  box.cleanup();
});

test('in a real browser the card says it did not start a run whose address is taken, and opens nothing until the link is pressed', { skip }, async () => {
  const box = sandbox();
  const port = await freePort();
  finishedRuns(box, [['taken', { runCmd: 'exit 3', url: `http://127.0.0.1:${port}/` }]]);
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  const stranger = http.createServer((q, s) => s.end('something else'));
  await new Promise((resolve) => stranger.listen(port, '127.0.0.1', resolve));
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const opened = [];
    context.on('page', (other) => opened.push(other));
    await page.goto(gallery.url);
    await page.locator('[data-run]').click();
    const problem = page.locator('[data-problem]');
    await problem.waitFor({ state: 'visible', timeout: 20000 });
    assert.match(await problem.innerText(), /^Something is already running at http:\/\/127\.0\.0\.1:\d+\/, so this page did not start taken\. Open it only if that is taken\. Open it anyway$/);
    assert.equal(opened.length, 0, 'nothing is opened until the owner presses the link');
    const link = problem.locator('a');
    assert.equal((await link.innerText()).trim(), 'Open it anyway');
    assert.equal(await link.getAttribute('href'), `http://127.0.0.1:${port}/`);
    assert.equal(await page.locator('[data-run]').isVisible(), true, 'the button is back, and nothing shows as running');
  } finally {
    await browser.close();
    await new Promise((resolve) => stranger.close(resolve));
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
    box.cleanup();
  }
});

test('in a real browser the served page keeps Stop and Open hidden until something runs, shows a failed start on the card with no dialog, and opens and stops a prototype', { skip }, async () => {
  const box = sandbox();
  const port = await freePort();
  const server = `node -e "require('http').createServer((q,s)=>s.end('hello from the prototype')).listen(process.env.PORT,'127.0.0.1')"`;
  finishedRuns(box, [
    ['crashy', { runCmd: 'exit 3', url: `http://127.0.0.1:${await freePort()}/` }],
    ['runnable', { runCmd: server, url: `http://127.0.0.1:${port}/` }],
  ]);
  const previous = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  const gallery = await startServer({ port: 0, all: true });
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      dialog.dismiss();
    });
    await page.goto(gallery.url);
    const crashy = page.locator('.card', { hasText: 'crashy' });
    const runnable = page.locator('.card', { hasText: 'runnable' });
    for (const card of [crashy, runnable]) {
      assert.equal(await card.locator('[data-run]').isVisible(), true, 'Run is there');
      assert.equal(await card.locator('[data-stop]').isVisible(), false, 'nothing runs, so there is nothing to stop');
      assert.equal(await card.locator('[data-open]').isVisible(), false, 'nothing runs, so there is no address to open');
      assert.equal(await card.locator('[data-problem]').isVisible(), false);
    }

    await crashy.locator('[data-run]').click();
    await crashy.locator('[data-problem]').waitFor({ state: 'visible', timeout: 20000 });
    assert.match(await crashy.locator('[data-problem]').innerText(), /exited with code 3/);
    const logLink = crashy.locator('[data-problem] a');
    assert.equal((await logLink.innerText()).trim(), 'See the log', 'the failure line gives the log as words to tap, and not a path to copy');
    assert.match(await logLink.getAttribute('href'), /^file\/[0-9a-f]+\/dev\.log$/);
    assert.equal((await crashy.locator('[data-run]').innerText()).trim(), 'Run and open', 'the button is back after a failed start, with its own label');
    assert.equal(await crashy.locator('[data-run]').isEnabled(), true);

    const opened = context.waitForEvent('page');
    await runnable.locator('[data-run]').click();
    const popup = await opened;
    await popup.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 20000 });
    await runnable.locator('[data-stop]').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await runnable.locator('[data-open]').isVisible(), true, 'Open shows once it runs');
    assert.equal(await runnable.locator('[data-run]').isVisible(), false, 'Run goes while it runs');
    await runnable.locator('[data-stop]').click();
    await runnable.locator('[data-stop]').waitFor({ state: 'hidden', timeout: 20000 });
    assert.equal(await runnable.locator('[data-run]').isVisible(), true, 'Run is back after Stop');
    assert.deepEqual(dialogs, [], 'a failed start is a line on the card, not a dialog');
  } finally {
    await browser.close();
    await gallery.close();
    if (previous === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = previous;
    box.cleanup();
  }
});

test('in a real browser a copy button that the clipboard refuses copies by hand, and leaves nothing selected or open when that worked', { skip }, async () => {
  const box = sandbox();
  finishedRuns(box, [['copyable', {}]]);
  assert.equal(cli(['morning', '--all'], { env: box.env }).code, 0);
  const browser = await resolvePlaywright(process.cwd()).playwright.chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    for (const worked of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.addInitScript((copied) => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
        document.execCommand = () => copied;
      }, worked);
      await page.goto(pathToFileURL(path.join(box.env.X100_HOME, 'morning', 'index.html')).href);
      const button = page.locator('[data-copy]').first();
      const command = await button.getAttribute('data-copy');
      assert.match(command, /^cd .+ && /);
      assert.equal(await page.evaluate(() => document.querySelector('.card .cmd').open), false, 'the command starts folded');
      await button.click();
      const selected = (await page.evaluate(() => String(getSelection()))).replace(/\s+/g, ' ').trim();
      const open = await page.evaluate(() => document.querySelector('.card .cmd').open);
      if (worked) {
        assert.equal((await button.textContent()).trim(), 'Copied');
        assert.equal(selected, '', 'nothing stays selected after a copy that worked');
        assert.equal(open, false, 'and the fold it opened to select from is shut again');
      } else {
        assert.match((await button.textContent()).trim(), /^Selected\. Press (Cmd|Ctrl)\+C$/, 'the button says what is left to do');
        assert.equal(selected, command, 'the command is selected, ready to copy by hand');
        assert.equal(open, true, 'and shown');
      }
      await page.waitForFunction(() => document.querySelector('[data-copy]').textContent === 'Copy run command', null, { timeout: 10000 });
      await context.close();
    }
  } finally {
    await browser.close();
    box.cleanup();
  }
});

const REFUSED_WHY = [
  { title: 'A second tab erases newer progress', state: 'left' },
  { title: 'Nothing says what happens at zero people', state: 'fixed' },
  { title: 'The sound is sold unheard', state: 'disagreed' },
];

test('a run the judge refused shows why on its card and in the ranking, each reason with what became of it, and a run the judge passed shows none', () => {
  const box = sandbox();
  finishedRuns(box, [['refused', {}], ['passed', {}]]);
  rewriteRegistry(box, (row) => {
    const rounds = { held: 3, planned: 5, lenses: ['code'] };
    row.review = { ...row.review, rounds: row.title === 'refused' ? { ...rounds, lastReady: false, why: REFUSED_WHY } : { ...rounds, lastReady: true } };
  });
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /\n\d\d look refused\. A thing that glows\.\n {3}look {3}builder said ready to ship\. The judge said NOT ready to ship\.\n {3}why {4}1\) A second tab erases newer progress \(left for later\)\n {10}2\) Nothing says what happens at zero people \(fixed, not checked again\)\n {10}3\) The sound is sold unheard \(the builder disagreed\)\n {3}moment /, 'the look line says what the builder said and what the judge said, and the reasons stand under it');
  assert.equal([...result.out.matchAll(/ {3}why /g)].length, 1, 'a run the judge passed has no reasons');
  const html = galleryHtml(box);
  const card = (title) => html.slice(html.indexOf(`<h2>${title}</h2>`), html.indexOf('</article>', html.indexOf(`<h2>${title}</h2>`)));
  assert.match(card('refused'), /<div class="trust bad"><p>The judge said NOT ready to ship\.<\/p><ul class="reasons" aria-label="Why not ready to ship"><li>A second tab erases newer progress<span class="state left">left for later<\/span><\/li><li>Nothing says what happens at zero people<span class="state fixed">fixed, not checked again<\/span><\/li><\/ul><details class="more"><summary>and 1 more<\/summary><ul class="reasons" aria-label="More reasons"><li>The sound is sold unheard<span class="state disagreed">the builder disagreed<\/span><\/li><\/ul><\/details><\/div>/, 'two reasons in view, and the third a tap away on the card');
  assert.match(html, /<p class="rank"><span>No\. \d\d<\/span><span>builder said ready to ship<\/span><\/p><h2>refused<\/h2>/, 'the card says what the builder said, so ready to ship beside a refusal is not taken for the judge\'s word');
  assert.match(html, /<span class="badge look bad">Judge said no<\/span><\/div>\s*<div class="body">\s*<div class="head"><p class="rank"><span>No\. \d\d<\/span><span>builder said ready to ship/, 'and the badge on the picture says what the judge said');
  assert.match(html, /<p class="rank"><span>No\. \d\d<\/span><\/p><h2>passed<\/h2>/, 'a run that is only what it says has just its number');
  assert.doesNotMatch(card('passed'), /reasons|Why not ready to ship/);
  box.cleanup();
});

test('the ranking says in one line why the runs to look at first are there, the page says the same in its buttons, and neither says it in words when only one run is', () => {
  const box = sandbox();
  finishedRuns(box, [['no-a', {}], ['no-b', {}], ['no-c', {}], ['unjudged', {}], ['passed', {}]]);
  rewriteRegistry(box, (row) => {
    if (row.title.startsWith('no-')) row.review = { ...row.review, rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false } };
    if (row.title === 'unjudged') row.review = { status: 'unreviewed', note: 'no judge was reachable' };
  });
  const result = cli(['morning', '--all'], { env: box.env });
  assert.match(result.out, /^Report\. 5 prototypes so far, ranked by the builder's word\. 1 ready to ship, 4 to look at first\.\nWhy, the worst reason of each run: the judge said no to 3, no judge looked at 1\.\n\d\d ship passed\. /);
  const html = galleryHtml(box);
  assert.match(html, /<p class="lede">5 prototypes so far, ranked by the builder&#39;s word\. 1 ready to ship, 4 to look at first\.<\/p><\/header>/, 'the page keeps the one line, and the reasons are the buttons under it');
  assert.match(html, /<div class="filters" role="group" aria-label="Filter by what to look at first"><button type="button" data-filter="all" aria-pressed="true">All 5<\/button><button type="button" data-filter="judge-no" aria-pressed="false">Judge said no 3<\/button><button type="button" data-filter="no-judge" aria-pressed="false">No judge 1<\/button><button type="button" data-filter="ship" aria-pressed="false">Ready to ship 1<\/button><\/div>/, 'each button is a word a badge says, with its count, the biggest first');
  assert.equal((html.match(/data-verdict="judge-no"/g) ?? []).length, 3, 'and each card is filed under the word its badge says');
  assert.doesNotMatch(html, /Why, the worst/);
  const lone = sandbox();
  finishedRuns(lone, [['lone', {}]]);
  rewriteRegistry(lone, (row) => {
    row.review = { ...row.review, rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false } };
  });
  assert.doesNotMatch(cli(['morning', '--all'], { env: lone.env }).out, /Why,/);
  assert.doesNotMatch(galleryHtml(lone), /Why,/);
  lone.cleanup();
  box.cleanup();
});

test('when every reason on a card ended the same way the card says so once under the list, and a mixed list says it on each line', () => {
  const box = sandbox();
  finishedRuns(box, [['alike', {}], ['mixed', {}]]);
  rewriteRegistry(box, (row) => {
    const why = row.title === 'alike' ? [{ title: 'First thing', state: 'fixed' }, { title: 'Second thing', state: 'fixed' }] : REFUSED_WHY;
    row.review = { ...row.review, rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false, why } };
  });
  cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  const card = (title) => html.slice(html.indexOf(`<h2>${title}</h2>`), html.indexOf('</article>', html.indexOf(`<h2>${title}</h2>`)));
  assert.match(card('alike'), /<ul class="reasons" aria-label="Why not ready to ship"><li>First thing<\/li><li>Second thing<\/li><\/ul><p class="state fixed">Both reasons were fixed since\. Neither was checked again\.<\/p>/, 'the first reason is the first thing under the verdict');
  assert.doesNotMatch(card('mixed'), /All \d reasons were|Both reasons were/);
  assert.match(card('mixed'), /<span class="state left">left for later<\/span>/);
  box.cleanup();
});

test('a phone-shaped picture is shown at the width of its card, cropped to its top, and says that it opens full size; a wide one is left as it was', () => {
  const box = sandbox();
  finishedRuns(box, [['phone', {}, null, { hero: gradientPng(390, 844) }], ['wide', {}, null, { hero: gradientPng(800, 500) }]]);
  cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  const card = (title) => html.slice(html.indexOf(`<h2>${title}</h2>`), html.indexOf('</article>', html.indexOf(`<h2>${title}</h2>`)));
  const picture = (title) => html.slice(html.lastIndexOf('<a class="shot', html.indexOf(`<h2>${title}</h2>`)), html.indexOf('</a>', html.lastIndexOf('<a class="shot', html.indexOf(`<h2>${title}</h2>`))));
  assert.match(picture('phone'), /^<a class="shot tall"[^>]*><img [^>]*><span class="full">See it full size<\/span>$/);
  assert.doesNotMatch(picture('wide'), /full size|tall/);
  assert.match(html, /\.shot\.tall img\{width:100%;height:auto;max-height:26rem;object-fit:cover;object-position:top center\}/, 'cropped to its top at the width of the card, not shrunk to fit a box');
  assert.doesNotMatch(card('phone'), /object-fit:contain/);
  box.cleanup();
});

test('a run whose folder has started another run since keeps its picture, its report link and its reasons, and the gallery writes no page into the new run', () => {
  const box = sandbox();
  const [root] = finishedRuns(box, [['moved', {}, null, { findings: FINDINGS.replace('Ready to ship: yes', 'Ready to ship: no') }]]);
  rewriteRegistry(box, (row) => {
    delete row.review.rounds.why;
  });
  const fresh = cli(['init', '--fresh', '--no-git'], { cwd: root, env: box.env });
  assert.equal(fresh.code, 0, fresh.err);
  fs.writeFileSync(path.join(root, '.100x', 'run.json'), JSON.stringify(runJson({ title: 'The next run' })));
  assert.equal(fs.existsSync(path.join(root, '.100x', 'hero.png')), false, 'the picture moved aside with the rest of the run');
  const result = cli(['morning', '--all'], { env: box.env });
  assert.equal(result.code, 0, result.err);
  const html = galleryHtml(box);
  const archive = path.join(root, '.100x', 'archive');
  const stamp = fs.readdirSync(archive)[0];
  assert.match(html, new RegExp(`<img [^>]*src="[^"]*archive/${stamp}/hero\\.png"`), 'the picture is the one in the archive');
  assert.match(html, new RegExp(`<a href="[^"]*archive/${stamp}/REPORT\\.html">Report</a>`), 'and so is the report');
  assert.match(html, /<li>Upgrade button clipped at 320px<span class="state fixed">fixed, not checked again<\/span><\/li>/, 'the reasons are read from the archive');
  assert.equal(fs.existsSync(path.join(root, '.100x', 'REPORT.html')), false, 'the next run is not finished, so the gallery writes no report page into it');
  fs.rmSync(path.join(archive, stamp, 'REPORT.html'));
  cli(['morning', '--all'], { env: box.env });
  const textOnly = galleryHtml(box);
  assert.match(textOnly, new RegExp(`<a href="[^"]*archive/${stamp}/REPORT\\.md">Report as text</a>`), 'a run that finished before the page existed has its text report, and the card links that');
  assert.doesNotMatch(textOnly, /gone from its folder|you can cut<\/a>/, 'it does not say the report is gone, and the cut list is not a link into a page that is not there');
  box.cleanup();
});

test('a pitch that finish accepts is said whole on the card and in the ranking, and an older one past 240 characters is cut at a word with a dots mark in the same place', () => {
  const box = sandbox();
  const long = `${'A very long sentence about a game with many parts and many words '.repeat(3).trim()}.`;
  finishedRuns(box, [['long', { pitch: long }], ['older', { pitch: 'Placeholder.' }], ['short', { pitch: 'A short one.' }]]);
  const older = `${'An older pitch that was written before the limit existed and that goes on and on '.repeat(5).trim()}.`;
  rewriteRegistry(box, (row) => {
    if (row.title === 'older') row.pitch = older;
  });
  const result = cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  assert.ok(html.includes(`<p class="what">${long}</p>`), 'a long first sentence is on the card whole');
  assert.ok(result.out.includes(`long. ${long}\n`), 'and in the ranking');
  const cut = /<h2>older<\/h2>[\s\S]*?<p class="what">([^<]*…)<\/p>/.exec(html)?.[1];
  assert.ok(cut && cut.length <= 241 && !/\s…$/.test(cut), `the card cuts the older sentence at a word: ${cut}`);
  assert.ok(result.out.includes(`older. ${cut}\n`), 'the ranking cuts it in the same place');
  assert.ok(fs.readFileSync(path.join(box.dir, 'long', '.100x', 'REPORT.html'), 'utf8').includes(`<p class="pitch">${long}</p>`), 'the report page keeps the whole sentence');
  assert.match(result.out, /\n\d\d ship short\. A short one\.\n/, 'a short one is left alone');
  box.cleanup();
});

test('a card shows two reasons and folds the rest open on the card, and names the folder of its run', () => {
  const box = sandbox();
  finishedRuns(box, [['lantern-hollow', { title: 'Say less' }]]);
  const why = [1, 2, 3, 4, 5].map((n) => ({ title: `Reason number ${n}`, state: 'left' }));
  rewriteRegistry(box, (row) => {
    row.review = { ...row.review, rounds: { held: 3, planned: 5, lenses: ['code'], lastReady: false, why } };
  });
  const result = cli(['morning', '--all'], { env: box.env });
  const html = galleryHtml(box);
  assert.match(html, /<ul class="reasons" aria-label="Why not ready to ship">(?:<li>Reason number \d<\/li>){2}<\/ul><details class="more"><summary>and 3 more<\/summary><ul class="reasons" aria-label="More reasons">(?:<li>Reason number \d<\/li>){3}<\/ul><\/details><p class="state left">All 5 reasons were left for later\.<\/p>/, 'two on the card and the other three in a fold on it, so a card whose report is gone still has them, and all five ended alike so the card says it once, after the last of them, whether the fold is shut or open, with how many it covers');
  assert.doesNotMatch(html, /morereasons|more in the report/, 'the page never points at a report it may not have');
  assert.match(result.out, /\n {10}3\) Reason number 3 \(left for later\)\n {10}and 2 more on its card\n {3}moment /, 'and the ranking counts the rest on its own line, where the page has them whole');
  rewriteRegistry(box, (row) => {
    row.review.rounds.why = ['left', 'fixed', 'fixed', 'fixed', 'disagreed'].map((state, i) => ({ title: `Reason number ${i + 1}`, state }));
  });
  cli(['morning', '--all'], { env: box.env });
  assert.match(galleryHtml(box), /<details class="more"><summary>and 3 more<\/summary><ul class="reasons" aria-label="More reasons"><li>Reason number 3<span class="state fixed">fixed, not checked again<\/span><\/li><li>Reason number 4<span class="state fixed">fixed, not checked again<\/span><\/li><li>Reason number 5<span class="state disagreed">the builder disagreed<\/span><\/li><\/ul><\/details><\/div>/, 'mixed endings are said on each line, in the fold too');
  assert.match(html, /<p class="meta facts"><span>Finished [^<]*<\/span><span>Folder <code>lantern-hollow<\/code><\/span>/, 'the folder is labelled, says which project this is a run of, and each fact is a unit that wraps whole');
  box.cleanup();
});
