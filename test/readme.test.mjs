import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readableFacts } from '../lib/finish.mjs';
import { checkPrompt, PROMPT_MARKER } from '../lib/prompt.mjs';
import { chatSummary } from '../lib/report.mjs';
import { pageStamp, pictureStamp, readStamp } from '../scripts/readme-stamp.mjs';
import { ROOT, sandbox } from './helpers.mjs';

import { SAMPLE } from '../scripts/readme-sample.mjs';

test('the final message in the README is the one the code prints', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const block = readme.split('### 3. The summary comes from memory')[1]?.match(/```text\n([\s\S]*?)\n```/)?.[1];
  assert.ok(block, 'README has a text block under "3. The summary comes from memory"');
  assert.equal(block, chatSummary(SAMPLE));
});

test('the picture of the final message says exactly what the code prints', () => {
  const svg = fs.readFileSync(path.join(ROOT, 'docs', 'img', 'diagrams', 'final-message.svg'), 'utf8');
  const desc = svg.match(/<desc id="d">([\s\S]*?)<\/desc>/)?.[1]?.replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  assert.equal(desc, chatSummary(SAMPLE), 'Run node scripts/readme-diagrams.mjs to redraw docs/img/diagrams/final-message.svg');
});

test('the facts behind the README message are short enough for finish to accept', () => {
  assert.deepEqual(readableFacts(SAMPLE), []);
});

test('the picture of the report page in the README was drawn from the page the code builds now', () => {
  const stamp = readStamp();
  assert.equal(stamp.page, pageStamp(), 'The report page changed since docs/img/morning-gallery.jpg was drawn, so the README shows a page that is gone. Build a page with `100x morning --all`, run `node scripts/readme-picture.mjs <that page.html>`, look at the picture, and commit it with docs/img/morning-gallery.stamp.');
  assert.equal(stamp.picture, pictureStamp(), 'The picture changed and its stamp did not. Run `node scripts/readme-stamp.mjs` once the picture shows the page.');
});

test('the worked prompts the README links pass the prompt check, as their pages say', () => {
  for (const name of ['stock-comparison-prompt.md', 'budget-app-prompt.md']) {
    const page = fs.readFileSync(path.join(ROOT, 'docs', 'examples', name), 'utf8');
    const prompt = page.split('```markdown\n')[1]?.split('\n```')[0];
    assert.ok(prompt, `${name} holds its prompt in a markdown block`);
    const { project } = sandbox();
    fs.mkdirSync(path.join(project, '.100x'), { recursive: true });
    fs.writeFileSync(path.join(project, '.100x', 'project.md'), prompt + '\n');
    fs.writeFileSync(path.join(project, '.100x', PROMPT_MARKER), '');
    const check = checkPrompt(project);
    assert.deepEqual(check.problems, [], name);
    assert.ok(page.includes(`"${check.written.length} written, ${check.none.length} marked none, ${check.asks} asks"`), `${name} quotes the check it passes`);
  }
});

test('the release badge in the README names the version in package.json', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(readme.includes('docs/img/badges/release.svg'), 'the README shows the release badge');
  const svg = fs.readFileSync(path.join(ROOT, 'docs/img/badges/release.svg'), 'utf8');
  assert.ok(svg.includes(`aria-label="release: ${version}"`), `the release badge says ${version}`);
});
